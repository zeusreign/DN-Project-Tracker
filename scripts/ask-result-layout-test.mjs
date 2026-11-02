import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import vm from 'node:vm';
import {answer} from '../worker/ask/assistant-core.js';
import '../worker/ask/table-exports.js';
for(const file of ['pdf-lib.min.js','exceljs.min.js'])vm.runInThisContext(readFileSync(new URL('../worker/ask/vendor/'+file,import.meta.url),'utf8'));
const X=globalThis.DNCTableExports;
const rows=[
 {id:1,name:'Canyon New Dorm',capp_number:'08598',business_unit:'Parks & Resorts',venue:'YELLOWSTONE GENERAL STORES',approved_budget:16872100,anticipated_final_cost:16872100},
 {id:2,name:'Other venue project',capp_number:'002',business_unit:'Gaming',venue:'Other',approved_budget:null,anticipated_final_cost:10},
 {id:3,name:'Canyon Adventure',capp_number:'08574',business_unit:'Parks & Resorts',venue:'YELLOWSTONE GENERAL STORES',approved_budget:2853689,anticipated_final_cost:2730164},
 {id:4,name:'Same venue name, another unit',capp_number:'004',business_unit:'Gaming',venue:'YELLOWSTONE GENERAL STORES',approved_budget:0,anticipated_final_cost:0},
 {id:5,name:'Yellowstone',capp_number:null,business_unit:'Parks & Resorts',venue:'WEST YELLOWSTONE',approved_budget:null,anticipated_final_cost:null}
];
const data={meta:{snapshot_at:'2026-11-01',latest_reporting_period:'2026-10-23',source_file:'Layout QA fixture'},projects:rows,history:[],photos:[]};
const result={title:'Grouped project results',plan:{},rows,table:{columns:[{key:'approved_budget',label:'Approved budget',type:'currency'},{key:'anticipated_final_cost',label:'Anticipated cost',type:'currency'}],rows:rows.map(p=>({id:p.id,approved_budget:p.approved_budget,anticipated_final_cost:p.anticipated_final_cost})),grouped:false}};
const original=JSON.stringify(result),table=X.view(result);
assert.equal(JSON.stringify(result),original,'Presentation must not mutate saved/query results');
assert.deepEqual(table.entries.filter(e=>e.kind==='row').map(e=>e.row.id),[1,3,5,2,4]);
assert.deepEqual(table.entries.filter(e=>e.kind==='unit').map(e=>e.count),[3,2]);
assert.equal(table.entries.filter(e=>e.kind==='venue'&&e.label==='YELLOWSTONE GENERAL STORES').length,2,'Same venue name in different units stays separate');
assert.deepEqual(table.columns.map(c=>c.key),['name','capp_number','approved_budget','anticipated_final_cost']);
assert.equal(table.rows[0].capp_number,'08598');assert.equal(table.rows[1].approved_budget,null);assert.equal(table.rows[3].approved_budget,0);
const grouped={...result,table:{columns:[{key:'group',label:'Manager',type:'text'},{key:'aggregate_0',label:'Count',type:'number'}],rows:[{group:'A',aggregate_0:5}],grouped:true,totalRow:{group:'Grand total',aggregate_0:5,isTotal:true}}};
assert.equal(X.view(grouped).entries.length,2);assert.equal(X.view(grouped).hierarchical,undefined);
assert.deepEqual(answer(data,'Show Yellowstone General Stores projects in a table').rows.map(p=>p.id),[1,3,4],'Specific venue must not be replaced by short project name Yellowstone');
const bytes=await X.xlsx(data,result),wb=new globalThis.ExcelJS.Workbook();await wb.xlsx.load(bytes);
const report=wb.getWorksheet('Results'),raw=wb.getWorksheet('Source records');
assert.equal(report.getCell('A7').value,'Parks & Resorts — 3 projects');
assert.equal(report.getCell('A7').fill.fgColor.argb,'FF2D6178');
assert.equal(report.getCell('A8').value,'YELLOWSTONE GENERAL STORES — 2 projects');
assert.equal(report.getCell('A9').value,'Canyon New Dorm');assert.equal(report.getCell('B9').value,'08598');assert.equal(report.getCell('C9').value,16872100);
assert.equal(raw.rowCount,6);assert.equal(raw.getTable('QueryResults').table.tableRef,'A1:F6');
assert.equal(raw.getCell('E5').value,null);assert.equal(raw.getCell('E6').value,0);
const groupedBook=new globalThis.ExcelJS.Workbook();await groupedBook.xlsx.load(await X.xlsx(data,grouped));assert.equal(groupedBook.worksheets[0].getCell('A8').value,'Grand total');
const pdf=await X.pdf(data,result);assert.ok(pdf.pages>=1);assert.equal((await globalThis.PDFLib.PDFDocument.load(pdf.bytes)).getPageCount(),pdf.pages);
const many={...result,rows:Array.from({length:65},(_,i)=>({...rows[0],id:i+100,name:'Project '+i})),table:undefined};const multi=await X.pdf(data,many);assert.ok(multi.pages>1);
if(process.env.ASK_LAYOUT_QA_DIR){mkdirSync(process.env.ASK_LAYOUT_QA_DIR,{recursive:true});writeFileSync(process.env.ASK_LAYOUT_QA_DIR+'/grouped-results.pdf',pdf.bytes);writeFileSync(process.env.ASK_LAYOUT_QA_DIR+'/grouped-results.xlsx',bytes);writeFileSync(process.env.ASK_LAYOUT_QA_DIR+'/grouped-multipage.pdf',multi.bytes);}
console.log('PASS: grouping keeps every project once, preserves null/zero/CAPP IDs, separates same-name venues by unit, exports headings plus filterable source records, keeps aggregate/grand-total reports intact, and renders multipage PDFs.');

// Alternating venues deliberately catch regrouping that breaks a global sort.
const rankedRows=[rows[3],rows[2],rows[0],rows[1],rows[4]];
const ranked={...result,plan:{sort:[{field:'approved_budget',direction:'asc'}]},rows:rankedRows,table:{...result.table,rows:rankedRows.map(p=>({id:p.id,approved_budget:p.approved_budget,anticipated_final_cost:p.anticipated_final_cost}))}};
const flat=X.view(ranked);assert.equal(flat.hierarchical,false);assert.deepEqual(flat.entries.map(e=>e.row.id),[4,3,1,2,5]);assert.deepEqual(flat.columns.map(c=>c.key),['name','approved_budget','anticipated_final_cost']);
const flatBook=new globalThis.ExcelJS.Workbook();await flatBook.xlsx.load(await X.xlsx(data,ranked));const fsheet=flatBook.getWorksheet('Results');assert.deepEqual([7,8,9,10,11].map(i=>fsheet.getCell(i,1).value),rankedRows.map(r=>r.name));assert.equal(fsheet.getCell('B7').value,0);assert.equal(fsheet.getCell('B10').value,null);assert.equal(fsheet.getTable('QueryResults').table.tableRef,'A6:C11');
assert.ok((await X.pdf(data,ranked)).pages>=1);
const extra=X.view({...ranked,table:{...ranked.table,columns:[...ranked.table.columns,{key:'venue',label:'Venue',type:'text'},{key:'business_unit',label:'Business unit',type:'text'}]}});assert.equal(extra.columns.at(-1).label,'BU');assert.equal(extra.rows[0].venue,rows[3].venue);
assert.deepEqual(answer(data,'Show all projects sorted by ascending approved budget').rows.map(p=>p.id),[4,3,1,2,5]);
console.log('PASS: global sorting preserves query order across venues in screen and Excel, PDF renders, concise columns retain requested identity details, and guided ascending order keeps missing values last.');
const alignBook=new globalThis.ExcelJS.Workbook();await alignBook.xlsx.load(await X.xlsx(data,{...ranked,table:{...ranked.table,columns:[{key:'project_manager',label:'PM',type:'text'},{key:'business_unit',label:'BU',type:'text'},{key:'status',label:'Status',type:'text'}]}}));
const align=alignBook.getWorksheet('Results');for(let col=2;col<=4;col++)assert.equal(align.getCell(6,col).alignment.horizontal,'center');assert.equal(align.getRow(6).height,32);
assert.equal(align.getCell(7,4).alignment.horizontal,'center','Status data and header are both centered');
// Transcript regression: PM first; remove both IDs; preserve order after sorting.
for(const sort of [[],[{field:'anticipated_final_cost',direction:'desc'}]]){
 const keys=['project_manager','name','anticipated_final_cost','cost_variance'];
 const cols=keys.map(key=>({key,label:key,type:key.includes('cost')?'currency':'text'}));
 const requested={...result,plan:{columns:keys,sort},table:{...result.table,columns:cols}};
 const shown=X.view(requested);assert.deepEqual(shown.columns.map(c=>c.key),keys);
 assert.ok(!shown.columns.some(c=>['id','capp_number'].includes(c.key)));
 assert.deepEqual(shown.entries.filter(e=>e.kind==='row').map(e=>e.row.id),sort.length?rows.map(r=>r.id):[1,3,5,2,4]);
 const book=new globalThis.ExcelJS.Workbook();await book.xlsx.load(await X.xlsx(data,requested));
 assert.deepEqual(book.getWorksheet('Results').getRow(6).values.slice(1),shown.columns.map(c=>c.label));
 if(!sort.length)assert.ok(!book.getWorksheet('Source records').getRow(1).values.includes('CAPP ID'));
 assert.ok((await X.pdf(data,requested)).bytes.length>1000);
}
console.log('PASS: explicit PM-first order and removal of both IDs survive grouped/flat rendering and matching PDF/Excel exports.');
