// Stage 1 of the Central City photo migration: turn the DN.LagosPM.com export
// into a normalised manifest the migration step can apply.
//
//   node scripts/central-city-manifest.mjs \
//     --export CentralCity_Transfer \
//     --out .central-city-import/manifest.json
//
// READ ONLY with respect to the export. It opens no database connection, makes
// no network call, and never writes inside --export. Its only contract is to
// represent what the CSV says and to fail loudly when a row cannot be mapped.
//
// It decides nothing about insert-vs-update: that needs the tracker's current
// state and belongs to scripts/migrate-central-city-photos.mjs. Keeping the two
// apart is what makes this stage reproducible without credentials.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { writeJson } from "./workbook/io.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const exportDir = resolve(projectRoot, arg("export", "CentralCity_Transfer"));
const outputPath = arg("out", ".central-city-import/manifest.json");
const csvPath = join(exportDir, "CentralCity_Photos_Metadata.csv");
const photoDir = join(exportDir, "photos");

// The tracker column widths, from photoMetadata() in worker/enhanced-api.js.
// Enforced here rather than at apply time so an over-long value is visible in
// the manifest review instead of surfacing as a 400 the first time somebody
// edits that photo in the UI.
const CAPTION_MAX = 500;
const NOTES_MAX = 4000;
const TEXT_MAX = 200;

// --- CSV ---------------------------------------------------------------------
// RFC 4180: quoted fields may contain commas, doubled quotes and newlines. The
// export uses all three, so a split(",") reader would corrupt 20-odd rows.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') { field += c; continue; }
      if (text[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const isBlank = (v) => v === undefined || v === null || v === "" || v === "NULL";

// Deterministic v5 UUID so a re-run proposes the same id for the same photo and
// the INSERT stays idempotent. The existing four rows do not use this scheme —
// they keep whatever id they already hold, because they are updated in place.
const UUID_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"; // RFC 4122 URL namespace
function uuid5(name) {
  const hash = createHash("sha1");
  hash.update(Buffer.from(UUID_NAMESPACE.replace(/-/g, ""), "hex"));
  hash.update(Buffer.from(name, "utf8"));
  const h = hash.digest();
  h[6] = (h[6] & 0x0f) | 0x50;            // version 5
  h[8] = (h[8] & 0x3f) | 0x80;            // RFC 4122 variant
  const hex = h.subarray(0, 16).toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}

// A caption over the column width is trimmed at the last sentence break that
// fits, and the untrimmed text is preserved in `notes`. Nothing is discarded:
// the full wording stays readable in the record, and the caption stays editable
// through the UI, which rejects anything longer than 500.
function splitCaption(description) {
  const full = clean(description);
  if (full.length <= CAPTION_MAX) return { caption: full, overflow: null };
  const window = full.slice(0, CAPTION_MAX);
  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  const cut = sentence > CAPTION_MAX * 0.5 ? sentence + 1 : window.lastIndexOf(" ");
  return { caption: full.slice(0, cut).trim(), overflow: full };
}

// --- Run ---------------------------------------------------------------------

for (const [label, path] of [["CSV", csvPath], ["photos directory", photoDir]]) {
  if (!existsSync(path)) {
    console.error(`ERROR: ${label} not found at ${path}`);
    process.exit(1);
  }
}

const rows = parseCsv(readFileSync(csvPath, "utf8"));
const header = rows[0].map((h) => h.trim());
const records = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));

const filesOnDisk = new Set(readdirSync(photoDir).filter((f) => /\.jpe?g$/i.test(f)));
const entries = [];
const problems = [];
const seen = new Map();

for (const [index, record] of records.entries()) {
  const line = index + 2;                               // 1-based, after the header
  const number = clean(record.photoNumber);
  const where = `CSV line ${line}` + (number ? ` (${number})` : "");

  if (!number) { problems.push(`${where}: no photoNumber; a photo cannot be identified without one.`); continue; }
  if (seen.has(number)) { problems.push(`${where}: duplicate photoNumber, first seen on line ${seen.get(number)}.`); continue; }
  seen.set(number, line);

  // Files were renamed to the photo number during export; the CSV `fileName`
  // column still holds the source system's GUID and matches nothing on disk.
  // Mapping is therefore by photo number, and the GUID is kept as provenance.
  const file = [number + ".jpg", number + ".jpeg", number + ".JPG"].find((f) => filesOnDisk.has(f));
  if (!file) { problems.push(`${where}: no image file named after this photo number in ${photoDir}.`); continue; }

  const day = clean(record.dateTaken).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { problems.push(`${where}: dateTaken "${record.dateTaken}" is not a YYYY-MM-DD date.`); continue; }

  const { caption, overflow } = splitCaption(record.description);
  if (!caption) problems.push(`${where}: description is empty.`);

  for (const [field, value] of [["TakenBy", record.TakenBy], ["area", record.area], ["category", record.category]]) {
    if (clean(value).length > TEXT_MAX) problems.push(`${where}: ${field} exceeds ${TEXT_MAX} characters.`);
  }
  if (overflow && overflow.length > NOTES_MAX) problems.push(`${where}: description exceeds the ${NOTES_MAX}-character notes column.`);

  const id = uuid5("https://dn.lagospm.com/central-city/photo/" + number);
  entries.push({
    photo_number: number,
    file,
    absolute_path: join(photoDir, file),
    bytes: statSync(join(photoDir, file)).size,
    mime: "image/jpeg",
    kind: "progress",
    // Both dates come from the one column the export provides. reporting_period
    // is what the gallery's week filter groups on; date_taken is the record.
    reporting_period: day,
    date_taken: day,
    taken_by: clean(record.TakenBy),
    area: clean(record.area),
    category: clean(record.category),
    caption,
    // Empty unless the caption had to be trimmed. The migration step never
    // overwrites an existing non-empty notes value with an empty one, so the
    // day narrative already on the four imported photos survives.
    notes: overflow || "",
    include_in_report: clean(record.includeInReport) === "1" ? 1 : 0,
    proposed_id: id,
    // Columns the tracker has nowhere to put. Carried into audit_log.details by
    // the migration step so the provenance is not simply dropped.
    source: {
      photo_id: clean(record.photoID),
      file_name: clean(record.fileName),
      project_id: clean(record.projectID),
      latitude: isBlank(record.LATITUDE) ? null : clean(record.LATITUDE),
      longitude: isBlank(record.LONGITUDE) ? null : clean(record.LONGITUDE),
      drawing_link: isBlank(record.Drawing_Link) ? null : clean(record.Drawing_Link),
    },
  });
}

const orphans = [...filesOnDisk].filter((f) => !seen.has(f.replace(/\.jpe?g$/i, "")));
for (const f of orphans) problems.push(`${f}: image on disk with no CSV row; it would not be imported.`);

const manifest = {
  generated_from: csvPath.replace(projectRoot + "/", ""),
  photo_directory: photoDir.replace(projectRoot + "/", ""),
  project: { venue: "CENTRAL CITY", name: "New Construction Complex" },
  totals: {
    csv_rows: records.length,
    images_on_disk: filesOnDisk.size,
    mapped: entries.length,
    captions_trimmed: entries.filter((e) => e.notes).length,
    with_coordinates: entries.filter((e) => e.source.latitude).length,
    bytes: entries.reduce((t, e) => t + e.bytes, 0),
    reporting_periods: [...new Set(entries.map((e) => e.reporting_period))].sort(),
  },
  problems,
  photos: entries,
};

// --- Report ------------------------------------------------------------------

console.log("Export   : " + exportDir.replace(projectRoot + "/", ""));
console.log("CSV rows : " + records.length + "   images on disk: " + filesOnDisk.size + "   mapped: " + entries.length);
console.log("");
console.log("  FIELD MAPPING (CSV -> project_photos)");
for (const [from, to] of [
  ["photoNumber", "photo_number"], ["dateTaken", "reporting_period + date_taken"],
  ["description", "caption (>500 spills to notes)"], ["TakenBy", "taken_by"],
  ["area", "area"], ["category", "category"], ["includeInReport", "include_in_report"],
  ["photoID / fileName / LAT / LONG", "audit_log.details (no column)"],
  ["Drawing_Link", "dropped — empty on every row"],
]) console.log("    " + from.padEnd(34) + " -> " + to);

console.log("");
console.log("  PER REPORTING PERIOD");
const byPeriod = {};
for (const e of entries) byPeriod[e.reporting_period] = (byPeriod[e.reporting_period] || 0) + 1;
for (const [period, count] of Object.entries(byPeriod).sort()) {
  console.log("    " + period + "  " + String(count).padStart(3) + " photos");
}

console.log("");
console.log("  totals          " + entries.length + " photos, " + (manifest.totals.bytes / 1048576).toFixed(1) + " MiB");
console.log("  captions trimmed " + manifest.totals.captions_trimmed + " (full text kept in notes)");
console.log("  with coordinates " + manifest.totals.with_coordinates + " (recorded in the audit entry)");

if (problems.length) {
  console.log("\n  PROBLEMS (" + problems.length + ") — resolve before migrating:");
  for (const p of problems) console.log("    ! " + p);
} else {
  console.log("\n  No problems: every CSV row mapped to an image and every value fits its column.");
}

const written = writeJson(projectRoot, outputPath, manifest);
console.log("\nWrote " + written.replace(projectRoot + "/", ""));
if (problems.length) process.exit(1);
