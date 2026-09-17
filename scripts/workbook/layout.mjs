// Worksheet classification and field mapping for the D&C bi-weekly workbook.
//
// FIELDS ARE FOUND BY HEADER TEXT, NEVER BY COLUMN LETTER.
//
// That is the load-bearing decision in this file. The capital tabs are not all
// the same shape: PATINA, GAMING, PARKS and SS open with a "Count" column, so
// Project Name is column B — while CORP and CLOSED PROJECTS have no Count column
// and Project Name is column A. Every field after it is shifted by one. A parser
// keyed on letters reads CORP's CAPP number as its project name.
//
// Matching on the header text handles all four layouts with one code path, and
// survives someone inserting a column in a future workbook.
import { cleanText } from "./normalise.mjs";

// Sheet -> how to treat it. Anything not listed is reported as unknown rather
// than guessed at, so a new tab next fortnight surfaces instead of vanishing.
export const SHEETS = {
  "CORP":                      { kind: "capital", unit: "Corporate" },
  "PATINA":                    { kind: "capital", unit: "Patina" },
  "GAMING":                    { kind: "capital", unit: "Gaming" },
  "PARKS":                     { kind: "capital", unit: "Parks & Resorts" },
  "SS":                        { kind: "capital", unit: "Sportservice" },
  "Design & Development":      { kind: "development", unit: null },

  // Parsed and reported, never imported. Listing them explicitly means the
  // reconciliation report can show them as deliberately skipped.
  "DEAD DEVELOPMENT PROJECTS": { kind: "excluded", reason: "Dead development projects are out of scope for the tracker." },
  "CLOSED PROJECTS":           { kind: "excluded", reason: "Closed projects tab; empty in this workbook." },
  "DASHBOARD":                 { kind: "excluded", reason: "Derived summary view; the tracker computes its own." },
  "Sheet1":                    { kind: "excluded", reason: "Derived summary view; the tracker computes its own." },
  "THS Openings Chart":        { kind: "excluded", reason: "PivotTable with refresh instructions; no project rows." },
};

// Header text -> output field. Matching is case-insensitive with whitespace
// collapsed, because headers vary ("Total Approved  Budget" carries a double
// space in every capital tab).
const CAPITAL_FIELDS = {
  "project name": "name",
  "capp #": "capp_number",
  "pm": "project_manager",
  "project update": "current_update",
  "previous week update": "previous_update",
  "budget risk": "budget_risk",
  "schedule risk": "schedule_risk",
  "a & e / pre-con capp": "precon_capp",
  "construction capp": "construction_capp",
  "add-capp (cumulative)": "add_capp",
  "total approved budget": "approved_budget",
  "anticipated final cost": "anticipated_final_cost",
  "original start date": "original_start_date",
  "current start date": "current_start_date",
  "original turnover date to ops": "original_turnover_date",
  "current turnover date to ops": "current_turnover_date",
  "duration change": "duration_change_days",
};

const DEVELOPMENT_FIELDS = {
  "project name": "name",
  "initiative #": "initiative_number",
  "project development lead": "development_lead",
  "project scope/description": "scope_description",
  "weekly update": "current_update",
  "status": "status",
  "request date": "request_date",
  "requestor": "requestor",
  "deliverable due date": "deliverable_due_date",
  "architect, engineers, cm consultants": "consultants",
  "food service design": "food_service_design",
  "design capp (y/n)": "design_capp",
  "subsidiary/biz dev expense total ($)": "subsidiary_expense_total",
  "original estimate": "original_estimate",
  "original estimate date": "original_estimate_date",
  "current estimate": "current_estimate",
  "current estimate date": "current_estimate_date",
};

// On the capital tabs a heading row names a VENUE ("TWO KINGS", "250 Delaware
// Ave") and the business unit comes from the tab itself. The development tab is
// the other way round: it is one sheet covering every subsidiary, so its heading
// rows name the BUSINESS UNIT. These are the headings seen in this workbook,
// mapped to the tracker's unit names. An unrecognised heading is flagged rather
// than silently dropped, because it would otherwise produce a project with no
// business unit and therefore no permission scope.
export const DEVELOPMENT_UNITS = {
  "sportservice": "Sportservice",
  "parks & resorts": "Parks & Resorts",
  "parks and resorts": "Parks & Resorts",
  "gaming": "Gaming",
  "patina": "Patina",
  "corporate": "Corporate",
  "corp": "Corporate",
};

export function developmentUnitFor(heading) {
  const key = String(heading || "").toLowerCase().replace(/\s+/g, " ").trim();
  return DEVELOPMENT_UNITS[key] || null;
}

// Columns read as Excel date serials. Identified here, by field name, so
// styles.xml never needs parsing.
export const DATE_FIELDS = new Set([
  "original_start_date", "current_start_date",
  "original_turnover_date", "current_turnover_date",
  "request_date", "deliverable_due_date",
  "original_estimate_date", "current_estimate_date",
]);

export const MONEY_FIELDS = new Set([
  "precon_capp", "construction_capp", "add_capp", "approved_budget",
  "anticipated_final_cost", "subsidiary_expense_total",
  "original_estimate", "current_estimate",
]);

function headerKey(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Finds the header row and returns { row, columns: { LETTER: field } }.
// The header is the first row mapping at least four known field names — enough
// to be unambiguous, low enough to tolerate a tab that omits optional columns.
export function findHeader(rows, kind) {
  const dictionary = kind === "development" ? DEVELOPMENT_FIELDS : CAPITAL_FIELDS;
  for (const row of rows) {
    const columns = {};
    let hits = 0;
    for (const [letter, cell] of Object.entries(row.cells)) {
      const field = dictionary[headerKey(cell.value)];
      if (field && !Object.values(columns).includes(field)) {
        columns[letter] = field;
        hits++;
      }
    }
    if (hits >= 4) {
      return { row: row.number, columns, unmapped: unmappedHeaders(row, dictionary) };
    }
  }
  return null;
}

// Header cells we did not recognise. Reported rather than ignored: a renamed or
// added column should be visible, not silently dropped.
function unmappedHeaders(row, dictionary) {
  const out = [];
  for (const [letter, cell] of Object.entries(row.cells)) {
    const key = headerKey(cell.value);
    // "Count" and "Column1" are known spreadsheet furniture with no destination.
    if (key === "count" || key === "column1" || key === "") continue;
    if (!dictionary[key]) out.push({ column: letter, header: cleanText(cell.value) });
  }
  return out;
}
