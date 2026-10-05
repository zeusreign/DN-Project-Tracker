// The assistant's query plan — the only thing the AI is allowed to produce.
//
// The AI never writes SQL and never names a table. It emits a plan object whose
// shape is declared once, below, and this module turns that into a scoped D1
// query. Two consequences worth stating plainly:
//
//   1. There is no SQL injection surface, because there is no SQL to inject
//      into. An unknown field is rejected outright rather than ignored.
//   2. The business-unit scope is applied here, as part of the query, from a
//      value the caller derives server-side via scopeFor(). A plan cannot opt
//      out of it, widen it, or reach past it with an explicit id list.
//
// Field names and semantics follow the "Ask the Tracker" pilot
// (DNC_Ask_the_Tracker_Pilot.html) so the prototype's UI maps onto this without
// translation. Its regex intent parser is what the AI replaces; everything from
// the plan down is reproduced here against real data.

// --- Derived values ----------------------------------------------------------
// Both mirror definitions that already exist in the application, because an
// assistant that disagrees with the screen is worse than one that declines to
// answer.

// Variance: forecast minus approved, positive meaning over budget. Identical to
// the expression served by /api/projects (worker/index.js:814).
const FORECAST_VARIANCE_SQL = `
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
const DAY_VARIANCE_SQL = `
  CASE
    WHEN p.original_turnover_date IS NULL OR p.current_turnover_date IS NULL
      OR trim(p.original_turnover_date) = '' OR trim(p.current_turnover_date) = ''
      OR julianday(p.original_turnover_date) IS NULL
      OR julianday(p.current_turnover_date) IS NULL
    THEN NULL
    ELSE CAST(julianday(p.current_turnover_date) - julianday(p.original_turnover_date) AS INTEGER)
  END`;

// --- Plan schema -------------------------------------------------------------
// One declaration drives validation, the human-readable description and the
// schema text shown to the model, so the three cannot drift apart.

export const PLAN_FIELDS = {
  unit: {
    type: "string", max: 120,
    // The accepted values are the signed-in user's own business units, loaded
    // from the database by availableUnits() and listed in the generated schema.
    // A name outside that list is refused rather than turned into a query that
    // matches nothing: an empty result reads as "there are none", which is a
    // confident wrong answer to a misspelling.
    describe: "Business unit name, or 'All' for every unit available to you. Must be one of the listed units.",
  },
  ids: {
    type: "intArray", maxItems: 50,
    describe: "Explicit project ids, for following up on a previous answer.",
  },
  search: {
    type: "string", max: 120,
    describe: "Free text matched against project name, venue, section, CAPP/initiative number, scope and current update.",
  },
  manager: {
    type: "string", max: 120,
    describe: "Matched against project manager and development lead.",
  },
  status: {
    type: "enum", values: ["Active", "On Hold", "Complete", "Needs Status", "Closeout"],
    describe: "Exact project status.",
  },
  type: {
    type: "enum", values: ["Capital", "Development"],
    describe: "Project type.",
  },
  excludeComplete: {
    type: "boolean",
    describe: "Drop projects whose status is Complete.",
  },
  risk: {
    type: "enum", values: ["budget", "schedule", "either"],
    describe: "Which risk rating to filter on. Pair with riskLevel.",
  },
  riskLevel: {
    type: "enum", values: ["High", "Medium", "Low", "Not Rated"],
    describe: "Risk level to match. Defaults to High when risk is set without it.",
  },
  delayed: {
    type: "boolean",
    describe: "Only projects whose current turnover date is later than the original. Use minDelayDays instead when the question names a number of days.",
  },
  minDelayDays: {
    type: "integer", min: -3650, max: 3650,
    describe: "Only projects that slipped at least this many days (current turnover minus original). Use this whenever the question names a number of days, such as \"slipped more than 30 days\" (30). Negative values select projects pulled earlier.",
  },
  overBudget: {
    type: "boolean",
    describe: "Only projects whose anticipated final cost exceeds the approved budget. Use minVariance instead when the question names an amount.",
  },
  minVariance: {
    type: "number",
    describe: "Only projects at least this many dollars over the approved budget (anticipated final cost minus approved budget). Use this whenever the question names an overrun amount, such as \"more than $50k over budget\" (50000). Not the same as minAmount, which is the size of the budget itself.",
  },
  minAmount: {
    type: "number", min: 0,
    describe: "Lower bound on the amount named by amountField.",
  },
  amountField: {
    type: "enum", values: ["approved_budget", "anticipated_final_cost"],
    describe: "Which amount minAmount applies to. Defaults to anticipated_final_cost.",
  },
  sort: {
    type: "enum", values: ["delay", "variance"],
    describe: "Order by largest schedule slip, or largest budget overrun. Defaults to the Tracker's own report order.",
  },
  limit: {
    type: "integer", clamp: true, min: 1, max: 50,
    describe: "Maximum rows to return. Defaults to 20 and is capped at 50 regardless of what is asked for.",
  },
};

// Columns the assistant may see. project_photos.object_key, every password and
// session column, and the internal source_key / source_sheet / sort bookkeeping
// are absent by construction rather than by instruction.
const SELECT_COLUMNS = `
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
  ${DAY_VARIANCE_SQL} AS duration_change_days`;

export const PLAN_LIMIT_DEFAULT = 20;
export const PLAN_LIMIT_MAX = PLAN_FIELDS.limit.max;

// --- Validation --------------------------------------------------------------
// Returns the cleaned plan plus a list of problems. A non-empty problems list
// means the plan is refused; nothing is silently corrected, because a quietly
// altered filter produces a confident answer to a question nobody asked.

export function validatePlan(raw, options = {}) {
  const problems = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { plan: null, problems: ["A plan object is required."] };
  }

  const plan = {};
  for (const key of Object.keys(raw)) {
    if (!Object.prototype.hasOwnProperty.call(PLAN_FIELDS, key)) {
      problems.push(`Unknown plan field "${key}".`);
    }
  }

  for (const [key, spec] of Object.entries(PLAN_FIELDS)) {
    const value = raw[key];
    if (value === undefined || value === null) continue;

    if (spec.type === "string") {
      if (typeof value !== "string") { problems.push(`"${key}" must be a string.`); continue; }
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (trimmed.length > spec.max) { problems.push(`"${key}" must be ${spec.max} characters or fewer.`); continue; }
      plan[key] = trimmed;

    } else if (spec.type === "enum") {
      if (!spec.values.includes(value)) {
        problems.push(`"${key}" must be one of: ${spec.values.join(", ")}.`); continue;
      }
      plan[key] = value;

    } else if (spec.type === "boolean") {
      if (typeof value !== "boolean") { problems.push(`"${key}" must be true or false.`); continue; }
      if (value) plan[key] = true;

    } else if (spec.type === "number" || spec.type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        problems.push(`"${key}" must be a number.`); continue;
      }
      if (spec.type === "integer" && !Number.isInteger(value)) {
        problems.push(`"${key}" must be a whole number.`); continue;
      }
      if (spec.min !== undefined && value < spec.min) { problems.push(`"${key}" must be at least ${spec.min}.`); continue; }
      // Only a field marked clamp may be silently capped, and only limit is:
      // a page size is ours to enforce and is not part of the question. Capping
      // a threshold would answer a different question from the one asked —
      // turning "slipped more than 99999 days" into "more than 3650" — so an
      // out-of-range threshold is refused instead.
      if (spec.max !== undefined && value > spec.max) {
        if (!spec.clamp) { problems.push(`"${key}" must be at most ${spec.max}.`); continue; }
        plan[key] = spec.max;
        continue;
      }
      plan[key] = value;

    } else if (spec.type === "intArray") {
      if (!Array.isArray(value)) { problems.push(`"${key}" must be an array.`); continue; }
      if (value.length > spec.maxItems) { problems.push(`"${key}" accepts at most ${spec.maxItems} entries.`); continue; }
      const ids = value.filter((entry) => Number.isInteger(entry) && entry > 0);
      if (ids.length !== value.length) { problems.push(`"${key}" must contain positive whole numbers only.`); continue; }
      if (ids.length) plan[key] = ids;
    }
  }

  if (plan.risk && !plan.riskLevel) plan.riskLevel = "High";
  if (plan.minAmount !== undefined && !plan.amountField) plan.amountField = "anticipated_final_cost";

  // Closed vocabulary for unit, when the caller supplied one. Case and spacing
  // are corrected to the stored name — that is reading a value back from the
  // database, not guessing at intent — but an unrecognised name is refused with
  // its reason so the model can correct itself on the next turn.
  //
  // The list is already narrowed to the user's scope, so a unit they cannot see
  // is indistinguishable from one that does not exist. That is the same choice
  // the project routes make in returning 404 rather than 403 for an id outside
  // scope: the error must not become a way to enumerate other units.
  if (Array.isArray(options.units) && plan.unit && plan.unit !== "All") {
    const match = options.units.find((name) => name.toLowerCase() === plan.unit.toLowerCase());
    if (match) plan.unit = match;
    else problems.push(`No business unit named “${plan.unit}”. Available: ${options.units.join(", ")}.`);
  }

  return { plan: problems.length ? null : plan, problems };
}

// --- Human-readable description ---------------------------------------------
// Rendered beside every answer so the user can see which filters were applied
// rather than trusting that the question was understood. Ported from the pilot's
// describePlan().

export function describePlan(plan = {}) {
  const parts = [];
  if (plan.unit && plan.unit !== "All") parts.push(plan.unit);
  if (plan.ids) parts.push(`${plan.ids.length} selected project${plan.ids.length === 1 ? "" : "s"}`);
  if (plan.search) parts.push(`Matching “${plan.search}”`);
  if (plan.manager) parts.push(plan.manager);
  if (plan.status) parts.push(plan.status);
  if (plan.type) parts.push(plan.type);
  if (plan.excludeComplete) parts.push("Excludes complete");
  if (plan.risk) parts.push(`${plan.riskLevel || "High"} ${plan.risk === "either" ? "budget or schedule" : plan.risk} risk`);
  if (plan.delayed) parts.push("Current turnover later than original");
  if (plan.minDelayDays !== undefined) {
    parts.push(plan.minDelayDays >= 0
      ? `Slipped ${plan.minDelayDays} days or more`
      : `Turnover moved no more than ${Math.abs(plan.minDelayDays)} days earlier`);
  }
  if (plan.overBudget) parts.push("Forecast above approved budget");
  if (plan.minVariance !== undefined) parts.push(`Over budget by ${plan.minVariance} or more`);
  if (plan.minAmount !== undefined) {
    parts.push(`${plan.amountField === "approved_budget" ? "Approved budget" : "Forecast"} above ${plan.minAmount}`);
  }
  if (plan.sort === "delay") parts.push("Largest schedule slip first");
  if (plan.sort === "variance") parts.push("Largest overrun first");
  if (plan.limit) parts.push(`Top ${plan.limit}`);
  return parts.length ? parts : ["All available projects"];
}

// --- Schema text for the system prompt ---------------------------------------
// Generated from PLAN_FIELDS so the model is never told about a field that does
// not exist, and never left unaware of one that does.

export function planSchemaPrompt(options = {}) {
  const lines = Object.entries(PLAN_FIELDS).map(([key, spec]) => {
    // unit is the one field whose values come from data rather than the
    // declaration, so the model is shown the names this user actually has and
    // cannot invent one.
    const type = key === "unit" && Array.isArray(options.units)
      ? [...options.units, "All"].map((v) => JSON.stringify(v)).join(" | ")
      : spec.type === "enum" ? spec.values.map((v) => JSON.stringify(v)).join(" | ")
      : spec.type === "intArray" ? "integer[]"
      : spec.type;
    return `  ${key}: ${type}\n      ${spec.describe}`;
  });
  return `The plan object accepts only these fields. Omit any field you do not need.\n\n${lines.join("\n")}`;
}

// --- Available business units ------------------------------------------------
// The vocabulary for the unit field, narrowed to what this user may see. Read
// from business_units rather than hardcoded, so a unit added through the admin
// screens is immediately askable about and a renamed one stops being offered.

export async function availableUnits(db, scope) {
  const result = await db.prepare(
    "SELECT name FROM business_units ORDER BY sort_order, name"
  ).bind().all();
  const names = (result.results || []).map((row) => row.name);
  if (!scope) return names;
  const allowed = new Set(scope.map((name) => name.toLowerCase()));
  return names.filter((name) => allowed.has(name.toLowerCase()));
}

// --- Execution ---------------------------------------------------------------
// scope is the array of business-unit names the signed-in user may see, or null
// for unrestricted access. It comes from scopeFor() on the server and is applied
// to every query here, ahead of any plan filter — never afterwards to a result
// set that has already been fetched.

function planWhere(plan, scope) {
  const clauses = ["p.archived_at IS NULL"];
  const bindings = [];

  if (scope) {
    if (!scope.length) return { sql: " WHERE 1 = 0", bindings: [] };
    clauses.push(`b.name IN (${scope.map(() => "?").join(", ")})`);
    bindings.push(...scope);
  }

  if (plan.unit && plan.unit !== "All") { clauses.push("b.name = ?"); bindings.push(plan.unit); }
  if (plan.ids) {
    clauses.push(`p.id IN (${plan.ids.map(() => "?").join(", ")})`);
    bindings.push(...plan.ids);
  }
  if (plan.search) {
    clauses.push(`(p.name LIKE ? OR p.venue LIKE ? OR p.section_name LIKE ?
      OR p.capp_number LIKE ? OR p.initiative_number LIKE ?
      OR p.scope_description LIKE ? OR p.current_update LIKE ?)`);
    bindings.push(...Array(7).fill(`%${plan.search}%`));
  }
  if (plan.manager) {
    clauses.push("(p.project_manager LIKE ? OR p.development_lead LIKE ?)");
    bindings.push(`%${plan.manager}%`, `%${plan.manager}%`);
  }
  if (plan.status) { clauses.push("p.status = ?"); bindings.push(plan.status); }
  if (plan.excludeComplete) clauses.push("p.status <> 'Complete'");
  if (plan.type) { clauses.push("p.project_type = ?"); bindings.push(plan.type); }

  if (plan.risk) {
    const level = plan.riskLevel || "High";
    if (plan.risk === "either") {
      clauses.push("(p.budget_risk = ? OR p.schedule_risk = ?)");
      bindings.push(level, level);
    } else {
      clauses.push(`p.${plan.risk === "budget" ? "budget_risk" : "schedule_risk"} = ?`);
      bindings.push(level);
    }
  }

  if (plan.delayed) clauses.push(`(${DAY_VARIANCE_SQL}) > 0`);
  if (plan.overBudget) clauses.push(`(${FORECAST_VARIANCE_SQL}) > 0`);
  // The numeric forms of the two booleans above. A project with no turnover
  // dates, or no budget figures, is unknown rather than below the threshold, so
  // the NULL case is excluded rather than compared.
  if (plan.minDelayDays !== undefined) {
    clauses.push(`(${DAY_VARIANCE_SQL}) IS NOT NULL AND (${DAY_VARIANCE_SQL}) >= ?`);
    bindings.push(plan.minDelayDays);
  }
  if (plan.minVariance !== undefined) {
    clauses.push(`(${FORECAST_VARIANCE_SQL}) IS NOT NULL AND (${FORECAST_VARIANCE_SQL}) >= ?`);
    bindings.push(plan.minVariance);
  }
  if (plan.minAmount !== undefined) {
    const column = plan.amountField === "approved_budget" ? "p.approved_budget" : "p.anticipated_final_cost";
    clauses.push(`${column} IS NOT NULL AND ${column} >= ?`);
    bindings.push(plan.minAmount);
  }

  return { sql: ` WHERE ${clauses.join(" AND ")}`, bindings };
}

const FROM_SQL = `
  FROM projects p
  JOIN business_units b ON b.id = p.business_unit_id`;

function orderSql(plan) {
  // NULLs last in both derived orderings: a project with no dates is not the
  // least delayed one, it is simply unknown.
  if (plan.sort === "delay") return ` ORDER BY (${DAY_VARIANCE_SQL}) IS NULL, (${DAY_VARIANCE_SQL}) DESC, p.id`;
  if (plan.sort === "variance") return ` ORDER BY (${FORECAST_VARIANCE_SQL}) IS NULL, (${FORECAST_VARIANCE_SQL}) DESC, p.id`;
  return " ORDER BY p.source_sort_order, p.id";
}

export function planQueries(plan, scope) {
  const where = planWhere(plan, scope);
  const limit = Math.min(plan.limit || PLAN_LIMIT_DEFAULT, PLAN_LIMIT_MAX);
  return {
    rows: {
      sql: `SELECT ${SELECT_COLUMNS}${FROM_SQL}${where.sql}${orderSql(plan)} LIMIT ?`,
      bindings: [...where.bindings, limit],
    },
    count: {
      sql: `SELECT COUNT(*) AS total${FROM_SQL}${where.sql}`,
      bindings: where.bindings,
    },
    limit,
  };
}

// Runs the plan and shapes the result. The model receives a count plus a capped
// page of rows, never the whole table: "137 projects match, showing 20" is read
// from COUNT(*) over the same scoped query rather than inferred from the page.
export async function runPlan(db, plan, scope) {
  const { rows, count, limit } = planQueries(plan, scope);
  const [page, totals] = await Promise.all([
    db.prepare(rows.sql).bind(...rows.bindings).all(),
    db.prepare(count.sql).bind(...count.bindings).first(),
  ]);
  const results = page.results || [];
  const total = totals?.total ?? results.length;
  return {
    total,
    returned: results.length,
    truncated: total > results.length,
    limit,
    rows: results,
    // Provenance for the evidence panel: every answer can cite the records
    // behind it rather than asserting a figure with nothing to inspect.
    sources: results.map((row) => ({
      id: row.id, name: row.name, business_unit: row.business_unit,
      reporting_period: row.reporting_period,
    })),
    description: describePlan(plan),
  };
}
