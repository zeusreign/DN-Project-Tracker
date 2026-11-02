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
  // Place Activity immediately after CAPP and PM in the flat register too.
  const order=[0,1,2,3,4,5,7,23,24,6,...Array.from({length:15},(_,i)=>i+8),...Array.from({length:13},(_,i)=>i+25)];
  return {headers:order.map(i=>headers[i]),rows:rows.map(r=>order.map(i=>r[i]))};
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
// Members may be strings or Uint8Array; byte arrays are stored verbatim so that
// binary members are not corrupted by text encoding.
export function zipMembers(members) {
  const encoder = new TextEncoder(), local = [], central = [];
  let offset = 0, centralSize = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
    return n >>> 0;
  });
  for (const [path, contents] of Object.entries(members)) {
    const name = encoder.encode(path);
    const bytes = contents instanceof Uint8Array ? contents : encoder.encode(contents);
    // Indexed loop rather than for..of: this runs over every byte of every
    // member and the iterator form costs several times more CPU, which matters
    // against the Workers per-request CPU limit.
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
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
  const sheets = data.sheets || [{...data,name:'Project Register'}];
  if(sheets.length>100)throw new Error('Too many sheets');
  function columnType(sheet,col) {
    if(sheet.columnTypes)return sheet.columnTypes[col];
    const header=sheet.headers[col];
    if(['A&E / Pre-Con CAPP','Construction CAPP','Add-CAPP','Total Approved Budget','Anticipated Final Cost','Budget Variance','Subsidiary / Biz Dev Expense','Development Original Estimate','Development Current Estimate'].includes(header))return 'money';
    if(header==='% Variance')return 'percent';
    if(['Source Order','Duration Change'].includes(header))return 'integer';
    if(['Original Start','Current Start','Original Turnover','Current Turnover','Development Request Date','Development Deliverable Due Date','Original Estimate Date','Current Estimate Date'].includes(header))return 'date';
    return 'text';
  }
  function columnWidth(sheet,col){return sheet.widths?.[col]||(/Activity Update/.test(sheet.headers[col])?65:['Major Project','Project','Development Consultants'].includes(sheet.headers[col])?32:23);}
  function textCell(ref, value, style) {
    if (String(value).length > 32767) throw new Error("An activity is too long for one Excel cell. Use CSV or tab-delimited instead.");
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
  }
  const font=(bold=false,color='FF000000',size=11)=>`<font>${bold?'<b/>':''}<sz val="${size}"/><color rgb="${color}"/><name val="Calibri"/></font>`;
  const fill=color=>`<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`;
  const xf=(num=0,fontId=0,fillId=0,borderId=0,align='left',wrap=true)=>`<xf numFmtId="${num}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="${align}"${wrap?' wrapText="1"':''}/></xf>`;
  const cellStyles=[
    xf(),xf(0,1,2,0,'center'),xf(7,0,0,0,'right',false),xf(10,0,0,0,'right',false),xf(14),xf(3,0,0,0,'right',false),
    xf(0,2,3),xf(0,2,4),xf(0,2,0,1,'center').replace('vertical="top"','vertical="center"'),xf(0,3,0,1,'center').replace('vertical="top"','vertical="center"'),
    xf(0,0,0,1),xf(164,0,0,1,'right',false),xf(165,0,0,1,'right',false),xf(166,0,0,1,'center',false),xf(3,0,0,1,'right',false),xf(49,0,0,1,'center'),xf(164,0,5,1,'right',false),xf(0,2,0,1),xf(164,2,0,1,'right',false)
  ];
  const fonts=[font(),font(true,'FFFFFFFF'),font(true),font(true,'FF305496')];
  const fills=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>',fill('FF063450'),fill('FF9BC2E6'),fill('FFFF0000'),fill('FFE7E6E6')];
  const variants=new Map();
  function appearanceStyle(base,appearance={}) {
    const valid=c=>/^#[0-9a-f]{6}$/i.test(c||'');
    if(!valid(appearance.fill)&&!valid(appearance.color)&&appearance.align!=='center')return base;
    const key=base+'|'+(appearance.fill||'')+'|'+(appearance.color||'')+'|'+(appearance.align||'');
    if(variants.has(key))return variants.get(key);
    let xml=cellStyles[base];
    if(appearance.align==='center')xml=xml.replace(/horizontal="[^"]+"/,'horizontal="center"');
    if(valid(appearance.fill)){
      const value=fill('FF'+appearance.fill.slice(1).toUpperCase());let id=fills.indexOf(value);
      if(id<0){id=fills.length;fills.push(value);}xml=xml.replace(/fillId="\d+"/,'fillId="'+id+'"');
    }
    if(valid(appearance.color)){
      const original=Number(xml.match(/fontId="(\d+)"/)[1]);
      const value=font(fonts[original].includes('<b/>'),'FF'+appearance.color.slice(1).toUpperCase());let id=fonts.indexOf(value);
      if(id<0){id=fonts.length;fonts.push(value);}xml=xml.replace(/fontId="\d+"/,'fontId="'+id+'"');
    }
    const id=cellStyles.length;cellStyles.push(xml);variants.set(key,id);return id;
  }
  function rowXml(values, row, sheet, kind = row===1?"header":"data", appearances=[]) {
    const cells = values.map((value, col) => {
      const ref = columnName(col) + row;
      if (kind === 'section') return textCell(ref, value ?? '', appearanceStyle(6,appearances[col]));
      if (kind === "header") return textCell(ref, value, sheet.grouped?(sheet.kind==='development'?9:8):1);
      const baseStyle=appearanceStyle(sheet.grouped?(kind==='total'?17:col===1||sheet.headers[col]==='CAPP / Initiative #'?15:10):0,appearances[col]);
      if (value == null || value === "") return `<c r="${ref}" s="${baseStyle}"/>`;
      const type=columnType(sheet,col);
      if (["money","integer","percent"].includes(type)) {
        const number = Number(value);
        if (Number.isFinite(number)) return `<c r="${ref}" s="${appearanceStyle(sheet.grouped?(kind==='total'?18:type==='money'?11:type==='percent'?12:14):(type === "money" ? 2 : type === "percent" ? 3 : 5),appearances[col])}" t="n"><v>${number}</v></c>`;
      }
      if (type === "date" && /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(String(value))) {
        const time = Date.parse(String(value).slice(0, 10) + "T00:00:00Z");
        if (Number.isFinite(time)) return `<c r="${ref}" s="${appearanceStyle(sheet.grouped?13:4,appearances[col])}" t="n"><v>${time / 86400000 + 25569}</v></c>`;
      }
      // Identifiers and all user-entered text are literal strings, never formulas.
      return textCell(ref, value, baseStyle);
    }).join("");
    const lines = Math.max(1, ...values.map((v, i) => String(v ?? "").split(/\r\n|[\r\n]/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / (columnWidth(sheet,i)-3))), 0)));
    const height = kind === "section" || kind === "total" ? 26 : kind === "header" ? (sheet.grouped?60:44) : Math.min(409, Math.max(30, lines * 15 + 8));
    return `<row r="${row}" ht="${height}" customHeight="1">${cells}</row>`;
  }
  const worksheets=sheets.map(sheet=>{
    if(sheet.rows.length>1048575)throw new Error('Too many rows');
    const entries=[{kind:'header',values:sheet.headers}];
    const sections=new Map((sheet.sections||[]).map(s=>[s.index,s]));
    sheet.rows.forEach((values,i)=>{
      if(sections.has(i))entries.push({kind:'section',values:sheet.headers.map((_,j)=>j===0?sections.get(i).label:null),appearances:sheet.headers.map(()=>sections.get(i).style)});
      entries.push({kind:'data',values,appearances:sheet.cellStyles?.[i]});
    });
    if(sheet.total)entries.push({kind:'total',values:sheet.total,appearances:sheet.totalStyles});
    const last = columnName(sheet.headers.length - 1) + entries.length;
    const cols=sheet.headers.map((_,i)=>`<col min="${i+1}" max="${i+1}" width="${columnWidth(sheet,i)}" customWidth="1"/>`).join('');
    const freeze=sheet.freezeColumns||0, cell=columnName(freeze)+'2',pane=freeze?'bottomRight':'bottomLeft';
    const printTitle=sheet.grouped?' showGridLines="0"':'';
    return declaration + `<worksheet xmlns="${ns}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"${printTitle}><pane ${freeze?`xSplit="${freeze}" `:''}ySplit="1" topLeftCell="${cell}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${cell}" sqref="${cell}"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${cols}</cols><sheetData>${entries.map((r,i) => rowXml(r.values,i+1,sheet,r.kind,r.appearances)).join("")}</sheetData>${sheet.autoFilter===false?'':`<autoFilter ref="A1:${last}"/>`}<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  });
  const styles = declaration + `<styleSheet xmlns="${ns}"><numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0;(&quot;$&quot;#,##0)"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="mm/dd/yy"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="hair"><color rgb="FFD9D9D9"/></left><right style="hair"><color rgb="FFD9D9D9"/></right><top style="hair"><color rgb="FFD9D9D9"/></top><bottom style="hair"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${cellStyles.length}">${cellStyles.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const members={
    "[Content_Types].xml": declaration + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": declaration + `<workbook xmlns="${ns}" xmlns:r="${relns}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${xmlText(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${relns}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="${relns}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles,
  };
  worksheets.forEach((xml,i)=>members['xl/worksheets/sheet'+(i+1)+'.xml']=xml);
  return zipMembers(members);
}
