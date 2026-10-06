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
