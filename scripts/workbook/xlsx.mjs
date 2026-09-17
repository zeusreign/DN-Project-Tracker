// Minimal, dependency-free .xlsx reader. READ ONLY — it never writes a file and
// never opens a database connection.
//
// WHY NOT A LIBRARY: this project has zero runtime dependencies (package.json
// declares only vite and wrangler as devDependencies), and worker/exports.js
// already hand-rolls zip *writing* for the XLSX export. Reading is the mirror of
// that, so it stays in house style and adds nothing to install or audit.
//
// Scope: enough OOXML to read the D&C bi-weekly workbook faithfully. It handles
// shared strings, inline strings, formula results, booleans and error cells. It
// deliberately does NOT parse styles.xml — see dateFromSerial() in normalise.mjs
// for why date columns are identified by their header text instead.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// --- ZIP ---------------------------------------------------------------------
// An .xlsx is a zip. Both compression methods occur in this workbook: 8
// (deflate) for the XML parts and 0 (stored) for small entries.

function findEndOfCentralDirectory(buffer) {
  // The EOCD record is at the end but may be followed by a variable-length
  // comment, so scan backwards for its signature. 22 bytes is its fixed size.
  const minimum = 22;
  const scanLimit = Math.min(buffer.length, 65535 + minimum);
  for (let i = buffer.length - minimum; i >= buffer.length - scanLimit; i--) {
    if (i >= 0 && buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("Not a zip file: no end-of-central-directory record found.");
}

function readCentralDirectory(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Corrupt zip: bad central directory signature at " + offset);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer, entry) {
  // The local header repeats the name and carries its own extra field, whose
  // length routinely differs from the central directory's. The data therefore
  // starts after the LOCAL header, which has to be re-read here — using the
  // central directory's lengths is a classic way to read a few bytes off.
  const { localOffset, method, compressedSize } = entry;
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error("Corrupt zip: bad local header signature at " + localOffset);
  }
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + compressedSize);
  if (method === 0) return raw;
  if (method === 8) return inflateRawSync(raw);
  throw new Error("Unsupported zip compression method: " + method);
}

// --- XML ---------------------------------------------------------------------
// Regex extraction rather than a parser. Acceptable here because the input is
// machine-generated OOXML with a known, narrow shape; it is not a general XML
// reader and should not be reused as one.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlText(value) {
  if (!value) return "";
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code) => {
    if (code[0] === "#") {
      const point = code[1] === "x" || code[1] === "X"
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return Object.hasOwn(ENTITIES, code) ? ENTITIES[code] : match;
  });
}

// Concatenates every <t> in a fragment. Shared strings may be split across
// several runs when part of a cell is formatted differently; joining them is
// what reproduces the author's original wording.
function textOf(fragment) {
  let out = "";
  for (const match of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    out += decodeXmlText(match[1]);
  }
  return out;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp("\\s" + name + '="([^"]*)"'));
  return match ? decodeXmlText(match[1]) : null;
}

// --- Workbook ----------------------------------------------------------------

export function readWorkbook(path) {
  const buffer = readFileSync(path);
  const entries = readCentralDirectory(buffer);

  const part = (name) => {
    const entry = entries.get(name);
    if (!entry) return null;
    return readEntry(buffer, entry).toString("utf8");
  };

  const sharedStrings = [];
  const sharedXml = part("xl/sharedStrings.xml");
  if (sharedXml) {
    for (const match of sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
      sharedStrings.push(textOf(match[1]));
    }
  }

  // Sheet name -> part path, resolved through the workbook relationships.
  const relationships = new Map();
  const relsXml = part("xl/_rels/workbook.xml.rels") || "";
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attribute(match[0], "Id");
    let target = attribute(match[0], "Target");
    if (!id || !target) continue;
    if (!target.startsWith("/")) target = "xl/" + target.replace(/^\.?\//, "");
    relationships.set(id, target.replace(/^\//, ""));
  }

  const sheets = [];
  const workbookXml = part("xl/workbook.xml") || "";
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attribute(match[0], "name");
    const relationId = attribute(match[0], "r:id") || attribute(match[0], "id");
    const target = relationships.get(relationId);
    if (name && target) sheets.push({ name, path: target });
  }

  return {
    sheetNames: sheets.map((sheet) => sheet.name),
    rows(sheetName) {
      const sheet = sheets.find((candidate) => candidate.name === sheetName);
      if (!sheet) throw new Error("No such worksheet: " + sheetName);
      const xml = part(sheet.path);
      if (xml === null) throw new Error("Worksheet part missing: " + sheet.path);
      return parseRows(xml, sharedStrings);
    },
  };
}

// Yields { number, cells } where cells maps a column letter to a cell object.
// Empty cells are omitted entirely rather than stored as nulls, so "which
// columns are populated" stays a simple key count — that test is what separates
// a venue heading row from a project row.
function parseRows(xml, sharedStrings) {
  // The attribute class MUST be lazy. With a greedy `[^>]*`, a self-closing
  // `<c r="A3" s="1"/>` has its trailing slash absorbed as an attribute
  // character; the alternation then matches the plain `>` branch and captures
  // the FOLLOWING cell's contents as this cell's value. The symptom is columns
  // shifted one to the left and shared-string indexes surfacing as raw numbers.
  // Empty cells are self-closing throughout this workbook, so this is the
  // difference between reading it correctly and reading it entirely wrong.
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const number = Number(attribute("<row" + rowMatch[1] + ">", "r"));
    const body = rowMatch[2] || "";
    const cells = {};
    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = "<c" + cellMatch[1] + ">";
      const reference = attribute(tag, "r") || "";
      const column = (reference.match(/^[A-Z]+/) || [""])[0];
      if (!column) continue;
      const type = attribute(tag, "t");
      const inner = cellMatch[2] || "";
      const cell = readCell(type, inner, sharedStrings);
      if (cell !== null) cells[column] = cell;
    }
    if (Object.keys(cells).length) rows.push({ number, cells });
  }
  return rows;
}

// Cell types seen in this workbook: s (shared string), str (formula result),
// e (error), and the default numeric. inlineStr and b are handled defensively
// because a future workbook may contain them.
function readCell(type, inner, sharedStrings) {
  if (type === "inlineStr") {
    const text = textOf(inner).trim();
    return text ? { kind: "text", value: text } : null;
  }
  const valueMatch = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
  if (!valueMatch) return null;
  const raw = decodeXmlText(valueMatch[1]);

  if (type === "s") {
    const text = (sharedStrings[Number(raw)] ?? "").trim();
    return text ? { kind: "text", value: text } : null;
  }
  if (type === "str") {
    const text = raw.trim();
    return text ? { kind: "text", value: text } : null;
  }
  if (type === "e") {
    // #REF! and #VALUE! appear in the formula columns. Surfaced rather than
    // swallowed, so the reconciliation report can show what was unreadable.
    return { kind: "error", value: raw.trim() };
  }
  if (type === "b") return { kind: "boolean", value: raw === "1" };

  const number = Number(raw);
  return Number.isFinite(number) ? { kind: "number", value: number } : null;
}
