// READ-ONLY access to the tracker's D1 database for reconciliation.
//
// Every statement in this file is a hard-coded SELECT. No SQL is ever built from
// user input, nothing is interpolated into a statement, and each response is
// checked for `rows_written === 0` and `changed_db === false` before it is
// accepted. A response that reports a write aborts the run — that would mean a
// statement did something this module does not intend, and continuing would be
// worse than failing.
import { execFileSync } from "node:child_process";

export const DATABASES = {
  prod: { id: "94241844-c709-445f-a71c-49f8b65a7cfd", name: "dnc-tracker-pilot" },
  test: { id: "34dca57e-bd32-46cd-b154-8c362efaeb4c", name: "dnc-tracker-pilot-dev" },
};

// Joined for the business unit name, which is what the workbook's tab and
// heading rows resolve to. archived_at is carried through so archived projects
// can be excluded from matching without pretending they do not exist.
const PROJECTS_SQL = `
  SELECT p.id, p.source_key, b.name AS business_unit, p.venue, p.section_name,
         p.source_sheet, p.project_type, p.name, p.capp_number, p.initiative_number,
         p.project_manager, p.development_lead, p.status, p.scope_description,
         p.current_update, p.previous_update, p.reporting_period, p.archived_at
  FROM projects p
  JOIN business_units b ON b.id = p.business_unit_id
`.trim().replace(/\s+/g, " ");

// Only the columns duplicate detection needs. current_summary is required
// because a repeat import must be caught by CONTENT as well as by key: the same
// note re-published under a new report date is not new information.
const UPDATES_SQL = `
  SELECT project_id, source_key, reporting_period, current_summary
  FROM project_updates
`.trim().replace(/\s+/g, " ");

function runSelect(databaseId, sql, label) {
  let raw;
  try {
    raw = execFileSync("npx", [
      "wrangler", "d1", "execute", databaseId, "--remote", "--yes", "--json", "--command", sql,
    ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (failure) {
    const detail = (failure.stdout || "") + (failure.stderr || "");
    throw new Error(`Reading ${label} failed.\n${detail.slice(-1500)}`);
  }

  // wrangler prints a banner before the JSON payload.
  const start = raw.indexOf("[");
  if (start === -1) throw new Error(`Reading ${label}: no JSON in the response.\n${raw.slice(-1500)}`);
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch {
    throw new Error(`Reading ${label}: unparsable JSON response.`);
  }

  const first = parsed[0];
  if (!first || first.success !== true) throw new Error(`Reading ${label}: query did not succeed.`);

  // The guarantee this module exists to make.
  const meta = first.meta || {};
  if (meta.rows_written !== 0 || meta.changed_db === true) {
    throw new Error(
      `ABORTED: reading ${label} reported a write (rows_written=${meta.rows_written}, ` +
      `changed_db=${meta.changed_db}). Reconciliation must never modify the database.`
    );
  }
  return { rows: first.results || [], meta };
}

// Reads everything reconciliation needs, in two statements.
export function readTracker(databaseId) {
  const projects = runSelect(databaseId, PROJECTS_SQL, "projects");
  const updates = runSelect(databaseId, UPDATES_SQL, "project_updates");
  return {
    read_at: new Date().toISOString(),
    database_id: databaseId,
    projects: projects.rows,
    updates: updates.rows,
    verification: {
      projects_rows_written: projects.meta.rows_written,
      updates_rows_written: updates.meta.rows_written,
      changed_db: Boolean(projects.meta.changed_db || updates.meta.changed_db),
    },
  };
}
