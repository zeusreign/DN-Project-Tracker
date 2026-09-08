// Independent format validation: requires Python with openpyxl (read-only use).
// Runs on synthetic records; never connects to the deployed database.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { projectExportData, delimitedExport, xlsxExport } from "../worker/exports.js";

const note = 'Delivery, café & equipment <review> "ready"\r\nNext step\tcheck';
const data = projectExportData([{
  source_sort_order: 1, source_sheet: "Capital", business_unit: "Gaming",
  section_name: "Sample section", name: "=1+1", capp_number: "00864",
  project_type: "capital", project_manager: "Test Lead", status: "Active",
  precon_capp: -100.25, approved_budget: 1000, anticipated_final_cost: 1200,
  original_start_date: "2026-09-04", duration_change_days: -3,
  current_update: note, previous_update: "@example", development_promoted_at: "2026-09-04T12:34:56Z",
}, {
  source_sort_order: 2, name: "Empty budget", initiative_number: "00042",
  approved_budget: 500, current_update: "+sample text",
}]);
assert.equal(data.headers.length, 38);
assert.equal(data.rows[0][16], 200);
assert.equal(data.rows[0][17], 0.2);
assert.equal(data.rows[1][16], null);
assert.equal(data.rows[1][17], null);
assert.throws(() => delimitedExport(data, "|"), /Unsupported/);
assert.throws(() => xlsxExport(projectExportData([{current_update: "x".repeat(32768)}])), /too long/);

const payload = {
  xlsx: Buffer.from(xlsxExport(data)).toString("base64"),
  empty: Buffer.from(xlsxExport(projectExportData([]))).toString("base64"),
  csv: delimitedExport(data, ","), tsv: delimitedExport(data, "\t"), note,
};
const python = String.raw`
import base64, csv, io, json, sys, zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from openpyxl import load_workbook
p = json.load(sys.stdin)
for key in ("xlsx", "empty"):
    raw = base64.b64decode(p[key])
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        assert z.testzip() is None, "ZIP CRC or offsets invalid"
        assert len(z.namelist()) == 6
        for member in z.namelist():
            ET.fromstring(z.read(member))
        assert b"<f>" not in z.read("xl/worksheets/sheet1.xml")
    book = load_workbook(io.BytesIO(raw), data_only=False)
    sheet = book["Project Register"]
    assert sheet.max_column == 38
    assert sheet.freeze_panes == "A2"
    assert sheet.auto_filter.ref == ("A1:AL3" if key == "xlsx" else "A1:AL1")
    assert sheet["A1"].font.bold
    if key == "xlsx":
        assert sheet.max_row == 3
        assert sheet["E2"].value == "=1+1" and sheet["E2"].data_type == "s"
        assert sheet["F2"].value == "00864" and sheet["F3"].value == "00042"
        assert sheet["L2"].value == -100.25 and sheet["L2"].data_type == "n"
        assert sheet["Q2"].value == 200 and sheet["R2"].value == 0.2
        assert sheet["S2"].value == datetime(2026, 9, 4)
        assert sheet["W2"].value == -3
        assert sheet["X2"].value == p["note"]
        assert sheet["AK2"].value == "2026-09-04T12:34:56Z"
        assert sheet["Y2"].value == "@example" and sheet["X3"].value == "+sample text"
        assert sheet["Q3"].value is None and sheet["R3"].value is None
        assert sheet["X2"].alignment.wrap_text
    else:
        assert sheet.max_row == 1
for key, delimiter in (("csv", ","), ("tsv", "\t")):
    assert p[key].startswith("\ufeff")
    rows = list(csv.reader(io.StringIO(p[key][1:], newline=""), delimiter=delimiter))
    assert len(rows) == 3 and all(len(row) == 38 for row in rows)
    assert rows[1][4] == "'=1+1" and rows[1][5] == "00864"
    assert rows[1][11] == "-100.25" and rows[1][22] == "-3"
    assert rows[1][23] == p["note"] and rows[1][24] == "'@example"
    assert rows[2][23] == "'+sample text" and rows[2][16:18] == ["", ""]
print("Export integrity passed: Excel reader, ZIP CRC/XML, cell types, identifiers, Unicode, multiline notes, CSV/TSV quoting, formula safety, and empty data.")
`;
const result = spawnSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON || "python3", ["-c", python], {
  input: JSON.stringify(payload), encoding: "utf8",
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
assert.equal(result.status, 0, "Independent export validation failed");
