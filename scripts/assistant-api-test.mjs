// Unit tests for the assistant's architecture-independent parts: the approved
// schema's business rules, and the route helpers that survive the planner.
//
// Nothing here imports the planner. That is the point: these are the pieces the
// SQL-generating engine will be built on, so they are tested against a real
// SQLite database and against SQL assembled the way that engine will assemble
// it, not the way the plan executor did.
//
//   node scripts/assistant-api-test.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORECAST_VARIANCE_SQL, DAY_VARIANCE_SQL, PROJECT_COLUMNS, PROJECT_FROM_SQL,
  LIVE_PROJECT_SQL, LIVE_PHOTO_SQL, RESULT_LIMIT_DEFAULT, RESULT_LIMIT_MAX,
  APPROVED_TABLES, FORBIDDEN_TABLES, GLOSSARY, clampLimit, scopePredicate, availableUnits,
} from "../worker/assistant-schema.js";
import { refersBack, formatSql, whereOf, legacyPlannerEnabled } from "../worker/assistant-api.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const database = new DatabaseSync(":memory:");
for (const name of [
  "0000_dnc_project_hub.sql", "0001_workbook_structure_and_roles.sql",
  "0002_user_directory.sql", "0003_development_pipeline_and_directory.sql",
  "0004_pilot_authentication.sql", "0005_profile_photos.sql",
  "0006_enhanced_media_and_revisions.sql", "0007_photo_details.sql",
]) database.exec(readFileSync(resolve(projectRoot, "drizzle", name), "utf8"));

// A project that is over budget and late, one that is neither, one in another
// unit, and one archived. Enough for the derived figures and for scope to have
// something to exclude.
database.exec(`
  INSERT INTO business_units (id, name, sort_order) VALUES (1, 'Gaming', 1), (2, 'Patina', 2);
  INSERT INTO projects (
    id, source_key, business_unit_id, venue, project_type, name, capp_number,
    project_manager, status, budget_risk, schedule_risk,
    approved_budget, anticipated_final_cost,
    original_turnover_date, current_turnover_date,
    duration_change_days, reporting_period, source_sort_order, archived_at
  ) VALUES
    (1, 'k1', 1, 'Venue A', 'Capital', 'Over And Late', 'CAPP-1',
     'Alice Stone', 'Active', 'High', 'Low', 1000, 1500,
     '2027-03-01', '2027-03-31', 0, '2026-09-11', 1, NULL),
    (2, 'k2', 1, 'Venue B', 'Capital', 'On Budget', 'CAPP-2',
     'Bob Reed', 'Active', 'Low', 'Low', 2000, 1800,
     '2027-04-01', '2027-04-01', 0, '2026-09-11', 2, NULL),
    (3, 'k3', 2, 'Venue C', 'Capital', 'No Figures', 'CAPP-3',
     'Cara Lin', 'On Hold', 'Low', 'High', NULL, NULL,
     NULL, NULL, NULL, '2026-09-11', 3, NULL),
    (4, 'k4', 1, 'Venue D', 'Capital', 'Archived One', 'CAPP-4',
     'Dan Poole', 'Active', 'High', 'High', 100, 900,
     '2027-01-01', '2027-06-01', 0, '2026-09-11', 4, '2026-01-01');
`);

const db = {
  prepare(sql) {
    const statement = database.prepare(sql);
    return { bind: (...b) => ({
      all: async () => ({ results: statement.all(...b) }),
      first: async () => statement.get(...b) ?? null,
    }) };
  },
};

let checks = 0;
async function check(label, fn) {
  try { await fn(); } catch (problem) {
    problem.message = `${label}\n   ${problem.message}`;
    throw problem;
  }
  checks++;
}

// How the new engine will assemble a statement: the approved projection, the
// approved FROM clause, the always-on soft-delete filter, then the scope.
function scopedQuery(scope, extra = "") {
  const scoped = scopePredicate(scope);
  const clauses = [LIVE_PROJECT_SQL, ...(scoped ? [scoped.sql] : []), ...(extra ? [extra] : [])];
  return {
    sql: `SELECT ${PROJECT_COLUMNS}${PROJECT_FROM_SQL} WHERE ${clauses.join(" AND ")}`
      + " ORDER BY p.source_sort_order, p.id LIMIT ?",
    bindings: [...(scoped ? scoped.bindings : []), RESULT_LIMIT_DEFAULT],
  };
}
const run = async (scope, extra) => {
  const { sql, bindings } = scopedQuery(scope, extra);
  return (await db.prepare(sql).bind(...bindings).all()).results;
};

// --- The derived figures -----------------------------------------------------

await check("forecast variance is the overrun, and null when either side is missing", async () => {
  const rows = await run(null);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by["Over And Late"].forecast_variance, 500, "1500 - 1000");
  assert.equal(by["On Budget"].forecast_variance, -200, "under budget is negative");
  assert.equal(by["No Figures"].forecast_variance, null,
    "no figures is unknown, never reported as on budget");
});

await check("the day variance is computed from the dates, not read from the stored column", async () => {
  // projects.duration_change_days is 0 on every fixture row and wrong on 24
  // production rows, because it is only recalculated when a date is written.
  // Reading it would report this project as on time.
  const rows = await run(null);
  const late = rows.find((r) => r.name === "Over And Late");
  assert.equal(late.duration_change_days, 30, "1 March to 31 March");
  assert.equal(database.prepare("SELECT duration_change_days AS d FROM projects WHERE id = 1").get().d, 0,
    "the stored column disagrees, which is exactly why it is not used");
  assert.equal(rows.find((r) => r.name === "On Budget").duration_change_days, 0, "no slip");
  assert.equal(rows.find((r) => r.name === "No Figures").duration_change_days, null, "no dates is unknown");
});

await check("the two derived expressions are the only source of those figures", () => {
  // If a future prompt offers duration_change_days as a column the model may
  // name, the assistant starts disagreeing with the project screen. The
  // projection must expose the computed value under that name and nothing else.
  assert.match(PROJECT_COLUMNS, /AS duration_change_days/);
  assert.ok(!/p\.duration_change_days/.test(PROJECT_COLUMNS),
    "the stored column is never selected");
  assert.match(DAY_VARIANCE_SQL, /julianday/);
  assert.match(FORECAST_VARIANCE_SQL, /anticipated_final_cost - p\.approved_budget/);
});

// --- Soft deletes ------------------------------------------------------------

await check("an archived project is never returned", async () => {
  const names = (await run(null)).map((r) => r.name);
  assert.ok(!names.includes("Archived One"), "archived is gone, not filtered on request");
  assert.equal(names.length, 3);
  assert.equal(LIVE_PROJECT_SQL, "p.archived_at IS NULL");
  assert.equal(LIVE_PHOTO_SQL, "deleted_at IS NULL");
});

// --- The permission boundary -------------------------------------------------

await check("scope is a predicate, and an empty scope is a contradiction", () => {
  assert.equal(scopePredicate(null), null, "unrestricted");
  assert.deepEqual(scopePredicate([]), { sql: "1 = 0", bindings: [] },
    "a user who may see nothing sees nothing, not everything");
  assert.deepEqual(scopePredicate(["Gaming"]), { sql: "b.name IN (?)", bindings: ["Gaming"] });
  assert.deepEqual(scopePredicate(["Gaming", "Patina"]),
    { sql: "b.name IN (?, ?)", bindings: ["Gaming", "Patina"] });
});

await check("scope is bound, never interpolated", () => {
  const { sql, bindings } = scopedQuery(["'; DROP TABLE projects --"]);
  assert.ok(!sql.includes("DROP"), "the value is not in the statement");
  assert.deepEqual(bindings.slice(0, 1), ["'; DROP TABLE projects --"]);
});

await check("a scoped query cannot reach another unit", async () => {
  const gaming = (await run(["Gaming"])).map((r) => r.business_unit);
  assert.deepEqual([...new Set(gaming)], ["Gaming"]);
  assert.equal((await run([])).length, 0, "an empty scope returns nothing");
  assert.equal((await run(null)).length, 3, "unrestricted still sees every live row");
});

await check("the unit vocabulary is narrowed to the reader's scope, without case", async () => {
  assert.deepEqual(await availableUnits(db, null), ["Gaming", "Patina"]);
  assert.deepEqual(await availableUnits(db, ["Gaming"]), ["Gaming"]);
  assert.deepEqual(await availableUnits(db, ["gaming"]), ["Gaming"],
    "a scope is stored as the administrator typed it");
  assert.deepEqual(await availableUnits(db, []), [], "no scope means no vocabulary");
});

// --- Result limits -----------------------------------------------------------

await check("the row cap is enforced rather than requested", () => {
  assert.equal(clampLimit(undefined), RESULT_LIMIT_DEFAULT);
  assert.equal(clampLimit(5), 5);
  assert.equal(clampLimit(500), RESULT_LIMIT_MAX, "asking for 500 gets 50");
  assert.equal(clampLimit("not a number"), RESULT_LIMIT_DEFAULT);
  assert.equal(RESULT_LIMIT_MAX, 50);
});

// --- The read surface --------------------------------------------------------

await check("the approved surface names five tables and no more", () => {
  assert.deepEqual(Object.keys(APPROVED_TABLES).sort(),
    ["business_units", "development_details", "project_photos", "project_updates", "projects"]);
  for (const table of FORBIDDEN_TABLES) {
    assert.ok(!PROJECT_FROM_SQL.includes(table), `${table} is not joined`);
    assert.ok(!PROJECT_COLUMNS.includes(table), `${table} is not selected`);
  }
  assert.ok(FORBIDDEN_TABLES.includes("user_directory"), "password hashes stay out of reach");
  assert.ok(FORBIDDEN_TABLES.includes("audit_log"), "the record of who did what is not project data");
});

await check("the photograph key is never part of an answer", () => {
  assert.ok(!PROJECT_COLUMNS.includes("object_key"),
    "R2 access is authorised by the application, so the key reaches neither model nor browser");
});

await check("the glossary states the two figures without naming a query field", () => {
  assert.match(GLOSSARY, /current turnover date minus the original/);
  assert.match(GLOSSARY, /anticipated final cost minus approved budget/);
  for (const field of ["minVariance", "amountField", "excludeComplete", "minDelayDays"]) {
    assert.ok(!GLOSSARY.includes(field), `${field} belongs to the planner, not the glossary`);
  }
});

// --- Route helpers -----------------------------------------------------------

await check("a follow-up has to be worded as one, not only declared", () => {
  // The model declares followUp and gets it wrong often enough to matter: "give
  // projects with high budget risks" came back as a follow-up and was answered
  // inside eleven unrelated projects, finding none of the five that match.
  for (const question of [
    "which of these are in Gaming?", "and which of those have low budget risk?",
    "filter out those whose schedule risk is also high", "show only the high risk ones",
  ]) assert.equal(refersBack(question), true, question);

  for (const question of [
    "give projects with high budget risks", "Give details of Holiday Inn",
    "what about Parks & Resorts?", "which projects slipped more than 30 days?",
  ]) assert.equal(refersBack(question), false, question);
});

await check("the developer's SQL is laid out so it can be read", () => {
  const { sql } = scopedQuery(["Gaming"], `(${FORECAST_VARIANCE_SQL}) >= ?`);
  const pretty = formatSql(sql);

  for (const keyword of ["FROM projects p", "JOIN business_units b", "WHERE ", "ORDER BY ", "LIMIT "]) {
    assert.ok(pretty.split("\n").some((line) => line.trim().startsWith(keyword.trim())),
      `${keyword} starts its own line`);
  }

  // Depth matters: the ANDs inside a CASE belong to that expression and must
  // not be broken out as if they were conditions of their own.
  const andLines = pretty.split("\n").filter((line) => line.trim().startsWith("AND "));
  assert.ok(andLines.length >= 1, "real conditions are broken out");
  assert.ok(andLines.every((line) => !line.trim().startsWith("AND p.anticipated_final_cost IS NOT NULL")),
    "an AND inside a CASE stays inside it");

  // Nothing is lost in the formatting: it is the same statement, respaced.
  assert.equal(pretty.replace(/\s+/g, " ").trim(), sql.replace(/\s+/g, " ").trim());

  const where = whereOf(sql);
  assert.match(where, /archived_at IS NULL/);
  assert.match(where, /b\.name IN/, "the scope is visible in the conditions");
  assert.ok(!/^WHERE/i.test(where), "the keyword is the label, not part of the value");
  assert.ok(!/ORDER BY/i.test(where), "and the ordering is not dragged in with it");
});

await check("the legacy planner is off unless an environment switches it on", () => {
  assert.equal(legacyPlannerEnabled({}), false, "absent means off");
  assert.equal(legacyPlannerEnabled({ ASSISTANT_LEGACY_PLANNER: "false" }), false);
  assert.equal(legacyPlannerEnabled({ ASSISTANT_LEGACY_PLANNER: true }), false, "the string, not the boolean");
  assert.equal(legacyPlannerEnabled({ ASSISTANT_LEGACY_PLANNER: "true" }), true);
});

console.log(`Assistant schema and route tests passed: ${checks} checks — derived figures, soft deletes, scope, limits, read surface, route helpers.`);
