// The SQL safety boundary, tested as an attacker and as a user.
//
// Two things are proved here. First, that a statement which is not a plain read
// of the approved tables is refused. Second - and this is the part a prompt
// cannot give us - that a statement which IS a plain read still cannot see
// outside the reader's business-unit scope, however it is written: through a
// join, a subquery, a UNION, an EXISTS, or a CTE of its own.
//
//   node scripts/assistant-sql-test.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSql, composeQuery, runSql, SqlRejected, tokenise } from "../worker/assistant-sql.js";
import { QUERY_TABLES, FORBIDDEN_COLUMNS } from "../worker/assistant-schema.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const database = new DatabaseSync(":memory:");
for (const name of [
  "0000_dnc_project_hub.sql", "0001_workbook_structure_and_roles.sql",
  "0002_user_directory.sql", "0003_development_pipeline_and_directory.sql",
  "0004_pilot_authentication.sql", "0005_profile_photos.sql",
  "0006_enhanced_media_and_revisions.sql", "0007_photo_details.sql",
]) database.exec(readFileSync(resolve(projectRoot, "drizzle", name), "utf8"));

database.exec(`
  INSERT INTO business_units (id, name, sort_order) VALUES (1,'Gaming',1),(2,'Corporate',2);
  INSERT INTO projects (id, source_key, business_unit_id, venue, project_type, name,
    capp_number, project_manager, status, budget_risk, schedule_risk,
    approved_budget, anticipated_final_cost, original_turnover_date, current_turnover_date,
    duration_change_days, reporting_period, source_sort_order, archived_at) VALUES
    (1,'k1',1,'Venue A','Capital','Gaming Over','CAPP-1','Alice','Active','High','Low',
      1000,1500,'2027-03-01','2027-03-31',0,'2026-09-11',1,NULL),
    (2,'k2',1,'Venue B','Capital','Gaming Fine','CAPP-2','Bob','Active','Low','Low',
      2000,1800,'2027-04-01','2027-04-01',0,'2026-09-11',2,NULL),
    (3,'k3',2,'Venue C','Capital','Corporate Secret','CAPP-3','Cara','On Hold','Low','High',
      500,900,'2027-01-01','2027-02-10',0,'2026-09-11',3,NULL),
    (4,'k4',1,'Venue D','Capital','Gaming Archived','CAPP-4','Dan','Active','High','High',
      100,900,'2027-01-01','2027-06-01',0,'2026-09-11',4,'2026-01-01');
  INSERT INTO project_updates (id, source_key, project_id, reporting_period, current_summary, author_email)
    VALUES (1,'u1',1,'2026-09-11','Gaming update','secret@dn.com'),
           (2,'u2',3,'2026-09-11','Corporate update','secret@dn.com');
  INSERT INTO user_directory (first_name, last_name, username, user_email, role, password_hash, password_salt)
    VALUES ('A','B','a@b.c','a@b.c','admin','HASHVALUE','SALTVALUE');
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
const refused = (sql, matching) => {
  assert.throws(() => validateSql(sql), (error) => {
    assert.ok(error instanceof SqlRejected, `expected a refusal, got ${error.name}: ${error.message}`);
    if (matching) assert.match(error.message, matching, `refusal explains itself: ${error.message}`);
    return true;
  }, `this should have been refused: ${sql}`);
};
const GAMING = ["Gaming"];
const run = (sql, scope = GAMING, options) => runSql(db, sql, scope, options);

// --- Writes and schema changes ----------------------------------------------

await check("every write verb is refused", () => {
  for (const sql of [
    "INSERT INTO projects (name) VALUES ('x')",
    "UPDATE projects SET name = 'x'",
    "DELETE FROM projects",
    "DROP TABLE projects",
    "ALTER TABLE projects ADD COLUMN x TEXT",
    "CREATE TABLE x (y TEXT)",
    "REPLACE INTO projects VALUES (1)",
    "TRUNCATE TABLE projects",
  ]) refused(sql);
});

await check("a write hidden behind a SELECT is still refused", () => {
  refused("SELECT * FROM projects; DROP TABLE projects", /one statement/i);
  refused("SELECT * FROM projects; DELETE FROM projects;", /one statement/i);
  // A CTE that writes. SQLite would not run it, but we refuse it ourselves.
  refused("WITH x AS (DELETE FROM projects RETURNING id) SELECT * FROM x");
  refused("SELECT (SELECT 1 FROM projects WHERE 1=1 UNION SELECT 1); UPDATE projects SET name='x'");
});

await check("schema and environment statements are refused", () => {
  for (const sql of [
    "PRAGMA table_info(projects)",
    "ATTACH DATABASE '/tmp/x.db' AS evil",
    "DETACH DATABASE evil",
    "VACUUM",
    "BEGIN TRANSACTION",
    "COMMIT",
    "ROLLBACK",
    "REINDEX",
    "SELECT load_extension('evil.so')",
    "SELECT readfile('/etc/passwd')",
  ]) refused(sql);
});

await check("only a SELECT or a WITH may start a query", () => {
  refused("EXPLAIN SELECT * FROM projects", /only a select/i);
  refused("VALUES (1)");
  refused("", /no query/i);
  refused("   ", /no query/i);
});

// --- Reaching outside the approved schema ------------------------------------

await check("a forbidden table cannot be named anywhere", () => {
  for (const sql of [
    "SELECT * FROM user_directory",
    "SELECT * FROM projects WHERE id IN (SELECT id FROM user_directory)",
    "SELECT * FROM projects JOIN user_roles ON 1=1",
    "SELECT (SELECT COUNT(*) FROM login_sessions) AS n FROM projects",
    "SELECT * FROM audit_log",
    "SELECT * FROM sqlite_master",
    "SELECT * FROM sqlite_schema",
  ]) refused(sql, /cannot read|not a table/i);
});

await check("a forbidden column cannot be named anywhere", () => {
  for (const column of ["password_hash", "password_salt", "token_hash", "csrf_token",
    "object_key", "author_email", "actor_email", "business_unit_id", "archived_at", "deleted_at"]) {
    refused(`SELECT ${column} FROM projects`, /not readable/i);
  }
  // Including when dressed up as an alias or inside an expression.
  refused("SELECT COUNT(object_key) FROM project_photos", /not readable/i);
  refused("SELECT id AS password_hash FROM projects", /not readable/i);
});

await check("an unapproved table is named in the refusal, with what is available", () => {
  assert.throws(() => validateSql("SELECT * FROM invoices"), (error) => {
    assert.match(error.message, /"invoices" is not a table/);
    for (const table of QUERY_TABLES) assert.ok(error.message.includes(table), `${table} is offered`);
    return true;
  });
});

await check("a schema-qualified name is refused, because it would reach the real table", () => {
  refused("SELECT * FROM main.projects", /schema-qualified/i);
  refused("SELECT main.projects.name FROM projects", /schema-qualified/i);
  // temp. is refused too, by the banned-word check that gets there first.
  refused("SELECT * FROM temp.projects");
});

await check("comments, quoted identifiers and parameters are refused", () => {
  refused("SELECT * FROM projects -- WHERE 1=0", /comment/i);
  refused("SELECT * FROM projects /* hide */ WHERE 1=1", /comment/i);
  refused('SELECT * FROM "user_directory"', /quoted identifier/i);
  refused("SELECT * FROM [user_directory]", /quoted identifier/i);
  refused("SELECT * FROM `user_directory`", /quoted identifier/i);
  refused("SELECT * FROM projects WHERE name = ?", /parameters/i);
});

await check("an unknown function is refused", () => {
  refused("SELECT evil(name) FROM projects", /not available/i);
  refused("SELECT randomblob(10) FROM projects");
});

await check("a string containing a keyword is not mistaken for one", () => {
  // The value is data, not syntax, and refusing it would make real questions
  // unanswerable: a project really can be called "Update the Pantry".
  const ok = validateSql("SELECT name FROM projects WHERE name = 'DROP TABLE; delete from x'");
  assert.match(ok.sql, /DROP TABLE/);
  assert.ok(tokenise("SELECT 'a'' b' AS x").length > 0, "an escaped quote inside a string parses");
});

// --- What a legitimate read may contain --------------------------------------

await check("the SQL the old planner could not express is accepted", async () => {
  const queries = [
    "SELECT name FROM projects WHERE business_unit <> 'Gaming'",
    "SELECT name FROM projects WHERE business_unit NOT IN ('Gaming','Corporate')",
    "SELECT name FROM projects WHERE current_turnover_date IS NULL",
    "SELECT name FROM projects WHERE current_turnover_date IS NOT NULL",
    "SELECT name FROM projects WHERE budget_risk = 'High' OR schedule_risk = 'High'",
    "SELECT COUNT(*) AS n FROM projects",
    "SELECT SUM(approved_budget) AS total FROM projects WHERE business_unit = 'Gaming'",
    "SELECT AVG(approved_budget) AS mean FROM projects",
    "SELECT MIN(current_turnover_date) AS earliest FROM projects",
    "SELECT MAX(approved_budget) AS biggest FROM projects",
    "SELECT business_unit, COUNT(*) AS n FROM projects GROUP BY business_unit ORDER BY n DESC",
    "SELECT name FROM projects WHERE anticipated_final_cost > approved_budget",
    "SELECT name FROM projects ORDER BY approved_budget DESC LIMIT 1",
    "SELECT p.name FROM projects p WHERE EXISTS (SELECT 1 FROM project_updates u WHERE u.project_id = p.id)",
    "SELECT p.name FROM projects p WHERE NOT EXISTS (SELECT 1 FROM project_photos ph WHERE ph.project_id = p.id)",
    "SELECT p.name, u.current_summary FROM projects p JOIN project_updates u ON u.project_id = p.id",
    "SELECT p.name FROM projects p LEFT JOIN development_details d ON d.project_id = p.id WHERE d.current_estimate IS NULL",
    "WITH risky AS (SELECT * FROM projects WHERE budget_risk = 'High') SELECT name FROM risky",
    "SELECT name FROM projects WHERE current_turnover_date BETWEEN '2027-01-01' AND '2027-12-31'",
    "SELECT business_unit, SUM(approved_budget) AS total FROM projects GROUP BY business_unit HAVING SUM(approved_budget) > 100",
  ];
  for (const sql of queries) {
    const validated = validateSql(sql);
    assert.ok(validated.sql, sql);
    // And each one actually runs once composed.
    const result = await run(sql);
    assert.ok(typeof result.total === "number", `${sql} produced a total`);
  }
});

// --- The permission boundary, which is the part the prompt cannot give us ----

await check("scope is enforced however the query is written", async () => {
  const escapes = [
    "SELECT name FROM projects",
    "SELECT name FROM projects WHERE business_unit = 'Corporate'",
    "SELECT name FROM projects WHERE 1 = 1 OR business_unit = 'Corporate'",
    "SELECT name FROM (SELECT * FROM projects) x",
    "SELECT name FROM projects UNION SELECT name FROM projects",
    "SELECT a.name FROM projects a JOIN projects b ON 1 = 1",
    "WITH mine AS (SELECT * FROM projects) SELECT name FROM mine",
    "SELECT name FROM projects WHERE id IN (SELECT id FROM projects)",
    "SELECT name FROM projects WHERE EXISTS (SELECT 1 FROM business_units)",
    "SELECT b.name FROM business_units b",
    "SELECT name FROM projects WHERE id = 3",
    "SELECT name FROM projects WHERE id IN (1,2,3,4)",
  ];
  for (const sql of escapes) {
    const result = await run(sql, GAMING);
    const text = JSON.stringify(result.rows);
    assert.ok(!text.includes("Corporate Secret"), `scope escaped through: ${sql}`);
    assert.ok(!text.includes("Gaming Archived"), `an archived project escaped through: ${sql}`);
  }
});

await check("a child table cannot be used to reach another unit's project", async () => {
  const result = await run("SELECT current_summary FROM project_updates", GAMING);
  const text = JSON.stringify(result.rows);
  assert.match(text, /Gaming update/);
  assert.ok(!text.includes("Corporate update"), "a Corporate update reached a Gaming reader");
});

await check("an empty scope sees nothing, and an absent scope sees everything live", async () => {
  assert.equal((await run("SELECT name FROM projects", [])).total, 0, "no scope means no rows");
  const all = await run("SELECT name FROM projects", null);
  assert.equal(all.total, 3, "unrestricted sees the three live projects");
  assert.ok(!JSON.stringify(all.rows).includes("Gaming Archived"), "but never an archived one");
});

await check("the stale stored column cannot be reached, only the computed one", async () => {
  const result = await run("SELECT name, duration_change_days FROM projects WHERE id = 1", GAMING);
  assert.equal(result.rows[0].duration_change_days, 30, "1 March to 31 March, computed");
  assert.equal(database.prepare("SELECT duration_change_days AS d FROM projects WHERE id = 1").get().d, 0,
    "the stored column still disagrees, which is why the view shadows it");
});

await check("no credential can be read even though its table exists", async () => {
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM user_directory").get().n, 1,
    "the fixture really does hold a password hash");
  for (const sql of ["SELECT * FROM user_directory", "SELECT password_hash FROM projects"]) refused(sql);
  // And a wildcard over an approved table cannot pick one up either.
  const star = await run("SELECT * FROM projects WHERE id = 1", GAMING);
  for (const column of FORBIDDEN_COLUMNS) {
    assert.ok(!(column in star.rows[0]), `${column} is not in a row the model receives`);
  }
});

// --- Bounded results ---------------------------------------------------------

await check("the row cap is applied outside the model's own query", async () => {
  const asked = await run("SELECT name FROM projects LIMIT 500", GAMING, { limit: 1 });
  assert.equal(asked.returned, 1, "the worker's cap wins over the model's LIMIT");
  assert.equal(asked.total, 2, "and the true total is still reported");
  assert.equal(asked.truncated, true, "which is flagged as truncated");
  const composed = composeQuery(validateSql("SELECT name FROM projects LIMIT 500"), GAMING, { limit: 9999 });
  assert.match(composed.rows.sql, /LIMIT \?$/, "the cap is the last thing in the statement");
  assert.equal(composed.limit, 50, "and is clamped to the maximum");
});

await check("a count is reported from the same query the rows came from", async () => {
  const result = await run("SELECT name FROM projects ORDER BY name", GAMING, { limit: 50 });
  assert.equal(result.total, 2);
  assert.equal(result.returned, 2);
  assert.equal(result.truncated, false);
});

await check("an aggregate is recognised, so it is answered rather than paged", async () => {
  for (const sql of [
    "SELECT COUNT(*) AS n FROM projects",
    "SELECT SUM(approved_budget) AS total FROM projects",
    "SELECT AVG(approved_budget) AS mean, MAX(approved_budget) AS top FROM projects",
  ]) assert.equal(validateSql(sql).aggregate, true, sql);
  for (const sql of [
    "SELECT business_unit, COUNT(*) AS n FROM projects GROUP BY business_unit",
    "SELECT name FROM projects",
    "SELECT name, approved_budget FROM projects ORDER BY approved_budget DESC LIMIT 1",
  ]) assert.equal(validateSql(sql).aggregate, false, sql);
});

await check("a GROUP BY total counts groups, not rows", async () => {
  const result = await run("SELECT business_unit, COUNT(*) AS n FROM projects GROUP BY business_unit", null);
  assert.equal(result.total, 2, "two units in the live data");
  assert.equal(result.rows.length, 2);
});

console.log(`Assistant SQL safety tests passed: ${checks} checks — writes, schema escapes, forbidden tables and columns, scope enforcement through joins, subqueries, UNION and CTEs, and result bounding.`);
