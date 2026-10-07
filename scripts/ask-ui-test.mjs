// The conversational project-analysis workspace, walked end to end.
//
// Driven through the real worker and the real page with a deterministic stub
// generator, so what is under test is the workspace rather than the model.
//
// The invariant this suite exists to protect: the conversation never becomes a
// database-record list. Everything structured belongs to the workspace, and a
// question that follows on refines what is already there rather than replacing
// it.
//
//   node scripts/ask-ui-test.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { createBrowser } = await import(`${root}/scripts/browser-harness.mjs`);
const database = new DatabaseSync(":memory:");
for (const n of ["0000_dnc_project_hub.sql","0001_workbook_structure_and_roles.sql","0002_user_directory.sql","0003_development_pipeline_and_directory.sql","0004_pilot_authentication.sql","0005_profile_photos.sql","0006_enhanced_media_and_revisions.sql","0007_photo_details.sql"])
  database.exec(await readFile(`${root}/drizzle/${n}`, "utf8"));
const DB = { prepare(q){const st=database.prepare(q);const r=(b)=>({all:async()=>({results:st.all(...b)}),first:async()=>st.get(...b)??null,run:async()=>({success:true,meta:st.run(...b)})});return {bind:(...b)=>r(b),...r([])}}, batch:async(p)=>Promise.all(p.map(x=>x.run())) };
const worker = (await import(`${root}/dist/server/index.js`)).default;
const headers = {"oai-authenticated-user-id":"a","oai-authenticated-user-email":"a@example.invalid","oai-authenticated-user-full-name":"Acc","oai-authenticated-user-full-name-encoding":"percent-encoded-utf-8","content-type":"application/json"};
const base = { DB, ADMIN_EMAILS:"a@example.invalid", ALLOW_PLATFORM_AUTH:"true" };
await worker.fetch(new Request("https://t/api/bootstrap", { headers }), base, {});

// A Gaming-scoped viewer, so the permission steps test something real.
const pw = "Zz9!" + crypto.randomUUID();
await worker.fetch(new Request("https://t/api/admin/users",{method:"POST",headers,body:JSON.stringify({
  first_name:"Ui",last_name:"Viewer",username:"ui@example.invalid",user_email:"ui@example.invalid",
  role:"viewer",business_unit_scope:"Gaming",account_status:"active",site_access_status:"authorized",
  temporary_password:pw,confirm_password:pw})}), base, {});
database.prepare("UPDATE user_directory SET must_change_password = 0 WHERE lower(username)=?")
  .run("ui@example.invalid");

const COLUMNS = "id, name, business_unit, venue, section_name, status, phase, project_manager, "
  + "development_lead, budget_risk, schedule_risk, approved_budget, anticipated_final_cost, "
  + "forecast_variance, original_start_date, current_start_date, original_turnover_date, "
  + "current_turnover_date, duration_change_days, scope_description, current_update, "
  + "previous_update, reporting_period, project_type, capp_number, initiative_number";

// Each question yields its own query and its own view hint, so every component
// renderer is driven by something the worker actually produced.
let failNext = false;
const plan = (q) => {
  if (q.includes("nothing")) return { view: "project_list",
    sql: `SELECT ${COLUMNS} FROM projects WHERE name LIKE '%zzzz-no-such-project%'` };
  if (q.includes("budget")) return { view: "budget_variance", followUp: q.includes("those"),
    sql: `SELECT ${COLUMNS} FROM projects WHERE approved_budget IS NOT NULL` };
  if (q.includes("risk")) return { view: "risk_summary",
    sql: `SELECT ${COLUMNS} FROM projects WHERE budget_risk IS NOT NULL` };
  if (q.includes("turnover") || q.includes("slip")) return { view: "schedule",
    sql: `SELECT ${COLUMNS} FROM projects WHERE current_turnover_date IS NOT NULL` };
  if (q.includes("how many")) return { view: null,
    sql: "SELECT COUNT(*) AS projects FROM projects" };
  if (q.includes("by phase")) return { view: null,
    sql: "SELECT phase, COUNT(*) AS n FROM projects GROUP BY phase" };
  return { view: "project_list", sql: `SELECT ${COLUMNS} FROM projects` };
};
const generator = { async generate(question) {
  if (failNext) throw new Error("boom");
  const chosen = plan(String(question).toLowerCase());
  return { intent:"search", language:"English", message:null, followUp:!!chosen.followUp,
    view:chosen.view, sql:chosen.sql, usage:{model:"stub"} };
} };
const answerer = { async answer(question, result) {
  return { text: result.total ? `I found ${result.total} ${result.entityLabel}.`
    : "The search found no matching records.", usage:{model:"stub"} };
} };

const page = await (await worker.fetch(new Request("https://t/",{headers:{cookie:""}}), base, {})).text();
const browser = await createBrowser({ page, handler:(r) =>
  worker.fetch(r, { ...base, ASSISTANT_SQL:generator, ASSISTANT_ANSWERER:answerer }, {}) }).start();
browser.type("loginUsername","ui@example.invalid"); browser.type("loginPassword",pw);
await browser.fire("loginForm","submit").results; await browser.settle();

// Steps that need async work do it OUTSIDE step(), which is synchronous and
// would otherwise return before an async body ever ran — a passing test that
// asserts nothing. That was a real defect in the suite this replaces.
const ok = [];
const step = (n, label, fn) => {
  try { fn(); ok.push(n); console.log(`  ${String(n).padStart(2)} ok   ${label}`); }
  catch (e) { console.log(`  ${String(n).padStart(2)} FAIL ${label}\n       ${e.message}`); process.exitCode = 1; }
};
const ask = async (q) => {
  browser.type("wsInput", q);
  await browser.fire("wsForm","submit").results;
  await browser.settle();
};
const inSpace = (sel) => [...browser.byId("wsSpace").querySelectorAll(sel)];
const inThread = (sel) => [...browser.byId("wsThread").querySelectorAll(sel)];
const spaceText = () => browser.byId("wsSpace").textContent;

step(1, "the application opens signed in", () =>
  assert.equal(browser.byId("workspace").hidden, false));

await browser.fire("askNav","click").results; await browser.settle();
step(2, "the workspace opens from the existing navigation", () =>
  assert.equal(browser.byId("wsInput").closest("[data-pane]").hidden, false));

step(3, "the shell renders both surfaces and nothing else", () => {
  for (const id of ["wsPresence","wsThread","wsForm","wsInput","wsMic","wsSend",
    "wsSubject","wsScope","wsSpace","wsBriefSlot"]) assert.ok(browser.byId(id), id + " is present");
});

step(4, "the resting state offers questions rather than an empty box", () => {
  assert.ok(inSpace("[data-ws-ask]").length >= 3, "openers are offered");
  assert.equal(inSpace(".wscard").length, 0, "and nothing is pretending to be a result");
});

await ask("show me the projects");
step(5, "the question is echoed in the conversation", () =>
  assert.match(browser.byId("wsThread").textContent, /show me the projects/));
step(6, "and answered with a sentence", () =>
  assert.match(browser.byId("wsThread").textContent, /I found \d+ projects/));
step(7, "the composer is cleared ready for the next question", () =>
  assert.equal(browser.byId("wsInput").value, ""));

step(8, "the conversation never becomes a record list", () => {
  assert.equal(inThread(".wsrow").length, 0, "no project rows");
  assert.equal(inThread(".wscard").length, 0, "no workspace cards");
  assert.equal(inThread(".wsmets").length, 0, "no metric blocks");
  assert.equal(inThread("table").length, 0, "and never a table");
});

step(9, "exactly one card is in focus, and no card nests another", () => {
  assert.equal(inSpace(".wscard").length, 1);
});

step(10, "a list question renders a project list", () => {
  assert.ok(inSpace(".wsrow").length > 1, "rows are rendered");
  assert.ok(inSpace(".wsrow-name").length === inSpace(".wsrow").length,
    "every row names its project");
  assert.ok(inSpace(".wsrow-meta").length > 0, "and says where it is");
});

const gaming = database.prepare(`SELECT p.name FROM projects p
  JOIN business_units b ON b.id = p.business_unit_id
  WHERE b.name='Gaming' AND p.archived_at IS NULL`).all().map((r) => r.name);
step(11, "and only projects this viewer is allowed to see", () => {
  const shown = inSpace(".wsrow-name").map((el) => el.textContent);
  assert.ok(shown.length > 0);
  for (const name of shown) assert.ok(gaming.includes(name), `${name} is out of scope`);
});

step(12, "the subject says what is being looked at", () =>
  assert.ok(browser.text("wsSubject").trim().length > 0));
step(13, "and the answer links to the view it produced", () =>
  assert.ok(inThread("[data-ws-show]").length > 0));

const subjectAfterFirst = browser.text("wsSubject");
await ask("what are the budgets on those?");
step(14, "a follow-up collapses the previous result to a strip, not away", () =>
  assert.ok(inSpace(".wsstrip").length >= 1));
step(15, "and the subject grows rather than being replaced", () =>
  assert.ok(browser.text("wsSubject").length > subjectAfterFirst.length));
step(16, "a budget question renders budget figures, not a plain list", () => {
  assert.ok(inSpace(".wsmets").length === 1, "the metric row is rendered");
  assert.ok(inSpace(".wsmet-k").length >= 4, "with the figures a budget answer needs");
});
step(17, "every total says how many projects it is computed over", () => {
  const notes = inSpace(".wsmet-n").map((el) => el.textContent).join(" ");
  assert.match(notes, /recorded|with both figures|of \d+/,
    "a sum across the ones that have a figure is not a sum across the set");
});
step(18, "a variance is shown as a figure and a bar, never as typed punctuation", () => {
  assert.ok(inSpace(".wsbar").length > 0, "bars are drawn");
  assert.ok(!spaceText().includes("->") && !spaceText().includes("-->"),
    "no ASCII arrows anywhere in the workspace");
});

const strip = browser.byId("wsSpace").querySelector(".wsstrip");
await browser.fire(strip, "click").results; await browser.settle();
step(19, "an earlier result can be brought back into focus", () =>
  assert.ok(inSpace(".wsrow-name").length > 0));

await ask("which projects have high risk?");
step(20, "a risk question renders the risk component", () => {
  assert.ok(inSpace(".wsrisk").length === 1, "the distribution is drawn");
  assert.ok(inSpace(".wsrisk-row").length > 0, "with a row per level");
});
step(21, "a new subject folds the previous thread away rather than deleting it", () =>
  assert.ok(inSpace("[data-ws-earlier]").length === 1));

await ask("what are the turnover dates?");
step(22, "a schedule question renders the schedule component", () => {
  assert.ok(inSpace(".wsmets").length === 1);
  assert.match(spaceText(), /Slipped|Holding|No date/);
});

await ask("how many projects are there?");
step(23, "a single figure is shown as a figure, not as a one-row table", () => {
  assert.ok(inSpace(".wsbig").length === 1, "the figure component is used");
  assert.equal(inSpace(".wsrow").length, 0, "and no list is invented around it");
});

await ask("break that down by phase");
step(24, "a grouped result is shown as a group, not as openable projects", () => {
  assert.ok(inSpace(".wsgroup-row").length > 0, "the group component is used");
  assert.equal(inSpace("[data-ws-open]").length, 0,
    "nothing offers to open a row that has no project behind it");
});

await ask("show me the projects");
const firstRow = browser.byId("wsSpace").querySelector("[data-ws-open]");
const openedId = Number(firstRow.getAttribute("data-ws-open"));
const openedName = database.prepare("SELECT name FROM projects WHERE id = ?").get(openedId).name;
await browser.fire(firstRow, "click").results; await browser.settle();

step(25, "opening a row opens the project in the workspace", () =>
  assert.ok(spaceText().includes(openedName.slice(0, 12))));
step(26, "the detail shows the derived figures the tracker computes", () => {
  assert.match(spaceText(), /Forecast variance/);
  assert.match(spaceText(), /Turnover/);
});
step(27, "and never opens the edit form", () =>
  assert.equal(browser.byId("detailsDialog").open, false));
step(28, "nothing in the workspace can be typed into or submitted", () => {
  assert.equal(inSpace("input").length, 0, "no inputs");
  assert.equal(inSpace("textarea").length, 0, "no editable text");
  assert.equal(inSpace("form").length, 0, "nothing to submit");
});
step(29, "the workspace shows no SQL and no debug panel", () => {
  assert.ok(!/SELECT |FROM projects|WHERE /.test(spaceText()),
    "a query is not provenance, and it is not for the reader");
});

const pin = browser.byId("wsSpace").querySelector("[data-ws-pin]");
await browser.fire(pin, "click").results; await browser.settle();
step(30, "anything in focus can be pinned into the briefing", () =>
  assert.match(browser.byId("wsBriefSlot").textContent, /1 item/));

await browser.fire(browser.byId("wsBriefSlot").querySelector("[data-ws-brief]"), "click").results;
await browser.settle();
step(31, "the briefing is a real object that opens and lists what it holds", () => {
  assert.ok(browser.byId("wsBriefSlot").querySelectorAll(".wsbrief-row").length === 1);
  assert.ok(browser.byId("wsBriefSlot").querySelectorAll("[data-ws-export]").length === 2,
    "and offers both ways out of it");
});

await browser.fire(browser.byId("wsBriefSlot").querySelector("[data-ws-unpin]"), "click").results;
await browser.settle();
step(32, "and anything in it can be taken out again", () =>
  assert.match(browser.byId("wsBriefSlot").textContent, /empty/));

const cardsBefore = inSpace(".wscard").length;
const subjectBefore = browser.text("wsSubject");
await ask("a question that matches nothing at all");
step(33, "an empty answer says so about the search, not about the portfolio", () =>
  assert.match(browser.byId("wsThread").textContent, /found no matching records/));
step(34, "and leaves what is on screen alone", () => {
  assert.equal(inSpace(".wscard").length, cardsBefore);
  assert.equal(browser.text("wsSubject"), subjectBefore);
});

failNext = true;
await ask("this one will fail");
failNext = false;
step(35, "an engine failure is reported in the conversation, not as a broken screen", () => {
  assert.ok(inThread(".wsa-err").length === 1, "the turn carries the error");
  assert.equal(inSpace(".wscard").length, cardsBefore, "and the workspace is untouched");
});

browser.byId("wsScope").value = "Gaming";
await browser.fire("wsScope","change").results; await browser.settle();
step(36, "changing scope clears the workspace rather than reinterpreting it", () => {
  assert.equal(inSpace(".wscard").length, 0);
  assert.equal(inSpace(".wsstrip").length, 0);
});
step(37, "but the conversation is kept, because it is a record of what was asked", () =>
  assert.ok(inThread(".wsturn").length > 0));

step(38, "the call control lives in the composer, not on a screen of its own", () => {
  assert.ok(browser.byId("wsMic"), "one control");
  assert.equal(browser.byId("wsForm").hidden, false, "and the composer never steps aside");
  assert.equal(browser.byId("wsPresence").getAttribute("data-state"), "off");
});

console.log(`\n${ok.length}/38 steps passed.`);
if (process.exitCode) { console.log("Workspace UI walk FAILED."); }
else console.log("Workspace UI walk passed: two surfaces, component selection, progressive disclosure, briefing, scope and failure.");
