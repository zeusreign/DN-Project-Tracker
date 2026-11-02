import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import worker from '../dist/server/index.js';
import {periodProjectRows} from '../worker/reporting.js';
import {SEED_PROJECTS} from '../worker/seed.js';
const db=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
class Statement{constructor(sql){this.s=db.prepare(sql);this.v=[]}bind(...v){this.v=v;return this}async first(){return this.s.get(...this.v)||null}async all(){return {results:this.s.all(...this.v)}}async run(){return this.s.run(...this.v)}}
const DB={prepare:s=>new Statement(s),async batch(stmts){db.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
const env={DB,ALLOW_PLATFORM_AUTH:'true',SITES_OWNER_PREVIEW:'true'};
// The idle-session guard rejects every request that arrives without the session
// cookie /api/bootstrap issues, so the harness bootstraps once and keeps the jar
// the way a browser would. Without it every call below comes back 401.
let cookie=null;
const call=async path=>{
  if(!cookie&&path!=='/api/bootstrap')await call('/api/bootstrap');
  const headers={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.invalid'};
  if(cookie)headers.cookie=cookie;
  const response=await worker.fetch(new Request('https://test.invalid'+path,{headers}),env,{});
  const issued=response.headers.get('set-cookie');
  if(issued)cookie=issued.split(';')[0];
  return response;
};
const report=await(await call('/api/workbook?end=2026-10-23')).json();
assert.equal(report.projects.length,72);
const previous=SEED_PROJECTS.filter(p=>p.previous_update);
assert.equal(report.data.undatedPreviousCount,previous.length);
for(const p of previous){const actual=report.projects.find(r=>r.source_key===p.source_key);assert.equal(actual.previous_update,p.previous_update);assert.equal(actual.previous_update_origin,'workbook_undated');}
assert.equal(db.prepare("SELECT COUNT(*) n FROM project_updates WHERE reporting_period < '2026-10-23'").get().n,259);
for(const day of ['2026-08-14','2026-11-06']){
  const result=periodProjectRows(report.projects,[],day);
  assert.ok(result.every(p=>p.previous_update_origin==='none'));
}
// A live user edit cannot overwrite the original, undated source narrative.
const original=previous[0],saved=report.projects.find(p=>p.source_key===original.source_key);
assert.equal(periodProjectRows([{...saved,previous_update:'Later mutable value'}],[],'2026-10-23')[0].previous_update,original.previous_update);
assert.equal(periodProjectRows([{...saved,source_key:'new-id'}],[],'2026-10-23')[0].previous_update_origin,'none');
const data=report.data.sheets.filter(s=>s.grouped);
for(const s of data.filter(s=>s.kind==='capital'))assert.equal(s.widths[3],s.widths[4]);
for(const s of data)assert.equal(s.widths[0],({CORP:24,PATINA:26,GAMING:28,PARKS:26,'Design & Development':29})[s.name]);
assert.deepEqual(data.map(s=>s.name),['CORP','PATINA','GAMING','PARKS','Design & Development']);
for(const s of data){assert.equal(s.headers.length,s.kind==='capital'?19:17);assert.equal(s.rows.length,s.rows.filter(r=>r.length===s.headers.length).length);assert.ok(!s.headers.includes('Venue')&&!s.headers.includes('Business unit'));}
const response=await call('/api/report-download?end=2026-10-23&format=xlsx');assert.equal(response.status,200);
const bytes=Buffer.from(await response.arrayBuffer());
if(process.env.WORKBOOK_QA_OUTPUT)writeFileSync(process.env.WORKBOOK_QA_OUTPUT,bytes);
const result=spawnSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',['-c',String.raw`
import sys,json,io,base64,openpyxl
p=json.load(sys.stdin); w=openpyxl.load_workbook(io.BytesIO(base64.b64decode(p['xlsx'])))
for s in p['sheets']:
 sheet=w[s['name']]
 assert [c.value for c in sheet[1]]==s['headers']
 assert sheet.freeze_panes=='D2'
 sections={x['index']:x for x in s['sections']};row=2
 for i,values in enumerate(s['rows']):
  if i in sections:
   assert sheet.cell(row,1).value==sections[i]['label']
   assert sheet.cell(row,1).fill.fgColor.rgb=='FF'+sections[i]['style']['fill'][1:]
   row+=1
  for col,(v,t) in enumerate(zip(values,s['columnTypes']),1):
   actual=sheet.cell(row,col).value
   if t=='date' and v: assert actual.strftime('%Y-%m-%d')==v
   elif v is None or v=='': assert actual is None
   elif isinstance(v,float): assert abs(actual-v)<1e-8
   else: assert actual==v,(s['name'],row,col,actual,v)
   st=s['cellStyles'][i][col-1]
   if st.get('fill'): assert sheet.cell(row,col).fill.fgColor.rgb=='FF'+st['fill'][1:]
   if st.get('color'): assert sheet.cell(row,col).font.color.rgb=='FF'+st['color'][1:]
   if st.get('align'): assert sheet.cell(row,col).alignment.horizontal==st['align']
  row+=1
 for i,width in enumerate(s['widths'],1): assert sheet.column_dimensions[openpyxl.utils.get_column_letter(i)].width==width
if p.get('reference'):
 ref=openpyxl.load_workbook(p['reference'],data_only=True)
 for s in p['sheets']:
  source=ref[s['name']]
  # Exclude hidden row count and empty trailing template columns.
  offset=0 if s['name']=='CORP' else 1
  labels=[' '.join(str(source.cell(1,i+1+offset).value).split()) for i in range(len(s['headers']))]
  assert labels==s['headers'],(s['name'],labels,s['headers'])
  activity=4 if s['kind']=='capital' else 5
  letter=openpyxl.utils.get_column_letter(activity+offset)
  assert abs(s['widths'][activity-1]-(source.column_dimensions[letter].width+10))<0.01
print('PASS: every displayed value, header, section, width and typed date matches Excel; reference columns and Activity +10 verified.')
`],{input:JSON.stringify({xlsx:bytes.toString('base64'),sheets:data,reference:process.argv[2]}),encoding:'utf8'});
process.stdout.write(result.stdout);process.stderr.write(result.stderr);assert.equal(result.status,0);
console.log('PASS: '+previous.length+' imported previous notes restored; dates not invented; other periods and user edits remain separate.');
