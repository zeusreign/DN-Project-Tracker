// Ask the assistant a question from the terminal.
//
//   npm run assistant -- "which projects slipped more than 30 days?"
//   npm run assistant                       # runs a handful of examples
//
// Boots the built worker against a throwaway in-memory database seeded with the
// 74 starting records, so it needs no Cloudflare access, no dev server and
// touches nothing real. The only outbound call is to OpenAI, using
// OPENAI_API_KEY from .env — without that key it stops and says so.
//
// Use it to see what a question turns into: the plan, the filters as the user
// would see them described, and the rows that matched.

import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";

// Read .env directly rather than requiring it to be exported first. The key
// lives there for the preview already, and `npm run assistant` should not need
// a shell incantation to find it. An existing environment variable wins, so
// OPENAI_API_KEY=... npm run assistant still overrides the file.
async function keyFromEnvFile() {
  for (const name of [".env.local", ".env"]) {
    let text;
    try { text = await readFile(new URL(`../${name}`, import.meta.url), "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const match = /^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const value = match[1].trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  }
  return null;
}

const KEY = process.env.OPENAI_API_KEY || await keyFromEnvFile();
if (!KEY) {
  console.error("\n  No OPENAI_API_KEY found in the environment, .env or .env.local.");
  console.error("  Add it to .env (see .env.example) and run this again.\n");
  process.exit(1);
}

const database = new DatabaseSync(":memory:");
for (const name of [
  "0000_dnc_project_hub.sql", "0001_workbook_structure_and_roles.sql",
  "0002_user_directory.sql", "0003_development_pipeline_and_directory.sql",
  "0004_pilot_authentication.sql", "0005_profile_photos.sql",
  "0006_enhanced_media_and_revisions.sql", "0007_photo_details.sql",
]) {
  database.exec(await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
}

// The same minimal D1 shim the smoke test uses: node:sqlite exposes a different
// surface from D1, so adapt it here rather than in the worker.
const statements = (sql) => database.prepare(sql);
const DB = {
  prepare(sql) {
    const statement = statements(sql);
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
  DB,
  ADMIN_EMAILS: "demo@example.invalid",
  ALLOW_PLATFORM_AUTH: "true",
  OPENAI_API_KEY: KEY,
  ASSISTANT_PLANNER_MODEL: process.env.ASSISTANT_PLANNER_MODEL,
};
// Platform identity, so the demo needs no password flow. Only valid because
// ALLOW_PLATFORM_AUTH is true on this throwaway database; production keeps it
// "false" and this header is ignored there.
const headers = {
  "oai-authenticated-user-id": "demo-id",
  "oai-authenticated-user-email": "demo@example.invalid",
  "oai-authenticated-user-full-name": "Assistant Demo",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  "content-type": "application/json",
};

const worker = (await import(new URL("../dist/server/index.js?demo=" + Date.now(), import.meta.url).href)).default;

const money = (value) => value === null || value === undefined ? "—"
  : "$" + Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });

async function ask(question) {
  const response = await worker.fetch(new Request("https://demo.local/api/assistant/ask", {
    method: "POST", headers, body: JSON.stringify({ question }),
  }), env, {});
  const body = await response.json().catch(() => null);

  console.log(`\n\x1b[1m? ${question}\x1b[0m`);
  if (!body) { console.log(`  HTTP ${response.status}, no body`); return; }

  if (!body.ok) {
    console.log(`  \x1b[31mrejected\x1b[0m (HTTP ${response.status})`);
    console.log(`  ${String(body.error).split("\n").join("\n  ")}`);
    return;
  }

  console.log(`  intent   ${body.intent}   language ${body.language}`);
  if (body.message) console.log(`  answer   ${body.message}`);
  if (body.plan) console.log(`  plan     ${JSON.stringify(body.plan)}`);
  if (body.description) console.log(`  filters  ${body.description.join(" · ")}`);
  if (body.intent === "search" || body.intent === "report") {
    console.log(`  matched  ${body.total}${body.truncated ? `, showing ${body.returned}` : ""}`);
    for (const row of (body.rows || []).slice(0, 8)) {
      const slip = row.duration_change_days === null ? "—" : `${row.duration_change_days}d`;
      console.log(`    ${String(row.name).slice(0, 38).padEnd(38)} ${String(row.business_unit).padEnd(16)}`
        + ` var ${money(row.forecast_variance).padStart(12)}  slip ${slip.padStart(6)}`);
    }
    if ((body.rows || []).length > 8) console.log(`    … and ${body.rows.length - 8} more`);
  }
}

const asked = process.argv.slice(2).filter((value) => value.trim());
const questions = asked.length ? asked : [
  "which projects slipped more than 30 days?",
  "anything more than $50k over budget?",
  "which Gaming projects have high schedule risk?",
  "delete the Gate City project",
  "what is the weather in Buffalo?",
  "welche Projekte sind in Verzug?",
];
for (const question of questions) await ask(question);
console.log("");
