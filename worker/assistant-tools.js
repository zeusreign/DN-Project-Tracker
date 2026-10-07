// The data tools the realtime voice model calls directly.
//
// This is the voice path, and it is deliberately not the typed path. A typed
// question is open-ended, so the model writes SQL and assistant-sql.js checks
// it. A spoken question is answered from a closed set of parameters: the model
// chooses filters, and the worker builds the statement. Nothing the model says
// becomes SQL, so there is no statement to validate and no round trip to a
// second model before the listener hears anything.
//
// The permission boundary is unchanged and is still structural. Every query
// here runs against scopedViews(scope) — the same common table expressions the
// typed path uses — so `projects` is already this reader's projects, archived
// rows are already gone, and the derived figures are already computed. A tool
// cannot reach a row the reader could not open on the Projects screen, and
// nothing below is in a position to widen that.

import { scopedViews, clampLimit, RESULT_LIMIT_MAX } from "./assistant-schema.js";
import { chooseView, buildView } from "./assistant-views.js";

// The columns a tool reads. The scoped view already holds exactly these, so
// this is a projection rather than a restriction — but writing it out keeps a
// future column from appearing in a voice answer without anyone deciding it
// should.
const SELECT = `id, name, business_unit, venue, section_name, project_type,
  capp_number, initiative_number, project_manager, development_lead,
  status, phase, scope_description, current_update, previous_update,
  budget_risk, schedule_risk, approved_budget, anticipated_final_cost,
  forecast_variance, original_start_date, current_start_date,
  original_turnover_date, current_turnover_date, duration_change_days,
  reporting_period`;

const ORDER_BY = {
  name: "name COLLATE NOCASE ASC",
  venue: "venue COLLATE NOCASE ASC, name COLLATE NOCASE ASC",
  budget: "approved_budget IS NULL, approved_budget DESC",
  budget_asc: "approved_budget IS NULL, approved_budget ASC",
  // NULL sorts first ascending in SQLite, so a project with no figure would
  // come back as the largest overrun. Pushed to the end explicitly, both ways.
  variance: "forecast_variance IS NULL, forecast_variance DESC",
  variance_asc: "forecast_variance IS NULL, forecast_variance ASC",
  slip: "duration_change_days IS NULL, duration_change_days DESC",
  turnover: "current_turnover_date IS NULL, current_turnover_date ASC",
  turnover_desc: "current_turnover_date IS NULL, current_turnover_date DESC",
  reported: "reporting_period IS NULL, reporting_period DESC",
};

// Words people put around the thing they are naming. "The Central City
// project" and "CAPP number 08727" both have to match a column that holds
// "central city" and "08727" and nothing else, so the label comes off here
// rather than being left to the model to remember not to send.
const LABEL_WORDS = /\b(the|a|an|project|projects|site|property|venue|section|number|no|capp|initiative|at|in|for|please)\b/gi;

export function searchTerm(text) {
  const cleaned = String(text || "")
    .toLowerCase()
    .replace(LABEL_WORDS, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || String(text || "").toLowerCase().trim();
}

const asInt = (value) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null);
const asDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null);

// Filters in, a WHERE clause out. Everything is bound; nothing is interpolated.
export function whereFrom(filters = {}) {
  const clauses = [];
  const bindings = [];
  const add = (sql, ...values) => { clauses.push(sql); bindings.push(...values); };

  const ids = Array.isArray(filters.ids)
    ? filters.ids.map(asInt).filter((id) => Number.isInteger(id) && id > 0).slice(0, RESULT_LIMIT_MAX)
    : [];
  if (ids.length) add(`id IN (${ids.map(() => "?").join(", ")})`, ...ids);

  if (filters.unit) add("lower(business_unit) = lower(?)", String(filters.unit).trim());
  if (filters.search) {
    const term = searchTerm(filters.search);
    if (term) add("identity LIKE ?", `%${term}%`);
  }
  if (filters.status) add("lower(status) = lower(?)", String(filters.status).trim());
  if (filters.phase) add("lower(phase) LIKE lower(?)", `%${String(filters.phase).trim()}%`);
  if (filters.project_type) add("lower(project_type) = lower(?)", String(filters.project_type).trim());

  const risk = String(filters.risk || "").toLowerCase();
  if (risk === "high") add("(budget_risk = 'High' OR schedule_risk = 'High')");
  else if (risk === "medium") add("(budget_risk = 'Medium' OR schedule_risk = 'Medium')");
  else if (risk === "low") add("(budget_risk = 'Low' OR schedule_risk = 'Low')");
  else if (risk === "budget_high") add("budget_risk = 'High'");
  else if (risk === "schedule_high") add("schedule_risk = 'High'");

  if (filters.over_budget === true) add("forecast_variance > 0");
  if (filters.under_budget === true) add("forecast_variance < 0");

  const slip = asInt(filters.slipped_min_days);
  if (slip !== null) add("duration_change_days >= ?", slip);
  if (filters.slipped === true) add("duration_change_days > 0");

  const from = asDate(filters.turnover_from);
  const to = asDate(filters.turnover_to);
  if (from) add("current_turnover_date >= ?", from);
  if (to) add("current_turnover_date <= ?", to);
  if (filters.missing_turnover_date === true) {
    add("(current_turnover_date IS NULL OR trim(current_turnover_date) = '')");
  }

  const min = Number(filters.budget_min);
  const max = Number(filters.budget_max);
  if (Number.isFinite(min)) add("approved_budget >= ?", min);
  if (Number.isFinite(max)) add("approved_budget <= ?", max);

  if (filters.no_update === true) {
    add("(COALESCE(trim(current_update), '') = '' AND COALESCE(trim(previous_update), '') = '')");
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    bindings,
  };
}

// One read. The scoped prefix always comes first, so its bindings do too.
async function select(db, filters, { order, limit } = {}) {
  const views = scopedViews(filters && filters.scope !== undefined ? filters.scope : null);
  const where = whereFrom(filters);
  const cap = clampLimit(limit);
  const orderBy = ORDER_BY[String(order || "")] || ORDER_BY.name;

  const countRow = await db
    .prepare(`${views.sql}\nSELECT COUNT(*) AS n FROM projects ${where.sql}`)
    .bind(...views.bindings, ...where.bindings)
    .first();
  const total = countRow ? Number(countRow.n) || 0 : 0;

  const rows = await db
    .prepare(`${views.sql}\nSELECT ${SELECT} FROM projects ${where.sql} ORDER BY ${orderBy} LIMIT ?`)
    .bind(...views.bindings, ...where.bindings, cap)
    .all();

  const results = rows.results || [];
  return {
    rows: results,
    total,
    returned: results.length,
    truncated: total > results.length,
    limit: cap,
    aggregate: false,
    entity: "projects",
    entityLabel: "projects",
    fannedOut: false,
    projects: { matched: total, returned: results.length },
  };
}

// How many projects this reader has in total, so a figure is never reported as
// though it covered a set it did not.
async function inScope(db, scope) {
  const views = scopedViews(scope);
  const row = await db.prepare(`${views.sql}\nSELECT COUNT(*) AS n FROM projects`)
    .bind(...views.bindings).first();
  return row ? Number(row.n) || 0 : 0;
}

// --- What the listener is told ----------------------------------------------
// One short line. The screen already has the detail, and a list read aloud is
// worse than a count and an offer to look.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function describe(total, filters, noun = "project") {
  const where = [];
  if (filters.search) where.push(`matching ${filters.search}`);
  if (filters.unit) where.push(`in ${filters.unit}`);
  if (filters.over_budget) where.push("over budget");
  if (filters.slipped || filters.slipped_min_days) where.push("running late");
  if (String(filters.risk || "").includes("high")) where.push("at high risk");
  const tail = where.length ? ` ${where.join(", ")}` : "";
  if (!total) return `No ${noun}s${tail}.`;
  return `${plural(total, noun, `${noun}s`)}${tail}.`;
}

function subjectLabel(filters, fallback) {
  const parts = [];
  if (filters.search) parts.push(String(filters.search).trim());
  if (filters.unit) parts.push(String(filters.unit).trim());
  if (filters.over_budget) parts.push("over budget");
  if (filters.under_budget) parts.push("under budget");
  if (filters.slipped || filters.slipped_min_days) parts.push("running late");
  if (String(filters.risk || "").includes("high")) parts.push("high risk");
  if (filters.status) parts.push(String(filters.status).trim());
  if (filters.phase) parts.push(String(filters.phase).trim());
  return parts.length ? parts.join(" · ") : fallback;
}

// --- The tools ---------------------------------------------------------------

const FILTER_PROPERTIES = {
  ids: {
    type: "array",
    items: { type: "integer" },
    description: "Project ids to work within. Pass the ids from the previous result whenever "
      + 'the listener says "those", "them", "which ones" or otherwise narrows what is already '
      + "on screen. Omit it to search the whole portfolio.",
  },
  search: {
    type: "string",
    description: "A project, venue, property, section, CAPP number or initiative number the "
      + 'listener named. Send only the identifying words: "Central City", not "the Central City '
      + 'project"; "08727", not "CAPP 08727".',
  },
  unit: { type: "string", description: "A business unit name, exactly as it was given to you." },
  status: { type: "string", enum: ["Active", "On Hold", "Complete", "Closeout"] },
  phase: { type: "string", description: "A phase such as Construction, Design or Procurement." },
  project_type: { type: "string", enum: ["Capital", "Development"] },
  risk: {
    type: "string",
    enum: ["high", "medium", "low", "budget_high", "schedule_high"],
    description: 'Plain "high" means either budget or schedule risk is High.',
  },
  over_budget: { type: "boolean", description: "Anticipated final cost is above the approved budget." },
  under_budget: { type: "boolean", description: "Anticipated final cost is below the approved budget." },
  slipped: { type: "boolean", description: "Turnover has moved later than originally planned." },
  slipped_min_days: { type: "integer", description: "At least this many days later than planned." },
  turnover_from: { type: "string", description: "Turnover on or after this date, YYYY-MM-DD." },
  turnover_to: { type: "string", description: "Turnover on or before this date, YYYY-MM-DD." },
  missing_turnover_date: { type: "boolean", description: "No turnover date recorded at all." },
  budget_min: { type: "number", description: "Approved budget at least this many dollars." },
  budget_max: { type: "number", description: "Approved budget at most this many dollars." },
  no_update: { type: "boolean", description: "No activity update written in either reporting period." },
};

const filterSchema = (extra = {}, required = []) => ({
  type: "object",
  properties: { ...FILTER_PROPERTIES, ...extra },
  required,
});

export const REALTIME_TOOLS = [
  {
    type: "function",
    name: "find_projects",
    description: "Find projects and put them on screen. This is the tool for almost every "
      + "question that is about which projects, how many, or where. The screen shows the list; "
      + "you say the count and at most a couple of names.",
    parameters: filterSchema({
      order: {
        type: "string",
        enum: Object.keys(ORDER_BY),
        description: 'How to sort. Use "variance" for the biggest overrun, "slip" for the '
          + 'furthest behind, "budget" for the largest budget, "turnover" for the soonest handover.',
      },
      limit: { type: "integer", description: "At most 50. Leave it out unless a number was asked for." },
    }),
  },
  {
    type: "function",
    name: "project_detail",
    description: "Open one project and show everything recorded about it. Use this when the "
      + "listener names a single project, or says to open, take or focus on one from the list.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "integer", description: "The project's id, when you have it." },
        search: { type: "string", description: "What it was called, if you do not have an id." },
      },
    },
  },
  {
    type: "function",
    name: "budget_analysis",
    description: "Budgets, forecasts and variance across a set of projects. Shows the totals "
      + "and the projects behind them.",
    parameters: filterSchema(),
  },
  {
    type: "function",
    name: "schedule_analysis",
    description: "Turnover dates and how far they have moved. Use this for anything about "
      + "schedule, slippage, handover or when something is due.",
    parameters: filterSchema(),
  },
  {
    type: "function",
    name: "risk_analysis",
    description: "How risk is distributed across a set of projects, budget and schedule "
      + "separately.",
    parameters: filterSchema(),
  },
  {
    type: "function",
    name: "compare_periods",
    description: "Compare one project with its previous reporting period: what the dates and "
      + "costs were, what they are now, and what the update said each time.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "integer" },
        search: { type: "string", description: "What the project was called, if you have no id." },
      },
    },
  },
  {
    type: "function",
    name: "compare_projects",
    description: "Put two to four projects side by side.",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "integer" }, description: "Two to four project ids." },
      },
      required: ["ids"],
    },
  },
];

export const TOOL_NAMES = REALTIME_TOOLS.map((tool) => tool.name);

// What the activity line says while a tool runs. Short, lower case, and about
// the work rather than about the system.
export const TOOL_LABELS = {
  find_projects: "finding projects",
  project_detail: "opening the project",
  budget_analysis: "checking budget",
  schedule_analysis: "checking schedule",
  risk_analysis: "checking risk",
  compare_periods: "comparing previous period",
  compare_projects: "comparing projects",
};

export class ToolError extends Error {}

// Run one tool. Returns the View for the screen and the line for the model.
export async function runTool(db, name, args, scope) {
  if (!TOOL_NAMES.includes(name)) throw new ToolError(`Unknown tool "${name}".`);
  const input = args && typeof args === "object" ? args : {};
  const filters = { ...input, scope };

  if (name === "project_detail" || name === "compare_periods") {
    const id = asInt(input.project_id);
    const found = await select(db, {
      scope,
      ...(id ? { ids: [id] } : { search: input.search || "" }),
    }, { order: "name", limit: 4 });

    if (!found.total) {
      const view = buildView("empty", { result: found, records: [], label: "No matching project" });
      return { view, speak: "The search found no project by that name.", subject: { ids: [], label: "" } };
    }
    // Several matches to a name is an answer, not an ambiguity: show them and
    // let the listener choose, rather than picking one and sounding certain.
    if (found.total > 1 && !id) {
      const view = buildView("project_list", { result: found, records: found.rows,
        label: `${found.total} projects match "${input.search}"` });
      return {
        view,
        speak: `${found.total} projects match that. They are on screen — which one?`,
        subject: { ids: found.rows.map((r) => r.id), label: String(input.search || "").trim() },
      };
    }

    const project = found.rows[0];
    const kind = name === "compare_periods" ? "change_comparison" : "project_detail";
    const view = buildView(kind, { result: { ...found, total: 1 }, records: [project] });
    const speak = name === "compare_periods"
      ? comparisonLine(project)
      : `${project.name}, at ${project.venue || project.business_unit}. It is on screen.`;
    return { view, speak, subject: { ids: [project.id], label: project.name } };
  }

  if (name === "compare_projects") {
    const ids = Array.isArray(input.ids) ? input.ids.map(asInt).filter(Boolean).slice(0, 4) : [];
    if (ids.length < 2) throw new ToolError("Two to four project ids are needed to compare.");
    const found = await select(db, { scope, ids }, { order: "name", limit: 4 });
    const view = buildView("project_comparison", { result: found, records: found.rows });
    return {
      view,
      speak: `${found.rows.map((r) => r.name).join(" and ")} are side by side on screen.`,
      subject: { ids: found.rows.map((r) => r.id), label: "side by side" },
    };
  }

  const order = name === "budget_analysis" ? (input.order || "variance")
    : name === "schedule_analysis" ? (input.order || "turnover")
    : (input.order || "name");
  const found = await select(db, filters, { order, limit: input.limit });

  const kind = name === "budget_analysis" ? "budget_variance"
    : name === "schedule_analysis" ? "schedule"
    : name === "risk_analysis" ? "risk_summary"
    : chooseView(filters.over_budget ? "budget_variance"
      : (filters.slipped || filters.slipped_min_days) ? "schedule"
      : filters.risk ? "risk_list" : "project_list", { result: found, records: found.rows });

  const label = subjectLabel(filters, "projects");
  const view = buildView(kind, { result: found, records: found.rows,
    label: kind === "project_list" ? titleFromFilters(filters, found.total) : undefined });

  if (!found.total) {
    return {
      view: buildView("empty", { result: found, records: [], label: "No matching records" }),
      speak: describe(0, filters),
      subject: { ids: [], label },
    };
  }

  return {
    view,
    speak: speakFor(name, found, filters),
    subject: { ids: found.rows.map((row) => row.id), label },
    projectsInScope: await inScope(db, scope),
  };
}

function titleFromFilters(filters, total) {
  const label = subjectLabel(filters, null);
  const head = total === 1 ? "1 project" : `${total} projects`;
  return label ? `${head} · ${label}` : head;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "not recorded";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${n < 0 ? "-" : ""}$${(abs / 1e6).toFixed(1)} million`;
  if (abs >= 1e3) return `${n < 0 ? "-" : ""}$${Math.round(abs / 1e3)} thousand`;
  return `${n < 0 ? "-" : ""}$${Math.round(abs)}`;
}

function speakFor(name, found, filters) {
  const rows = found.rows;
  if (name === "budget_analysis") {
    const over = rows.filter((r) => Number(r.forecast_variance) > 0);
    const missing = rows.filter((r) => r.forecast_variance === null).length;
    if (!over.length) {
      return `None of the ${found.total} are forecasting over budget.`
        + (missing ? ` ${missing} have no figures recorded.` : "");
    }
    const sum = over.reduce((a, r) => a + Number(r.forecast_variance), 0);
    return `${plural(over.length, "project is", "projects are")} over budget, by ${money(sum)} together.`
      + (missing ? ` ${missing} have no figures recorded.` : "");
  }
  if (name === "schedule_analysis") {
    const late = rows.filter((r) => Number(r.duration_change_days) > 0);
    if (!late.length) return `None of the ${found.total} have moved their turnover date.`;
    const worst = late.slice().sort((a, b) => b.duration_change_days - a.duration_change_days)[0];
    return `${plural(late.length, "project has", "projects have")} slipped. `
      + `${worst.name} is the furthest out, at ${worst.duration_change_days} days.`;
  }
  if (name === "risk_analysis") {
    const high = rows.filter((r) => /high/i.test(`${r.budget_risk} ${r.schedule_risk}`));
    return high.length
      ? `${plural(high.length, "project is", "projects are")} rated High, out of ${found.total}.`
      : `None of the ${found.total} are rated High.`;
  }
  const head = describe(found.total, filters);
  return found.truncated
    ? `${head} The first ${found.returned} are on screen.`
    : `${head} They are on screen.`;
}

function comparisonLine(project) {
  const slip = Number(project.duration_change_days);
  const variance = Number(project.forecast_variance);
  const parts = [];
  if (Number.isFinite(slip) && slip !== 0) {
    parts.push(`turnover has moved ${Math.abs(slip)} days ${slip > 0 ? "later" : "earlier"}`);
  } else if (Number.isFinite(slip)) {
    parts.push("the turnover date has not moved");
  }
  if (Number.isFinite(variance) && variance !== 0) {
    parts.push(`the forecast is ${money(Math.abs(variance))} ${variance > 0 ? "above" : "below"} the approved budget`);
  }
  if (!parts.length) return `${project.name} — the comparison is on screen.`;
  return `On ${project.name}, ${parts.join(", and ")}.`;
}
