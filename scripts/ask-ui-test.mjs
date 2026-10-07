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
  for (const id of ["wsShell","wsPresence","wsThread","wsForm","wsInput","wsMic","wsSend",
    "wsScope","wsSpace","wsSavedSlot","wsTabChat","wsTabResults"])
    assert.ok(browser.byId(id), id + " is present");
});

step(4, "the product names itself", () =>
  assert.match(browser.byId("wsInput").closest("[data-pane]").textContent, /DNC Tracker/));

step(5, "the resting state offers questions rather than an empty box", () => {
  assert.ok(browser.byId("wsStart").querySelectorAll("[data-ws-ask]").length >= 3,
    "questions to start with, beside the box they would be typed into");
  assert.equal(browser.byId("wsStart").hidden, false);
  assert.equal(inSpace("[data-ws-ask]").length, 0,
    "and not also out in the workspace, where nothing has been found yet");
  assert.equal(inSpace(".wscard").length, 0, "and nothing is pretending to be a result");
  assert.equal(browser.byId("wsSavedSlot").textContent.trim(), "",
    "nothing has been asked yet, so there is no saved control to be dead");
  assert.equal(inThread(".wsturn").length, 0,
    "and the conversation does not explain itself before it has started");
});

await ask("show me the projects");
step(5.5, "and they step aside once the conversation has started", () =>
  assert.equal(browser.byId("wsStart").hidden, true));

step(6, "the question is echoed in the conversation", () =>
  assert.match(browser.byId("wsThread").textContent, /show me the projects/));
step(7, "and answered with a sentence", () =>
  assert.match(browser.byId("wsThread").textContent, /I found \d+ projects/));
step(8, "the composer is cleared ready for the next question", () =>
  assert.equal(browser.byId("wsInput").value, ""));

step(9, "the conversation never becomes a record list", () => {
  assert.equal(inThread(".wsrow").length, 0, "no project rows");
  assert.equal(inThread(".wscard").length, 0, "no workspace cards");
  assert.equal(inThread(".wsmets").length, 0, "no metric blocks");
  assert.equal(inThread("table").length, 0, "and never a table");
});

step(10, "the result is the first thing in the workspace", () => {
  const space = browser.byId("wsSpace");
  assert.ok(space.querySelectorAll(".wscard").length === 1);
  assert.ok(/^\s*<article class="wscard/.test(space.innerHTML),
    "the latest result sits at the top, not under its own history");
});

step(11, "a list question renders a project list", () => {
  assert.ok(inSpace(".wsrow").length > 1, "rows are rendered");
  assert.ok(inSpace(".wsrow-name").length === inSpace(".wsrow").length,
    "every row names its project");
});

const gaming = database.prepare(`SELECT p.name FROM projects p
  JOIN business_units b ON b.id = p.business_unit_id
  WHERE b.name='Gaming' AND p.archived_at IS NULL`).all().map((r) => r.name);
step(12, "and only projects this viewer is allowed to see", () => {
  const shown = inSpace(".wsrow-name").map((el) => el.textContent);
  assert.ok(shown.length > 0);
  for (const name of shown) assert.ok(gaming.includes(name), `${name} is out of scope`);
});

step(13, "what to ask next is offered where an empty workspace would be", () => {
  assert.ok(inSpace(".wsnext").length === 1, "and only under the latest result");
  assert.ok(inSpace(".wsnext").length && browser.byId("wsSpace")
    .querySelectorAll("[data-ws-ask]").length >= 2, "each one asks a real question");
});

step(14, "the latest answer does not link to a result already at the top", () =>
  assert.equal(inThread("[data-ws-show]").length + inThread(".wsalink").length, 0,
    "a link that points at what is already in front of the reader is noise"));

await ask("what are the budgets on those?");
step(15, "a follow-up keeps the earlier result, collapsed, below it", () => {
  assert.equal(inSpace(".wscard").length, 1, "one card open");
  assert.equal(inSpace(".wsold").length, 1, "and the one it came from, as a line");
});
step(16, "the newest result is still the first thing on screen", () =>
  assert.ok(/^\s*<article class="wscard/.test(browser.byId("wsSpace").innerHTML)));
step(17, "a follow-up is drawn as a follow-up, so the lineage is visible", () =>
  assert.ok(inSpace(".is-follow").length >= 1));
step(18, "the older answer now links back to its result", () =>
  assert.ok(inThread(".wsalink").length === 1));
step(19, "a budget question renders budget figures, not a plain list", () => {
  assert.ok(inSpace(".wsmets").length === 1, "the metric row is rendered");
  assert.ok(inSpace(".wsmet-k").length >= 4, "with the figures a budget answer needs");
});
step(20, "every total says how many projects it is computed over", () => {
  const notes = inSpace(".wsmet-n").map((el) => el.textContent).join(" ");
  assert.match(notes, /recorded|with both figures|of \d+/,
    "a sum across the ones that have a figure is not a sum across the set");
});
step(21, "a variance is shown as a figure and a bar, never as typed punctuation", () => {
  assert.ok(inSpace(".wsbar").length > 0, "bars are drawn");
  assert.ok(!spaceText().includes("->") && !spaceText().includes("-->"),
    "no ASCII arrows anywhere in the workspace");
});

const older = browser.byId("wsSpace").querySelector(".wsold");
await browser.fire(older, "click").results; await browser.settle();
step(22, "an earlier result expands in place rather than replacing the newest", () => {
  assert.equal(inSpace(".wscard").length, 2, "both are open");
  assert.ok(/^\s*<article class="wscard/.test(browser.byId("wsSpace").innerHTML),
    "and the newest is still first");
});

await ask("which projects have high risk?");
step(23, "a risk question renders the risk component", () => {
  assert.ok(inSpace(".wsrisk").length === 1, "the distribution is drawn");
  assert.ok(inSpace(".wsrisk-row").length > 0, "with a row per level");
});
step(24, "and nothing earlier is thrown away", () =>
  assert.ok(inSpace(".wsold").length >= 2, "the whole investigation is still below it"));

await ask("what are the turnover dates?");
step(25, "a schedule question renders the schedule component", () => {
  assert.ok(inSpace(".wsmets").length >= 1);
  assert.match(spaceText(), /Slipped|Holding|No date/);
});

await ask("how many projects are there?");
step(26, "a figure is the number and what it counts, with no heading over it", () => {
  assert.ok(inSpace(".wsbig").length === 1, "the figure component is used");
  assert.equal(inSpace(".wsrow").length, 0, "and no list is invented around it");
  assert.ok(!/COUNT|count\(\*\)|A single figure|^Figure/m.test(spaceText()),
    "no SQL function and no filler subtitle");
  assert.match(spaceText(), /projects/, "the number says what it is a number of");
});

await ask("break that down by phase");
step(27, "a grouped result is shown as a group, not as openable projects", () => {
  assert.ok(inSpace(".wsgroup-row").length > 0, "the group component is used");
});

await ask("show me the projects");
const firstRow = browser.byId("wsSpace").querySelector("[data-ws-open]");
const openedId = Number(firstRow.getAttribute("data-ws-open"));
const openedName = database.prepare("SELECT name FROM projects WHERE id = ?").get(openedId).name;
await browser.fire(firstRow, "click").results; await browser.settle();

step(28, "opening a row opens the project in the workspace", () =>
  assert.ok(spaceText().includes(openedName.slice(0, 12))));
step(29, "the detail shows the derived figures the tracker computes", () => {
  assert.match(spaceText(), /Forecast variance/);
  assert.match(spaceText(), /Turnover/);
});
step(30, "and never opens the edit form", () =>
  assert.equal(browser.byId("detailsDialog").open, false));
step(31, "a detail panel shows no empty fields", () =>
  assert.ok(!inSpace(".wsfld").some((el) => el.textContent.trim().endsWith("—")),
    "a grid of dashes is a database row, not a product"));
step(32, "nothing in the workspace can be typed into or submitted", () => {
  assert.equal(inSpace("textarea").length, 0, "no editable text");
  assert.equal(inSpace("form").length, 0, "nothing to submit");
});
step(33, "the workspace shows no SQL and no debug panel", () =>
  assert.ok(!/SELECT |FROM projects|WHERE /.test(spaceText())));

// The pin: an icon with two states and a tooltip, not another labelled button.
const pin = browser.byId("wsSpace").querySelector("[data-ws-pin]");
step(34, "a result is kept with a pin, not with a word", () => {
  assert.ok(pin, "every card carries one");
  assert.equal(pin.getAttribute("aria-pressed"), "false", "and starts unpinned");
  assert.ok(pin.querySelectorAll("svg").length === 1, "it is drawn, not typed");
  assert.match(pin.getAttribute("title") || "", /save/i, "and says what it does on hover");
});
await browser.fire(pin, "click").results; await browser.settle();
const pinned = browser.byId("wsSpace").querySelector("[data-ws-pin]");
step(35, "pinning changes the icon's state and what it offers to do", () => {
  assert.equal(pinned.getAttribute("aria-pressed"), "true");
  assert.ok(pinned.classList.contains("is-on"), "the icon reads as filled");
  assert.match(pinned.getAttribute("title") || "", /remove/i);
});
step(36, "and the saved count says so without a bar across the screen", () =>
  assert.match(browser.byId("wsSavedSlot").textContent, /Saved\s*1/));

await browser.fire(browser.byId("wsSavedBtn"), "click").results; await browser.settle();
step(37, "one control opens one panel: what to include, how much, which format", () => {
  const panel = browser.byId("wsSavedSlot");
  assert.ok(panel.querySelectorAll(".wspick").length === 1, "the saved results, to choose from");
  assert.ok(panel.querySelectorAll("[data-ws-detail]").length === 2, "summary or full records");
  assert.ok(panel.querySelectorAll("[data-ws-format]").length === 2, "PDF or CSV");
  assert.ok(panel.querySelectorAll("[data-ws-go]").length === 1, "and one primary action");
});
step(38, "nothing is ticked, so the reader chooses what leaves the product", () => {
  const boxes = [...browser.byId("wsSavedSlot").querySelectorAll("[data-ws-pick]")];
  assert.ok(boxes.length > 0);
  assert.ok(boxes.every((b) => !b.checked));
  assert.equal(browser.byId("wsSavedSlot").querySelector("[data-ws-go]").disabled, true,
    "and Download waits until something is chosen");
});
const box = browser.byId("wsSavedSlot").querySelector("[data-ws-pick]");
box.checked = true;
await browser.fire(box, "change").results; await browser.settle();
step(39, "choosing one enables the download", () =>
  assert.equal(browser.byId("wsSavedSlot").querySelector("[data-ws-go]").disabled, false));

const cardsBefore = inSpace(".wscard").length;
await ask("a question that matches nothing at all");
step(40, "an empty answer says so about the search, not about the portfolio", () =>
  assert.match(browser.byId("wsThread").textContent, /found no matching records/));
step(41, "and never joins the stack: it is not knowledge to keep", () =>
  assert.equal(inSpace(".wscard").length, cardsBefore));

failNext = true;
await ask("this one will fail");
failNext = false;
step(42, "an engine failure is reported in the conversation, not as a broken screen", () => {
  assert.ok(inThread(".wsa-err").length === 1, "the turn carries the error");
  assert.equal(inSpace(".wscard").length, cardsBefore, "and the workspace is untouched");
});

browser.byId("wsScope").value = "Gaming";
await browser.fire("wsScope","change").results; await browser.settle();
step(43, "changing scope clears the workspace rather than reinterpreting it", () => {
  assert.equal(inSpace(".wscard").length, 0);
  assert.equal(inSpace(".wsold").length, 0);
  assert.equal(browser.byId("wsSavedSlot").textContent.trim(), "",
    "and what was saved under the old scope goes with it, control and all");
});
step(44, "but the conversation is kept, because it is a record of what was asked", () =>
  assert.ok(inThread(".wsturn").length > 0));

step(45, "the call control lives in the composer, not on a screen of its own", () => {
  assert.ok(browser.byId("wsMic"), "one control");
  assert.equal(browser.byId("wsForm").hidden, false, "and the composer never steps aside");
  assert.equal(browser.byId("wsPresence").getAttribute("data-state"), "off");
});

step(46, "a phone gets one thing at a time, not two squeezed columns", () => {
  assert.ok(browser.byId("wsTabChat") && browser.byId("wsTabResults"),
    "conversation and results are switchable");
  assert.ok(browser.byId("wsShell").getAttribute("data-tab"),
    "and the shell says which is showing");
});

console.log(`\n${ok.length} steps passed.`);
if (process.exitCode) { console.log("Workspace UI walk FAILED."); }
else console.log("Workspace UI walk passed: two surfaces, accumulation, components, pin, download, scope and failure.");
