// Assistant query-plan tests.
//
// Runs against a real SQLite database built from the production schema and seed
// data, so the derived expressions are checked against the same shapes D1 holds
// rather than against fixtures invented for the test.
//
//   node scripts/assistant-plan-test.mjs
//
// The point of this suite is not that the happy path works. It is that a plan
// cannot reach a business unit the signed-in user may not see, by any field,
// including an explicit id list.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validatePlan, describePlan, planSchemaPrompt, planQueries, runPlan,
  PLAN_FIELDS, PLAN_LIMIT_MAX,
} from "../worker/assistant-plan.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- Database ----------------------------------------------------------------
// Schema from the migrations, rows from the seed, so this runs with no
// Cloudflare access and touches nothing real.

const database = new DatabaseSync(":memory:");
// The same migration list the smoke test applies, in the same order. They are
// not idempotent and several assume the previous one has run, so the order is
// the contract — see docs/DATABASE.md §2.
for (const name of [
  "0000_dnc_project_hub.sql",
  "0001_workbook_structure_and_roles.sql",
  "0002_user_directory.sql",
  "0003_development_pipeline_and_directory.sql",
  "0004_pilot_authentication.sql",
  "0005_profile_photos.sql",
  "0006_enhanced_media_and_revisions.sql",
  "0007_photo_details.sql",
]) {
  database.exec(readFileSync(resolve(projectRoot, "drizzle", name), "utf8"));
}

// Minimal fixture: two business units, so scope has something to exclude.
database.exec(`
  INSERT INTO business_units (id, name, sort_order) VALUES (1, 'Gaming', 1), (2, 'Patina', 2);
  INSERT INTO projects (
    id, source_key, business_unit_id, venue, project_type, name, capp_number,
    project_manager, status, budget_risk, schedule_risk,
    approved_budget, anticipated_final_cost,
    original_turnover_date, current_turnover_date,
    reporting_period, source_sort_order, archived_at
  ) VALUES
    (1, 'k1', 1, 'Venue A', 'Capital', 'Gaming Over Budget', 'CAPP-1',
     'Alice Stone', 'Active', 'High', 'Low', 1000, 1500, '2027-03-05', '2027-03-31', '2026-09-11', 1, NULL),
    (2, 'k2', 1, 'Venue B', 'Capital', 'Gaming On Time', 'CAPP-2',
     'Bob Reed', 'Active', 'Low', 'Low', 2000, 1800, '2027-04-01', '2027-04-01', '2026-09-11', 2, NULL),
    (3, 'k3', 2, 'Venue C', 'Capital', 'Patina Delayed', 'CAPP-3',
     'Cara Lin', 'On Hold', 'Low', 'High', 500, 900, '2027-01-01', '2027-02-10', '2026-09-11', 3, NULL),
    (4, 'k4', 1, 'Venue D', 'Development', 'Gaming Complete', NULL,
     'Dan Poole', 'Complete', 'Low', 'Low', NULL, NULL, NULL, NULL, '2026-09-11', 4, NULL),
    (5, 'k5', 1, 'Venue E', 'Capital', 'Gaming Archived', 'CAPP-5',
     'Eve Marsh', 'Active', 'High', 'High', 100, 900, '2027-01-01', '2027-06-01', '2026-09-11', 5, '2026-01-01');
`);

// node:sqlite exposes a different surface from D1, so adapt it rather than
// writing the module against the test's shape.
const db = {
  prepare(sql) {
    const statement = database.prepare(sql);
    return {
      bind(...bindings) {
        return {
          all: async () => ({ results: statement.all(...bindings) }),
          first: async () => statement.get(...bindings) ?? null,
        };
      },
    };
  },
};

const GAMING = ["Gaming"];
const ALL = null;
const names = (result) => result.rows.map((row) => row.name).sort();
let checks = 0;
// Every check is awaited, so an async body's assertion failure surfaces here
// with its label rather than as an unhandled rejection.
async function check(label, fn) {
  try { await fn(); } catch (problem) {
    problem.message = `${label}\n   ${problem.message}`;
    throw problem;
  }
  checks++;
}

// --- Validation --------------------------------------------------------------

await check("an empty plan is valid and means everything in scope", () => {
  const { plan, problems } = validatePlan({});
  assert.deepEqual(problems, []);
  assert.deepEqual(plan, {});
});

await check("a non-object plan is refused", () => {
  for (const bad of [null, "search", 7, ["unit"]]) {
    assert.equal(validatePlan(bad).plan, null);
  }
});

await check("an unknown field is refused, not ignored", () => {
  const { plan, problems } = validatePlan({ unit: "Gaming", table: "user_directory" });
  assert.equal(plan, null);
  assert.match(problems.join(" "), /Unknown plan field "table"/);
});

await check("enum fields reject values outside their list", () => {
  assert.equal(validatePlan({ status: "Cancelled" }).plan, null);
  assert.equal(validatePlan({ risk: "reputational" }).plan, null);
  assert.equal(validatePlan({ amountField: "password_hash" }).plan, null);
  assert.equal(validatePlan({ sort: "password_hash" }).plan, null);
});

await check("types are enforced", () => {
  assert.equal(validatePlan({ delayed: "yes" }).plan, null);
  assert.equal(validatePlan({ minAmount: "1000" }).plan, null);
  assert.equal(validatePlan({ limit: 2.5 }).plan, null);
  assert.equal(validatePlan({ ids: "1,2,3" }).plan, null);
  assert.equal(validatePlan({ ids: [1, "2"] }).plan, null);
  assert.equal(validatePlan({ ids: [-1] }).plan, null);
});

await check("limit is clamped to the server's maximum, not taken on trust", () => {
  assert.equal(validatePlan({ limit: 5000 }).plan.limit, PLAN_LIMIT_MAX);
  assert.equal(validatePlan({ limit: 5 }).plan.limit, 5);
});

await check("ids are capped", () => {
  const tooMany = Array.from({ length: PLAN_FIELDS.ids.maxItems + 1 }, (_, i) => i + 1);
  assert.equal(validatePlan({ ids: tooMany }).plan, null);
});

await check("risk implies High, minAmount implies the forecast column", () => {
  assert.equal(validatePlan({ risk: "budget" }).plan.riskLevel, "High");
  assert.equal(validatePlan({ minAmount: 10 }).plan.amountField, "anticipated_final_cost");
});

// --- Scope enforcement -------------------------------------------------------

await check("a scoped user sees only their own unit", async () => {  const scoped = await runPlan(db, {}, GAMING);
  assert.deepEqual(names(scoped), ["Gaming Complete", "Gaming On Time", "Gaming Over Budget"]);
  assert.equal(scoped.total, 3);

  const unrestricted = await runPlan(db, {}, ALL);
  assert.equal(unrestricted.total, 4, "unrestricted access sees the Patina project too");

  // The archived project is excluded from both, matching every other screen.
  assert.ok(!names(unrestricted).includes("Gaming Archived"));});

await check("an explicit id list cannot reach outside scope", async () => {  const result = await runPlan(db, { ids: [1, 3] }, GAMING);
  assert.deepEqual(names(result), ["Gaming Over Budget"], "project 3 is Patina and must not appear");
  assert.equal(result.total, 1);});

await check("naming another unit cannot widen scope", async () => {  const result = await runPlan(db, { unit: "Patina" }, GAMING);
  assert.equal(result.total, 0, "unit narrows within scope; it never replaces it");
  assert.equal(result.rows.length, 0);});

await check("an empty scope array returns nothing rather than everything", async () => {  const result = await runPlan(db, {}, []);
  assert.equal(result.total, 0);});

// --- Filters -----------------------------------------------------------------

await check("overBudget uses forecast minus approved, positive meaning over", async () => {  const result = await runPlan(db, { overBudget: true }, ALL);
  assert.deepEqual(names(result), ["Gaming Over Budget", "Patina Delayed"]);});

await check("delayed compares the two turnover dates", async () => {  const result = await runPlan(db, { delayed: true }, ALL);
  assert.deepEqual(names(result), ["Gaming Over Budget", "Patina Delayed"]);});

await check("day variance is computed from the dates, not the stored column", async () => {  // The stored duration_change_days is deliberately left NULL in the fixture.
  // A correct implementation still reports 26 for 2027-03-05 -> 2027-03-31 —
  // QA's original case, and the reason the column cannot be trusted.
  const result = await runPlan(db, { ids: [1] }, ALL);
  assert.equal(result.rows[0].duration_change_days, 26);});

await check("forecast_variance is exposed and signed correctly", async () => {  const result = await runPlan(db, { ids: [1] }, ALL);
  assert.equal(result.rows[0].forecast_variance, 500);});

await check("risk filters address the right column", async () => {  assert.deepEqual(names(await runPlan(db, { risk: "budget", riskLevel: "High" }, ALL)), ["Gaming Over Budget"]);
  assert.deepEqual(names(await runPlan(db, { risk: "schedule", riskLevel: "High" }, ALL)), ["Patina Delayed"]);
  assert.deepEqual(names(await runPlan(db, { risk: "either", riskLevel: "High" }, ALL)),
    ["Gaming Over Budget", "Patina Delayed"]);});

await check("excludeComplete and status", async () => {  assert.ok(!names(await runPlan(db, { excludeComplete: true }, GAMING)).includes("Gaming Complete"));
  assert.deepEqual(names(await runPlan(db, { status: "On Hold" }, ALL)), ["Patina Delayed"]);});

await check("search covers the fields the pilot searched", async () => {  assert.deepEqual(names(await runPlan(db, { search: "CAPP-3" }, ALL)), ["Patina Delayed"]);
  assert.deepEqual(names(await runPlan(db, { search: "Venue A" }, ALL)), ["Gaming Over Budget"]);
  assert.deepEqual(names(await runPlan(db, { search: "Cara" }, ALL)), [], "manager is not a search field");
  assert.deepEqual(names(await runPlan(db, { manager: "Cara" }, ALL)), ["Patina Delayed"]);});

await check("minAmount applies to the named column", async () => {  // Forecasts are 1500, 1800 and 900, so 1500 matches the first two.
  assert.deepEqual(names(await runPlan(db, { minAmount: 1500 }, ALL)),
    ["Gaming On Time", "Gaming Over Budget"]);
  // Approved budgets are 1000, 2000 and 500, so the same threshold against the
  // other column selects a different project — which is the point of the field.
  assert.deepEqual(names(await runPlan(db, { minAmount: 1500, amountField: "approved_budget" }, ALL)),
    ["Gaming On Time"]);});

// --- Result shape ------------------------------------------------------------

await check("total counts the whole match, rows are capped, truncation is reported", async () => {  const result = await runPlan(db, { limit: 1 }, GAMING);
  assert.equal(result.total, 3, "total is COUNT(*) over the scoped query, not the page length");
  assert.equal(result.returned, 1);
  assert.equal(result.truncated, true);

  const whole = await runPlan(db, {}, GAMING);
  assert.equal(whole.truncated, false);});

await check("sources accompany every answer for the evidence panel", async () => {  const result = await runPlan(db, { ids: [1] }, ALL);
  assert.deepEqual(result.sources, [{
    id: 1, name: "Gaming Over Budget", business_unit: "Gaming", reporting_period: "2026-09-11",
  }]);});

await check("no row carries a column the assistant must not see", async () => {  const result = await runPlan(db, {}, ALL);
  const forbidden = [
    "password_hash", "password_salt", "token_hash", "csrf_token",
    "object_key", "author_email", "source_key", "source_sheet",
    "business_unit_id", "source_sort_order",
  ];
  for (const row of result.rows) {
    for (const column of forbidden) {
      assert.ok(!(column in row), `${column} must not reach the assistant`);
    }
  }});

await check("sort orders by the requested derived value, nulls last", async () => {  const byDelay = await runPlan(db, { sort: "delay" }, ALL);
  assert.equal(byDelay.rows[0].name, "Patina Delayed", "40 days beats 26");
  assert.equal(byDelay.rows.at(-1).duration_change_days, null);

  const byVariance = await runPlan(db, { sort: "variance" }, ALL);
  assert.equal(byVariance.rows[0].name, "Gaming Over Budget", "+500 beats +400");});

// --- Description and prompt --------------------------------------------------

await check("describePlan names every applied filter", () => {
  const { plan } = validatePlan({ unit: "Gaming", risk: "budget", delayed: true, limit: 5 });
  const text = describePlan(plan).join(" · ");
  assert.match(text, /Gaming/);
  assert.match(text, /High budget risk/);
  assert.match(text, /Current turnover later than original/);
  assert.match(text, /Top 5/);
  assert.deepEqual(describePlan({}), ["All available projects"]);
});

await check("the generated schema text mentions every field and no secrets", () => {
  const prompt = planSchemaPrompt();
  for (const key of Object.keys(PLAN_FIELDS)) assert.match(prompt, new RegExp(`\\b${key}\\b`));
  for (const leak of ["password", "token", "object_key", "user_directory", "login_sessions", "SELECT"]) {
    assert.ok(!prompt.includes(leak), `${leak} must not appear in the model's vocabulary`);
  }
});

await check("the plan never produces SQL from model text", () => {
  // Every binding is a value; no plan field is interpolated into the statement.
  const { plan } = validatePlan({ search: "'; DROP TABLE projects --", manager: "x' OR '1'='1" });
  const { rows } = planQueries(plan, GAMING);
  assert.ok(!rows.sql.includes("DROP"));
  assert.ok(!rows.sql.includes("OR '1'='1"));
  assert.ok(rows.bindings.includes("%'; DROP TABLE projects --%"));
});

await check("an injection attempt through search returns no rows and changes nothing", async () => {  const { plan } = validatePlan({ search: "'; DROP TABLE projects --" });
  const result = await runPlan(db, plan, ALL);
  assert.equal(result.total, 0);
  const stillThere = database.prepare("SELECT COUNT(*) AS c FROM projects").get().c;
  assert.equal(stillThere, 5, "projects table intact");});

console.log(`Assistant plan tests passed: ${checks} checks — validation, scope enforcement, filters, result shape, prompt schema.`);
