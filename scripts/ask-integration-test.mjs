// The tool layer and the view layer: the two things the workspace is built on.
//
// The voice path does not write SQL. The realtime model picks named filters and
// the worker builds the statement, so what has to be true here is different
// from what assistant-sql-test checks: that a filter cannot reach outside the
// reader's scope, that a bad view hint is overruled by the shape of the result,
// and that nothing a tool returns carries a column or a query the reader was
// never meant to see.
//
//   node scripts/ask-integration-test.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const database = new DatabaseSync(":memory:");
for (const n of ["0000_dnc_project_hub.sql","0001_workbook_structure_and_roles.sql","0002_user_directory.sql","0003_development_pipeline_and_directory.sql","0004_pilot_authentication.sql","0005_profile_photos.sql","0006_enhanced_media_and_revisions.sql","0007_photo_details.sql"])
  database.exec(await readFile(`${root}/drizzle/${n}`, "utf8"));
const DB = { prepare(q){const st=database.prepare(q);const r=(b)=>({all:async()=>({results:st.all(...b)}),first:async()=>st.get(...b)??null,run:async()=>({success:true,meta:st.run(...b)})});return {bind:(...b)=>r(b),...r([])}}, batch:async(p)=>Promise.all(p.map(x=>x.run())) };
const worker = (await import(`${root}/dist/server/index.js`)).default;

const { runTool, searchTerm, whereFrom, REALTIME_TOOLS, TOOL_NAMES, TOOL_LABELS, ToolError } =
  await import(`${root}/worker/assistant-tools.js`);
const { chooseView, buildView, budgetTotals, marksFor, periodPairs, VIEW_KINDS } =
  await import(`${root}/worker/assistant-views.js`);
const { FORBIDDEN_COLUMNS } = await import(`${root}/worker/assistant-schema.js`);

const headers = {"oai-authenticated-user-id":"i","oai-authenticated-user-email":"i@example.invalid","oai-authenticated-user-full-name":"I","oai-authenticated-user-full-name-encoding":"percent-encoded-utf-8","content-type":"application/json"};
const env = { DB, ADMIN_EMAILS:"i@example.invalid", ALLOW_PLATFORM_AUTH:"true" };
await worker.fetch(new Request("https://i/api/bootstrap",{headers}), env, {});

const pw = "Zz9!" + crypto.randomUUID();
await worker.fetch(new Request("https://i/api/admin/users",{method:"POST",headers,body:JSON.stringify({
  first_name:"Tool",last_name:"Viewer",username:"tool@example.invalid",user_email:"tool@example.invalid",
  role:"viewer",business_unit_scope:"Gaming",account_status:"active",site_access_status:"authorized",
  temporary_password:pw,confirm_password:pw})}), env, {});
database.prepare("UPDATE user_directory SET must_change_password=0 WHERE lower(username)=?")
  .run("tool@example.invalid");

// Two ways in, each for what it is good at. The route is exercised through the
// platform-auth headers the other suites use, which is what proves the guards
// and the audit row; the scope cases call runTool directly with an explicit
// scope, because what they are about is the predicate, not the session.
const callTool = (name, args) => worker.fetch(new Request("https://i/api/assistant/tool",{
  method:"POST", headers, body: JSON.stringify({ name, arguments: args }) }), env, {});
const scoped = (name, args) => runTool(DB, name, args, ["Gaming"]);

let n = 0;
const check = async (label, fn) => {
  try { await fn(); n += 1; console.log(`  ok   ${label}`); }
  catch (problem) { console.log(`  FAIL ${label}\n       ${problem.message}`); process.exitCode = 1; }
};

const GAMING = database.prepare(`SELECT p.id, p.name FROM projects p
  JOIN business_units b ON b.id=p.business_unit_id
  WHERE b.name='Gaming' AND p.archived_at IS NULL`).all();
const OUTSIDE = database.prepare(`SELECT p.id, p.name, b.name AS unit FROM projects p
  JOIN business_units b ON b.id=p.business_unit_id
  WHERE b.name<>'Gaming' AND p.archived_at IS NULL LIMIT 1`).get();

// --- The route ---------------------------------------------------------------

await check("an unauthenticated tool call is refused", async () => {
  const reply = await worker.fetch(new Request("https://i/api/assistant/tool",{method:"POST",
    headers:{"content-type":"application/json"}, body:JSON.stringify({name:"find_projects"})}), env, {});
  assert.ok(reply.status === 401 || reply.status === 403, `got ${reply.status}`);
});

await check("a GET is refused: a tool call is not a read of a page", async () => {
  const reply = await worker.fetch(new Request("https://i/api/assistant/tool",{ headers }), env, {});
  assert.ok(reply.status === 405 || reply.status === 403, `got ${reply.status}`);
});

await check("an unknown tool name is refused rather than guessed at", async () => {
  const reply = await callTool("drop_everything", {});
  assert.equal(reply.status, 400);
});

await check("find_projects answers with a view, a line to speak, and a subject", async () => {
  const body = await (await callTool("find_projects", {})).json();
  assert.equal(body.ok, true);
  assert.ok(VIEW_KINDS.includes(body.view.kind), `unknown kind ${body.view.kind}`);
  assert.ok(typeof body.speak === "string" && body.speak.length > 0, "something to say");
  assert.ok(Array.isArray(body.subject.ids), "and what the answer is about");
  assert.ok(body.label, "and what to show while it runs");
});

// --- The permission boundary -------------------------------------------------

await check("a scoped reader sees only their own unit through a tool", async () => {
  const body = await scoped("find_projects", { limit: 50 });
  const names = GAMING.map((row) => row.name);
  assert.ok(body.view.data.rows.length > 0, "something came back");
  for (const row of body.view.data.rows) {
    assert.ok(names.includes(row.name), `${row.name} is outside the reader's scope`);
  }
});

await check("naming another unit returns nothing, not that unit", async () => {
  const body = await scoped("find_projects", { unit: OUTSIDE.unit });
  assert.equal(body.view.count, 0, `${OUTSIDE.unit} leaked through the unit filter`);
});

await check("an out-of-scope id in the ids filter reaches nothing", async () => {
  const body = await scoped("find_projects", { ids: [OUTSIDE.id] });
  assert.equal(body.view.count, 0, "a forged id must not widen what a reader sees");
});

await check("opening an out-of-scope project by id finds no project", async () => {
  const body = await scoped("project_detail", { project_id: OUTSIDE.id });
  assert.equal(body.view.kind, "empty");
  assert.match(body.speak, /no project/i);
});

await check("and the refusal reads as a search result, never as a permission notice", async () => {
  const body = await scoped("project_detail", { project_id: OUTSIDE.id });
  assert.ok(!/permission|scope|not allowed|forbidden/i.test(body.speak),
    "telling a reader a record exists but is hidden is itself a disclosure");
});

await check("a tool response never carries a query or a forbidden column", async () => {
  const text = await (await callTool("find_projects", {})).text();
  assert.ok(!/SELECT |FROM projects|WITH projects/i.test(text), "no SQL reaches the browser");
  for (const column of FORBIDDEN_COLUMNS) {
    assert.ok(!text.includes(`"${column}"`), `${column} reached the browser`);
  }
});

await check("the row cap holds whatever a tool asks for", async () => {
  const body = await scoped("find_projects", { limit: 5000 });
  assert.ok(body.view.data.rows.length <= 50, "50 is the cap, not a suggestion");
});

await check("a tool call is written to the audit log", async () => {
  const before = database.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action='assistant_ask'").get().n;
  await callTool("find_projects", {});
  const after = database.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action='assistant_ask'").get().n;
  assert.equal(after, before + 1);
});

// --- Finding a project by what someone called it ------------------------------

await check("a named thing is searched for without the label around it", () => {
  assert.equal(searchTerm("the Central City project"), "central city");
  assert.equal(searchTerm("CAPP number 08727"), "08727");
  assert.equal(searchTerm("initiative 44"), "44");
  assert.equal(searchTerm("Central City"), "central city");
});

await check("stripping the label never leaves an empty search", () => {
  // Every word was a label word. Falling through to the original text is better
  // than searching for "" and matching the whole portfolio.
  assert.ok(searchTerm("the project").length > 0);
});

await check("several matches to a name are an answer, not an ambiguity", async () => {
  const body = await scoped("project_detail", { search: "a" });
  if (body.view.count > 1) {
    assert.equal(body.view.kind, "project_list");
    assert.match(body.speak, /which one|match/i);
  }
});

await check("one project opens as a detail panel", async () => {
  const body = await scoped("project_detail", { project_id: GAMING[0].id });
  assert.equal(body.view.kind, "project_detail");
  assert.equal(body.view.data.project.name, GAMING[0].name);
  assert.deepEqual(body.subject.ids, [GAMING[0].id]);
});

// --- Component selection ------------------------------------------------------

await check("comparing a project with its previous period gives a comparison", async () => {
  const body = await scoped("compare_periods", { project_id: GAMING[0].id });
  assert.equal(body.view.kind, "change_comparison");
  assert.ok(Array.isArray(body.view.data.pairs), "with the pairs drawn side by side");
  assert.ok(Object.prototype.hasOwnProperty.call(body.view.data, "narrative"),
    "and what was written each period");
});

await check("comparing fewer than two projects is refused rather than half-done", async () => {
  const reply = await callTool("compare_projects", { ids: [GAMING[0].id] });
  assert.equal(reply.status, 400);
});

await check("two projects come back side by side", async () => {
  const body = await scoped("compare_projects", { ids: [GAMING[0].id, GAMING[1].id] });
  assert.equal(body.view.kind, "project_comparison");
  assert.equal(body.view.data.projects.length, 2);
  assert.ok(body.view.data.fields.length > 4, "with the fields worth comparing");
});

await check("a budget question is shown as budget figures", async () => {
  const body = await scoped("budget_analysis", {});
  assert.equal(body.view.kind, "budget_variance");
  assert.ok(body.view.data.totals, "with totals");
});

await check("a schedule question is shown as a schedule", async () => {
  const body = await scoped("schedule_analysis", {});
  assert.equal(body.view.kind, "schedule");
  assert.ok(body.view.data.totals, "with the slip counted");
});

await check("a risk question is shown as a distribution", async () => {
  const body = await scoped("risk_analysis", {});
  assert.equal(body.view.kind, "risk_summary");
  assert.ok(Array.isArray(body.view.data.buckets));
});

// --- The view layer overrules a hint that does not fit ------------------------

const oneRow = { aggregate:false, total:1, returned:1, truncated:false, rows:[{ id:1, name:"X" }] };
const manyRows = { aggregate:false, total:3, returned:3, truncated:false,
  rows:[{id:1,name:"A"},{id:2,name:"B"},{id:3,name:"C"}] };
const figure = { aggregate:true, total:1, returned:1, truncated:false, rows:[{ total_budget: 12 }] };
const grouped = { aggregate:true, total:3, returned:3, truncated:false,
  rows:[{unit:"A",n:1},{unit:"B",n:2},{unit:"C",n:3}] };

await check("a single figure is never rendered as a comparison, whatever was asked for", () =>
  assert.equal(chooseView("project_comparison", { result: figure, records: [] }), "figure"));

await check("a grouped result is never rendered as openable projects", () =>
  assert.equal(chooseView("project_list", { result: grouped, records: [] }), "group"));

await check("one project is a detail panel even when a list was asked for", () =>
  assert.equal(chooseView("project_list", { result: oneRow, records: [] }), "project_detail"));

await check("a budget hint is refused when the result carries no budget column", () =>
  assert.equal(chooseView("budget_variance", { result: manyRows, records: [] }), "project_list"));

await check("and honoured when it does", () => {
  const withBudget = { ...manyRows, rows: manyRows.rows.map((r) => ({ ...r, forecast_variance: 1 })) };
  assert.equal(chooseView("budget_variance", { result: withBudget, records: [] }), "budget_variance");
});

await check("an unknown hint falls back rather than rendering nothing", () =>
  assert.equal(chooseView("spreadsheet", { result: manyRows, records: [] }), "project_list"));

await check("no rows at all is its own component", () =>
  assert.equal(chooseView("project_list",
    { result: { ...manyRows, total:0, returned:0, rows:[] }, records: [] }), "empty"));

// --- The figures the components are built from --------------------------------

await check("a total says how many projects it is computed over, not how many exist", () => {
  const totals = budgetTotals([
    { approved_budget: 100, anticipated_final_cost: 120, forecast_variance: 20 },
    { approved_budget: null, anticipated_final_cost: null, forecast_variance: null },
    { approved_budget: 50, anticipated_final_cost: 40, forecast_variance: -10 },
  ]);
  assert.equal(totals.count, 3, "three projects");
  assert.equal(totals.approvedCount, 2, "but only two have an approved budget");
  assert.equal(totals.approved, 150);
  assert.equal(totals.variance, 10);
  assert.equal(totals.overBudget, 1);
  assert.equal(totals.underBudget, 1);
  assert.equal(totals.noFigures, 1, "and one is in neither camp");
});

await check("a missing figure is never counted as being on budget", () => {
  const totals = budgetTotals([{ approved_budget: null, anticipated_final_cost: null, forecast_variance: null }]);
  assert.equal(totals.overBudget, 0);
  assert.equal(totals.underBudget, 0);
  assert.equal(totals.noFigures, 1);
});

await check("a row carries at most the three state marks, and no others", () => {
  const marks = marksFor({ forecast_variance: 5, duration_change_days: 9, budget_risk: "High" });
  assert.deepEqual(marks, ["over_budget", "slipped", "high_risk"]);
  assert.deepEqual(marksFor({ forecast_variance: null, duration_change_days: null }), []);
  assert.deepEqual(marksFor({ forecast_variance: -5, duration_change_days: 0 }), []);
});

await check("a period pair with nothing on either side is left out rather than drawn empty", () => {
  const pairs = periodPairs({ original_turnover_date:null, current_turnover_date:null,
    original_start_date:null, current_start_date:null,
    approved_budget: 10, anticipated_final_cost: 12, forecast_variance: 2 });
  assert.equal(pairs.length, 1, "only the pair that has values");
  assert.equal(pairs[0].label, "Cost");
});

await check("the largest variance is a project that has one, never a missing value", async () => {
  const body = await scoped("find_projects", { order: "variance", limit: 1 });
  if (body.view.count > 0) {
    const row = body.view.data.rows ? body.view.data.rows[0] : body.view.data.project;
    const anyRecorded = database.prepare(`SELECT COUNT(*) AS n FROM projects p
      JOIN business_units b ON b.id=p.business_unit_id
      WHERE b.name='Gaming' AND p.archived_at IS NULL
        AND p.approved_budget IS NOT NULL AND p.anticipated_final_cost IS NOT NULL`).get().n;
    if (anyRecorded > 0) {
      assert.notEqual(row.forecast_variance, null,
        "SQLite sorts NULL first descending-last, so this has to be ordered explicitly");
    }
  }
});

// --- The tool catalogue the realtime model is given ---------------------------

await check("every tool is well formed for the realtime API", () => {
  for (const tool of REALTIME_TOOLS) {
    assert.equal(tool.type, "function", `${tool.name} is not a function tool`);
    assert.ok(tool.name && /^[a-z_]+$/.test(tool.name), `${tool.name} is not a usable name`);
    assert.ok(tool.description && tool.description.length > 20, `${tool.name} is not described`);
    assert.equal(tool.parameters.type, "object", `${tool.name} takes no object`);
    assert.ok(tool.parameters.properties, `${tool.name} declares no parameters`);
  }
});

await check("every tool has a line to show while it runs", () => {
  for (const name of TOOL_NAMES) {
    assert.ok(TOOL_LABELS[name], `${name} has nothing to show`);
    assert.equal(TOOL_LABELS[name], TOOL_LABELS[name].toLowerCase(),
      "the activity line is about the work, not shouted");
  }
});

await check("the filters a tool accepts are a closed set, never free text SQL", () => {
  for (const tool of REALTIME_TOOLS) {
    const keys = Object.keys(tool.parameters.properties);
    for (const key of keys) {
      assert.ok(!/sql|query|statement|where|select/i.test(key),
        `${tool.name} accepts ${key}, which is a way back to model-written SQL`);
    }
  }
});

await check("a filter builder binds every value rather than interpolating it", () => {
  const built = whereFrom({ unit: "Gaming'; DROP TABLE projects; --", search: "x", budget_min: 5 });
  assert.ok(!built.sql.includes("DROP"), "nothing from the model is in the statement text");
  assert.ok(built.bindings.includes("Gaming'; DROP TABLE projects; --"),
    "it is a bound value, where it can do nothing");
  assert.equal((built.sql.match(/\?/g) || []).length, built.bindings.length,
    "one placeholder per binding");
});

await check("an empty filter set produces no WHERE clause rather than a broken one", () => {
  assert.equal(whereFrom({}).sql, "");
  assert.deepEqual(whereFrom({}).bindings, []);
});

await check("runTool refuses a name that is not in the catalogue", async () => {
  await assert.rejects(() => runTool(DB, "exec", {}, null), (e) => e instanceof ToolError);
});

// --- The View contract --------------------------------------------------------

await check("every view carries what the workspace needs to render a header", () => {
  const view = buildView("project_list", { result: manyRows, records: manyRows.rows });
  assert.ok(view.kind && view.title, "a kind and a title");
  assert.ok(Object.prototype.hasOwnProperty.call(view, "subtitle"));
  assert.ok(Object.prototype.hasOwnProperty.call(view, "count"));
  assert.ok(view.data, "and the data its renderer reads");
});

await check("a truncated result says so in the view rather than hiding it", () => {
  const view = buildView("project_list",
    { result: { ...manyRows, total: 90, returned: 3, truncated: true }, records: manyRows.rows });
  assert.equal(view.truncated, true);
  assert.match(view.subtitle, /90 matched/);
});

console.log(`\n${n} checks passed.`);
if (!process.exitCode) {
  console.log("Tool and view layers: scope, filters, component selection, figures and catalogue covered.");
}
