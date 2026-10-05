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
  validatePlan, describePlan, planSchemaPrompt, planQueries, runPlan, availableUnits,
  summarisePlan, PLAN_FIELDS, PLAN_LIMIT_MAX,
} from "../worker/assistant-plan.js";
import { restatesThePlan, refersBack } from "../worker/assistant-api.js";

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

// --- Unit vocabulary ---------------------------------------------------------
// A unit name is checked against the units this user actually has. Without this
// a misspelling validates, becomes b.name = 'Gamming', matches nothing, and the
// assistant reports "0 projects" — a confident wrong answer, which is worse than
// a refusal because nothing about an empty result signals failure.

await check("availableUnits reads the real names and narrows them to scope", async () => {
  assert.deepEqual(await availableUnits(db, null), ["Gaming", "Patina"]);
  assert.deepEqual(await availableUnits(db, GAMING), ["Gaming"]);
  assert.deepEqual(await availableUnits(db, []), []);
});

await check("a misspelled unit is refused, not turned into an empty result", async () => {
  const units = await availableUnits(db, null);
  const { plan, problems } = validatePlan({ unit: "Gamming" }, { units });
  assert.equal(plan, null);
  assert.match(problems.join(" "), /No business unit named .Gamming./);
  assert.match(problems.join(" "), /Available: Gaming, Patina/);
});

await check("case and spacing are corrected to the stored name", async () => {
  const units = await availableUnits(db, null);
  assert.equal(validatePlan({ unit: "gaming" }, { units }).plan.unit, "Gaming");
  assert.equal(validatePlan({ unit: "  PATINA  " }, { units }).plan.unit, "Patina");
});

await check("All stays valid and means every unit in scope", async () => {
  const units = await availableUnits(db, GAMING);
  assert.equal(validatePlan({ unit: "All" }, { units }).plan.unit, "All");
});

await check("a unit outside scope is refused like a misspelling, revealing nothing", async () => {
  // The vocabulary handed to the validator is already scoped, so for a Gaming
  // viewer "Patina" is simply not a unit. The refusal must not name it as one
  // that exists elsewhere — the same reason project ids outside scope return 404
  // rather than 403.
  const units = await availableUnits(db, GAMING);
  const { plan, problems } = validatePlan({ unit: "Patina" }, { units });
  assert.equal(plan, null);
  assert.match(problems.join(" "), /No business unit named .Patina./);
  assert.ok(!problems.join(" ").includes("Available: Gaming, Patina"),
    "a scoped user must not be shown units they cannot see");
});

await check("without a vocabulary the field is still only type-checked", async () => {
  // Pure-function callers that have no database may omit units; the other
  // fields keep working, and the unit check simply does not run.
  assert.equal(validatePlan({ unit: "Anything" }).plan.unit, "Anything");
});

await check("the generated schema lists the real units for this user", async () => {
  const wide = planSchemaPrompt({ units: await availableUnits(db, null) });
  assert.match(wide, /unit: "Gaming" \| "Patina" \| "All"/);
  const scoped = planSchemaPrompt({ units: await availableUnits(db, GAMING) });
  assert.match(scoped, /unit: "Gaming" \| "All"/);
  assert.ok(!scoped.includes("Patina"), "the schema must not name units out of scope");
});

// --- Restating the question is not a search ----------------------------------
// The model puts the question into the search field - "high budget issue",
// "over 100K budget" - which matches no project name and empties an otherwise
// correct answer. Dropping that text is safe; dropping a real term is not, so
// the two have to be told apart. Err towards keeping: a kept term gives an
// honestly empty answer, a wrongly dropped one gives a confident wrong answer.

await check("a search restating a numeric filter is recognised", () => {
  assert.equal(restatesThePlan({ search: "over 100K budget", minAmount: 100000 }), true);
  assert.equal(restatesThePlan({ search: "more than 30 days", minDelayDays: 30 }), true);
  assert.equal(restatesThePlan({ search: "over $2m", minAmount: 2000000 }), true);
});

await check("a search made only of question words is recognised", () => {
  for (const text of [
    "high budget issue", "projects with budget problems", "show me high risk",
    "which projects are delayed", "high schedule risk",
  ]) {
    assert.equal(restatesThePlan({ search: text }), true, `${text} names no record`);
  }
});

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

await check("a search duplicating a field of its own is recognised", () => {
  // A person's name is a real search term, so no vocabulary test catches this.
  // What gives it away is that the plan already says it somewhere better: the
  // manager filter was right and the search looked for a person in project
  // names, which matched nothing and emptied eighteen projects.
  assert.equal(restatesThePlan({ search: "John Kolkowski", manager: "John Kolkowski" }), true);
  assert.equal(restatesThePlan({ search: "Mina QA", requestor: "Mina QA" }), true);
  assert.equal(restatesThePlan({ search: "Gaming", unit: "Gaming" }), true);
  assert.equal(restatesThePlan({ search: "John Kolkowski" }), false, "on its own it is a real term");
  assert.equal(restatesThePlan({ search: "asbestos", manager: "Tim Brown" }), false,
    "a different value is a condition of its own");
});

await check("a real term is never mistaken for a restatement", () => {
  for (const text of [
    "asbestos", "Central City", "Mardi Gras", "CAPP-1042", "roof replacement",
    "Yellowstone", "elevator", "Kolkowski",
  ]) {
    assert.equal(restatesThePlan({ search: text }), false, `${text} is something to look for`);
  }
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

await check("a near-miss name still finds its project, without loosening a good match", async () => {
  // The phrase runs first. "Venue A" keeps its single-letter half and matches
  // one project; loosening would drop the "A" and match every venue. Only a
  // phrase that finds nothing is retried word by word, which is what lets a
  // name heard or typed slightly wrong still land.
  database.exec(`INSERT INTO projects (id, source_key, business_unit_id, venue, project_type, name,
    status, budget_risk, schedule_risk, reporting_period, source_sort_order, archived_at)
    VALUES (9, 'k9', 1, 'Highmark', 'Capital', 'DN Suite Remodel', 'Active', 'Low', 'Low', '2026-09-11', 9, NULL)`);

  const exact = await runPlan(db, { search: "DN Suite Remodel" }, ALL);
  assert.deepEqual(names(exact), ["DN Suite Remodel"]);
  assert.equal(exact.loosened, false, "a phrase that matches is never loosened");

  const misheard = await runPlan(db, { search: "DN suit remodel" }, ALL);
  assert.deepEqual(names(misheard), ["DN Suite Remodel"], "a missing letter still finds it");
  assert.equal(misheard.loosened, true, "and the answer knows it was loosened");

  const reordered = await runPlan(db, { search: "remodel suite" }, ALL);
  assert.deepEqual(names(reordered), ["DN Suite Remodel"], "word order does not matter on a retry");

  const nothing = await runPlan(db, { search: "asbestos survey" }, ALL);
  assert.deepEqual(names(nothing), [], "loosening does not invent a match");

  database.exec("DELETE FROM projects WHERE id = 9");
});

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

// --- Numeric thresholds ------------------------------------------------------
// A number in the question must survive into the query. Before these fields
// existed, "slipped more than 30 days" became delayed: true and answered a
// broader question — in production that is 16 projects reported where 10 match.

await check("minDelayDays filters by the size of the slip, not just its existence", async () => {
  // Fixture slips: project 1 = 26 days, project 3 = 40 days, project 2 = 0.
  assert.deepEqual(names(await runPlan(db, { delayed: true }, ALL)),
    ["Gaming Over Budget", "Patina Delayed"]);
  assert.deepEqual(names(await runPlan(db, { minDelayDays: 30 }, ALL)),
    ["Patina Delayed"], "26 days must not answer a question about more than 30");
  assert.deepEqual(names(await runPlan(db, { minDelayDays: 26 }, ALL)),
    ["Gaming Over Budget", "Patina Delayed"], "the threshold is inclusive");
  assert.deepEqual(names(await runPlan(db, { minDelayDays: 41 }, ALL)), []);
});

await check("a project with no turnover dates is unknown, not below the threshold", async () => {
  // Project 4 has neither date. It must not be counted as having slipped 0 days.
  const result = await runPlan(db, { minDelayDays: -3650 }, ALL);
  assert.ok(!names(result).includes("Gaming Complete"));
});

await check("minVariance filters by the size of the overrun", async () => {
  // Overruns: project 1 = +500, project 3 = +400, project 2 = -200.
  assert.deepEqual(names(await runPlan(db, { overBudget: true }, ALL)),
    ["Gaming Over Budget", "Patina Delayed"]);
  assert.deepEqual(names(await runPlan(db, { minVariance: 450 }, ALL)), ["Gaming Over Budget"]);
  assert.deepEqual(names(await runPlan(db, { minVariance: 400 }, ALL)),
    ["Gaming Over Budget", "Patina Delayed"]);
  assert.deepEqual(names(await runPlan(db, { minVariance: 501 }, ALL)), []);
});

await check("under budget is the other direction, not the absence of over budget", async () => {
  // Fixture variances: project 1 = +500, project 3 = +400, project 2 = -200.
  // A project with no budget figures is unknown, not under budget.
  assert.deepEqual(names(await runPlan(db, { underBudget: true }, ALL)), ["Gaming On Time"]);
  assert.deepEqual(names(await runPlan(db, { maxVariance: -100 }, ALL)), ["Gaming On Time"]);
  assert.deepEqual(names(await runPlan(db, { maxVariance: -500 }, ALL)), []);
  assert.deepEqual(names(await runPlan(db, { maxVariance: 450 }, ALL)),
    ["Gaming On Time", "Patina Delayed"], "a positive bound means within that much of budget");
  assert.ok(!names(await runPlan(db, { underBudget: true }, ALL)).includes("Gaming Complete"),
    "a project with no budget figures is unknown, not under budget");
});

await check("the sentence says which direction it looked", () => {
  assert.match(summarisePlan(validatePlan({ underBudget: true }).plan, 7), /under budget/);
  assert.match(summarisePlan(validatePlan({ maxVariance: -50000 }).plan, 7), /under budget by \$50,000 or more/);
  assert.match(summarisePlan(validatePlan({ maxVariance: 10000 }).plan, 7), /within \$10,000 of the approved budget/);
  assert.match(summarisePlan(validatePlan({ overBudget: true }).plan, 7), /over budget/);
});

await check("minVariance is the overrun, minAmount is the budget's size", async () => {
  // Distinct fields: project 2 has the largest budget and no overrun at all.
  assert.deepEqual(names(await runPlan(db, { minAmount: 1500, amountField: "approved_budget" }, ALL)),
    ["Gaming On Time"]);
  assert.ok(!names(await runPlan(db, { minVariance: 1 }, ALL)).includes("Gaming On Time"));
});

await check("thresholds stay inside the user's scope", async () => {
  assert.deepEqual(names(await runPlan(db, { minDelayDays: 30 }, GAMING)), [],
    "the only project past 30 days is Patina, which a Gaming viewer cannot see");
});

await check("the applied threshold is shown to the user, not hidden", () => {
  const { plan } = validatePlan({ minDelayDays: 30, minVariance: 50000 });
  const text = describePlan(plan).join(" · ");
  assert.match(text, /Slipped 30 days or more/);
  assert.match(text, /Over budget by 50000 or more/);
  assert.match(describePlan(validatePlan({ minDelayDays: -14 }).plan).join(" "),
    /14 days earlier/);
});

await check("the thresholds are range-checked and type-checked", () => {
  assert.equal(validatePlan({ minDelayDays: 1.5 }).plan, null, "days are whole");
  assert.equal(validatePlan({ minDelayDays: 99999 }).plan, null);
  assert.equal(validatePlan({ minVariance: "50k" }).plan, null);
  assert.equal(validatePlan({ minVariance: 50000 }).plan.minVariance, 50000);
});

// --- The other tables --------------------------------------------------------
// Activity updates, photographs and the development pipeline's own columns. The
// children are fetched by the ids an already-scoped query returned, so they can
// only belong to a project the reader may see, and object_key is never selected
// because R2 access is authorised by the application.

database.exec(`
  INSERT INTO project_updates (id, source_key, project_id, reporting_period, current_summary, author_name)
  VALUES (1, 'u1', 1, '2026-09-11', 'Latest on the restrooms.', 'Alice Stone'),
         (2, 'u2', 1, '2026-08-28', 'Earlier note.', 'Alice Stone'),
         (3, 'u3', 1, '2026-08-14', 'Older still.', 'Alice Stone'),
         (4, 'u4', 1, '2026-07-31', 'Oldest of four.', 'Alice Stone'),
         (5, 'u5', 3, '2026-09-11', 'Patina note.', 'Cara Lin');
  INSERT INTO project_photos (id, project_id, kind, caption, object_key, mime, actor_email, reporting_period, deleted_at)
  VALUES ('p1', 1, 'progress', 'North elevation', 'projects/1/secret-key', 'image/jpeg', 'a@b.c', '2026-09-11', NULL),
         ('p2', 1, 'progress', 'Removed photo', 'projects/1/gone', 'image/jpeg', 'a@b.c', '2026-09-11', '2026-09-20'),
         ('p3', 3, 'cover', 'Patina cover', 'projects/3/cover', 'image/jpeg', 'a@b.c', '2026-09-11', NULL);
  INSERT INTO development_details (project_id, requestor, deliverable_due_date, current_estimate)
  VALUES (4, 'Mina QA', '2026-12-01', 42000);
`);

await check("updates are attached only when the question asked for them", async () => {
  const without = await runPlan(db, { ids: [1] }, ALL);
  assert.equal(without.rows[0].updates, undefined, "nothing is attached unasked");

  const withUpdates = await runPlan(db, { ids: [1], includeUpdates: true }, ALL);
  assert.equal(withUpdates.rows[0].updates.length, 3, "capped at three, newest first");
  assert.equal(withUpdates.rows[0].updates[0].current_summary, "Latest on the restrooms.");
  assert.ok(!withUpdates.rows[0].updates.some((u) => u.current_summary === "Oldest of four."));
});

await check("a project's updates are its own", async () => {
  const result = await runPlan(db, { includeUpdates: true }, ALL);
  const patina = result.rows.find((row) => row.name === "Patina Delayed");
  assert.deepEqual(patina.updates.map((u) => u.current_summary), ["Patina note."]);
  const onTime = result.rows.find((row) => row.name === "Gaming On Time");
  assert.deepEqual(onTime.updates, [], "a project with none gets an empty list, not another's");
});

await check("photographs never carry the R2 key, and a deleted one is gone", async () => {
  const result = await runPlan(db, { ids: [1], includePhotos: true }, ALL);
  assert.equal(result.rows[0].photos.length, 1, "the soft-deleted photograph is excluded");
  assert.equal(result.rows[0].photos[0].caption, "North elevation");
  for (const photo of result.rows[0].photos) {
    assert.ok(!("object_key" in photo), "object_key must never reach the assistant");
    assert.ok(!JSON.stringify(photo).includes("secret-key"));
  }
});

await check("children stay inside the reader's scope", async () => {
  // The Patina project is invisible to a Gaming viewer, so its updates and
  // photographs are unreachable too - there is no row to hang them on.
  const scoped = await runPlan(db, { includeUpdates: true, includePhotos: true }, GAMING);
  assert.ok(!scoped.rows.some((row) => row.name === "Patina Delayed"));
  const text = JSON.stringify(scoped.rows);
  assert.ok(!text.includes("Patina note."));
  assert.ok(!text.includes("Patina cover"));
});

await check("the development pipeline's own columns are available and filterable", async () => {
  const result = await runPlan(db, { ids: [4] }, ALL);
  assert.equal(result.rows[0].development_requestor, "Mina QA");
  assert.equal(result.rows[0].development_due_date, "2026-12-01");
  assert.equal(result.rows[0].development_current_estimate, 42000);
  assert.deepEqual(names(await runPlan(db, { requestor: "Mina" }, ALL)), ["Gaming Complete"]);
  assert.deepEqual(names(await runPlan(db, { requestor: "Nobody" }, ALL)), []);
});

await check("the sentence says what was attached", () => {
  assert.match(summarisePlan(validatePlan({ includeUpdates: true }).plan, 3), /with their recent updates/);
  assert.match(summarisePlan(validatePlan({ includePhotos: true }).plan, 3), /with their photographs/);
  assert.match(summarisePlan(validatePlan({ includeUpdates: true, includePhotos: true }).plan, 3),
    /recent updates and their photographs/);
  // One project owns its updates, not their updates.
  assert.match(summarisePlan(validatePlan({ includeUpdates: true }).plan, 1), /with its recent updates/);
});

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
