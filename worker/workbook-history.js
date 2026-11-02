import { WORKBOOK_HISTORY } from './workbook-history-data.js';

// Append-only, resumable backfill. Immutable source keys target the copied
// register. Never reseed projects or overwrite edits, costs, status or archives.
export async function ensureWorkbookHistory(db) {
 const key=WORKBOOK_HISTORY.version;
 if(await db.prepare('SELECT value FROM app_meta WHERE key=?').bind(key).first())return;
 const statements=WORKBOOK_HISTORY.updates.map(h=>db.prepare(`
   INSERT OR IGNORE INTO project_updates
   (source_key,project_id,reporting_period,current_summary,previous_summary,author_name,created_at)
   SELECT ?,p.id,?,?,?,'Workbook Import',? FROM projects p WHERE p.source_key=?
   AND NOT EXISTS(SELECT 1 FROM project_updates u WHERE u.project_id=p.id AND u.reporting_period=? AND trim(u.current_summary)=trim(?))
 `).bind(h.source_key,h.date,h.current,h.previous||null,h.date+'T12:00:00Z',h.target,h.date,h.current));
 for(let i=0;i<statements.length;i+=25)await db.batch(statements.slice(i,i+25));
 // Only write completion after all batches succeed. Concurrent runs and retries
 // use the same unique source keys; neither can create duplicate import entries.
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)').bind(key,JSON.stringify(WORKBOOK_HISTORY.summary)),
  db.prepare("INSERT INTO audit_log(action,entity_type,entity_key,details) SELECT 'workbook_history_import','import',?,? WHERE changes()=1").bind(key,JSON.stringify({periods:WORKBOOK_HISTORY.summary,heldRows:WORKBOOK_HISTORY.review.length}))
 ]);
}

export function workbookImportReview(end,unit,module,scope) {
 const rows=WORKBOOK_HISTORY.review.filter(r=>r.date===end&&(unit==='All'||r.business_unit===unit)&&(module==='all'||(module==='development')===(r.kind==='development'))&&(!scope||scope.includes(r.business_unit)));
 if(!rows.length)return null;
 return {name:'Import review',kind:'review',grouped:true,autoFilter:false,freezeColumns:3,sections:[],
  headers:['Source report','Worksheet / row','Project','CAPP / Initiative #','Business unit','Scope','Reason for review','Activity as supplied','Previous note as supplied'],
  columnTypes:['date','text','text','text','text','text','text','text','text'],widths:[17,25,40,18,24,50,55,80,65],
  rows:rows.map(r=>[r.date,r.sheet+' / '+r.row,r.name,r.identifier,r.business_unit,r.scope,r.reason,r.current,r.previous])};
}
