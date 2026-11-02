import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import worker from '../dist/server/index.js';
import {latestReportEnd,periodProjectRows,workbookData} from '../worker/reporting.js';
import {xlsxExport} from '../worker/exports.js';
import {createBrowser} from './browser-harness.mjs';
assert.equal(latestReportEnd(new Date('2026-10-30T20:00:00Z')),'2026-10-23');
assert.equal(latestReportEnd(new Date('2026-11-06T20:00:00Z')),'2026-10-23');
assert.equal(latestReportEnd(new Date('2026-11-07T00:00:00Z')),'2026-11-06');
const db=new DatabaseSync(':memory:');
for(const n of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+n,'utf8'));
class Statement{constructor(sql){this.s=db.prepare(sql);this.v=[]}bind(...v){this.v=v;return this}async first(){return this.s.get(...this.v)||null}async all(){return {results:this.s.all(...this.v)}}async run(){return this.s.run(...this.v)}}
const DB={prepare:s=>new Statement(s),async batch(stmts){db.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
const objects=new Map(),env={DB,BUCKET:{async put(k,v){objects.set(k,v)},async get(k){return objects.has(k)?{body:objects.get(k)}:null},async delete(k){objects.delete(k)}},ALLOW_PLATFORM_AUTH:'true',ADMIN_EMAILS:'admin@example.invalid'};
// The idle-session guard rejects requests that carry no session cookie, so each
// identity bootstraps once and then reuses the cookie /api/bootstrap issued it.
const cookies=new Map();
function headers(who='admin'){const h={'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.invalid','content-type':'application/json'};const jar=cookies.get(who);if(jar)h.cookie=jar;return h}
async function call(path,method='GET',body,who='admin'){
  if(!cookies.has(who)&&path!=='/api/bootstrap')await call('/api/bootstrap','GET',undefined,who);
  const response=await worker.fetch(new Request('https://tracker.example'+path,{method,headers:headers(who),body:body===undefined?undefined:JSON.stringify(body)}),env,{});
  const issued=response.headers.get('set-cookie');
  if(issued)cookies.set(who,issued.split(';')[0]);
  return response;
}
const boot=await(await call('/api/bootstrap')).json(),p=boot.projects.find(p=>p.business_unit==='Corporate'),g=boot.projects.find(p=>p.business_unit==='Gaming');
for(const [who,role,scope] of [['viewer','viewer','All'],['editor','editor','All'],['gaming','editor','Gaming']])db.prepare("INSERT INTO user_directory(user_email,username,first_name,last_name,role,business_unit_scope,account_status,site_access_status,created_by) VALUES(?,?,'Test','User',?,?,'active','authorized','admin')").run(who+'@example.invalid',who,role,scope);
const seedNote=(id,day,note)=>db.prepare("INSERT INTO project_updates(source_key,project_id,reporting_period,current_summary,author_email) VALUES(?,?,?,?,?)").run('test-'+id+'-'+day,id,day,note,'test@example.invalid');
for(const [day,note] of [['2026-09-25','Too old'],['2026-09-26','Prior boundary'],['2026-10-09','Prior end'],['2026-10-10','Current boundary'],['2026-10-23','Current end'],['2026-10-24','Future window']])seedNote(p.id,day,note);
seedNote(g.id,'2026-10-23','Gaming ONLY');
const report=await(await call('/api/workbook?end=2026-10-23')).json();
const row=report.projects.find(x=>x.id===p.id);
assert.match(row.current_update,/Current boundary/);assert.match(row.current_update,/Current end/);assert.doesNotMatch(row.current_update,/Future window|Prior|Too old/);
assert.equal(row.previous_update,p.previous_update); // Original previous-week note takes precedence for this source report.
const datedPrior=periodProjectRows([{...p,source_key:'test-without-source-note'}],db.prepare('SELECT * FROM project_updates').all(),'2026-10-23')[0];
assert.match(datedPrior.previous_update,/Prior boundary/);assert.match(datedPrior.previous_update,/Prior end/);assert.doesNotMatch(datedPrior.previous_update,/Current|Too old/);
assert.equal(row.approved_budget,p.approved_budget);assert.match(report.note,/not historical financial snapshots/);
assert.deepEqual(report.data.sheets[0].headers.slice(0,5),['Project Name','CAPP #','PM','Project Update','Previous Week Update']);
const noHistory=periodProjectRows([{id:100,current_update:'Must not carry forward'}],[],'2026-10-23')[0];assert.match(noHistory.current_update,/No activity recorded/);
const scoped=await(await call('/api/workbook?end=2026-10-23','GET',undefined,'gaming')).json();assert.ok(scoped.projects.every(x=>x.business_unit==='Gaming'));assert.doesNotMatch(JSON.stringify(scoped),/Current boundary/);
for(const path of ['/api/workbook?end=2026-02-30','/api/workbook?end=2026-10-22','/api/workbook?end=2099-01-01','/api/report-download?from=2020-01-03&end=2026-10-23','/api/report-download?format=pdf'])assert.equal((await call(path)).status,400,path);
const calendar=await(await call('/api/reporting-periods')).json();assert.ok(calendar.periods.some(x=>x.end==='2026-10-23'));assert.ok(calendar.periods.every(x=>x.end<=calendar.latest));
const one=await call('/api/report-download?end=2026-10-23&format=xlsx','GET',undefined,'viewer');assert.equal(one.status,200);assert.match(one.headers.get('content-disposition'),/DNC-report-2026-10-23.xlsx/);
const multi=await call('/api/report-download?from=2026-10-09&end=2026-10-23&format=xlsx');assert.equal(multi.status,200);assert.match(multi.headers.get('content-type'),/zip/);
const multiBytes=Buffer.from(await multi.arrayBuffer());
const sample=workbookData([{...p,capp_number:'00864',name:'=1+1',current_update:'Line 1\nLine 2 café <note>',approved_budget:1000,anticipated_final_cost:1200}], '2026-10-23');
const python=String.raw`
import io,json,base64,zipfile,xml.etree.ElementTree as ET,sys
from openpyxl import load_workbook
p=json.load(sys.stdin)
with zipfile.ZipFile(io.BytesIO(base64.b64decode(p['multi']))) as z:
 assert z.testzip() is None
 assert sorted(z.namelist())==['DNC-report-2026-10-09.xlsx','DNC-report-2026-10-23.xlsx']
 for name in z.namelist():
  book=load_workbook(io.BytesIO(z.read(name)))
  assert book.sheetnames[0]=='CORP'
  assert name[11:21] in book['Report notes']['B2'].value
book=load_workbook(io.BytesIO(base64.b64decode(p['sample'])))
sheet=book['CORP']
assert sheet.freeze_panes=='D2'
assert sheet['A3'].value=='=1+1' and sheet['A3'].data_type=='s'
assert sheet['B3'].value=='00864' and sheet['B3'].data_type=='s'
assert sheet['D3'].value=='Line 1\nLine 2 café <note>'
assert sheet['K3'].value==1000 and sheet['M3'].value==200 and sheet['N3'].value==0.2
assert sheet['D3'].alignment.wrap_text
assert 'not historical financial snapshots' in dict(book['Report notes'].values)['Basis']
print('PASS: independent Excel reader, period ZIP, literal identifiers and text, numeric costs, frozen identity columns, provenance.')
`;
const validation=spawnSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',['-c',python],{input:JSON.stringify({multi:multiBytes.toString('base64'),sample:Buffer.from(xlsxExport(sample)).toString('base64')}),encoding:'utf8'});if(validation.stdout)process.stdout.write(validation.stdout);if(validation.stderr)process.stderr.write(validation.stderr);assert.equal(validation.status,0);
const photos='/api/projects/'+p.id+'/photos',png=readFileSync('assets/delaware-north-logo.png');
const photoResponse=await worker.fetch(new Request('https://tracker.example'+photos+'?kind=cover',{method:'POST',headers:{...headers(),'content-type':'image/png'},body:png}),env,{});assert.equal(photoResponse.status,201);const photo=await photoResponse.json();
const objectCount=objects.size;
const childCount=db.prepare('SELECT COUNT(*) n FROM project_updates WHERE project_id=?').get(p.id).n;
const change={archived:true,expected_archived:false},archive='/api/projects/'+p.id+'/archive';
assert.equal((await call(archive,'PATCH',change,'viewer')).status,403);assert.equal((await call(archive,'PATCH',change,'gaming')).status,404);
assert.equal((await call(archive,'PATCH',change,'editor')).status,200);
assert.equal((await call(archive,'PATCH',change,'editor')).status,409);
assert.ok(!(await(await call('/api/bootstrap')).json()).projects.some(x=>x.id===p.id));
assert.ok((await(await call('/api/archive')).json()).projects.some(x=>x.id===p.id));
assert.ok(!(await(await call('/api/archive','GET',undefined,'gaming')).json()).projects.some(x=>x.id===p.id));
assert.equal(db.prepare('SELECT COUNT(*) n FROM project_updates WHERE project_id=?').get(p.id).n,childCount);
assert.equal(objects.size,objectCount);assert.equal((await call(photos+'/'+photo.id)).status,200);
assert.equal((await call('/api/projects/'+p.id+'/fields','PATCH',{status:'Complete'},'editor')).status,409);
assert.equal((await call(photos+'/'+photo.id,'DELETE',undefined,'editor')).status,409);
assert.equal((await call('/api/projects/'+p.id,'DELETE',undefined,'editor')).status,405);
assert.equal((await call(archive,'PATCH',{archived:false,expected_archived:true},'editor')).status,200);
assert.equal(db.prepare('SELECT status FROM projects WHERE id=?').get(p.id).status,p.status);
assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action IN ('project_archive','project_restore') AND entity_key=?").get(String(p.id)).n,2);
assert.equal((await call('/api/projects/'+p.id+'/fields','PATCH',{status:'Complete'},'editor')).status,200);
assert.ok((await(await call('/api/bootstrap')).json()).projects.some(x=>x.id===p.id));
// Exercise served client rather than testing strings alone. Isolated synthetic auth.
const page=await(await call('/')).text();
// The served client fetches as the viewer, so that identity needs its own jar.
await call('/api/bootstrap','GET',undefined,'viewer');
const browser=await createBrowser({page,handler:req=>{const h=new Headers(req.headers);for(const [k,v] of Object.entries(headers('viewer')))h.set(k,v);return worker.fetch(new Request(req,{headers:h}),env,{})}});
await browser.start();await browser.fire('moduleInfoBtn','click').results;assert.equal(browser.byId('moduleInfoDialog').open,true);assert.match(browser.text('moduleInfoBody'),/capital project activity/);
browser.byId('moduleInfoDialog').close();await browser.fire('workbookBtn','click').results;await browser.settle();assert.equal(browser.location.hash,'#workbook');assert.match(browser.text('workbookTable'),/Previous Week Update/);assert.match(browser.text('workbookBasis'),/not historical financial snapshots/);
await browser.fire('workbookDownload','click').results;await browser.settle();assert.equal(browser.byId('reportDownloadDialog').open,true);assert.ok(browser.byId('reportTo').querySelectorAll('option').length>0);
browser.byId('reportDownloadDialog').close();await browser.fire('archiveNav','click').results;await browser.settle();assert.equal(browser.location.hash,'#archive');assert.match(browser.text('archiveRows'),/No archived projects/);
console.log('PASS: fortnight boundaries, no carried-forward notes, BU isolation, period validation, Archive/Restore permissions, conflict handling, retained history/photos, Complete stays visible, served Info/Workbook/download/Archive UI.');
