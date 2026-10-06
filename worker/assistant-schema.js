// The approved schema: what the assistant is allowed to read, and what the
// tracker's figures mean.
//
// This module is deliberately free of any opinion about how a query is
// produced. It holds the business rules and the read surface, both of which
// outlive the thing that consumes them: the legacy structured planner reads
// them today, and the SQL generator of the new architecture will read the same
// declarations tomorrow. Keeping one copy is the point — the derived
// expressions below are the app's own arithmetic, and a second copy that
// drifted would make the assistant disagree with the screens.
//
// Nothing here executes a model call or interprets a question.

// --- Derived figures ---------------------------------------------------------
// Both are computed rather than read from a stored column, and both must stay
// that way. They are the two numbers every budget and schedule question in the
// tracker is really about.

// Forecast variance: anticipated final cost minus approved budget. Positive is
// over budget. NULL when either side is missing, so "no figures yet" is not
// reported as being on budget.
export const FORECAST_VARIANCE_SQL = `
  CASE
    WHEN p.approved_budget IS NOT NULL AND p.anticipated_final_cost IS NOT NULL
    THEN p.anticipated_final_cost - p.approved_budget
    ELSE NULL
  END`;

// Day variance: current turnover minus original, in whole days. Computed from
// the two dates rather than read from projects.duration_change_days, because
// that stored column is only recalculated when a turnover date is written — 24
// production rows still hold their imported value (docs/VERSIONS.md §5). The
// pilot's dayVariance() subtracts the dates for the same reason.
//
// Any future query path must use this expression and must not offer
// duration_change_days, or the assistant will report a different slip from the
// one the project screen shows.
export const DAY_VARIANCE_SQL = `
  CASE
    WHEN p.original_turnover_date IS NULL OR p.current_turnover_date IS NULL
      OR trim(p.original_turnover_date) = '' OR trim(p.current_turnover_date) = ''
      OR julianday(p.original_turnover_date) IS NULL
      OR julianday(p.current_turnover_date) IS NULL
    THEN NULL
    ELSE CAST(julianday(p.current_turnover_date) - julianday(p.original_turnover_date) AS INTEGER)
  END`;

// --- Soft deletes ------------------------------------------------------------
// Omitting either of these surfaces records the tracker considers gone. They
// are not filters a question may ask for or waive; they are always applied.
export const LIVE_PROJECT_SQL = "p.archived_at IS NULL";
export const LIVE_PHOTO_SQL = "deleted_at IS NULL";

// --- Read surface ------------------------------------------------------------
// The projection every project answer is built from. project_photos.object_key
// is absent by decision: R2 access is authorised by the application, so the key
// must reach neither the model nor the browser. A photograph is identified
// here and served by the route that checks who is asking.
export const PROJECT_COLUMNS = `
  p.id, p.name, b.name AS business_unit, p.venue, p.section_name,
  p.project_type, p.capp_number, p.initiative_number,
  p.project_manager, p.development_lead, p.status, p.phase,
  p.scope_description, p.current_update, p.previous_update,
  p.budget_risk, p.schedule_risk,
  p.precon_capp, p.construction_capp, p.add_capp,
  p.approved_budget, p.anticipated_final_cost,
  p.original_start_date, p.current_start_date,
  p.original_turnover_date, p.current_turnover_date,
  p.reporting_period, p.updated_at,
  ${FORECAST_VARIANCE_SQL} AS forecast_variance,
  ${DAY_VARIANCE_SQL} AS duration_change_days,
  d.requestor AS development_requestor,
  d.deliverable_due_date AS development_due_date,
  d.consultants AS development_consultants,
  d.original_estimate AS development_original_estimate,
  d.current_estimate AS development_current_estimate,
  d.request_date AS development_request_date`;

export const PROJECT_FROM_SQL = `
  FROM projects p
  JOIN business_units b ON b.id = p.business_unit_id
  LEFT JOIN development_details d ON d.project_id = p.id`;

// The tables an assistant answer may be built from, and the ones it may not.
// Six tables are absent by decision rather than by omission: user_directory and
// user_roles hold password hashes, salts, token hashes and every staff email in
// the same rows, and login_sessions, login_events, audit_log and
// activity_revisions are the record of who did what, which is not project
// information. Widening this list is a deliberate act, not a convenience.
export const APPROVED_TABLES = {
  projects: { alias: "p", role: "the subject of every answer" },
  business_units: { alias: "b", role: "the unit a project belongs to, and the scope boundary" },
  development_details: { alias: "d", role: "pipeline detail for Development projects, one row or none per project" },
  project_updates: { alias: null, role: "activity updates, fetched by project id for projects an answer already found" },
  project_photos: { alias: null, role: "photographs, fetched by project id; object_key is never selected" },
};

export const FORBIDDEN_TABLES = [
  "user_directory", "user_roles", "login_sessions", "login_events",
  "audit_log", "activity_revisions", "app_meta", "photo_number_sequences",
];

// --- Result limits -----------------------------------------------------------
// A model receives a capped page of rows and a true count, never a table. The
// cap is enforced here rather than requested, so a question asking for 500 gets
// 50 and is told the real total.
export const RESULT_LIMIT_DEFAULT = 20;
export const RESULT_LIMIT_MAX = 50;

export const clampLimit = (requested) =>
  Math.min(Number(requested) || RESULT_LIMIT_DEFAULT, RESULT_LIMIT_MAX);

// --- Permission boundary -----------------------------------------------------
// The business-unit scope as a SQL predicate. It goes into the WHERE clause
// before anything a question asked for, and an empty scope resolves to a
// contradiction rather than to "no filter": a user who may see nothing must see
// nothing, not everything.
//
// scope === null means unrestricted. This is enforced by the worker and must
// never depend on a model honouring an instruction.
export function scopePredicate(scope) {
  if (!scope) return null;
  if (!scope.length) return { sql: "1 = 0", bindings: [] };
  return {
    sql: `b.name IN (${scope.map(() => "?").join(", ")})`,
    bindings: [...scope],
  };
}

// The unit vocabulary this reader may ask about, narrowed to their scope so a
// unit outside it is refused the way a misspelling is and cannot be used to
// discover which other units exist.
export async function availableUnits(db, scope) {
  const result = await db.prepare(
    "SELECT name FROM business_units ORDER BY sort_order, name"
  ).bind().all();
  const names = (result.results || []).map((row) => row.name);
  if (!scope) return names;
  // Compared without case, because a scope is stored as the administrator typed
  // it and a unit name as the workbook spelled it.
  const allowed = new Set(scope.map((name) => name.toLowerCase()));
  return names.filter((name) => allowed.has(name.toLowerCase()));
}

// --- Glossary ----------------------------------------------------------------
// What the tracker's words mean, in prose, for whichever model has to read a
// question. This is the half of the old DOMAIN_RULES that is about the business
// rather than about a particular query vocabulary: the field-mapping half
// stayed with the planner that had those fields.
export const GLOSSARY = `
What the tracker's figures mean:
- "Days" means the current turnover date minus the original turnover date, in
  whole days. Positive means the project has slipped later.
- "Variance" means anticipated final cost minus approved budget. Positive means
  over budget. Never the other way round.
- "Current", "open" and "live" exclude archived projects. Archived projects are
  never returned at all.
- Dates are plain YYYY-MM-DD text. A month or a quarter is a range.
- A Capital project has a CAPP number; a Development project has an initiative
  number and sits in the development pipeline.
- Risk is rated separately for budget and for schedule. "High risk" with no
  further qualification means either of them is High.
- Amounts are in dollars with no currency symbol.
- The size of a budget and the size of an overrun are different questions and
  must never be swapped: "a budget over $50k" is the approved budget, "over
  budget by $50k" is the variance.`;

// =============================================================================
// The query surface the SQL generator sees, and the scoped views it runs against
// =============================================================================
// Phase 3. Everything above is shared with the legacy planner; everything below
// belongs to the SQL engine.
//
// The model writes SQL against five table names. Those names are not the real
// tables: at execution time each one is bound to a common table expression that
// has already applied this reader's business-unit scope, dropped soft-deleted
// rows, and replaced the stale stored columns with the computed ones. SQLite
// resolves a WITH name ahead of a real table, so every reference the model can
// write - in a join, a subquery, a UNION branch, an EXISTS, or a CTE of its own
// - resolves to the scoped view. Permission enforcement is therefore structural
// rather than a clause we have to find somewhere in the model's text.
//
// The one escape is schema qualification: main.projects would reach the real
// table. assistant-sql.js rejects a qualified table reference outright.

// What the model may name. A column absent here is absent from the view as
// well, so naming it is a SQL error rather than a leak - but the validator
// rejects it first, with something a reader can act on.
export const QUERY_COLUMNS = {
  projects: [
    "id", "business_unit", "venue", "section_name", "name", "project_type",
    "capp_number", "initiative_number", "project_manager", "development_lead",
    "status", "phase", "scope_description", "current_update", "previous_update",
    "budget_risk", "schedule_risk", "precon_capp", "construction_capp", "add_capp",
    "approved_budget", "anticipated_final_cost", "forecast_variance",
    "original_start_date", "current_start_date",
    "original_turnover_date", "current_turnover_date", "duration_change_days",
    "reporting_period", "updated_at", "source_sort_order",
  ],
  business_units: ["id", "name", "sort_order"],
  project_updates: [
    "id", "project_id", "reporting_period", "current_summary", "previous_summary",
    "author_name", "created_at",
  ],
  project_photos: [
    "id", "project_id", "kind", "reporting_period", "caption", "date_taken",
    "taken_by", "area", "category", "include_in_report", "notes", "photo_number", "created_at",
  ],
  development_details: [
    "project_id", "request_date", "requestor", "deliverable_due_date", "consultants",
    "food_service_design", "design_capp", "subsidiary_expense_total",
    "original_estimate", "original_estimate_date", "current_estimate", "current_estimate_date",
  ],
};

export const QUERY_TABLES = Object.keys(QUERY_COLUMNS);

// Columns that exist in an approved table but must never be read. Credentials
// and session material are in tables the model cannot name at all; these are
// the ones sitting beside data it can. object_key is how a photograph is
// fetched from R2, and the route that serves it checks who is asking.
export const FORBIDDEN_COLUMNS = [
  "password_hash", "password_salt", "token_hash", "csrf_token", "reset_token",
  "must_change_password", "object_key", "actor_email", "author_email", "author_id",
  "promoted_by", "source_key", "source_sheet", "business_unit_id", "archived_at", "deleted_at",
];

// The scoped views, as a WITH prefix. Returns the SQL and its bindings, which
// come first in the final statement because the prefix does.
//
// scope === null means unrestricted, and the views then carry no unit filter -
// but they still drop archived projects, still hide the forbidden columns, and
// still compute the derived figures, because none of that is about permission.
export function scopedViews(scope) {
  const unit = scopePredicate(scope);
  const where = unit && unit.sql !== "1 = 0" ? ` AND ${unit.sql}` : (unit ? " AND 1 = 0" : "");
  const bindings = unit && unit.sql !== "1 = 0" ? unit.bindings : [];
  // Repeated for each child view, which each need their own copy of the filter.
  const liveProjects = `SELECT p2.id FROM main.projects p2
      JOIN main.business_units b2 ON b2.id = p2.business_unit_id
      WHERE p2.archived_at IS NULL${where.replace(/\bb\.name\b/g, "b2.name")}`;
  const child = (table, columns, extra = "") => ({
    sql: `${table} AS (
    SELECT ${columns}
    FROM main.${table} c
    WHERE c.project_id IN (${liveProjects})${extra}
  )`,
    bindings,
  });

  const views = [
    {
      sql: `projects AS (
    SELECT p.id, b.name AS business_unit, p.venue, p.section_name, p.name, p.project_type,
      p.capp_number, p.initiative_number, p.project_manager, p.development_lead,
      p.status, p.phase, p.scope_description, p.current_update, p.previous_update,
      p.budget_risk, p.schedule_risk, p.precon_capp, p.construction_capp, p.add_capp,
      p.approved_budget, p.anticipated_final_cost,
      ${FORECAST_VARIANCE_SQL} AS forecast_variance,
      p.original_start_date, p.current_start_date,
      p.original_turnover_date, p.current_turnover_date,
      -- Computed, shadowing the stored column of the same name, which is stale
      -- on 24 production rows. The model cannot reach the stored one.
      ${DAY_VARIANCE_SQL} AS duration_change_days,
      p.reporting_period, p.updated_at, p.source_sort_order
    FROM main.projects p
    JOIN main.business_units b ON b.id = p.business_unit_id
    WHERE ${LIVE_PROJECT_SQL}${where}
  )`,
      bindings,
    },
    {
      sql: `business_units AS (
    SELECT b.id, b.name, b.sort_order FROM main.business_units b
    WHERE 1 = 1${where}
  )`,
      bindings,
    },
    child("project_updates",
      "c.id, c.project_id, c.reporting_period, c.current_summary, c.previous_summary, c.author_name, c.created_at"),
    child("project_photos",
      "c.id, c.project_id, c.kind, c.reporting_period, c.caption, c.date_taken, c.taken_by, "
      + "c.area, c.category, c.include_in_report, c.notes, c.photo_number, c.created_at",
      ` AND c.${LIVE_PHOTO_SQL.replace("deleted_at", "deleted_at")}`),
    child("development_details",
      "c.project_id, c.request_date, c.requestor, c.deliverable_due_date, c.consultants, "
      + "c.food_service_design, c.design_capp, c.subsidiary_expense_total, "
      + "c.original_estimate, c.original_estimate_date, c.current_estimate, c.current_estimate_date"),
  ];
  return {
    sql: "WITH " + views.map((v) => v.sql).join(",\n  "),
    bindings: views.flatMap((v) => v.bindings),
  };
}

// What the model is told about the data. Written out rather than generated from
// the column lists, because a column name is not a meaning: "duration_change_days
// is positive when a project slipped" is the part that stops a wrong answer.
export function schemaPrompt({ units, today, role } = {}) {
  return `The database is SQLite (Cloudflare D1). You may read these five tables and no others.
Every one has already been filtered to what this reader is allowed to see, so do
not write any permission condition yourself.

projects - one row per project, archived projects already excluded
  id                     integer, the project's key
  business_unit          text, the owning business unit's name${units && units.length ? ` (one of: ${units.join(", ")})` : ""}
  name                   text, the project's title
  venue                  text, the property or site
  section_name           text, the area within the venue
  project_type           text: 'Capital' or 'Development'
  capp_number            text, capital appropriation number; Capital projects have one
  initiative_number      text, Development projects have one instead
  project_manager        text, may be null
  development_lead       text, the equivalent on Development projects; may be null
  status                 text: 'Active', 'On Hold', 'Complete', 'Closeout', or null
  phase                  text, free text such as 'Construction', 'Design'
  scope_description      text, what the project covers
  current_update         text, the latest saved activity update
  previous_update        text, the one before it
  budget_risk            text: 'High', 'Medium', 'Low' or 'Not Rated'
  schedule_risk          text: same four values
  approved_budget        real dollars, null when not yet recorded
  anticipated_final_cost real dollars, the forecast; null when not recorded
  forecast_variance      real, anticipated_final_cost - approved_budget, already
                         computed. Positive means over budget. Null when either
                         side is missing, so a project with no figures is never
                         reported as on budget. Use this rather than subtracting.
  precon_capp            real, pre-construction appropriation
  construction_capp      real, construction appropriation
  add_capp               real, additional appropriation
  original_start_date    text 'YYYY-MM-DD', may be null
  current_start_date     text 'YYYY-MM-DD', may be null
  original_turnover_date text 'YYYY-MM-DD', the handover date first committed to
  current_turnover_date  text 'YYYY-MM-DD', the handover date now expected
  duration_change_days   integer, current_turnover_date - original_turnover_date in
                         whole days, already computed. Positive means the project
                         has slipped later. Null when either date is missing. Use
                         this rather than subtracting the dates yourself.
  reporting_period       text 'YYYY-MM-DD', the reporting cycle this row belongs to
  updated_at             text timestamp, when the row was last written
  source_sort_order      integer, the Tracker's own report order

business_units - the units this reader can see
  id, name, sort_order

project_updates - the saved activity updates, many per project
  id, project_id (-> projects.id), reporting_period 'YYYY-MM-DD',
  current_summary (the update text), previous_summary, author_name, created_at
  A project's own current_update column repeats its most recent entry, so a
  question about "the latest update" can usually be answered from projects alone.

project_photos - photographs, many per project, deleted ones already excluded
  id, project_id (-> projects.id), kind, reporting_period, caption, date_taken,
  taken_by, area, category, include_in_report, notes, photo_number, created_at
  There may be no photographs at all. "No photos" is a real answer.

development_details - extra detail for Development projects, at most one row per project
  project_id (-> projects.id), request_date, requestor, deliverable_due_date,
  consultants, food_service_design, design_capp, subsidiary_expense_total,
  original_estimate, original_estimate_date, current_estimate, current_estimate_date

Relationships: project_updates, project_photos and development_details each join
to projects on project_id. projects.business_unit is already the unit's name, so
you do not need to join business_units to filter or group by unit.

Dates are plain 'YYYY-MM-DD' text and compare correctly with < > BETWEEN. Today
is ${today}. Work out any relative period from that date, never from anything else.

There is no table of people, roles or permissions, no contractor or vendor table,
no approvals table, and no change log. A question that needs one of those cannot
be answered from this database.${role ? `\n\nThe reader's role is ${role}. It does not change what the SQL may read.` : ""}`;
}
