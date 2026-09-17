// Phase 3 of the workbook import: turn a REVIEWED reconciliation report into SQL
// and, only when explicitly told to, run it.
//
//   # dry run — writes the SQL file, executes nothing (the default)
//   node scripts/apply-workbook-import.mjs \
//     --report reconciliation-report.json --sql-out import-2026-09-11.sql
//
//   # execute — both flags are required, and --target is never defaulted
//   node scripts/apply-workbook-import.mjs \
//     --report reconciliation-report.json --sql-out import-2026-09-11.sql \
//     --target test --execute
//
// This script makes no decisions. Every insert it emits was already classified
// and planned by scripts/reconcile-workbook.mjs; if the report says a row is
// unresolved, this refuses to run at all rather than choosing for you.
//
// WHY RAW SQL RATHER THAN THE APPLICATION'S OWN API: the activity route
// (worker/index.js:1387) generates its own random `update:<id>:<uuid>` source
// key. That defeats the deterministic key this import depends on for
// idempotence, so the route's three-statement batch is replicated here instead,
// verbatim in shape, with our own key.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeOutput } from "./workbook/io.mjs";
import { DATABASES } from "./workbook/tracker.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes("--" + name);

// --- SQL helpers -------------------------------------------------------------

export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return "'" + String(value).replaceAll("'", "''") + "'";
}

const AUDIT_ACTOR = "Workbook Import";

// --- Statement generation ----------------------------------------------------
// Exported so the tests can generate and run the SQL without any CLI or network.

export function buildStatements(report) {
  const statements = [];
  const summary = {
    history_previous: 0, history_current: 0, project_current_updates: 0,
    new_projects: 0, status_changes: 0, audit_rows: 0,
  };

  const runMarker = "workbook_import:" + report.report_date;

  const add = (sql, note) => statements.push({ sql, note });

  // An audit row has no unique constraint, so each is guarded on its own
  // deterministic key. Without this, a partial failure followed by a re-run
  // would double the audit trail.
  //
  // The guard matches on `import_id`, a hex digest, NOT on the readable key.
  // A readable key is unsafe to match with LIKE: one project's source_key is
  //   Corporate:250 Delaware Ave:3 office build out "Transformation Dept":08727
  // and JSON.stringify turns those quotes into \" inside `details`, so a pattern
  // built from the raw key never matches what was stored — the guard silently
  // fails open and the row is inserted again on every run. Hex has no characters
  // that JSON escapes or that LIKE treats as wildcards.
  const auditOnce = (action, entityKey, details, key) => {
    const importId = createHash("sha256").update(key).digest("hex").slice(0, 16);
    const detailsJson = JSON.stringify({ ...details, import_key: key, import_id: importId });
    add(
      `INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)\n` +
      `  SELECT ${sqlLiteral(action)}, 'project', ${sqlLiteral(String(entityKey))}, ` +
      `${sqlLiteral(AUDIT_ACTOR)}, NULL, ${sqlLiteral(detailsJson)}\n` +
      `  WHERE NOT EXISTS (SELECT 1 FROM audit_log\n` +
      `    WHERE details LIKE ${sqlLiteral('%"import_id":"' + importId + '"%')});`,
      `audit ${action} for project ${entityKey}`,
    );
    summary.audit_rows++;
  };

  // --- 1. Previous-week history (the earlier date) ---------------------------
  // Historical backfill ONLY. These rows never become the project's current
  // update: the report date is newer, so the current field belongs to it.
  for (const entry of report.matched) {
    const plan = entry.planned_history.previous;
    if (plan.action !== "insert") continue;
    add(
      `INSERT OR IGNORE INTO project_updates (\n` +
      `  source_key, project_id, reporting_period, current_summary, previous_summary,\n` +
      `  author_name, author_email, author_id, created_at\n` +
      `) VALUES (${sqlLiteral(plan.source_key)}, ${entry.tracker.id}, ${sqlLiteral(plan.date)},\n` +
      `  ${sqlLiteral(entry.workbook.previous_update)}, NULL,\n` +
      `  ${sqlLiteral(AUDIT_ACTOR)}, NULL, NULL, ${sqlLiteral(plan.date + "T12:00:00Z")});`,
      `previous-week history for project ${entry.tracker.id}`,
    );
    summary.history_previous++;
  }

  // --- 2. Current update (the report date) -----------------------------------
  for (const entry of report.matched) {
    const plan = entry.planned_history.current;
    if (plan.action !== "insert") continue;
    const id = entry.tracker.id;
    const text = entry.workbook.current_update;

    // `previous_summary` mirrors what the activity route stores: the text this
    // update displaces.
    const previousPlan = entry.planned_history.previous;
    const displaced = previousPlan.action === "insert"
      ? entry.workbook.previous_update
      : entry.project_fields.tracker_current_update ?? null;

    add(
      `INSERT OR IGNORE INTO project_updates (\n` +
      `  source_key, project_id, reporting_period, current_summary, previous_summary,\n` +
      `  author_name, author_email, author_id, created_at\n` +
      `) VALUES (${sqlLiteral(plan.source_key)}, ${id}, ${sqlLiteral(plan.date)},\n` +
      `  ${sqlLiteral(text)}, ${sqlLiteral(displaced)},\n` +
      `  ${sqlLiteral(AUDIT_ACTOR)}, NULL, NULL, ${sqlLiteral(plan.date + "T12:00:00Z")});`,
      `current history for project ${id}`,
    );
    summary.history_current++;

    // The denormalised current/previous pair on `projects` only moves when this
    // workbook is the newest word on the project. A tracker entry dated after
    // the report keeps its place — that is the "do not overwrite newer tracker
    // updates" rule.
    if (entry.project_fields.would_become_current) {
      add(
        `UPDATE projects\n` +
        `  SET previous_update = ${sqlLiteral(displaced)},\n` +
        `      current_update = ${sqlLiteral(text)},\n` +
        `      reporting_period = ${sqlLiteral(plan.date)},\n` +
        `      updated_at = datetime('now')\n` +
        `  WHERE id = ${id}\n` +
        `    AND (current_update IS NULL OR current_update <> ${sqlLiteral(text)});`,
        `set current update on project ${id}`,
      );
      summary.project_current_updates++;
    }

    auditOnce("activity_update", id, { reportingPeriod: plan.date, source: report.workbook }, plan.source_key);
  }

  // --- 3. Approved new projects ----------------------------------------------
  for (const entry of report.proposed_new) {
    const proposed = entry.proposed;
    // Deterministic, traceable, and unique — so a re-run inserts nothing.
    const sourceKey = `workbook:${report.report_date}:new:${entry.workbook.sheet}:${entry.workbook.row}`;
    const isDevelopment = proposed.project_type === "Development";

    add(
      `INSERT OR IGNORE INTO business_units (name, sort_order) VALUES (${sqlLiteral(proposed.business_unit)}, 99);`,
      `ensure business unit ${proposed.business_unit}`,
    );
    add(
      `INSERT OR IGNORE INTO projects (\n` +
      `  source_key, business_unit_id, venue, project_type, name, capp_number, initiative_number,\n` +
      `  project_manager, development_lead, status, phase, scope_description, current_update,\n` +
      `  budget_risk, schedule_risk, reporting_period, source_sort_order, section_name, source_sheet, updated_at\n` +
      `) VALUES (\n` +
      `  ${sqlLiteral(sourceKey)}, (SELECT id FROM business_units WHERE name = ${sqlLiteral(proposed.business_unit)}),\n` +
      `  ${sqlLiteral(isDevelopment ? "Development Pipeline" : proposed.venue)}, ${sqlLiteral(proposed.project_type)},\n` +
      `  ${sqlLiteral(proposed.name)},\n` +
      `  ${sqlLiteral(isDevelopment ? null : proposed.identifier)},\n` +
      `  ${sqlLiteral(isDevelopment ? proposed.identifier : null)},\n` +
      `  ${sqlLiteral(isDevelopment ? null : proposed.lead)},\n` +
      `  ${sqlLiteral(isDevelopment ? proposed.lead : null)},\n` +
      `  ${sqlLiteral(isDevelopment ? "Active" : "Active")}, ${sqlLiteral(isDevelopment ? null : "Planning")},\n` +
      `  ${sqlLiteral(proposed.scope_description)}, ${sqlLiteral(entry.workbook.current_update)},\n` +
      `  'Not Rated', 'Not Rated', ${sqlLiteral(report.report_date)},\n` +
      `  (SELECT COALESCE(MAX(source_sort_order), 9998) + 1 FROM projects),\n` +
      `  ${sqlLiteral(proposed.section_name)}, ${sqlLiteral(entry.workbook.sheet)}, datetime('now')\n` +
      `);`,
      `create project "${proposed.name}" (${entry.workbook.sheet} r${entry.workbook.row})`,
    );

    if (entry.workbook.current_update) {
      add(
        `INSERT OR IGNORE INTO project_updates (\n` +
        `  source_key, project_id, reporting_period, current_summary, previous_summary,\n` +
        `  author_name, author_email, author_id, created_at\n` +
        `) SELECT ${sqlLiteral(sourceKey + ":initial")}, id, ${sqlLiteral(report.report_date)},\n` +
        `  ${sqlLiteral(entry.workbook.current_update)}, NULL, ${sqlLiteral(AUDIT_ACTOR)}, NULL, NULL,\n` +
        `  ${sqlLiteral(report.report_date + "T12:00:00Z")}\n` +
        `  FROM projects WHERE source_key = ${sqlLiteral(sourceKey)};`,
        `initial history for "${proposed.name}"`,
      );
    }
    if (isDevelopment) {
      add(
        `INSERT OR IGNORE INTO development_details (project_id, updated_at)\n` +
        `  SELECT id, datetime('now') FROM projects WHERE source_key = ${sqlLiteral(sourceKey)};`,
        `development details for "${proposed.name}"`,
      );
    }
    const createId = createHash("sha256").update(sourceKey).digest("hex").slice(0, 16);
    add(
      `INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)\n` +
      `  SELECT 'create', 'project', CAST(id AS TEXT), ${sqlLiteral(AUDIT_ACTOR)}, NULL,\n` +
      `  ${sqlLiteral(JSON.stringify({ name: proposed.name, businessUnit: proposed.business_unit, import_key: sourceKey, import_id: createId }))}\n` +
      `  FROM projects WHERE source_key = ${sqlLiteral(sourceKey)}\n` +
      `    AND NOT EXISTS (SELECT 1 FROM audit_log\n` +
      `      WHERE details LIKE ${sqlLiteral('%"import_id":"' + createId + '"%')});`,
      `audit create for "${proposed.name}"`,
    );
    summary.new_projects++;
    summary.audit_rows++;
  }

  // --- 4. Decisions on projects absent from the workbook ---------------------
  for (const entry of report.tracker_only) {
    if (entry.decision.action !== "mark_complete") continue;
    const id = entry.project.id;
    const key = `workbook:${report.report_date}:status:${id}`;
    add(
      `UPDATE projects SET status = 'Complete', updated_at = datetime('now')\n` +
      `  WHERE id = ${id} AND status <> 'Complete';`,
      `mark project ${id} "${entry.project.name}" Complete`,
    );
    auditOnce("field_update", id, {
      fields: ["status"], before: entry.project.status, after: "Complete",
      reason: entry.decision.note,
    }, key);
    summary.status_changes++;
  }

  // --- 5. Run marker ---------------------------------------------------------
  // Refusing a second run is the outer guard; every statement above is
  // independently idempotent so a partial failure can still be retried safely.
  add(
    `INSERT OR IGNORE INTO app_meta (key, value, updated_at)\n` +
    `  VALUES (${sqlLiteral(runMarker)}, ${sqlLiteral(JSON.stringify({
      workbook: report.workbook, report_date: report.report_date,
      previous_report_date: report.previous_report_date,
    }))}, datetime('now'));`,
    `record import run marker`,
  );

  return { statements, summary, runMarker };
}

// --- CLI ---------------------------------------------------------------------

function main() {
  const reportPath = arg("report");
  if (!reportPath) {
    console.error("ERROR: --report is required (the output of scripts/reconcile-workbook.mjs).");
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(resolve(projectRoot, reportPath), "utf8"));

  // --- Refusals ------------------------------------------------------------
  const refusals = [];
  if ((report.blocking_contradictions || []).length) {
    refusals.push(`${report.blocking_contradictions.length} blocking contradiction(s) in the report.`);
    for (const item of report.blocking_contradictions) refusals.push("    " + item);
  }
  if ((report.unresolved || []).length) {
    refusals.push(`${report.unresolved.length} unresolved row(s). Every row must be classified before applying.`);
    for (const entry of report.unresolved.slice(0, 10)) {
      refusals.push(`    ${entry.workbook.sheet} r${entry.workbook.row} — ${entry.reason}`);
    }
  }
  if (refusals.length) {
    console.error("REFUSING TO APPLY\n");
    for (const line of refusals) console.error("  " + line);
    console.error("\nNothing was generated and nothing was executed.");
    process.exit(1);
  }

  const { statements, summary, runMarker } = buildStatements(report);
  const header = [
    `-- Workbook import: ${report.workbook}`,
    `-- Report date ${report.report_date}, previous-week date ${report.previous_report_date}`,
    `-- Generated from ${reportPath}`,
    `-- Idempotent: every statement is INSERT OR IGNORE or a guarded UPDATE.`,
    `-- Run marker: ${runMarker}`,
    "",
  ].join("\n");
  const sql = header + statements.map((s) => `-- ${s.note}\n${s.sql}`).join("\n\n") + "\n";

  const sqlOut = arg("sql-out");
  if (sqlOut) writeOutput(projectRoot, sqlOut, sql);

  console.log("Workbook : " + report.workbook);
  console.log("Dates    : current " + report.report_date + "  |  previous " + report.previous_report_date);
  console.log("");
  console.log("  previous-week history rows   " + String(summary.history_previous).padStart(4));
  console.log("  current history rows         " + String(summary.history_current).padStart(4));
  console.log("  projects whose current moves " + String(summary.project_current_updates).padStart(4));
  console.log("  new projects created         " + String(summary.new_projects).padStart(4));
  console.log("  status changes               " + String(summary.status_changes).padStart(4));
  console.log("  audit rows                   " + String(summary.audit_rows).padStart(4));
  console.log("  ---");
  console.log("  SQL statements               " + String(statements.length).padStart(4));
  if (sqlOut) console.log("\nWrote " + sqlOut);

  if (!flag("execute")) {
    console.log("\nDRY RUN — nothing was executed. Add --target <test|prod|id> --execute to apply.");
    return;
  }

  const targetName = arg("target");
  if (!targetName) {
    console.error("\nERROR: --execute requires an explicit --target. It is never defaulted.");
    process.exit(1);
  }
  const database = DATABASES[targetName] || { id: targetName, name: targetName };
  if (!sqlOut) {
    console.error("\nERROR: --execute requires --sql-out, so the exact statements applied are on disk.");
    process.exit(1);
  }

  console.log(`\nEXECUTING against ${database.name} (${database.id})`);
  const output = execFileSync("npx", [
    "wrangler", "d1", "execute", database.id, "--remote", "--yes", "--file", resolve(projectRoot, sqlOut),
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  console.log(output.split("\n").slice(-12).join("\n"));
}

// Only run the CLI when invoked directly, so the tests can import buildStatements.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
