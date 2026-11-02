// One-time, deterministic reconciliation. Inputs are parsed source workbooks.
// No fuzzy joins, guessed dates, new project creation, or current-record changes.
import {readFileSync,writeFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {SEED_PROJECTS} from '../worker/seed.js';
import {buildIndex,matchRow} from './workbook/match.mjs';
import {normaliseName} from './workbook/normalise.mjs';
const dir=process.argv[2];if(!dir)throw new Error('Provide parsed workbook directory.');
const updates=[],review=[],summary=[];
for(const day of ['2026-08-28','2026-09-11','2026-09-25','2026-10-09']){
 const source=JSON.parse(readFileSync(join(dir,day+'.json'),'utf8'));
 let matched=0,blank=0;const seen=new Set();
 for(const sheet of source.sheets)for(const row of sheet.rows){
  const candidates=SEED_PROJECTS.map((p,i)=>({...p,id:i+1})).filter(p=>p.business_unit===row.business_unit&&(p.project_type==='Development')===(row.kind==='development'));
  const match=matchRow(row,buildIndex(candidates));
  const record={date:day,file:basename(source.generated_from.workbook||source.generated_from),sheet:row.source.sheet,row:row.source.row,business_unit:row.business_unit,kind:row.kind,name:row.name,identifier:row.fields.capp_number||row.fields.initiative_number||'',scope:row.fields.scope_description||'',current:row.current_update||'',previous:row.previous_update||''};
  const verified=match.outcome==='matched'&&match.confidence>=80&&normaliseName(match.project.name)===normaliseName(row.name);
  if(!verified){review.push({...record,reason:match.outcome==='matched'?'Identity needs confirmation':'No unique match in the current '+row.business_unit+' '+row.kind+' register'});continue;}
  const key=match.source_key+'|'+day;if(seen.has(key))throw new Error('Two source rows matched one project/period: '+key);seen.add(key);matched++;
  if(!record.current&&!record.previous){blank++;continue;}
  updates.push({...record,target:match.source_key,source_key:'history:'+day+':'+row.source.sheet+':'+row.source.row,match:match.reason});
 }
 summary.push({date:day,sourceRows:source.totals.project_rows,matched,blank,imported:updates.filter(x=>x.date===day).length,review:review.filter(x=>x.date===day).length});
}
writeFileSync('worker/workbook-history-data.js','// Verified dated narratives only. Original report values remain in source workbooks.\nexport const WORKBOOK_HISTORY = '+JSON.stringify({version:'workbook-history-aug-oct-2026-v1',summary,updates,review},null,2)+';\n');
console.log(JSON.stringify(summary,null,2));
