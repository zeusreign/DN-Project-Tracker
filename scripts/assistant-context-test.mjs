// Conversation continuity with ASSISTANT_DEBUG off.
//
// Two things are proved. First, that nothing in a normal answer carries the
// generated SQL or the schema to the browser. Second, that a follow-up still
// gets the previous query: the worker seals it, the page round-trips it
// without being able to read it, and the next turn is handed exactly what it
// would have had with debug on.
//
// The generator is a stub, so what is under test is the plumbing rather than
// the model. Whether the model then writes the right SQL is covered live by
// scripts/assistant-sql-e2e.mjs.
//
//   node scripts/assistant-context-test.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const database = new DatabaseSync(":memory:");
for (const name of [
  "0000_dnc_project_hub.sql", "0001_workbook_structure_and_roles.sql",
  "0002_user_directory.sql", "0003_development_pipeline_and_directory.sql",
  "0004_pilot_authentication.sql", "0005_profile_photos.sql",
  "0006_enhanced_media_and_revisions.sql", "0007_photo_details.sql",
]) database.exec(await readFile(resolve(projectRoot, "drizzle", name), "utf8"));

const DB = {
  prepare(sql) {
    const statement = database.prepare(sql);
    const run = (b) => ({
      all: async () => ({ results: statement.all(...b) }),
      first: async () => statement.get(...b) ?? null,
      run: async () => ({ success: true, meta: statement.run(...b) }),
    });
    return { bind: (...b) => run(b), ...run([]) };
  },
  batch: async (list) => Promise.all(list.map((s) => s.run())),
};
const headers = {
  "oai-authenticated-user-id": "ctx", "oai-authenticated-user-email": "ctx@example.invalid",
  "oai-authenticated-user-full-name": "Ctx", "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  "content-type": "application/json",
};
const worker = (await import(resolve(projectRoot, "dist/server/index.js") + "?ctx=" + Date.now())).default;

// Every question the stub is asked, with the context it was handed. This is
// what the test inspects: the worker's side of the conversation.
const seen = [];
const COLUMNS = "id, name, business_unit, status, budget_risk, schedule_risk, approved_budget";
const generator = {
  async generate(question, options) {
    seen.push({ question, context: options.context, history: options.history });
    const q = question.toLowerCase();
    if (q.includes("total budget")) {
      return { intent: "search", language: "English", message: null,
        sql: "SELECT SUM(approved_budget) AS total FROM projects WHERE business_unit = 'Gaming'",
        usage: { model: "stub" } };
    }
    if (q.includes("updates")) {
      return { intent: "search", language: "English", message: null,
        sql: "SELECT u.id, u.project_id, u.reporting_period, u.current_summary FROM project_updates u "
          + "JOIN projects p ON p.id = u.project_id WHERE p.business_unit = 'Gaming'",
        usage: { model: "stub" } };
    }
    if (q.includes("corporate")) {
      return { intent: "search", language: "English", message: null,
        sql: `SELECT ${COLUMNS} FROM projects WHERE business_unit = 'Corporate'`, usage: { model: "stub" } };
    }
    if (q.includes("not gaming")) {
      return { intent: "search", language: "English", message: null,
        sql: `SELECT ${COLUMNS} FROM projects WHERE business_unit <> 'Gaming'`, usage: { model: "stub" } };
    }
    return { intent: "search", language: "English", message: null,
      sql: `SELECT ${COLUMNS} FROM projects WHERE business_unit = 'Gaming'`, usage: { model: "stub" } };
  },
};
const answerer = { async answer() { return { text: "Stub answer.", usage: { model: "stub" } }; } };

// Debug is off, which is the whole point of this file.
const env = {
  DB, ADMIN_EMAILS: "ctx@example.invalid", ALLOW_PLATFORM_AUTH: "true",
  ASSISTANT_SQL: generator, ASSISTANT_ANSWERER: answerer,
  ASSISTANT_CONTEXT_SECRET: "test-secret-for-sealing",
  ASSISTANT_DEBUG: "false",
};
await worker.fetch(new Request("https://ctx/api/bootstrap", { headers }), env, {});

// The browser, as it actually behaves: it keeps the token it was given and
// hands it back, and it has no other way of knowing what was asked.
const page = { context: null, history: [] };
async function ask(question) {
  const payload = { question };
  if (page.context) payload.context = page.context;
  if (page.history.length) payload.history = page.history;
  const response = await worker.fetch(new Request("https://ctx/api/assistant/ask", {
    method: "POST", headers, body: JSON.stringify(payload),
  }), env, {});
  const answer = await response.json();
  page.history.push({ question, intent: answer.intent, total: answer.total, token: answer.token });
  if (answer.rows && answer.rows.length) {
    page.context = {
      ids: answer.rows.map((r) => r.id).filter((id) => typeof id === "number"),
      total: answer.total,
      token: answer.token,
    };
  }
  return answer;
}

let checks = 0;
const check = async (label, fn) => {
  try { await fn(); } catch (problem) {
    problem.message = `${label}\n   ${problem.message}`;
    throw problem;
  }
  checks++;
};

const first = await ask("Show me Gaming projects.");

await check("with debug off, nothing in an answer carries the query or the schema", () => {
  assert.equal(first.debug, undefined, "no debug block");
  const body = JSON.stringify(first);
  for (const leak of ["SELECT", "FROM projects", "WHERE", "business_unit =", "WITH projects AS"]) {
    assert.ok(!body.includes(leak), `the answer leaked "${leak}" to the browser`);
  }
  assert.ok(first.token, "but a sealed token is issued");
  assert.ok(!first.token.includes("SELECT"), "and the token is opaque");
});

await check("the sealed token is what carries the query to the next turn", async () => {
  await ask("Which of those are not Gaming?");
  const handed = seen.at(-1).context;
  assert.ok(handed, "the second turn was given context");
  assert.match(handed.sql, /business_unit = 'Gaming'/,
    "the model is handed the previous query, recovered from the token");
  assert.ok(handed.ids.length > 0, "and the ids the previous answer returned");
});

await check("a turn with no token gets ids only, and still answers", async () => {
  const bare = await worker.fetch(new Request("https://ctx/api/assistant/ask", {
    method: "POST", headers,
    body: JSON.stringify({ question: "Which of those are not Gaming?", context: { ids: [1, 2, 3], total: 3 } }),
  }), env, {});
  const answer = await bare.json();
  assert.equal(answer.ok, true, "it still answers");
  assert.equal(seen.at(-1).context.sql, undefined, "but with no conditions to build on");
  assert.deepEqual(seen.at(-1).context.ids, [1, 2, 3], "only what the page itself saw");
});

await check("a forged or borrowed token is ignored, not trusted", async () => {
  for (const token of ["a1.not-a-real-token", first.token.slice(0, -6) + "AAAAAA", "", "SELECT 1"]) {
    const response = await worker.fetch(new Request("https://ctx/api/assistant/ask", {
      method: "POST", headers,
      body: JSON.stringify({ question: "Which of those are not Gaming?", context: { ids: [1], token } }),
    }), env, {});
    const answer = await response.json();
    assert.equal(answer.ok, true, "a bad token is not an error");
    assert.equal(seen.at(-1).context.sql, undefined, `a forged token supplied conditions: ${token}`);
  }
});

await check("the whole conversation keeps working: narrow, aggregate, switch subject", async () => {
  page.context = null; page.history = [];
  const gaming = await ask("Show me Gaming projects.");
  assert.ok(gaming.total > 0);

  await ask("What is their total budget?");
  assert.match(seen.at(-1).context.sql, /business_unit = 'Gaming'/,
    '"their" reaches the previous conditions');
  assert.ok(seen.at(-1).history.some((turn) => turn.sql),
    "and the history carries the earlier queries too");

  const corporate = await ask("What about Corporate?");
  assert.ok(corporate.rows.every((row) => row.business_unit === "Corporate"),
    "switching subject replaces the unit rather than combining the two");
  assert.ok(!corporate.rows.some((row) => row.business_unit === "Gaming"), "no Gaming leaked in");
});

// --- Result semantics --------------------------------------------------------

await check("a figure is reported as a figure", async () => {
  page.context = null; page.history = [];
  await ask("Show me Gaming projects.");
  const total = await ask("What is their total budget?");
  assert.equal(total.aggregate, true);
  assert.equal(total.entity, "figure");
  assert.equal(total.entityLabel, "a single figure");
  assert.equal(total.rows.length, 1, "one row holding the answer");
});

await check("child records are counted as child records, not as projects", async () => {
  page.context = null; page.history = [];
  const updates = await ask("Show me the Gaming activity updates.");
  assert.equal(updates.entity, "project_updates");
  assert.equal(updates.entityLabel, "activity updates");
  // The point of the fix: the row count and the project count are different
  // numbers and both are reported.
  const trueUpdates = database.prepare(`
    SELECT COUNT(*) AS n FROM project_updates u JOIN projects p ON p.id = u.project_id
    JOIN business_units b ON b.id = p.business_unit_id
    WHERE p.archived_at IS NULL AND b.name = 'Gaming'`).get().n;
  const trueProjects = database.prepare(`
    SELECT COUNT(DISTINCT u.project_id) AS n FROM project_updates u JOIN projects p ON p.id = u.project_id
    JOIN business_units b ON b.id = p.business_unit_id
    WHERE p.archived_at IS NULL AND b.name = 'Gaming'`).get().n;
  assert.equal(updates.total, trueUpdates, "the matched count is of updates");
  assert.ok(updates.projects, "distinct project counts are reported");
  assert.equal(updates.projects.matched, trueProjects, "and they are the distinct projects");
  assert.notEqual(updates.total, updates.projects.matched,
    "the fixture really does have more updates than projects, which is the case that was wrong");
});

await check("a project query counts projects, and says so", async () => {
  page.context = null; page.history = [];
  const projects = await ask("Show me Gaming projects.");
  assert.equal(projects.entity, "projects");
  assert.equal(projects.entityLabel, "projects");
  assert.equal(projects.projects.matched, projects.total, "one row is one project here");
});

await check("the answerer is told what a row is, and how many projects it covers", async () => {
  let handed = null;
  const watching = { async answer(question, result) { handed = result; return { text: "ok", usage: {} }; } };
  const watched = { ...env, ASSISTANT_ANSWERER: watching };
  await worker.fetch(new Request("https://ctx/api/assistant/ask", {
    method: "POST", headers, body: JSON.stringify({ question: "Show me the Gaming activity updates." }),
  }), watched, {});
  assert.equal(handed.entityLabel, "activity updates", "the answerer knows what it is counting");
  assert.ok(handed.projects.matched > 0, "and how many projects those rows are about");
  assert.notEqual(handed.total, handed.projects.matched);
});

// --- Phase 5 regressions ----------------------------------------------------

await check("a join that multiplies the rows is not reported as a project count", async () => {
  // Phase 5, case A1. "Show me each project together with its activity updates"
  // produced 127 rows over 74 projects, driven from projects, and the answer
  // read "there are 127 projects". There are 74.
  const fanned = {
    async generate() {
      return { intent: "search", language: "English", message: null,
        sql: "SELECT p.id, p.name, u.current_summary FROM projects p JOIN project_updates u ON u.project_id = p.id",
        usage: { model: "stub" } };
    },
  };
  let handed = null;
  const watching = { async answer(question, result) { handed = result; return { text: "ok", usage: {} }; } };
  const response = await worker.fetch(new Request("https://ctx/api/assistant/ask", {
    method: "POST", headers, body: JSON.stringify({ question: "projects with their updates" }),
  }), { ...env, ASSISTANT_SQL: fanned, ASSISTANT_ANSWERER: watching }, {});
  const answer = await response.json();

  const rows = database.prepare(`
    SELECT COUNT(*) AS n FROM projects p JOIN project_updates u ON u.project_id = p.id
    WHERE p.archived_at IS NULL`).get().n;
  const projects = database.prepare(`
    SELECT COUNT(DISTINCT p.id) AS n FROM projects p JOIN project_updates u ON u.project_id = p.id
    WHERE p.archived_at IS NULL`).get().n;
  assert.ok(rows > projects, "the fixture really does fan out, or this proves nothing");

  assert.equal(answer.total, rows, "the row count is still reported truthfully");
  assert.equal(answer.projects.matched, projects, "alongside the distinct projects");
  assert.equal(answer.fannedOut, true, "and the two are flagged as disagreeing");
  assert.match(answer.entityLabel, /more than one row per project/,
    "so the label cannot be read as a project count");
  assert.ok(!/^projects$/.test(answer.entityLabel), "it no longer says plainly 'projects'");
  assert.equal(handed.fannedOut, true, "the answerer is told, so it leads with the project count");
  assert.equal(handed.projects.matched, projects);
});

await check("a query with one row per project is not flagged as fanned out", async () => {
  const plain = {
    async generate() {
      return { intent: "search", language: "English", message: null,
        sql: "SELECT id, name FROM projects WHERE business_unit = 'Gaming'", usage: { model: "stub" } };
    },
  };
  const answer = await (await worker.fetch(new Request("https://ctx/api/assistant/ask", {
    method: "POST", headers, body: JSON.stringify({ question: "gaming" }),
  }), { ...env, ASSISTANT_SQL: plain, ASSISTANT_ANSWERER: answerer }, {})).json();
  assert.equal(answer.fannedOut, false, "no join, no fan-out");
  assert.equal(answer.entityLabel, "projects");
  assert.equal(answer.projects.matched, answer.total, "one row is one project");
});

await check("the answerer is told a figure covers only what is recorded", async () => {
  // Phase 5, case C2. An average over the 49 projects that have a budget was
  // described as "the average across all projects". There are 74.
  const { ANSWER_RULES } = await import("../worker/assistant-prompt.js");
  assert.match(ANSWER_RULES, /covers only the projects that\s+have that figure recorded/,
    "the rule is stated");
  assert.match(ANSWER_RULES, /Never\s+describe such a figure as covering "all projects"/,
    "and names the wording that was wrong");
  assert.match(ANSWER_RULES, /more than one row per project/,
    "the fan-out rule is stated too");
});

await check("an unintelligible question is asked about rather than answered", async () => {
  // Phase 5, case K4. Sixty x's followed by "projects?" returned all 74.
  const { INTENT_RULES } = await import("../worker/assistant-prompt.js");
  assert.match(INTENT_RULES, /mostly unintelligible/, "the rule is stated");
  assert.match(INTENT_RULES, /Returning the whole portfolio is a confident answer/,
    "and says why it matters");
});

console.log(`Assistant context and result-semantics tests passed: ${checks} checks — sealed continuity with ASSISTANT_DEBUG off, forged tokens ignored, subject switching, and child records counted as themselves.`);
