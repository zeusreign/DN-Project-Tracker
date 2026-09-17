// Regression test for the workbook parser.
//
//   node scripts/workbook-parse-test.mjs
//
// The expected values below are not invented: they were established by an
// independent read-only investigation of the September 11 workbook and the live
// tracker, before this parser existed. If a change to the reader makes these
// drift, the reader is wrong.
//
// This exists because the first version of the reader WAS wrong in a way the
// totals nearly hid. Its cell regex used a greedy attribute class, so a
// self-closing `<c .../>` swallowed the following cell: columns shifted one to
// the left and shared-string indexes surfaced as raw numbers. The sheet still
// parsed and still produced plausible-looking rows.
//
// The workbook is client working material and is gitignored, so this test skips
// cleanly when the file is absent rather than failing a clean checkout.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "./workbook/xlsx.mjs";
import { SHEETS, findHeader, developmentUnitFor } from "./workbook/layout.mjs";
import { normaliseCapp, normaliseRisk, dateFromSerial, normaliseName } from "./workbook/normalise.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workbookPath = resolve(projectRoot, "2026_0911 D&C Bi-Weekly Report Data.xlsx");

// --- Pure normaliser tests (always run) --------------------------------------

// Placeholders must become null. Six tracker projects share the literal "TBD";
// treating it as a real identifier joins all six to each other.
for (const placeholder of ["TBD", "tbd", "N/A", "NON CAPP", "Non-Capital", "", "  "]) {
  assert.equal(normaliseCapp(placeholder), null, `"${placeholder}" must not be a usable CAPP`);
}
assert.equal(normaliseCapp("08312"), "8312", "leading zeros are stripped");
assert.equal(normaliseCapp("8312"), "8312", "unpadded form matches the padded one");
assert.equal(normaliseCapp("08650A"), "8650A", "suffixed numbers survive");

// The server compares `p.budget_risk === "High"` exactly, so case matters.
assert.equal(normaliseRisk("low"), "Low");
assert.equal(normaliseRisk("medium"), "Medium");
assert.equal(normaliseRisk("High"), "High");
assert.equal(normaliseRisk(null), "Not Rated", "blank must not become null: the column is NOT NULL");

// Excel serials count from 1899-12-30.
assert.equal(dateFromSerial({ kind: "number", value: 46195 }).date, "2026-06-22");
assert.equal(dateFromSerial({ kind: "number", value: 46327 }).date, "2026-11-01");
// A literal "TBD" in a date column must never be coerced into a date.
const tbd = dateFromSerial({ kind: "text", value: "TBD" });
assert.equal(tbd.date, null);
assert.equal(tbd.unparsed, true);
assert.equal(tbd.raw, "TBD", "the original cell text is preserved for review");

assert.equal(normaliseName("Refurb & Fire Rating"), "refurb and fire rating");
assert.equal(developmentUnitFor("PARKS & RESORTS"), "Parks & Resorts");
assert.equal(developmentUnitFor("Something New"), null, "an unknown heading must not be guessed");

console.log("Normalisers: OK");

if (!existsSync(workbookPath)) {
  console.log("Workbook absent (gitignored client material) — skipping parse assertions.");
  process.exit(0);
}

// --- Parse assertions --------------------------------------------------------

const book = readWorkbook(workbookPath);

// Row counts per sheet, established independently before the parser existed.
const EXPECTED_ROWS = {
  "CORP": 4, "PATINA": 4, "GAMING": 28, "PARKS": 16, "SS": 0,
  "Design & Development": 21,
};

let total = 0;
for (const [sheetName, expected] of Object.entries(EXPECTED_ROWS)) {
  const definition = SHEETS[sheetName];
  const rows = book.rows(sheetName);
  const header = findHeader(rows, definition.kind);
  assert.ok(header, `${sheetName}: header row not found`);

  const nameColumn = Object.keys(header.columns).find((l) => header.columns[l] === "name");
  let count = 0;
  for (const row of rows) {
    if (row.number <= header.row) continue;
    const mapped = Object.keys(row.cells).filter((l) => header.columns[l]);
    if (!mapped.length) continue;
    const name = row.cells[nameColumn]?.value;
    if (!name) continue;
    if (mapped.length === 1 && mapped[0] === nameColumn) continue;   // venue heading
    if (/^totals?$/i.test(String(name).trim())) continue;
    count++;
  }
  assert.equal(count, expected, `${sheetName}: expected ${expected} project rows, got ${count}`);
  total += count;
}
assert.equal(total, 73, `expected 73 project rows across all sheets, got ${total}`);

// CORP has NO Count column, so its name is in column A. Every other capital tab
// has one, so the name is in column B. This is the difference a letter-keyed
// parser gets wrong, and the reason fields are matched by header text.
const corpHeader = findHeader(book.rows("CORP"), "capital");
const gamingHeader = findHeader(book.rows("GAMING"), "capital");
assert.equal(corpHeader.columns.A, "name", "CORP: name must resolve to column A");
assert.equal(gamingHeader.columns.B, "name", "GAMING: name must resolve to column B");
assert.equal(corpHeader.columns.B, "capp_number");
assert.equal(gamingHeader.columns.C, "capp_number");

// The self-closing-cell bug specifically: row 3 of the development tab begins
// with an EMPTY column A, so B must still read as text, not as a number.
const devRow3 = book.rows("Design & Development").find((r) => r.number === 3);
assert.equal(devRow3.cells.A, undefined, "development row 3 column A is empty");
assert.equal(devRow3.cells.B.kind, "text", "column B must be a resolved shared string, not a raw index");
assert.equal(devRow3.cells.B.value, "Comerica");

// The five Via Napoli rows are separable only by scope description. This is the
// ambiguous set the reconciliation step has to surface for human review.
const devRows = book.rows("Design & Development");
const devHeader = findHeader(devRows, "development");
const scopeColumn = Object.keys(devHeader.columns).find((l) => devHeader.columns[l] === "scope_description");
const nameColumnDev = Object.keys(devHeader.columns).find((l) => devHeader.columns[l] === "name");
const viaNapoli = devRows.filter((r) => r.cells[nameColumnDev]?.value === "Via Napoli");
assert.equal(viaNapoli.length, 5, "expected 5 Via Napoli rows");
const scopes = new Set(viaNapoli.map((r) => r.cells[scopeColumn]?.value));
assert.equal(scopes.size, 5, "all five Via Napoli scopes must be distinct");

// The three approved new projects, each identified by its exact cell.
const leadColumn = Object.keys(devHeader.columns).find((l) => devHeader.columns[l] === "development_lead");
const connex = devRows.find((r) => r.number === 23);
assert.match(connex.cells[scopeColumn].value, /Connex Box/);
assert.equal(connex.cells[leadColumn].value, "Jason",
  'the Connex Box lead must stay literally "Jason" and must not be mapped to Jason Fatouros');

console.log(`Parse: OK — 73 project rows across ${Object.keys(EXPECTED_ROWS).length} sheets`);
console.log("Workbook parser test passed.");
