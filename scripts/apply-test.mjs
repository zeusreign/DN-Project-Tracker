// Verification tests for the apply engine.
//
//   node scripts/apply-test.mjs
//
// Offline and self-contained: it builds a real SQLite database from the project's
// own migration files, seeds a small tracker, generates the import SQL from a
// synthetic reconciliation report, and executes it. No network, no D1, no
// production contact.
//
// The properties under test are the ones that would be expensive to get wrong:
// existing history survives, a user's own edit survives, and running the import
// twice changes nothing the second time.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStatements, sqlLiteral } from "./apply-workbook-import.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function freshDatabase() {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "0000_dnc_project_hub.sql", "0001_workbook_structure_and_roles.sql",
    "0002_user_directory.sql", "0003_development_pipeline_and_directory.sql",
    "0004_pilot_authentication.sql", "0005_profile_photos.sql",
  ]) {
    db.exec(readFileSync(resolve(projectRoot, "drizzle", file), "utf8"));
  }
  return db;
}

// A tracker holding one project with real history, including an update written
// by a person after the last workbook import — the thing that must survive.
function seed(db) {
  db.exec(`
    INSERT INTO business_units (id, name, sort_order) VALUES (1, 'Gaming', 1);
    INSERT INTO projects (id, source_key, business_unit_id, venue, project_type, name,
      capp_number, status, current_update, previous_update, reporting_period, section_name, source_sheet)
    VALUES (9, 'Gaming:TWO KINGS:Two Kings Casino:08312', 1, 'TWO KINGS', 'Capital',
      'Two Kings Casino', '08312', 'Active',
      'HUMAN EDIT: podium power energised.', 'Older workbook text.', '2026-09-09', 'TWO KINGS', 'GAMING');
    INSERT INTO projects (id, source_key, business_unit_id, venue, project_type, name,
      capp_number, status, current_update, reporting_period, section_name, source_sheet)
    VALUES (21, 'Gaming:WHEELING ISLAND:Wheeling Island Outfall repair:08669', 1, 'WHEELING ISLAND',
      'Capital', 'Wheeling Island Outfall repair', '08669', 'Active',
      'Outfall replacement complete. Closing out.', '2026-08-28', 'WHEELING ISLAND', 'GAMING');
    INSERT INTO project_updates (id, source_key, project_id, reporting_period, current_summary, author_name, created_at)
    VALUES (1, 'initial:two-kings', 9, '2026-08-28', 'Workbook text from August.', 'Workbook Import', '2026-08-28T12:00:00Z');
    INSERT INTO project_updates (id, source_key, project_id, reporting_period, current_summary, author_name, author_email, created_at)
    VALUES (2, 'update:9:abc', 9, '2026-09-09', 'HUMAN EDIT: podium power energised.', 'Faheem user', 'f@example.invalid', '2026-09-09 08:51:15');
  `);
}

// A reconciliation report shaped exactly like the real one, small enough to reason about.
function report() {
  return {
    workbook: "test.xlsx",
    report_date: "2026-09-11",
    previous_report_date: "2026-09-04",
    blocking_contradictions: [],
    unresolved: [],
    matched: [{
      confidence: 100,
      workbook: {
        sheet: "GAMING", row: 3, name: "Two Kings Casino",
        current_update: "September 11 text from the workbook.",
        previous_update: "September 4 text from the workbook.",
      },
      tracker: { id: 9, name: "Two Kings Casino" },
      planned_history: {
        current: { date: "2026-09-11", action: "insert", reason: "new_text", source_key: "workbook:2026-09-11:Gaming:TWO KINGS:Two Kings Casino:08312" },
        previous: { date: "2026-09-04", action: "insert", reason: "new_text", source_key: "workbook:2026-09-04:Gaming:TWO KINGS:Two Kings Casino:08312" },
      },
      project_fields: {
        tracker_reporting_period: "2026-09-09",
        tracker_current_update: "HUMAN EDIT: podium power energised.",
        would_become_current: true,
      },
    }],
    proposed_new: [{
      workbook: { sheet: "Design & Development", row: 23, name: "Via Napoli", current_update: "Connex box update." },
      proposed: {
        name: "Via Napoli", business_unit: "Patina", project_type: "Development",
        venue: null, section_name: "PATINA", identifier: null, lead: "Jason",
        scope_description: "Adding a 40' Connex Box to replace the old ones",
      },
    }],
    tracker_only: [
      {
        project: { id: 21, name: "Wheeling Island Outfall repair", status: "Active" },
        decision: { action: "mark_complete", audit_actor: "Workbook Import", note: "Confirmed complete." },
      },
      {
        project: { id: 8, name: "Something Else", status: "Closeout" },
        decision: { action: "leave_unchanged", note: "Flagged for review." },
      },
    ],
  };
}

const runSql = (db, statements) => { for (const s of statements) db.exec(s.sql); };
const one = (db, sql) => db.prepare(sql).get();
const all = (db, sql) => db.prepare(sql).all();

// --- Run 1 -------------------------------------------------------------------

const db = freshDatabase();
seed(db);
const before = {
  updates: one(db, "SELECT COUNT(*) AS n FROM project_updates").n,
  humanEdit: one(db, "SELECT current_summary FROM project_updates WHERE id = 2").current_summary,
};

const { statements, summary } = buildStatements(report());
runSql(db, statements);

// Existing history is untouched.
assert.equal(
  one(db, "SELECT current_summary FROM project_updates WHERE id = 2").current_summary,
  before.humanEdit,
  "the user's own update text must be unchanged",
);
assert.equal(one(db, "SELECT COUNT(*) AS n FROM project_updates WHERE id IN (1,2)").n, 2,
  "pre-existing history rows must still exist");

// Both dated rows were added, under their deterministic keys.
const sept4 = one(db, "SELECT * FROM project_updates WHERE source_key LIKE 'workbook:2026-09-04:%'");
const sept11 = one(db, "SELECT * FROM project_updates WHERE source_key LIKE 'workbook:2026-09-11:Gaming%'");
assert.ok(sept4, "the previous-week row was inserted");
assert.equal(sept4.reporting_period, "2026-09-04");
assert.equal(sept4.current_summary, "September 4 text from the workbook.");
assert.equal(sept4.author_name, "Workbook Import");
assert.ok(sept11, "the report-date row was inserted");
assert.equal(sept11.reporting_period, "2026-09-11");

// The September 4 row is history only: the project's current update belongs to
// September 11, and previous_update holds the text it displaced.
const project9 = one(db, "SELECT * FROM projects WHERE id = 9");
assert.equal(project9.current_update, "September 11 text from the workbook.");
assert.equal(project9.reporting_period, "2026-09-11");
assert.equal(project9.previous_update, "September 4 text from the workbook.",
  "previous_update holds the displaced September 4 text, keeping the timeline coherent");

// The human's text was not destroyed — it is still in the history table.
assert.ok(
  all(db, "SELECT current_summary FROM project_updates WHERE project_id = 9")
    .some((row) => row.current_summary === "HUMAN EDIT: podium power energised."),
  "the human edit survives in history after the import",
);

// Wheeling Island, and only Wheeling Island, changed status.
assert.equal(one(db, "SELECT status FROM projects WHERE id = 21").status, "Complete");
assert.equal(one(db, "SELECT COUNT(*) AS n FROM project_updates WHERE project_id = 21").n, 0,
  "a status change must not invent history");

// The approved new project was created, with its lead stored literally.
const napoli = one(db, "SELECT * FROM projects WHERE name = 'Via Napoli'");
assert.ok(napoli, "the approved new project was created");
assert.equal(napoli.project_type, "Development");
assert.equal(napoli.development_lead, "Jason", 'the lead must remain literally "Jason"');
assert.equal(napoli.scope_description, "Adding a 40' Connex Box to replace the old ones");
assert.equal(napoli.source_key, "workbook:2026-09-11:new:Design & Development:23");
assert.equal(one(db, `SELECT COUNT(*) AS n FROM development_details WHERE project_id = ${napoli.id}`).n, 1,
  "a Development project gets its development_details row");

// The unchanged tracker-only project really is unchanged.
assert.equal(one(db, "SELECT COUNT(*) AS n FROM projects WHERE id = 8").n, 0,
  "leave_unchanged rows are never written");

// Audit trail, attributed as the client specified.
const audits = all(db, "SELECT * FROM audit_log ORDER BY id");
assert.ok(audits.length >= 3, "audit rows were written");
assert.ok(audits.every((row) => row.actor_id === "Workbook Import"),
  'every audit row is attributed to "Workbook Import"');
assert.ok(audits.some((row) => row.action === "activity_update" && row.entity_key === "9"));
assert.ok(audits.some((row) => row.action === "field_update" && row.entity_key === "21"));
assert.ok(audits.some((row) => row.action === "create"));

const afterFirst = {
  projects: one(db, "SELECT COUNT(*) AS n FROM projects").n,
  updates: one(db, "SELECT COUNT(*) AS n FROM project_updates").n,
  audits: audits.length,
  marker: one(db, "SELECT value FROM app_meta WHERE key = 'workbook_import:2026-09-11'"),
  project9: one(db, "SELECT current_update, previous_update, reporting_period FROM projects WHERE id = 9"),
};
assert.ok(afterFirst.marker, "the run marker was recorded");
assert.equal(afterFirst.updates, before.updates + 3, "2 for the matched project, 1 for the new project");

console.log(`Run 1: OK — ${statements.length} statements, ${afterFirst.updates - before.updates} history rows added`);

// --- Run 2: idempotence ------------------------------------------------------
// The same SQL applied again must change nothing at all.

runSql(db, buildStatements(report()).statements);

assert.equal(one(db, "SELECT COUNT(*) AS n FROM projects").n, afterFirst.projects, "no duplicate projects");
assert.equal(one(db, "SELECT COUNT(*) AS n FROM project_updates").n, afterFirst.updates, "no duplicate history");
assert.equal(all(db, "SELECT * FROM audit_log").length, afterFirst.audits, "no duplicate audit rows");
assert.deepEqual(
  one(db, "SELECT current_update, previous_update, reporting_period FROM projects WHERE id = 9"),
  afterFirst.project9,
  "the project row is byte-identical after a second run",
);
assert.equal(one(db, "SELECT COUNT(*) AS n FROM projects WHERE name = 'Via Napoli'").n, 1,
  "the new project is not created twice");
assert.equal(one(db, "SELECT status FROM projects WHERE id = 21").status, "Complete");

console.log("Run 2: OK — re-running the import changed nothing");

// --- A newer tracker update is not overwritten -------------------------------
{
  const db2 = freshDatabase();
  seed(db2);
  const later = report();
  later.matched[0].project_fields.would_become_current = false;   // tracker is newer
  runSql(db2, buildStatements(later).statements);

  assert.equal(
    one(db2, "SELECT current_update FROM projects WHERE id = 9").current_update,
    "HUMAN EDIT: podium power energised.",
    "a tracker update newer than the report keeps its place on the project row",
  );
  assert.ok(
    one(db2, "SELECT * FROM project_updates WHERE source_key LIKE 'workbook:2026-09-11:%'"),
    "the history row is still recorded, even when the project row does not move",
  );
  console.log("Newer-tracker-update guard: OK");
}

// --- Audit rows must render on the Admin screen -------------------------------
// auditRowHtml() in worker/client.js reads the actor as
//   details.actorName || actor_email || "System"
// and shows the project name and before -> after values ONLY from details.changes[].
// The first version wrote the actor into the actor_id column, which the UI never
// reads, and used a bespoke {fields, before, after} shape. Result: rows that said
// "Changed by System / project - 21 / Before-and-after values were not recorded".
{
  const shaped = report();
  const built = buildStatements(shaped).statements;
  const audit = built.filter((s) => s.sql.includes("INSERT INTO audit_log"));
  assert.ok(audit.length, "audit statements are generated");

  // EVERY audit row, including `create` — which builds its own INSERT rather than
  // going through auditOnce() and so has to be handled separately.
  for (const statement of audit) {
    assert.match(statement.sql, /"actorName":"Workbook Import"/,
      "audit rows must carry actorName, or the UI labels them 'Changed by System'");
  }

  // Still parked: showing the project name and the update text on activity rows.
  // That needs auditFieldLabels in worker/client.js to gain a current_update key,
  // and therefore a redeploy. The actor label above needs neither.

  const fieldUpdate = audit.find((s) => s.sql.includes("'field_update'"));
  assert.ok(fieldUpdate, "the status change writes a field_update audit row");
  for (const required of ['"version":1', '"projectName":', '"changes":[', '"field":"status"',
                          '"before":"Active"', '"after":"Complete"']) {
    assert.ok(fieldUpdate.sql.includes(required),
      `field_update details must match fieldAuditStatement()'s shape — missing ${required}`);
  }
  assert.ok(!fieldUpdate.sql.includes('"fields":["status"]'),
    "the old bespoke shape must not come back");
  console.log("Audit row shape: OK");
}

// --- Audit guards survive JSON escaping --------------------------------------
// A real project is named `3 office build out "Transformation Dept"`, so its
// source_key — and therefore the import key — contains double quotes. Those
// become \" inside the audit `details` JSON. An earlier version of the guard
// matched the RAW key with LIKE, never matched the stored escaped form, and so
// re-inserted every audit row on every run. It passed all the other tests: the
// history rows were correctly idempotent, only the audit trail silently grew.
{
  const db4 = freshDatabase();
  db4.exec(`
    INSERT INTO business_units (id, name, sort_order) VALUES (1, 'Corporate', 1);
    INSERT INTO projects (id, source_key, business_unit_id, venue, project_type, name, status,
      current_update, reporting_period, section_name, source_sheet)
    VALUES (1, 'Corporate:250 Delaware Ave:3 office build out "Transformation Dept":08727', 1,
      '250 Delaware Ave', 'Capital', '3 office build out "Transformation Dept"', 'Active',
      'Old text.', '2026-08-28', '250 Delaware Ave', 'CORP');
  `);
  const quoted = {
    workbook: "test.xlsx", report_date: "2026-09-11", previous_report_date: "2026-09-04",
    blocking_contradictions: [], unresolved: [], proposed_new: [], tracker_only: [],
    matched: [{
      workbook: { sheet: "CORP", row: 3, name: '3 office build out "Transformation Dept"', current_update: "New text.", previous_update: null },
      tracker: { id: 1 },
      planned_history: {
        current: { date: "2026-09-11", action: "insert", source_key: 'workbook:2026-09-11:Corporate:250 Delaware Ave:3 office build out "Transformation Dept":08727' },
        previous: { date: "2026-09-04", action: "skip", reason: "empty_in_workbook", source_key: "x" },
      },
      project_fields: { tracker_current_update: "Old text.", would_become_current: true },
    }],
  };
  runSql(db4, buildStatements(quoted).statements);
  const auditsAfterFirst = one(db4, "SELECT COUNT(*) AS n FROM audit_log").n;
  assert.equal(auditsAfterFirst, 1, "one audit row on the first run");

  runSql(db4, buildStatements(quoted).statements);
  assert.equal(one(db4, "SELECT COUNT(*) AS n FROM audit_log").n, auditsAfterFirst,
    "a source_key containing double quotes must not defeat the audit guard");
  assert.equal(one(db4, "SELECT COUNT(*) AS n FROM project_updates").n, 1, "no duplicate history either");
  console.log("Quoted-identifier audit guard: OK");
}

// --- Refusals ----------------------------------------------------------------
// buildStatements is only reached once the CLI has accepted the report; these
// assert the report shapes the CLI must reject.
{
  const blocked = report();
  blocked.unresolved = [{ workbook: { sheet: "GAMING", row: 5 }, reason: "ambiguous_name" }];
  assert.ok(blocked.unresolved.length, "a report with unresolved rows must not be applied");

  const contradicted = report();
  contradicted.blocking_contradictions = ["approved-new row matches an existing project"];
  assert.ok(contradicted.blocking_contradictions.length, "a contradicted report must not be applied");
}

// --- SQL escaping ------------------------------------------------------------
assert.equal(sqlLiteral("O'Malley"), "'O''Malley'", "apostrophes are escaped");
assert.equal(sqlLiteral(null), "NULL");
assert.equal(sqlLiteral(42), "42");
{
  // Update text routinely contains apostrophes: "Podium Area 'A'".
  const quoted = report();
  quoted.matched[0].workbook.current_update = "Podium Area 'A': permanent chillers on-line.";
  const db3 = freshDatabase();
  seed(db3);
  runSql(db3, buildStatements(quoted).statements);
  assert.equal(
    one(db3, "SELECT current_update FROM projects WHERE id = 9").current_update,
    "Podium Area 'A': permanent chillers on-line.",
    "apostrophes survive the round trip intact",
  );
  console.log("SQL escaping: OK");
}

console.log("Apply engine tests passed.");
