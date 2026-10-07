// What the workspace renders.
//
// One answer produces one View. This module owns the whole contract: which
// component kind a result becomes, and what shape that component is handed.
// Nothing here runs a query or calls a model — it is given a finished result
// and decides how it should be looked at.
//
// The model proposes a kind; this file decides. A model knows what the person
// meant and nothing about what came back, so a hint that disagrees with the
// shape of the result is overruled rather than trusted: a comparison of one
// aggregate row is a figure, whatever was asked for.

export const VIEW_KINDS = [
  "project_list", "project_detail", "budget_summary", "budget_variance",
  "risk_summary", "risk_list", "schedule", "change_comparison",
  "project_comparison", "timeline", "figure", "group", "empty",
];

const BUDGET_COLUMNS = ["approved_budget", "anticipated_final_cost", "forecast_variance",
  "precon_capp", "construction_capp", "add_capp"];
const SCHEDULE_COLUMNS = ["current_turnover_date", "original_turnover_date",
  "duration_change_days", "current_start_date", "original_start_date"];
const RISK_COLUMNS = ["budget_risk", "schedule_risk"];

const columnsOf = (rows) => (rows && rows.length ? Object.keys(rows[0]) : []);
const touches = (columns, list) => columns.some((name) => list.includes(name));

// Which component a result becomes.
//
// Order matters: the tests run from the most specific shape to the least, and
// the first that fits wins. A result that is one project is a detail panel
// whether or not the question sounded like a list.
export function chooseView(hint, { result, records }) {
  const rows = (records && records.length ? records : result.rows) || [];
  const columns = columnsOf(rows);

  if (!rows.length) return "empty";

  // A single figure is never a list, whatever was asked for.
  if (result.aggregate) {
    return rows.length === 1 && columns.length <= 4 ? "figure" : "group";
  }

  // A GROUP BY: a label column and a count or total beside it, with no project
  // id to open. Rendering this as a project list would invite a click that
  // leads nowhere.
  if (!columns.includes("id") && rows.length > 1) return "group";

  const hinted = VIEW_KINDS.includes(hint) ? hint : null;

  // One project: a detail panel, unless the hint asks for something that is
  // still true of a single row.
  if (rows.length === 1 && columns.includes("id")) {
    if (hinted === "change_comparison" || hinted === "timeline") return hinted;
    return "project_detail";
  }

  // Two to four named projects, explicitly asked to be compared.
  if (hinted === "project_comparison" && rows.length >= 2 && rows.length <= 4) {
    return "project_comparison";
  }

  if (hinted === "change_comparison") return "change_comparison";

  // The hint is taken for the three analytical lists, but only when the result
  // actually carries the columns that component is built from.
  if (hinted === "budget_variance" && touches(columns, BUDGET_COLUMNS)) return "budget_variance";
  if (hinted === "schedule" && touches(columns, SCHEDULE_COLUMNS)) return "schedule";
  if (hinted === "risk_list" && touches(columns, RISK_COLUMNS)) return "risk_list";
  if (hinted === "budget_summary") return "budget_summary";
  if (hinted === "risk_summary") return "risk_summary";

  return "project_list";
}

const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// Totals over a set of projects, with the recorded counts beside them.
//
// Every total here says how many projects it is computed over, because a sum
// across the ones that happen to have a figure is not a sum across the set and
// has been reported as one.
export function budgetTotals(rows) {
  const totals = {
    count: rows.length,
    approved: 0, approvedCount: 0,
    forecast: 0, forecastCount: 0,
    variance: 0, varianceCount: 0,
    overBudget: 0, underBudget: 0, noFigures: 0,
  };
  rows.forEach((row) => {
    const approved = number(row.approved_budget);
    const forecast = number(row.anticipated_final_cost);
    const variance = number(row.forecast_variance);
    if (approved !== null) { totals.approved += approved; totals.approvedCount += 1; }
    if (forecast !== null) { totals.forecast += forecast; totals.forecastCount += 1; }
    if (variance !== null) {
      totals.variance += variance;
      totals.varianceCount += 1;
      if (variance > 0) totals.overBudget += 1;
      if (variance < 0) totals.underBudget += 1;
    } else {
      totals.noFigures += 1;
    }
  });
  return totals;
}

export function scheduleTotals(rows) {
  const slips = rows.map((row) => number(row.duration_change_days)).filter((n) => n !== null);
  const dates = rows.map((row) => row.current_turnover_date).filter(Boolean).sort();
  return {
    count: rows.length,
    slipped: slips.filter((n) => n > 0).length,
    pulled: slips.filter((n) => n < 0).length,
    onPlan: slips.filter((n) => n === 0).length,
    noDates: rows.length - slips.length,
    worst: slips.length ? Math.max(...slips) : null,
    from: dates.length ? dates[0] : null,
    to: dates.length ? dates[dates.length - 1] : null,
  };
}

const RISK_LEVELS = ["High", "Medium", "Low", "Not Rated"];

export function riskBuckets(rows) {
  const level = (value) => {
    const text = String(value || "").trim();
    const found = RISK_LEVELS.find((name) => name.toLowerCase() === text.toLowerCase());
    return found || "Not Rated";
  };
  return RISK_LEVELS.map((name) => ({
    label: name,
    budget: rows.filter((row) => level(row.budget_risk) === name).length,
    schedule: rows.filter((row) => level(row.schedule_risk) === name).length,
  })).filter((bucket) => bucket.budget || bucket.schedule);
}

// The fields a side-by-side comparison shows. Kept short on purpose: four
// projects against twenty rows is a spreadsheet, and a spreadsheet is what the
// Projects screen is for.
export const COMPARISON_FIELDS = [
  { key: "business_unit", label: "Business unit", format: "text" },
  { key: "venue", label: "Venue", format: "text" },
  { key: "status", label: "Status", format: "text" },
  { key: "phase", label: "Phase", format: "text" },
  { key: "approved_budget", label: "Approved budget", format: "money" },
  { key: "anticipated_final_cost", label: "Anticipated final", format: "money" },
  { key: "forecast_variance", label: "Forecast variance", format: "money_signed" },
  { key: "current_turnover_date", label: "Turnover", format: "date" },
  { key: "duration_change_days", label: "Days moved", format: "days_signed" },
  { key: "budget_risk", label: "Budget risk", format: "text" },
  { key: "schedule_risk", label: "Schedule risk", format: "text" },
];

// A project's two reporting periods, side by side. The tracker holds the
// previous values on the row itself, which is what makes this answerable
// without a history table.
export function periodPairs(project) {
  const pairs = [
    {
      label: "Turnover date",
      previous: project.original_turnover_date || null,
      current: project.current_turnover_date || null,
      delta: number(project.duration_change_days),
      format: "date",
      deltaFormat: "days_signed",
    },
    {
      label: "Start date",
      previous: project.original_start_date || null,
      current: project.current_start_date || null,
      delta: null,
      format: "date",
    },
    {
      label: "Cost",
      previous: number(project.approved_budget),
      current: number(project.anticipated_final_cost),
      delta: number(project.forecast_variance),
      format: "money",
      deltaFormat: "money_signed",
      previousLabel: "Approved",
      currentLabel: "Anticipated",
    },
  ];
  return pairs.filter((pair) => pair.previous !== null || pair.current !== null);
}

const clean = (value) => {
  const text = String(value === null || value === undefined ? "" : value).trim();
  return text || null;
};

// What to call the thing on screen. Built from the result rather than from the
// question, so a misread question shows up as a title that does not match what
// was asked instead of being hidden behind one that does.
function titleFor(kind, rows, result) {
  const one = rows.length === 1 ? rows[0] : null;
  switch (kind) {
    // A figure says itself. "74 projects" set large needs no heading above it
    // saying "Figure", and a heading plus a generic subtitle is two lines
    // spent on what one line already carries.
    case "figure": return null;
    case "project_detail": return clean(one && one.name) || "Project";
    case "budget_summary":
    case "budget_variance": return "Budgets and variance";
    case "risk_summary": return "Risk";
    case "risk_list": return "Risk ratings";
    case "schedule": return "Turnover";
    case "change_comparison": return one ? `${clean(one.name) || "Project"} · period on period` : "Period on period";
    case "project_comparison": return "Side by side";
    case "timeline": return one ? `${clean(one.name) || "Project"} · timeline` : "Timeline";
    case "group": return "Breakdown";
    case "empty": return "Nothing matched";
    default: return result.total === 1 ? "1 project" : `${result.total} projects`;
  }
}

// Only what the title does not already say. A count under a title that is the
// same count is a line of interface that tells the reader nothing.
function subtitleFor(kind, rows, result) {
  if (kind === "empty" || kind === "figure") return null;
  const parts = [];
  if (kind === "project_detail" && rows.length === 1) {
    const row = rows[0];
    [row.venue, row.business_unit, row.phase].forEach((value) => {
      const text = clean(value);
      if (text) parts.push(text);
    });
    return parts.join(" · ") || null;
  }
  if (result.truncated) parts.push(`${result.total} matched · showing ${result.returned}`);
  else if (typeof result.total === "number" && kind !== "project_list") {
    parts.push(`${result.total} ${result.total === 1 ? "project" : "projects"}`);
  }
  if (result.fannedOut && result.projects && result.projects.matched !== null) {
    parts.push(`across ${result.projects.matched} projects`);
  }
  return parts.join(" · ") || null;
}

// Rows carry one of three marks, and no more. Three is the whole visual
// vocabulary of state in this product: anything else is a figure the reader
// can see for themselves.
export function marksFor(row) {
  const marks = [];
  const variance = number(row.forecast_variance);
  const slip = number(row.duration_change_days);
  const high = (value) => String(value || "").trim().toLowerCase() === "high";
  if (variance !== null && variance > 0) marks.push("over_budget");
  if (slip !== null && slip > 0) marks.push("slipped");
  if (high(row.budget_risk) || high(row.schedule_risk)) marks.push("high_risk");
  return marks;
}

// The View itself. `data` is whatever that component is built from; the client
// has one renderer per kind and reads nothing else.
// A bare count of every project this reader can see. Only then is a breakdown
// of the whole portfolio provably about the same set as the figure: a count
// with any condition on it would be shown beside a breakdown that totals
// something else, which is the kind of confident wrong answer this product
// exists to avoid.
export function countsWholePortfolio(result) {
  if (!result || !result.aggregate || !Array.isArray(result.rows)) return false;
  if (result.rows.length !== 1) return false;
  const values = Object.values(result.rows[0]);
  if (values.length !== 1) return false;
  const total = number(values[0]);
  return total !== null && total > 1
    && typeof result.projectsInScope === "number" && total === result.projectsInScope;
}

export function buildView(kind, { result, records, label }) {
  const rows = (records && records.length ? records : result.rows) || [];
  const view = {
    kind,
    title: label || titleFor(kind, rows, result),
    subtitle: subtitleFor(kind, rows, result),
    count: result.aggregate ? null : result.total,
    truncated: !!result.truncated,
    data: {},
  };

  switch (kind) {
    case "project_detail":
      view.data = { project: rows[0] || null };
      break;
    case "budget_summary":
      view.data = { rows, totals: budgetTotals(rows) };
      break;
    case "budget_variance":
      view.data = {
        rows: rows.slice().sort((a, b) => (number(b.forecast_variance) ?? -Infinity)
          - (number(a.forecast_variance) ?? -Infinity)),
        totals: budgetTotals(rows),
      };
      break;
    case "risk_summary":
      view.data = { buckets: riskBuckets(rows), rows, totals: { count: rows.length } };
      break;
    case "risk_list":
      view.data = { rows };
      break;
    case "schedule":
      view.data = {
        rows: rows.slice().sort((a, b) => String(a.current_turnover_date || "9999")
          .localeCompare(String(b.current_turnover_date || "9999"))),
        totals: scheduleTotals(rows),
      };
      break;
    case "change_comparison":
      view.data = rows[0]
        ? { project: rows[0], pairs: periodPairs(rows[0]), narrative: {
          previous: clean(rows[0].previous_update),
          current: clean(rows[0].current_update),
        } }
        : { project: null, pairs: [], narrative: null };
      break;
    case "project_comparison":
      view.data = { projects: rows.slice(0, 4), fields: COMPARISON_FIELDS };
      break;
    case "timeline":
      view.data = { events: timelineFor(rows[0]) };
      break;
    case "figure":
      view.data = { metrics: metricsFrom(rows[0] || {}, countUnit(result)) };
      break;
    case "group":
      view.data = { rows, columns: columnsOf(rows) };
      break;
    case "empty":
      view.data = {};
      break;
    default:
      view.data = { rows };
  }
  return view;
}

// A single aggregate row, read as labelled numbers rather than as a table of
// one. The column name is the label: the query wrote it, so it says what the
// figure is.
// A single aggregate row, read as labelled numbers. The column name is the
// label, so it has to be made readable first: the model writes SQL, and
// COUNT(*) on screen is the database showing through the product.
const AGGREGATES = [
  [/^count\s*\(\s*\*\s*\)$/i, null],
  [/^sum[_(]/i, "Total "], [/^total[_(]/i, "Total "],
  [/^avg[_(]/i, "Average "], [/^average[_(]/i, "Average "],
  [/^max[_(]/i, "Highest "], [/^min[_(]/i, "Lowest "],
  [/^count[_(]/i, null],
];

export function humanMetric(key) {
  const name = String(key || "").trim();
  for (const [pattern, prefix] of AGGREGATES) {
    if (!pattern.test(name)) continue;
    // A bare count has no label at all: the unit beside the number says what
    // was counted, and "Count" above "74" says nothing.
    const inner = name.replace(/^[a-z]+\s*[_(]\s*/i, "").replace(/[)\s]+$/, "").replace(/\*/, "");
    const rest = inner.replace(/_/g, " ").trim();
    if (prefix === null) return null;
    return (prefix + (rest || "value")).replace(/\s+/g, " ").trim();
  }
  // A terse alias is a count by another name: "AS n", "AS c", "AS cnt". Shown
  // as a label it reads as a column, which is the database showing through.
  if (/^(n|c|cnt|num|qty|count|total|projects|records)$/i.test(name)) return null;
  return name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// What a bare COUNT(*) counted. entityLabel says "a single figure" for an
// aggregate, which reads correctly in a sentence and wrongly as a unit beside
// a number. The tables the query touched say what the rows actually were.
export function countUnit(result) {
  const tables = (result && result.tables) || [];
  if (tables.includes("project_updates")) return "activity updates";
  if (tables.includes("project_photos")) return "photographs";
  if (tables.includes("development_details")) return "development records";
  if (tables.includes("projects")) return "projects";
  return "records";
}

function metricsFrom(row, unit) {
  return Object.entries(row).map(([key, value]) => ({
    key,
    label: humanMetric(key),
    // What the number is a number OF. Shown beside it, so a figure reads as a
    // sentence rather than as a value with a column name over it.
    unit: humanMetric(key) === null ? (unit || "records") : null,
    value: number(value) === null ? clean(value) : number(value),
    format: /budget|cost|variance|capp|estimate/i.test(key) && number(value) !== null
      ? "money"
      : (number(value) === null ? "text" : "number"),
  }));
}

function timelineFor(project) {
  if (!project) return [];
  const events = [
    { date: project.original_start_date, label: "Original start", kind: "plan" },
    { date: project.current_start_date, label: "Current start", kind: "actual" },
    { date: project.original_turnover_date, label: "Original turnover", kind: "plan" },
    { date: project.current_turnover_date, label: "Current turnover", kind: "actual" },
    { date: project.reporting_period, label: "Last reported", kind: "report" },
  ];
  return events
    .filter((event) => clean(event.date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
