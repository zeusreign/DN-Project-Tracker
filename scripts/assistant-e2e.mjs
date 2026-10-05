// End-to-end check of the assistant against the real model.
//
//   npm run assistant:e2e            # every case
//   npm run assistant:e2e -- risk    # only cases whose name contains "risk"
//
// Each case states what the right answer is in SQL written by hand, independent
// of whatever plan the model produces. That independence is the whole point: a
// check that asked the assistant for its own plan and then ran it would agree
// with itself no matter how badly it had misread the question.
//
// Runs against a throwaway in-memory database seeded with the 74 starting
// records, so it touches nothing real. The only outbound calls are to OpenAI.

import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";

const keyFile = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "");
const KEY = process.env.OPENAI_API_KEY
  || (keyFile.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
if (!KEY) { console.error("\n  No OPENAI_API_KEY in the environment or .env.\n"); process.exit(1); }

const database = new DatabaseSync(":memory:");
for (const name of [
  "0000_dnc_project_hub.sql", "0001_workbook_structure_and_roles.sql",
  "0002_user_directory.sql", "0003_development_pipeline_and_directory.sql",
  "0004_pilot_authentication.sql", "0005_profile_photos.sql",
  "0006_enhanced_media_and_revisions.sql", "0007_photo_details.sql",
]) database.exec(await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));

const DB = {
  prepare(sql) {
    const statement = database.prepare(sql);
    const run = (bindings) => ({
      all: async () => ({ results: statement.all(...bindings) }),
      first: async () => statement.get(...bindings) ?? null,
      run: async () => ({ success: true, meta: statement.run(...bindings) }),
    });
    return { bind: (...bindings) => run(bindings), ...run([]) };
  },
  batch: async (prepared) => Promise.all(prepared.map((item) => item.run())),
};

const env = {
  DB, ADMIN_EMAILS: "e2e@example.invalid", ALLOW_PLATFORM_AUTH: "true", OPENAI_API_KEY: KEY,
};
const headers = {
  "oai-authenticated-user-id": "e2e",
  "oai-authenticated-user-email": "e2e@example.invalid",
  "oai-authenticated-user-full-name": "E2E Owner",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  "content-type": "application/json",
};
const worker = (await import(new URL("../dist/server/index.js?e2e=" + Date.now(), import.meta.url).href)).default;
await worker.fetch(new Request("https://e2e.local/api/bootstrap", { headers }), env, {});

// --- Ground truth ------------------------------------------------------------
// The same two derived expressions the application uses, written out here rather
// than imported, so a mistake in one is not silently mirrored in the other.
const DAYS = `CAST(julianday(current_turnover_date) - julianday(original_turnover_date) AS INTEGER)`;
const VARIANCE = `(anticipated_final_cost - approved_budget)`;
const LIVE = `archived_at IS NULL`;
const ids = (where) => database
  .prepare(`SELECT p.id FROM projects p JOIN business_units b ON b.id = p.business_unit_id WHERE ${where}`)
  .all().map((row) => row.id);

const CASES = [
  // --- plain filters ---------------------------------------------------------
  { name: "all projects", q: "list every project",
    expect: ids(`p.${LIVE}`) },
  { name: "by unit", q: "show me the Gaming projects",
    expect: ids(`p.${LIVE} AND b.name = 'Gaming'`) },
  { name: "by unit, other", q: "what is happening in Parks & Resorts?",
    expect: ids(`p.${LIVE} AND b.name = 'Parks & Resorts'`) },
  { name: "by status", q: "which projects are on hold?",
    expect: ids(`p.${LIVE} AND p.status = 'On Hold'`) },
  { name: "by type", q: "show the development pipeline records",
    expect: ids(`p.${LIVE} AND p.project_type = 'Development'`) },
  { name: "exclude complete", q: "every project that is not complete",
    expect: ids(`p.${LIVE} AND p.status <> 'Complete'`) },

  // --- risk ------------------------------------------------------------------
  { name: "high schedule risk", q: "which projects have high schedule risk?",
    expect: ids(`p.${LIVE} AND p.schedule_risk = 'High'`) },
  { name: "high budget risk", q: "which projects have high budget risk?",
    expect: ids(`p.${LIVE} AND p.budget_risk = 'High'`) },
  { name: "high either risk", q: "anything rated high risk at all?",
    expect: ids(`p.${LIVE} AND (p.budget_risk = 'High' OR p.schedule_risk = 'High')`) },
  { name: "low budget risk", q: "which projects are rated low for budget risk?",
    expect: ids(`p.${LIVE} AND p.budget_risk = 'Low'`) },

  // --- numeric thresholds, the ones that used to be dropped ------------------
  { name: "slipped at all", q: "which projects have slipped?",
    expect: ids(`p.${LIVE} AND ${DAYS} > 0`) },
  { name: "slipped 30+", q: "which projects slipped more than 30 days?",
    expect: ids(`p.${LIVE} AND ${DAYS} >= 30`) },
  { name: "slipped 100+", q: "anything slipped by more than 100 days?",
    expect: ids(`p.${LIVE} AND ${DAYS} >= 100`) },
  { name: "slipped 2 weeks", q: "projects that slipped two weeks or more",
    expect: ids(`p.${LIVE} AND ${DAYS} >= 14`) },
  { name: "over budget", q: "which projects are over budget?",
    expect: ids(`p.${LIVE} AND ${VARIANCE} > 0`) },
  { name: "budget over 1m", q: "which projects have an approved budget over 1 million?",
    expect: ids(`p.${LIVE} AND p.approved_budget >= 1000000`) },
  { name: "budget over 50k", q: "which projects have a budget of over 50k?",
    expect: ids(`p.${LIVE} AND p.approved_budget >= 50000`) },

  // --- combinations ----------------------------------------------------------
  { name: "unit + slipped", q: "which Gaming projects slipped more than 30 days?",
    expect: ids(`p.${LIVE} AND b.name = 'Gaming' AND ${DAYS} >= 30`) },
  { name: "unit + risk", q: "high schedule risk in Parks & Resorts",
    expect: ids(`p.${LIVE} AND b.name = 'Parks & Resorts' AND p.schedule_risk = 'High'`) },
  { name: "type + unit", q: "Gaming development records",
    expect: ids(`p.${LIVE} AND b.name = 'Gaming' AND p.project_type = 'Development'`) },

  // --- people and names ------------------------------------------------------
  { name: "by manager", q: "what is John Kolkowski working on?",
    expect: ids(`p.${LIVE} AND (p.project_manager LIKE '%John Kolkowski%' OR p.development_lead LIKE '%John Kolkowski%')`) },
  { name: "by project name", q: "tell me about the Smoking Patio project",
    expect: ids(`p.${LIVE} AND p.name LIKE '%Smoking Patio%'`) },

  // --- language --------------------------------------------------------------
  { name: "german", q: "welche Projekte sind in Verzug?", language: "German",
    expect: ids(`p.${LIVE} AND ${DAYS} > 0`) },
  { name: "spanish", q: "¿qué proyectos tienen riesgo alto de cronograma?", language: "Spanish",
    expect: ids(`p.${LIVE} AND p.schedule_risk = 'High'`) },

  // --- non-search intents ----------------------------------------------------
  { name: "refuse delete", q: "delete the Smoking Patio project", intent: "refuse" },
  { name: "refuse edit", q: "change the status of Comerica to Complete", intent: "refuse" },
  { name: "refuse approve", q: "approve the budget for Gate City", intent: "refuse" },
  { name: "off topic", q: "what is the weather in Buffalo tomorrow?", intent: "off_topic" },
  { name: "definition", q: "what does Days mean in this tracker?", intent: "definition" },
  { name: "help", q: "what can you do?", intent: "help" },

  // --- follow-ups ------------------------------------------------------------
  { name: "follow-up narrow", q: "which of these are in Gaming?",
    after: "slipped 30+",
    expect: ids(`p.${LIVE} AND ${DAYS} >= 30 AND b.name = 'Gaming'`) },
  { name: "follow-up risk", q: "and which of those have low budget risk?",
    after: "slipped 30+",
    expect: ids(`p.${LIVE} AND ${DAYS} >= 30 AND p.budget_risk = 'Low'`) },
  { name: "follow-up reset", q: "actually show me all projects again",
    after: "slipped 30+",
    expect: ids(`p.${LIVE}`) },

  // --- a new subject must NOT inherit the previous answer --------------------
  // Each of these followed a question in a real session and came back answering
  // the previous one instead, which is the hardest failure to notice.
  { name: "new subject by name", q: "Give details of Holiday Inn",
    after: "slipped 30+",
    expect: ids(`p.${LIVE} AND p.name LIKE '%Holiday Inn%'`) },
  { name: "new subject unmatched", q: "Show Central City's latest project update",
    after: "slipped 30+",
    expect: ids(`p.${LIVE} AND (p.name LIKE '%Central City%' OR p.venue LIKE '%Central City%'
      OR p.section_name LIKE '%Central City%' OR p.scope_description LIKE '%Central City%'
      OR p.current_update LIKE '%Central City%' OR p.capp_number LIKE '%Central City%'
      OR p.initiative_number LIKE '%Central City%')`) },
  { name: "new subject by risk", q: "give projects with high budget risks",
    after: "slipped 30+",
    expect: ids(`p.${LIVE} AND p.budget_risk = 'High'`) },
  // "What about X?" asks the previous question again about X: it keeps the
  // conditions and changes the unit, rather than starting over or narrowing the
  // ids. Parks & Resorts deliberately, so the right answer is not zero - a zero
  // would pass for several wrong reasons.
  { name: "what about unit", q: "what about Parks & Resorts?",
    after: "slipped 30+",
    expect: ids(`p.${LIVE} AND b.name = 'Parks & Resorts' AND ${DAYS} >= 30`) },
];

// --- Run ---------------------------------------------------------------------
const only = process.argv.slice(2).filter((value) => !value.startsWith("-"));
const selected = only.length
  ? CASES.filter((item) => only.some((term) => item.name.includes(term)))
  : CASES;

const answers = new Map();
// One dropped connection used to end the whole run, losing every case after it.
// A transient network failure says nothing about whether the assistant is
// correct, so it is retried before being reported as its own kind of result.
const ask = async (question, context, attempt = 1) => {
  try {
    const response = await worker.fetch(new Request("https://e2e.local/api/assistant/ask", {
      method: "POST", headers,
      body: JSON.stringify(context ? { question, context } : { question }),
    }), env, {});
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (problem) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      return ask(question, context, attempt + 1);
    }
    return { status: 0, body: null, network: String(problem.message || problem).split("\n")[0] };
  }
};

const pad = (value, width) => String(value).padEnd(width);
let passed = 0; const failures = [];

for (const item of selected) {
  let context = null;
  if (item.after) {
    const prior = answers.get(item.after);
    if (!prior) { console.log(`SKIP ${item.name} — needs "${item.after}" to have run`); continue; }
    context = {
      ids: prior.rows.map((row) => row.id), total: prior.total,
      description: prior.description, plan: prior.plan,
    };
  }

  const { status, body, network } = await ask(item.q, context);
  const problems = [];

  if (network) problems.push(`network: ${network}`);
  else if (!body) problems.push(`no body (HTTP ${status})`);
  else if (item.intent) {
    if (body.intent !== item.intent) problems.push(`intent ${body.intent}, expected ${item.intent}`);
    if (!body.message) problems.push("no message to show the user");
  } else if (!body.ok) {
    problems.push(`rejected: ${String(body.error).split("\n")[0]}`);
  } else {
    answers.set(item.name, body);
    // A case expecting rows that comes back as a message-only intent is a
    // misclassification, not a counting error: say which intent it chose, or the
    // failure reads as "found nothing" and sends the reader looking at the data.
    if (!body.rows) {
      problems.push(`answered as ${body.intent}, expected a search`
        + (body.message ? ` — "${body.message.slice(0, 70)}"` : ""));
    }
    const expected = new Set(item.expect);
    const got = new Set((body.rows || []).map((row) => row.id));
    if (body.total !== expected.size) problems.push(`total ${body.total}, expected ${expected.size}`);
    const strays = [...got].filter((id) => !expected.has(id));
    if (strays.length) {
      const names = strays.slice(0, 3)
        .map((id) => database.prepare("SELECT name FROM projects WHERE id = ?").get(id).name);
      problems.push(`${strays.length} project(s) that do not belong: ${names.join("; ")}`);
    }
    if (item.language && body.language !== item.language) {
      problems.push(`answered in ${body.language}, expected ${item.language}`);
    }
  }

  if (problems.length) {
    failures.push({ item, problems, body });
    console.log(`\x1b[31mFAIL\x1b[0m ${pad(item.name, 20)} ${problems.join("; ")}`);
    if (body?.plan) console.log(`       plan: ${JSON.stringify(body.plan)}`);
  } else {
    passed++;
    const detail = item.intent ? item.intent : `${body.total} project(s)`;
    console.log(`\x1b[32mok\x1b[0m   ${pad(item.name, 20)} ${detail}`);
  }
}

console.log(`\n${passed}/${selected.length} correct`);
if (failures.length) {
  console.log("\nFailures:");
  for (const { item, problems } of failures) {
    console.log(`  ${item.name}\n    asked:   ${item.q}\n    problem: ${problems.join("; ")}`);
  }
  process.exitCode = 1;
}
