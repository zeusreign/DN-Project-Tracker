// Value normalisers shared by the parser and, later, the reconciliation matcher.
// Every function is pure: same input, same output, no I/O.
//
// Normalised values exist ONLY for comparison. The raw workbook wording is
// always carried alongside and is what gets written to the tracker — the import
// must never rewrite a project manager's note.

// --- Text --------------------------------------------------------------------

// Outer whitespace only. Internal newlines and double spaces are part of the
// author's wording: GAMING row 5 holds two dates across a line break, and the
// update columns are full of deliberate line breaks.
export function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

// For equality tests, never for storage. Collapses whitespace and case so that
// "Await a schedule.  Permit pulled." matches "Await a schedule. Permit pulled."
export function comparableText(value) {
  const text = cleanText(value);
  return text ? text.replace(/\s+/g, " ").toLowerCase() : null;
}

// --- CAPP / initiative numbers -----------------------------------------------

// Placeholders that mean "no number assigned yet". Treating these as real values
// is the single biggest matching hazard in this dataset: six tracker projects
// share the literal string "TBD", so a naive match on the raw cell joins all six
// to each other.
const CAPP_PLACEHOLDERS = new Set([
  "", "TBD", "T.B.D.", "N/A", "NA", "NONE", "NON CAPP", "NON-CAPP",
  "NONCAPP", "NON CAPITAL", "NON-CAPITAL",
]);

export function isCappPlaceholder(value) {
  const text = cleanText(value);
  if (text === null) return true;
  return CAPP_PLACEHOLDERS.has(text.toUpperCase().replace(/\s+/g, " "));
}

// Uppercase, strip leading zeros, drop placeholders. Under this rule the
// September 11 workbook and the tracker each hold 45 usable numbers with zero
// collisions on either side, which is what makes CAPP the primary match key.
// Returns null when there is no usable number, so callers fall through to the
// name-based key rather than matching on an empty string.
export function normaliseCapp(value) {
  if (isCappPlaceholder(value)) return null;
  const text = cleanText(value).toUpperCase().replace(/\s+/g, "");

  // Spreadsheet numerics reach storage as floats. The tracker holds initiative
  // "8608.0" for Lincoln Ristorante where this workbook says "8608" — a single
  // row, but the one that decides whether a real project is matched or
  // duplicated. Collapsing any purely numeric identifier through Number makes
  // the two forms meet, and also subsumes the leading-zero case ("08312" ->
  // "8312"). Identifiers carrying a letter or separator ("08650A") fall through
  // to the string rule below, because Number would destroy them.
  if (/^\d{1,15}(\.\d+)?$/.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) return String(number);
  }

  const stripped = text.replace(/^0+(?=.)/, "");
  return stripped || null;
}

// --- Project names -----------------------------------------------------------

// Punctuation and spacing are unreliable across reports ("Refurb & Fire Rating"
// vs "Refurb and Fire Rating" is a real difference between cycles), so the
// comparison form keeps letters and digits only.
export function normaliseName(value) {
  const text = cleanText(value);
  if (text === null) return null;
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || null;
}

// --- Dates -------------------------------------------------------------------

// Excel serials count days from 1899-12-30 (the epoch that reproduces Excel's
// deliberate 1900 leap-year bug for every date after 1900-03-01).
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

// Date columns are identified by their HEADER TEXT, not by cell style, so
// styles.xml never has to be parsed. That also means a cell holding the literal
// "TBD" arrives here as text: 20 rows across GAMING, PARKS and PATINA do exactly
// that, and one GAMING cell holds two dates across a line break. Those are
// returned as { date: null, raw, unparsed: true } — never coerced into a date.
export function dateFromSerial(cell) {
  if (!cell) return { date: null, raw: null, unparsed: false };
  if (cell.kind === "error") {
    return { date: null, raw: cell.value, unparsed: true };
  }
  if (cell.kind === "number") {
    const serial = cell.value;
    // Guard the plausible range: 1 is 1899-12-31, 60000 is well past 2060.
    if (!Number.isFinite(serial) || serial < 1 || serial > 60000) {
      return { date: null, raw: String(serial), unparsed: true };
    }
    const whole = Math.floor(serial);
    const iso = new Date(EXCEL_EPOCH_UTC + whole * 86400000)
      .toISOString()
      .slice(0, 10);
    return { date: iso, raw: String(serial), unparsed: false };
  }
  const text = cleanText(cell.value);
  return { date: null, raw: text, unparsed: text !== null };
}

// --- Risk --------------------------------------------------------------------

// The workbook writes "low" and "medium" in lower case; the tracker stores
// title case. This is not cosmetic: summarize() in worker/index.js compares
// `p.budget_risk === "High"` exactly, so an unnormalised value would leave the
// at-risk KPI silently wrong. Blank becomes "Not Rated" because the column is
// NOT NULL DEFAULT 'Not Rated' and will reject a null.
export function normaliseRisk(value) {
  const text = cleanText(value);
  if (text === null) return "Not Rated";
  const key = text.toLowerCase();
  if (key === "high") return "High";
  if (key === "medium" || key === "med") return "Medium";
  if (key === "low") return "Low";
  return "Not Rated";
}

// --- Status ------------------------------------------------------------------

// Development tab vocabulary -> tracker vocabulary. The capital tabs carry no
// status column at all; capital status is tracker-side state maintained by
// people and must never be inferred from a workbook.
export function normaliseDevelopmentStatus(value) {
  const text = cleanText(value);
  if (text === null) return "Needs Status";
  const key = text.toLowerCase();
  if (key === "active") return "Active";
  if (key === "hold" || key === "on hold" || key === "holding") return "On Hold";
  if (key === "complete" || key === "completed") return "Complete";
  if (key === "dead") return "Dead";
  return "Needs Status";
}

// --- Money -------------------------------------------------------------------

export function normaliseMoney(cell) {
  if (!cell) return null;
  if (cell.kind === "number") return Number.isFinite(cell.value) ? cell.value : null;
  if (cell.kind === "error") return null;
  const text = cleanText(cell.value);
  if (text === null) return null;
  // "N/A" appears in the pre-con column on at least one PATINA row.
  const stripped = text.replace(/[$,\s]/g, "");
  const number = Number(stripped);
  return Number.isFinite(number) ? number : null;
}
