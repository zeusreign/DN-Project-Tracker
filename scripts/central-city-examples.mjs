// Reusable import for the authorized deployment handoff. Preview invokes this only on its in-memory bindings.
import {readFileSync} from 'node:fs';
const root=new URL('../assets/central-city/',import.meta.url);
export const centralCityExamples=JSON.parse(readFileSync(new URL('photos.json',root),'utf8'));
export function centralCityMedia(){return centralCityExamples.map(p=>({...p,src:'data:'+(p.mime||'image/jpeg')+';base64,'+readFileSync(new URL(p.file,root)).toString('base64')}))}
export async function importCentralCityExamples(env,{apply=false}={}){
 const matches=(await env.DB.prepare("SELECT id,name,venue FROM projects WHERE upper(venue)='CENTRAL CITY' AND name='New Construction Complex'").all()).results;
 if(matches.length!==1)throw Error('Expected exactly one Central City / New Construction Complex project. Confirm project mapping before import.');
 const pid=matches[0].id,result=[];
 for(const p of centralCityExamples){const exists=await env.DB.prepare('SELECT id FROM project_photos WHERE id=? OR photo_number=?').bind(p.id,p.photo_number).first();if(exists){result.push({photo:p.photo_number,status:'already present'});continue}if(!apply){result.push({photo:p.photo_number,status:'would import',project_id:pid});continue}
 const key='projects/'+pid+'/'+p.id;await env.BUCKET.put(key,readFileSync(new URL(p.file,root)),{httpMetadata:{contentType:p.mime||'image/jpeg'}});
 try{await env.DB.batch([env.DB.prepare('INSERT INTO project_photos(id,project_id,kind,reporting_period,caption,object_key,mime,actor_email,date_taken,taken_by,area,category,include_in_report,notes,photo_number) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(p.id,pid,p.kind,p.reporting_period,p.caption,key,p.mime||'image/jpeg','example-import',p.date_taken,p.taken_by,p.area,p.category,p.include_in_report,p.notes,p.photo_number),env.DB.prepare("INSERT INTO audit_log(action,entity_type,entity_key,actor_email,details) VALUES('photo_import','project',?,'example-import',?)").bind(String(pid),JSON.stringify({photo_number:p.photo_number,source_file:p.source_file,notes_source:p.notes_source}))]);}catch(e){await env.BUCKET.delete(key);throw e}result.push({photo:p.photo_number,status:'imported',project_id:pid});
 }return result;
}
