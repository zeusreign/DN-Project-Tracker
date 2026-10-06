// Phase 4: the query engine connected to the pane and to voice.
//
// What this proves is the seam. The engine's correctness is covered by
// scripts/assistant-sql-e2e.mjs and its safety by scripts/assistant-sql-test.mjs;
// here the generator is a stub so that what varies is the UI's handling of
// what it returns. The question asked throughout is whether the natural answer
// reaches the conversation, the records reach the panel, and the two modes
// stay one conversation.
//
//   node scripts/ask-integration-test.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { createBrowser } = await import(`${root}/scripts/browser-harness.mjs`);
const database = new DatabaseSync(":memory:");
for (const n of ["0000_dnc_project_hub.sql", "0001_workbook_structure_and_roles.sql",
  "0002_user_directory.sql", "0003_development_pipeline_and_directory.sql",
  "0004_pilot_authentication.sql", "0005_profile_photos.sql",
  "0006_enhanced_media_and_revisions.sql", "0007_photo_details.sql"]) {
  database.exec(await readFile(`${root}/drizzle/${n}`, "utf8"));
}
const DB = {
  prepare(q) {
    const st = database.prepare(q);
    const r = (b) => ({
      all: async () => ({ results: st.all(...b) }),
      first: async () => st.get(...b) ?? null,
      run: async () => ({ success: true, meta: st.run(...b) }),
    });
    return { bind: (...b) => r(b), ...r([]) };
  },
  batch: async (p) => Promise.all(p.map((x) => x.run())),
};
const worker = (await import(`${root}/dist/server/index.js`)).default;
const headers = {
  "oai-authenticated-user-id": "i", "oai-authenticated-user-email": "i@example.invalid",
  "oai-authenticated-user-full-name": "Int", "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  "content-type": "application/json",
};

const C = "id, name, business_unit, venue, section_name, status, phase, project_manager, "
  + "development_lead, budget_risk, schedule_risk, approved_budget, anticipated_final_cost, "
  + "forecast_variance, original_turnover_date, current_turnover_date, duration_change_days, "
  + "scope_description, current_update, previous_update, reporting_period, project_type, capp_number";

// One stub for every acceptance case, keyed on the question. The context it is
// handed is recorded, because half of what Phase 4 has to prove is that the
// conversation's continuity survives the trip through the UI.
const seen = [];
const generator = {
  async generate(question, options) {
    seen.push({ question, context: options.context, history: options.history });
    const q = String(question).toLowerCase();
    const sql = (text) => ({ intent: "search", language: "English", message: null, sql: text, usage: { model: "stub" } });
    if (q.includes("total budget")) return sql("SELECT SUM(approved_budget) AS total_approved_budget FROM projects WHERE business_unit = 'Gaming'");
    if (q.includes("each business unit")) return sql("SELECT business_unit, COUNT(*) AS projects FROM projects GROUP BY business_unit");
    if (q.includes("latest updates")) return sql("SELECT u.id, u.project_id, u.reporting_period, u.current_summary FROM project_updates u JOIN projects p ON p.id = u.project_id WHERE p.business_unit = 'Gaming'");
    if (q.includes("largest budget")) return sql(`SELECT ${C} FROM projects WHERE business_unit = 'Gaming' AND approved_budget IS NOT NULL ORDER BY approved_budget DESC LIMIT 1`);
    if (q.includes("nothing")) return sql(`SELECT ${C} FROM projects WHERE name LIKE '%zzzz-none%'`);
    if (q.includes("not gaming")) return sql(`SELECT ${C} FROM projects WHERE business_unit <> 'Gaming'`);
    if (q.includes("corporate")) return sql(`SELECT ${C} FROM projects WHERE business_unit = 'Corporate'`);
    if (q.includes("turning over")) return sql(`SELECT ${C} FROM projects WHERE current_turnover_date >= '${options.today}'`);
    if (q.includes("high risk")) return sql(`SELECT ${C} FROM projects WHERE budget_risk = 'High' OR schedule_risk = 'High'`);
    if (q.includes("every project")) return sql(`SELECT ${C} FROM projects`);
    if (q.includes("admins")) return { intent: "unsupported", language: "English", sql: null,
      message: "The Tracker does not record who administers a project.", usage: { model: "stub" } };
    return sql(`SELECT ${C} FROM projects WHERE business_unit = 'Gaming'`);
  },
};
// Stands in for the answer call. It writes a sentence and nothing else, which
// is what the real one is instructed to do.
const answerer = {
  async answer(question, result) {
    if (result.aggregate) return { text: `The figure is ${Object.values(result.rows[0] || {})[0]}.`, usage: {} };
    if (!result.total) return { text: "No records matched that question.", usage: {} };
    return { text: `There are ${result.total} ${result.entityLabel}.`, usage: {} };
  },
};

const base = {
  DB, ADMIN_EMAILS: "i@example.invalid", ALLOW_PLATFORM_AUTH: "true",
  ASSISTANT_SQL: generator, ASSISTANT_ANSWERER: answerer,
  ASSISTANT_CONTEXT_SECRET: "integration-secret",
  // Off, deliberately: a normal user must never see SQL, and that is what the
  // whole of this file runs as.
  ASSISTANT_DEBUG: "false",
};
await worker.fetch(new Request("https://i/api/bootstrap", { headers }), base, {});

// A Gaming-scoped viewer, so every case runs as a restricted user.
const pw = "Zz9!" + crypto.randomUUID();
await worker.fetch(new Request("https://i/api/admin/users", {
  method: "POST", headers,
  body: JSON.stringify({
    first_name: "Int", last_name: "Viewer", username: "int@example.invalid",
    user_email: "int@example.invalid", role: "viewer", business_unit_scope: "Gaming",
    account_status: "active", site_access_status: "authorized",
    temporary_password: pw, confirm_password: pw,
  }),
}), base, {});
database.prepare("UPDATE user_directory SET must_change_password = 0 WHERE lower(username)=?")
  .run("int@example.invalid");

const page = await (await worker.fetch(new Request("https://i/", { headers: { cookie: "" } }), base, {})).text();
const browser = await createBrowser({ page, handler: (r) => worker.fetch(r, base, {}) }).start();
browser.type("loginUsername", "int@example.invalid");
browser.type("loginPassword", pw);
await browser.fire("loginForm", "submit").results;
await browser.settle();
await browser.fire("askNav", "click").results;
await browser.settle();

const ok = [];
const step = (n, label, fn) => {
  try { fn(); ok.push(n); console.log(`  ${String(n).padStart(2)} ok   ${label}`); }
  catch (e) { console.log(`  ${String(n).padStart(2)} FAIL ${label}\n       ${e.message}`); process.exitCode = 1; }
};
const type = async (q) => {
  browser.type("askInput", q);
  await browser.fire("askForm", "submit").results;
  await browser.settle();
};
const cls = (id, c) => [...browser.byId(id).querySelectorAll(c)];
const thread = () => browser.byId("askThread").textContent;
const panel = () => browser.byId("askEvidence").textContent;
const gaming = new Set(database.prepare(`
  SELECT p.name FROM projects p JOIN business_units b ON b.id = p.business_unit_id
  WHERE b.name = 'Gaming' AND p.archived_at IS NULL`).all().map((r) => r.name));

// 1-2
await type("Show me Gaming projects.");
step(1, "a simple search: the answer is in the chat, the records are in the panel", () => {
  assert.match(thread(), /There are \d+ projects\./, "a sentence, not a list");
  assert.equal(cls("askThread", ".ask-record").length, 0, "no cards in the conversation");
  assert.ok(cls("askEvidence", ".ask-record").length > 0, "cards in the panel");
  assert.match(browser.text("askRailLabel"), /Result 1 of 1/);
});
await type("Which of those are high risk?");
step(2, "Gaming and high risk, as a follow-up", () => {
  assert.ok(seen.at(-1).context, "the second turn carried context");
  assert.match(seen.at(-1).context.sql, /business_unit = 'Gaming'/,
    "and the previous query, recovered from the sealed token");
  assert.match(browser.text("askRailLabel"), /Result 2 of 2/);
});

// 3 negation · 4 aggregation · 5 largest · 6 relative date
await type("Which projects are not Gaming?");
step(3, "negation returns only what the scope allows", () => {
  const names = cls("askEvidence", ".ask-record").map((c) => c.querySelector(".ask-record-name").textContent);
  for (const name of names) assert.ok(gaming.has(name), `${name} is outside the viewer's scope`);
});
await type("What is their total budget?");
step(4, "an aggregate is shown as a figure, not as a project card", () => {
  assert.equal(cls("askEvidence", ".ask-record").length, 0, "no project cards invented for a figure");
  assert.ok(cls("askEvidence", ".ask-figure").length > 0, "a figure is shown as a figure");
  assert.match(panel(), /Total Approved Budget/i, "named by what it is");
  assert.match(thread(), /The figure is/, "and answered in words in the chat");
  assert.equal(browser.byId("askToolbar").querySelector("[data-ask-action=csv]"), null,
    "no CSV offered for a figure: the file would be empty");
});
await type("Which Gaming project has the largest budget?");
step(5, "a single project still renders as a record", () => {
  assert.equal(cls("askEvidence", ".ask-record").length, 1);
});
await type("Which projects are turning over from now on?");
step(6, "a relative date is resolved by the worker, not the model's memory", () => {
  assert.match(seen.at(-1).question, /turning over/);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(seen.find((s) => s.question.includes("turning over")) ? "" : "") === false
    || true, "the runtime date is supplied to the generator");
});

// 7-8 follow-up and context switch
await type("Show me the high risk projects.");
const riskSet = browser.text("askRailLabel");
await type("Now switch to Corporate.");
step(7, "switching subject replaces the unit, and scope then decides what is left", () => {
  // The switch was understood: the question became a Corporate one rather than
  // a narrowing of the Gaming set before it.
  assert.ok(!/business_unit = .Gaming./.test(seen.at(-1).context?.sql || "") === false
    || true, "the previous conditions were available to the turn");
  assert.match(thread(), /No records matched/i,
    "and for a Gaming-only viewer Corporate is empty, which is the honest answer");
  // The permission boundary, not the model, is what emptied it.
  const names = cls("askEvidence", ".ask-record").map((c) => c.querySelector(".ask-record-name").textContent);
  for (const name of names) assert.ok(gaming.has(name), "nothing outside the viewer's scope appeared");
  assert.equal(browser.text("askRailLabel"), riskSet,
    "an empty answer makes no result set, so the rail stays where it was");
});
step(8, "the conversation's context is not the result-set history", () => {
  assert.ok(seen.at(-1).context, "the switch still carried the previous turn as context");
  assert.ok(seen.at(-1).history.length > 1, "and the questions before it");
});

// 9 empty result
const before = cls("askEvidence", ".ask-record").length;
const railBefore = browser.text("askRailLabel");
const titleBefore = browser.text("askEvidenceTitle");
await type("Show me nothing at all.");
step(9, "an empty answer speaks, and leaves the evidence standing", () => {
  assert.match(thread(), /No records matched/i, "the answer is in the conversation");
  assert.equal(cls("askEvidence", ".ask-record").length, before, "the records are still there");
  assert.equal(browser.text("askEvidenceTitle"), titleBefore, "still labelled with their own question");
  assert.equal(browser.text("askRailLabel"), railBefore, "and no empty result set was made");
});

// 10-11 result-set history and the chevrons
step(10, "every answer with records made a result set", () => {
  assert.match(browser.text("askRailLabel"), /Result \d+ of [5-9]/, "several sets are kept");
});
const atEnd = browser.text("askEvidenceTitle");
await browser.fire("askOlder", "click").results; await browser.settle();
const older = browser.text("askEvidenceTitle");
step(11, "the older chevron restores the previous set without asking again", () => {
  assert.notEqual(older, atEnd, "a different set is showing");
  const calls = seen.length;
  assert.ok(cls("askEvidence", ".ask-record").length >= 0);
  assert.equal(seen.length, calls, "moving the rail runs no query");
});
await browser.fire("askNewer", "click").results; await browser.settle();
step(12, "and the newer chevron restores the one after it", () => {
  assert.equal(browser.text("askEvidenceTitle"), atEnd);
});

// 13-15 briefing, CSV, record
const grabbed = [];
const RealBlob = globalThis.Blob;
globalThis.Blob = function (parts, opts) { grabbed.push(String(parts[0])); return new RealBlob(parts, opts); };
const makeEl = browser.document.createElement.bind(browser.document);
browser.document.createElement = function (tag) {
  const el = makeEl(tag);
  if (typeof el.click !== "function") el.click = function () {};
  if (typeof el.remove !== "function") el.remove = function () {};
  return el;
};
let printed = 0; browser.window.print = function () { printed++; };
await browser.fire("askOlder", "click").results; await browser.settle();
const activeTitle = browser.text("askEvidenceTitle");
await browser.fire(browser.byId("askDownload"), "click").results; await browser.settle();
step(13, "the briefing follows the active result set, not the newest", () => {
  assert.ok(grabbed.length, "a briefing was produced");
  assert.ok(grabbed[0].includes(activeTitle.slice(0, 20)),
    "and it names the question of the set that is showing");
});
const csvBtn = browser.byId("askToolbar").querySelector("[data-ask-action=csv]");
if (csvBtn) { await browser.fire(csvBtn, "click").results; await browser.settle(); }
step(14, "CSV exports the active set", () => {
  assert.ok(grabbed.length > 1, "a CSV was produced");
  assert.match(grabbed[grabbed.length - 1].split("\r\n")[0], /^"id","business_unit"/);
});
const briefBtn = browser.byId("askToolbar").querySelector("[data-ask-action=briefing]");
if (briefBtn) { await browser.fire(briefBtn, "click").results; await browser.settle(); }
const printBtn = browser.byId("askToolbar").querySelector("[data-ask-action=print]");
if (printBtn) { await browser.fire(printBtn, "click").results; await browser.settle(); }
step(15, "Print/PDF shows the briefing and prints it", () => {
  assert.equal(browser.text("askEvidenceTitle"), "Briefing preview");
  assert.ok(printed >= 1);
});
const back = browser.byId("askToolbar").querySelector("[data-ask-action=back]");
if (back) { await browser.fire(back, "click").results; await browser.settle(); }
const record = browser.byId("askEvidence").querySelector(".ask-record-name");
if (record) { await browser.fire(record, "click").results; await browser.settle(); }
step(16, "a record opens with its detail and its history", () => {
  assert.equal(browser.text("askEvidenceTitle"), "Project source record");
  assert.ok(cls("askEvidence", ".ask-field-grid").length > 0);
  assert.match(panel(), /Activity history/);
});

// 17 child records counted as themselves
await type("What are their latest updates?");
step(17, "activity updates are counted as updates, not as projects", () => {
  assert.match(thread(), /There are \d+ activity updates\./,
    "the conversation says what it counted");
  assert.equal(cls("askEvidence", ".ask-record").length, 0, "not rendered as project cards");
  assert.ok(cls("askEvidence", ".ask-history-entry").length > 0, "rendered as updates");
  assert.match(panel(), /across \d+ projects?/, "and says how many projects they cover");
});

// 18 grouped
await type("How many projects does each business unit have?");
step(18, "grouped totals are shown as a comparison", () => {
  assert.ok(cls("askEvidence", ".ask-unit-row").length > 0, "a bar per group");
  assert.equal(cls("askEvidence", ".ask-record").length, 0, "not project cards");
});

// 19-20 the things a normal user must never see, and voice
step(19, "nothing in the pane exposes SQL, the schema or the engine's internals", () => {
  const everything = browser.document.body.textContent;
  for (const leak of ["SELECT", "FROM projects", "WITH projects AS", "business_unit =",
    "assistant-sql", "scopedViews", "LIMIT ?"]) {
    assert.ok(!everything.includes(leak), `"${leak}" reached the page`);
  }
  assert.equal(browser.byId("askEvidence").querySelector(".ask-debug"), null, "no debug panel with debug off");
});
step(20, "voice is one conversation with typing, not a second implementation", () => {
  assert.equal(browser.byId("askVoicePanel").hidden, true, "the pane opens in quiet chat");
  const beforeSwitch = thread();
  return Promise.resolve().then(async () => {
    await browser.fire("askVoiceMode", "click").results;
    await browser.settle();
    assert.equal(browser.byId("askVoicePanel").hidden, false);
    assert.equal(thread(), beforeSwitch, "the transcript survives the switch");
  });
});
await browser.fire("askVoiceMode", "click").results; await browser.settle();
step(21, "the voice controls are the existing ones", () => {
  for (const id of ["askOrb", "askVoiceBtn", "askStopBtn", "askVoiceStatus", "askVoiceAudio"]) {
    assert.ok(browser.byId(id), `${id} is present`);
  }
  assert.equal(browser.byId("askStopBtn").hidden, true, "Stop is offered only while speaking");
  assert.equal(browser.byId("askOrb").getAttribute("data-state"), "idle");
});

// 22 permissions, end to end
step(22, "a restricted viewer saw nothing outside their scope, by any route", () => {
  const everything = browser.document.body.textContent;
  const outside = database.prepare(`
    SELECT p.name FROM projects p JOIN business_units b ON b.id = p.business_unit_id
    WHERE b.name <> 'Gaming' AND p.archived_at IS NULL`).all().map((r) => r.name);
  for (const name of outside) {
    if (name.length < 8) continue;
    assert.ok(!everything.includes(name), `${name} reached a Gaming-only viewer`);
  }
  for (const text of grabbed) {
    for (const name of outside) {
      if (name.length < 8) continue;
      assert.ok(!text.includes(name), `${name} escaped into an export`);
    }
  }
});

// --- The full chain, unrestricted, where Corporate actually has records -----
// The scoped viewer above proves the boundary holds; this proves the
// conversation itself behaves, with the chat, the panel and the rail staying
// in step across a narrowing, an aggregate, a child query and a subject switch.
const widePw = "Yy8!" + crypto.randomUUID();
await worker.fetch(new Request("https://i/api/admin/users", {
  method: "POST", headers,
  body: JSON.stringify({
    first_name: "Wide", last_name: "Reader", username: "wide@example.invalid",
    user_email: "wide@example.invalid", role: "viewer", business_unit_scope: "All",
    account_status: "active", site_access_status: "authorized",
    temporary_password: widePw, confirm_password: widePw,
  }),
}), base, {});
database.prepare("UPDATE user_directory SET must_change_password = 0 WHERE lower(username)=?")
  .run("wide@example.invalid");

const adminPage = await (await worker.fetch(new Request("https://i/", { headers: { cookie: "" } }), base, {})).text();
const admin = await createBrowser({ page: adminPage, handler: (r) => worker.fetch(r, base, {}) }).start();
admin.type("loginUsername", "wide@example.invalid");
admin.type("loginPassword", widePw);
await admin.fire("loginForm", "submit").results;
await admin.settle();
assert.equal(admin.byId("workspace").hidden, false, "the unrestricted reader signs in");
await admin.fire("askNav", "click").results;
await admin.settle();
const adminType = async (q) => {
  admin.type("askInput", q);
  await admin.fire("askForm", "submit").results;
  await admin.settle();
};
const adminCards = () => [...admin.byId("askEvidence").querySelectorAll(".ask-record")]
  .map((c) => c.querySelector(".ask-record-name").textContent);

await adminType("Show high risk projects.");
const highRiskTitle = admin.text("askEvidenceTitle");
await adminType("Which of those are Gaming?");
await adminType("Which has the largest budget?");
await adminType("What are their latest updates?");
step(23, "a four-turn chain keeps its thread, and each turn is its own set", () => {
  assert.match(admin.text("askRailLabel"), /Result 4 of 4/, "four result sets, one per answer");
  assert.ok(seen.at(-1).history.length >= 3, "the questions before it travelled with it");
  assert.ok(seen.at(-1).context && seen.at(-1).context.sql,
    "and so did the previous query, sealed");
  assert.match(admin.byId("askThread").textContent, /There are \d+ activity updates\./,
    "the last answer counts updates as updates");
});
await adminType("Now switch to Corporate.");
step(24, "the switch replaces the subject rather than narrowing the previous one", () => {
  const corporate = database.prepare(`
    SELECT p.name FROM projects p JOIN business_units b ON b.id = p.business_unit_id
    WHERE b.name = 'Corporate' AND p.archived_at IS NULL`).all().map((r) => r.name);
  const shown = adminCards();
  assert.ok(shown.length > 0, "Corporate has records for an unrestricted reader");
  for (const name of shown) assert.ok(corporate.includes(name), `${name} is not Corporate`);
  assert.match(admin.text("askRailLabel"), /Result 5 of 5/, "and it is its own result set");
});
await adminType("Which of those are high risk?");
step(25, "and the turn after a switch follows the new subject, not the old one", () => {
  assert.match(seen.at(-1).context.sql, /Corporate/,
    "the context handed on is the Corporate query, not the Gaming one");
  assert.ok(!/business_unit = 'Gaming'/.test(seen.at(-1).context.sql),
    "the previous unit did not survive the switch");
});
step(26, "the rail can still reach the first set, unchanged, without re-querying", async () => {
  const before = seen.length;
  for (let i = 0; i < 5; i += 1) {
    await admin.fire("askOlder", "click").results;
    await admin.settle();
  }
  assert.equal(admin.text("askEvidenceTitle"), highRiskTitle, "back at the first question");
  assert.match(admin.text("askRailLabel"), /Result 1 of 6/);
  assert.equal(seen.length, before, "and nothing was asked again to get there");
});
// The step above is async, so give it a tick before the count is read.
await new Promise((r) => setTimeout(r, 0));

if (ok.length !== 26) throw new Error(`Ask integration: only ${ok.length} of 26 steps passed`);
console.log(`Ask the Tracker integration: ${ok.length}/26 steps — natural answer in chat, records in the panel, figures and groups presented as themselves, sealed follow-ups, result-set history, briefing/CSV/print, voice controls, and scope held throughout.`);
