// Runtime serializers for the same read-only project-register snapshot in all formats.
// No external service, macros, formulas or links are included in downloaded workbooks.
export const EXPORT_FORMATS = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
};

export function projectExportData(projects) {
  const headers = [
    "Source Order", "Source Sheet", "Business Unit", "Major Project", "Project", "CAPP #",
    "Type", "PM / Lead", "Status", "Budget Risk", "Schedule Risk", "A&E / Pre-Con CAPP",
    "Construction CAPP", "Add-CAPP", "Total Approved Budget", "Anticipated Final Cost",
    "Budget Variance", "% Variance", "Original Start", "Current Start", "Original Turnover",
    "Current Turnover", "Duration Change", "Activity Update", "Previous Activity Update",
    "Development Request Date", "Development Requestor", "Development Deliverable Due Date",
    "Development Consultants", "Food Service Design", "Design CAPP", "Subsidiary / Biz Dev Expense",
    "Development Original Estimate", "Original Estimate Date", "Development Current Estimate",
    "Current Estimate Date", "Promoted At", "Promoted By",
  ];
  const rows = projects.map(p => {
    const variance = p.approved_budget == null || p.anticipated_final_cost == null ? null : Number(p.anticipated_final_cost) - Number(p.approved_budget);
    const percent = variance == null || !Number(p.approved_budget) ? null : variance / Number(p.approved_budget);
    return [
      p.source_sort_order, p.source_sheet, p.business_unit, p.section_name || p.venue, p.name,
      p.capp_number || p.initiative_number, p.project_type, p.project_manager || p.development_lead,
      p.status, p.budget_risk, p.schedule_risk, p.precon_capp, p.construction_capp, p.add_capp,
      p.approved_budget, p.anticipated_final_cost, variance, percent, p.original_start_date,
      p.current_start_date, p.original_turnover_date, p.current_turnover_date,
      p.duration_change_days, p.current_update, p.previous_update,
      p.development_request_date, p.development_requestor, p.development_deliverable_due_date,
      p.development_consultants, p.development_food_service_design, p.development_design_capp,
      p.development_subsidiary_expense_total, p.development_original_estimate,
      p.development_original_estimate_date, p.development_current_estimate,
      p.development_current_estimate_date, p.development_promoted_at, p.development_promoted_by,
    ];
  });
  return { headers, rows };
}

export function delimitedExport(data, delimiter) {
  if (delimiter !== "," && delimiter !== "\t") throw new Error("Unsupported delimiter");
  function cell(value) {
    if (value == null) return "";
    let text = String(value);
    // Quoting alone does not prevent spreadsheet formula injection. Only text
    // gets a protective apostrophe; actual negative numeric amounts stay numeric.
    if (typeof value === "string" && (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r]/.test(text))) text = "'" + text;
    return text.includes(delimiter) || /["\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }
  // UTF-8 BOM helps Excel detect accented names, smart quotes and other Unicode.
  return "\uFEFF" + [data.headers, ...data.rows].map(row => row.map(cell).join(delimiter)).join("\r\n");
}

function xmlText(value) {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/_x([0-9a-f]{4})_/gi, "_x005F_x$1_")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("\r", "&#13;");
}
function columnName(index) {
  let name = "";
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}

// Small uncompressed ZIP writer, using only Workers-compatible web APIs. Each
// member has CRC32 and UTF-8 names; sizes/offsets are validated below by tests.
function zipMembers(members) {
  const encoder = new TextEncoder(), local = [], central = [];
  let offset = 0, centralSize = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
    return n >>> 0;
  });
  for (const [path, contents] of Object.entries(members)) {
    const name = encoder.encode(path), bytes = encoder.encode(contents);
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(12, 33, true); // ZIP epoch: 1980-01-01, not an invalid zero date.
    h.setUint32(14, crc, true); h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true);
    h.setUint16(26, name.length, true); header.set(name, 30);
    local.push(header, bytes);
    const directory = new Uint8Array(46 + name.length), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true); d.setUint16(14, 33, true); d.setUint32(16, crc, true);
    d.setUint32(20, bytes.length, true); d.setUint32(24, bytes.length, true);
    d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
    central.push(directory); centralSize += directory.length; offset += header.length + bytes.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...local, ...central, end]) { output.set(part, at); at += part.length; }
  return output;
}

export function xlsxExport(data) {
  if (data.rows.length > 1048575) throw new Error("Too many rows for one Excel sheet.");
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const relns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const money = new Set([11,12,13,14,15,16,30,31,32,34]), integers = new Set([0,22]);
  // Keep Promoted At as its original timestamp text so its time/zone is not lost.
  const dates = new Set([18,19,20,21,25,27,33,35]);
  function textCell(ref, value, style) {
    if (String(value).length > 32767) throw new Error("An activity is too long for one Excel cell. Use CSV or tab-delimited instead.");
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
  }
  function rowXml(values, row) {
    const cells = values.map((value, col) => {
      const ref = columnName(col) + row;
      if (row === 1) return textCell(ref, value, 1);
      if (value == null || value === "") return `<c r="${ref}" s="0"/>`;
      if (money.has(col) || integers.has(col) || col === 17) {
        const number = Number(value);
        if (Number.isFinite(number)) return `<c r="${ref}" s="${money.has(col) ? 2 : col === 17 ? 3 : 5}" t="n"><v>${number}</v></c>`;
      }
      if (dates.has(col) && /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(String(value))) {
        const time = Date.parse(String(value).slice(0, 10) + "T00:00:00Z");
        if (Number.isFinite(time)) return `<c r="${ref}" s="4" t="n"><v>${time / 86400000 + 25569}</v></c>`;
      }
      // Identifiers and all user-entered text are literal strings, never formulas.
      return textCell(ref, value, 0);
    }).join("");
    const lines = Math.max(1, ...values.map((v, i) => String(v ?? "").split(/\r\n|[\r\n]/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / ([23,24].includes(i) ? 60 : [3,4,28].includes(i) ? 29 : 20))), 0)));
    const height = row === 1 ? 44 : Math.min(409, Math.max(30, lines * 15 + 8));
    return `<row r="${row}" ht="${height}" customHeight="1">${cells}</row>`;
  }
  const last = columnName(data.headers.length - 1) + (data.rows.length + 1);
  const cols = data.headers.map((_, i) => `<col min="${i+1}" max="${i+1}" width="${[23,24].includes(i) ? 65 : [3,4,28].includes(i) ? 32 : i === 5 ? 16 : 23}" customWidth="1"/>`).join("");
  const worksheet = declaration + `<worksheet xmlns="${ns}"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${cols}</cols><sheetData>${[data.headers, ...data.rows].map((r,i) => rowXml(r,i+1)).join("")}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
  const styles = declaration + `<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><color rgb="FF23313A"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF063450"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="7" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zipMembers({
    "[Content_Types].xml": declaration + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels": declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": declaration + `<workbook xmlns="${ns}" xmlns:r="${relns}"><bookViews><workbookView/></bookViews><sheets><sheet name="Project Register" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relns}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles,
    "xl/worksheets/sheet1.xml": worksheet,
  });
}
