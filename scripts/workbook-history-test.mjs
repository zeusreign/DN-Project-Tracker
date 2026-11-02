import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {WORKBOOK_HISTORY as source} from '../worker/workbook-history-data.js';
import {ensureWorkbookHistory,workbookImportReview} from '../worker/workbook-history.js';
import {workbookCellStyle} from '../worker/workbook-layout.js';
const db=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
class Statement{constructor(sql){this.s=db.prepare(sql);this.v=[]}bind(...v){this.v=v;return this}async first(){return this.s.get(...this.v)||null}async all(){return{results:this.s.all(...this.v)}}async run(){return this.s.run(...this.v)}}
const DB={prepare:sql=>new Statement(sql),async batch(ss){db.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
const env={DB,ALLOW_PLATFORM_AUTH:'true',SITES_OWNER_PREVIEW:'true'};
const call=path=>worker.fetch(new Request('https://test.invalid'+path,{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.invalid'}}),env,{});
await call('/api/bootstrap');
assert.equal(source.updates.length,259);assert.equal(source.review.length,29);
const projectsBefore=db.prepare('SELECT * FROM projects ORDER BY id').all();
for(const period of source.summary){
 const report=await(await call('/api/workbook?end='+period.date)).json();
 assert.equal(report.data.projectCount,72);assert.equal(report.data.importReviewCount,period.review);
 for(const h of source.updates.filter(x=>x.date===period.date)){
   const p=report.projects.find(x=>x.source_key===h.target);assert.ok(p);
   if(h.current)assert.equal(p.current_update,h.current);
   if(h.previous)assert.equal(p.previous_update,h.previous);
   const saved=db.prepare('SELECT * FROM project_updates WHERE source_key=?').get(h.source_key);
   assert.equal(saved.current_summary,h.current);assert.equal(saved.reporting_period,h.date);
 }
 if(period.date==='2026-08-28'&&process.env.HISTORY_QA_OUTPUT){const r=await call('/api/report-download?end='+period.date+'&format=xlsx');assert.equal(r.status,200);writeFileSync(process.env.HISTORY_QA_OUTPUT,Buffer.from(await r.arrayBuffer()));}
}
assert.deepEqual(db.prepare('SELECT * FROM projects ORDER BY id').all(),projectsBefore);
const count=()=>db.prepare('SELECT COUNT(*) n FROM project_updates').get().n;
const original=count();await ensureWorkbookHistory(DB);assert.equal(count(),original);
// Retry after partial completion, preserving user edits, archives, and existing notes.
db.prepare('DELETE FROM app_meta WHERE key=?').run(source.version);
db.exec("UPDATE projects SET name='Saved test name',approved_budget=12345,current_update='Saved current edit',archived_at='2026-10-30' WHERE id=1");
const keep=db.prepare('SELECT * FROM projects WHERE id=1').get();
const h=source.updates[0];db.prepare('UPDATE project_updates SET current_summary=? WHERE source_key=?').run('Saved historical edit',h.source_key);
await ensureWorkbookHistory(DB);assert.equal(count(),original);
assert.deepEqual(db.prepare('SELECT * FROM projects WHERE id=1').get(),keep);
assert.equal(db.prepare('SELECT current_summary FROM project_updates WHERE source_key=?').get(h.source_key).current_summary,'Saved historical edit');
for(const day of source.summary.map(x=>x.date)){
 const review=workbookImportReview(day,'All','all',['Gaming']);
 if(review)assert.ok(review.rows.every(r=>r[4]==='Gaming'));
 assert.equal(workbookImportReview(day,'All','all',[]),null);
}
const low={project_type:'Capital',budget_risk:'Low'},high={...low,budget_risk:'High'};
assert.equal(workbookCellStyle(low,'budget_risk',5,'GAMING').fill,'#00B050');
assert.equal(workbookCellStyle(high,'budget_risk',5,'GAMING').fill,'#FF0000');
assert.equal(workbookCellStyle({...low,approved_budget:100,anticipated_final_cost:90},'cost_variance',12,'GAMING').color,'#385723');
console.log('PASS: 259 exact source entries, four dated windows, 29 review rows, no current-field changes, duplicate-safe retry, archived/edit preservation, scoped review and dynamic risk/variance colors.');
