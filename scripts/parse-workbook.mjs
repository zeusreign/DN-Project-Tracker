// Phase 1 of the workbook import: READ the bi-weekly workbook and emit
// normalised JSON for the later reconciliation step.
//
//   node scripts/parse-workbook.mjs \
//     --config scripts/workbook/import-2026-09-11.json \
//     --workbook "2026_0911 D&C Bi-Weekly Report Data.xlsx" \
//     --out /tmp/workbook-2026-09-11.json
//
// READ ONLY. It opens no database connection, writes nothing but the output
// file, and makes no network call. It decides nothing about what should be
// imported — that is reconciliation's job. Its only contract is: represent what
// the workbook says, faithfully, and say so when a cell cannot be read.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson } from "./workbook/io.mjs";
import { readWorkbook } from "./workbook/xlsx.mjs";
import { SHEETS, findHeader, developmentUnitFor, DATE_FIELDS, MONEY_FIELDS } from "./workbook/layout.mjs";
import {
  cleanText, comparableText, normaliseCapp, normaliseName, dateFromSerial,
  normaliseRisk, normaliseDevelopmentStatus, normaliseMoney, isCappPlaceholder,
} from "./workbook/normalise.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argument(name, fallback = null) {
  const index = process.argv.indexOf("--" + name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const configPath = argument("config", "scripts/workbook/import-2026-09-11.json");
const config = JSON.parse(readFileSync(resolve(projectRoot, configPath), "utf8"));

// Dates are never derived. A config without both is a hard failure, so a future
// workbook cannot be imported under guessed dates.
for (const key of ["report_date", "previous_report_date"]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config[key] || "")) {
    console.error(`ERROR: ${configPath} must set ${key} to an explicit YYYY-MM-DD date.`);
    process.exit(1);
  }
}

const workbookPath = resolve(projectRoot, argument("workbook", config.workbook));
const outputPath = argument("out", null);

const book = readWorkbook(workbookPath);

// --- Row extraction ----------------------------------------------------------

// A row carrying ONLY the name column is a venue / section heading, not a
// project — "TWO KINGS", "MARDI GRAS", "250 Delaware Ave". It is recorded and
// carried down onto the project rows beneath it, which is how the tracker's
// `venue` (capital) and subsidiary grouping (development) are reconstructed.
function isHeadingRow(cells, columns, nameColumn) {
  const populated = Object.keys(cells).filter((letter) => columns[letter]);
  return populated.length === 1 && populated[0] === nameColumn;
}

function extractSheet(sheetName, definition) {
  const rows = book.rows(sheetName);
  const header = findHeader(rows, definition.kind);
  if (!header) {
    return { sheet: sheetName, kind: definition.kind, error: "No recognisable header row.", rows: [] };
  }

  const nameColumn = Object.keys(header.columns).find((letter) => header.columns[letter] === "name");
  const out = [];
  const skipped = [];
  let venue = null;

  for (const row of rows) {
    if (row.number <= header.row) continue;

    const mapped = {};
    for (const [letter, cell] of Object.entries(row.cells)) {
      const field = header.columns[letter];
      if (field) mapped[field] = cell;
    }
    if (!Object.keys(mapped).length) continue;

    const rawName = mapped.name ? cleanText(mapped.name.value) : null;

    if (rawName && isHeadingRow(row.cells, header.columns, nameColumn)) {
      venue = rawName;
      continue;
    }
    if (!rawName) {
      skipped.push({ row: row.number, reason: "No project name in the name column." });
      continue;
    }
    if (/^totals?$/i.test(rawName)) {
      skipped.push({ row: row.number, reason: "Spreadsheet TOTAL row." });
      continue;
    }

    out.push(buildRecord(sheetName, definition, row, mapped, venue, rawName));
  }

  return {
    sheet: sheetName,
    kind: definition.kind,
    business_unit: definition.unit,
    header_row: header.row,
    columns: header.columns,
    unmapped_headers: header.unmapped,
    row_count: out.length,
    skipped,
    rows: out,
  };
}

function buildRecord(sheetName, definition, row, mapped, venue, rawName) {
  // Capital tabs: the unit comes from the tab, the heading names a venue.
  // Development tab: one sheet spans every subsidiary, so the heading names the
  // unit and there is no venue.
  const isDevelopment = definition.kind === "development";
  const businessUnit = isDevelopment ? developmentUnitFor(venue) : definition.unit;

  const record = {
    // Provenance. Every row can be traced back to the exact cell it came from,
    // which is what makes an ambiguous match reviewable by a human.
    source: { sheet: sheetName, row: row.number },
    kind: definition.kind,
    business_unit: businessUnit,
    // The raw heading text exactly as the workbook wrote it, kept whichever
    // meaning it carries, so a reviewer can always see where a row sat.
    section_heading: venue,
    venue: isDevelopment ? null : venue,
    name: rawName,
    fields: {},
    flags: [],
  };

  if (businessUnit === null) {
    record.flags.push({
      field: "business_unit",
      issue: "unresolved_business_unit",
      raw: venue,
      note: "Heading row did not map to a known business unit; the row cannot be scoped.",
    });
  }

  for (const [field, cell] of Object.entries(mapped)) {
    if (field === "name") continue;

    if (DATE_FIELDS.has(field)) {
      const parsed = dateFromSerial(cell);
      record.fields[field] = parsed.date;
      if (parsed.unparsed) {
        // 20 rows carry a literal "TBD" in a date column, and one GAMING cell
        // holds two dates across a line break. Kept verbatim, never coerced.
        record.fields[field + "_raw"] = parsed.raw;
        record.flags.push({ field, issue: "unparsed_date", raw: parsed.raw });
      }
      continue;
    }

    if (MONEY_FIELDS.has(field)) {
      record.fields[field] = normaliseMoney(cell);
      if (cell.kind === "error") record.flags.push({ field, issue: "formula_error", raw: cell.value });
      else if (cell.kind === "text" && record.fields[field] === null) {
        record.fields[field + "_raw"] = cleanText(cell.value);
        record.flags.push({ field, issue: "non_numeric", raw: cleanText(cell.value) });
      }
      continue;
    }

    if (cell.kind === "error") {
      record.fields[field] = null;
      record.flags.push({ field, issue: "formula_error", raw: cell.value });
      continue;
    }

    record.fields[field] = cell.kind === "number" ? cell.value : cleanText(cell.value);
  }

  // Update text is carried through untouched apart from an outer trim. The
  // import must preserve the project manager's wording exactly.
  record.current_update = cleanText(record.fields.current_update ?? null);
  record.previous_update = cleanText(record.fields.previous_update ?? null);
  delete record.fields.current_update;
  delete record.fields.previous_update;

  if (definition.kind === "capital") {
    record.fields.budget_risk = normaliseRisk(record.fields.budget_risk);
    record.fields.schedule_risk = normaliseRisk(record.fields.schedule_risk);
  } else {
    record.fields.status = normaliseDevelopmentStatus(record.fields.status);
  }

  const identifier = definition.kind === "capital"
    ? record.fields.capp_number
    : record.fields.initiative_number;

  // Comparison keys for the matcher. Raw values stay in `fields`; these exist
  // only so reconciliation never has to re-derive them.
  record.match = {
    capp_raw: cleanText(identifier ?? null),
    capp: normaliseCapp(identifier),
    name: normaliseName(rawName),
    venue: normaliseName(venue),
    scope: comparableText(record.fields.scope_description ?? null),
  };

  if (record.match.capp === null && !isCappPlaceholder(identifier)) {
    record.flags.push({ field: "capp_number", issue: "unusable_identifier", raw: cleanText(identifier) });
  }
  if (record.match.capp === null) {
    record.flags.push({
      field: "capp_number",
      issue: "no_identifier",
      raw: cleanText(identifier ?? null),
      note: "Matching must fall back to sheet + name, and then scope description.",
    });
  }
  if (!record.current_update) {
    record.flags.push({ field: "current_update", issue: "empty" });
  }

  return record;
}

// --- Run ---------------------------------------------------------------------

const sheets = [];
const excluded = [];
const unknown = [];

for (const sheetName of book.sheetNames) {
  const definition = SHEETS[sheetName];
  if (!definition) {
    // A tab nobody has classified must surface, not vanish.
    unknown.push(sheetName);
    continue;
  }
  if (definition.kind === "excluded") {
    // Still parsed, so the report can state how many rows were skipped and why.
    let rowCount = null;
    try {
      const rows = book.rows(sheetName);
      const header = findHeader(rows, "capital") || findHeader(rows, "development");
      rowCount = header ? rows.filter((row) => row.number > header.row).length : rows.length;
    } catch { rowCount = null; }
    excluded.push({ sheet: sheetName, reason: definition.reason, approximate_rows: rowCount });
    continue;
  }
  sheets.push(extractSheet(sheetName, definition));
}

const allRows = sheets.flatMap((sheet) => sheet.rows);
const output = {
  generated_from: config.workbook,
  report_date: config.report_date,
  previous_report_date: config.previous_report_date,
  date_provenance: "Both dates are assigned from configuration, not observed in the workbook.",
  totals: {
    sheets_parsed: sheets.length,
    sheets_excluded: excluded.length,
    sheets_unknown: unknown.length,
    project_rows: allRows.length,
    rows_with_flags: allRows.filter((row) => row.flags.length).length,
    rows_without_identifier: allRows.filter((row) => row.match.capp === null).length,
  },
  sheets,
  excluded,
  unknown_sheets: unknown,
};

if (outputPath) {
  writeJson(projectRoot, outputPath, output);
}

// --- Human-readable summary --------------------------------------------------

console.log("Workbook : " + config.workbook);
console.log("Dates    : current " + config.report_date + "  |  previous " + config.previous_report_date + "  (both assigned, not observed)");
console.log("");
console.log("  SHEET                        KIND         HEADER  ROWS  SKIPPED  FLAGGED");
for (const sheet of sheets) {
  const flagged = sheet.rows.filter((row) => row.flags.length).length;
  console.log("  " + sheet.sheet.padEnd(28) + String(sheet.kind).padEnd(13)
    + String(sheet.header_row ?? "-").padStart(6)
    + String(sheet.row_count).padStart(6)
    + String(sheet.skipped.length).padStart(9)
    + String(flagged).padStart(9));
  for (const header of sheet.unmapped_headers || []) {
    console.log("      ! unmapped column " + header.column + ': "' + header.header + '"');
  }
}
console.log("");
for (const sheet of excluded) {
  console.log("  EXCLUDED " + sheet.sheet.padEnd(28) + "~" + String(sheet.approximate_rows ?? "?").padStart(4) + " rows  — " + sheet.reason);
}
for (const sheet of unknown) {
  console.log("  UNKNOWN SHEET (not classified, not parsed): " + sheet);
}
console.log("");
console.log("  project rows            " + output.totals.project_rows);
console.log("  rows with flags         " + output.totals.rows_with_flags);
console.log("  rows without CAPP/init  " + output.totals.rows_without_identifier);
if (outputPath) console.log("\nWrote " + outputPath);
