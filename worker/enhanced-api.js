// Additive Enhanced routes. Authentication, CSRF and forced-password checks run first.
export const EDIT_WINDOW_MS = 10 * 86400000;
export function editDeadline(created) { return Date.parse(created.endsWith('Z') ? created : created.replace(' ', 'T') + 'Z') + EDIT_WINDOW_MS; }
export function validDay(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
function photoMetadata(body) {
 if(!body||typeof body!=='object'||Array.isArray(body))return null;
 const out={};
 for(const [key,max] of Object.entries({caption:500,taken_by:200,area:200,category:200,notes:4000})) {
  if(typeof body[key]!=='string'||body[key].length>max)return null;out[key]=body[key].trim();
 }
 if(body.date_taken!==''&&!validDay(body.date_taken))return null;
 if(!validDay(body.reporting_period)||typeof body.include_in_report!=='boolean')return null;
 return {...out,date_taken:body.date_taken||null,reporting_period:body.reporting_period,include_in_report:body.include_in_report?1:0};
}
export async function enhancedApi(request, env, user, role, scope, helpers) {
 const {json,error,projectInScope,canWrite}=helpers, url=new URL(request.url);
 const match=url.pathname.match(/^\/api\/projects\/(\d+)\/(photos(?:\/[a-z0-9-]+)?|history\/\d+)$/);
 if(!match)return null;
 const pid=Number(match[1]),route=match[2];
 if(!await projectInScope(env.DB,pid,scope))return error('Project not found.',404);
 if(request.method!=='GET'&&!canWrite(role))return error('Editor access is required.',403);
 if(route.startsWith('history/')) {
  if(request.method!=='PATCH')return error('Method not allowed.',405);
  const id=Number(route.split('/')[1]),body=await request.json().catch(()=>null);
  if(!body||typeof body.summary!=='string'||!body.summary.trim()||body.summary.length>20000||typeof body.expected_summary!=='string')return error('Enter an activity update (maximum 20,000 characters).',400);
  const entry=await env.DB.prepare('SELECT * FROM project_updates WHERE id=? AND project_id=?').bind(id,pid).first();
  if(!entry)return error('Activity entry not found.',404);
  if(!(Date.now()<editDeadline(entry.created_at)))return error('This entry is locked after 10 days.',423);
  if(entry.current_summary!==body.expected_summary)return error('This entry changed. Reload its history before editing.',409);
  const summary=body.summary.trim();if(summary===entry.current_summary)return json({ok:true,unchanged:true});
  const revision=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO activity_revisions(id,update_id,previous_text,revised_text,actor_email)
    SELECT ?,id,current_summary,?,? FROM project_updates WHERE id=? AND project_id=? AND current_summary=? AND julianday('now') < julianday(created_at,'+10 days')`).bind(revision,summary,user.email,id,pid,body.expected_summary),
   env.DB.prepare(`UPDATE projects SET current_update=?,updated_at=datetime('now') WHERE id=? AND current_update=? AND ?=(SELECT id FROM project_updates WHERE project_id=? ORDER BY reporting_period DESC,created_at DESC,id DESC LIMIT 1) AND EXISTS(SELECT 1 FROM activity_revisions WHERE id=?)`).bind(summary,pid,entry.current_summary,id,pid,revision),
   env.DB.prepare(`UPDATE project_updates SET current_summary=? WHERE id=? AND EXISTS(SELECT 1 FROM activity_revisions WHERE id=?)`).bind(summary,id,revision),
   env.DB.prepare(`INSERT INTO audit_log(action,entity_type,entity_key,actor_id,actor_email,details) SELECT 'activity_edit','project',?,?,?,? WHERE EXISTS(SELECT 1 FROM activity_revisions WHERE id=?)`).bind(String(pid),user.id,user.email,JSON.stringify({update_id:id,reporting_period:entry.reporting_period,previous:entry.current_summary,value:summary}),revision)
  ]);
  const saved=await env.DB.prepare('SELECT id FROM activity_revisions WHERE id=?').bind(revision).first();
  return saved?json({ok:true}):error('The entry changed or its editing window closed. Reload history.',409);
 }
 const photoId=route.split('/')[1];
 if(request.method==='GET'&&!photoId){const r=await env.DB.prepare('SELECT id,kind,reporting_period,caption,photo_number,date_taken,taken_by,area,category,include_in_report,notes,revision,created_at,actor_email FROM project_photos WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC,rowid DESC').bind(pid).all();return json({photos:r.results||[]});}
 if(request.method==='DELETE'&&photoId){
  const row=await env.DB.prepare('SELECT * FROM project_photos WHERE id=? AND project_id=? AND deleted_at IS NULL').bind(photoId,pid).first();
  if(!row)return error('Photo not found.',404);
  await env.DB.batch([
   env.DB.prepare("UPDATE project_photos SET deleted_at=datetime('now') WHERE id=? AND project_id=?").bind(photoId,pid),
   env.DB.prepare("INSERT INTO audit_log(action,entity_type,entity_key,actor_id,actor_email,details) VALUES('photo_delete','project',?,?,?,?)").bind(String(pid),user.id,user.email,JSON.stringify({photo_id:photoId,photo_number:row.photo_number,caption:row.caption,object_key:row.object_key}))
  ]);
  let cleanup_pending=false;try{if(!env.BUCKET)throw Error('Storage unavailable');await env.BUCKET.delete(row.object_key)}catch{cleanup_pending=true}
  return json({ok:true,cleanup_pending});
 }
 if(request.method==='PATCH'&&photoId){
  const body=await request.json().catch(()=>null),data=photoMetadata(body);
  if(!data||!Number.isInteger(body.revision)||body.revision<0)return error('Enter valid photo details and reporting date.',400);
  const previous=await env.DB.prepare('SELECT * FROM project_photos WHERE id=? AND project_id=? AND deleted_at IS NULL').bind(photoId,pid).first();
  if(!previous)return error('Photo not found.',404);
  if(previous.revision!==body.revision)return error('Photo details changed. Reload before editing.',409);
  const token=crypto.randomUUID(),keys=Object.keys(data);
  await env.DB.batch([
   env.DB.prepare('UPDATE project_photos SET '+keys.map(k=>k+'=?').join(',')+',revision=revision+1 WHERE id=? AND project_id=? AND revision=? AND deleted_at IS NULL').bind(...keys.map(k=>data[k]),photoId,pid,body.revision),
   env.DB.prepare("INSERT INTO audit_log(action,entity_type,entity_key,actor_id,actor_email,details) SELECT 'photo_edit','project',?,?,?,? WHERE changes()=1").bind(String(pid),user.id,user.email,JSON.stringify({token,photo_id:photoId,previous:Object.fromEntries(keys.map(k=>[k,previous[k]])),value:data}))
  ]);
  const audit=await env.DB.prepare("SELECT id FROM audit_log WHERE action='photo_edit' AND details LIKE ?").bind('%'+token+'%').first();
  return audit?json({ok:true}):error('Photo details changed. Reload before editing.',409);
 }
 if(!env.BUCKET)return error('Photo storage is unavailable.',503);
 if(request.method==='GET'&&photoId){
  const row=await env.DB.prepare('SELECT * FROM project_photos WHERE id=? AND project_id=? AND deleted_at IS NULL').bind(photoId,pid).first();if(!row)return error('Photo not found.',404);
  const object=await env.BUCKET.get(row.object_key);if(!object)return error('Photo not found.',404);
  return new Response(object.body,{headers:{'content-type':row.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
 }
 if(request.method!=='POST'||photoId)return error('Method not allowed.',405);
 const kind=url.searchParams.get('kind'),period=url.searchParams.get('period'),caption=(url.searchParams.get('caption')||'').trim();
 if(!['cover','progress'].includes(kind)||caption.length>500||(kind==='progress'&&!validDay(period)))return error('Choose a valid reporting date and caption.',400);
 const mime=request.headers.get('content-type');if(!['image/jpeg','image/png','image/webp'].includes(mime))return error('Use JPG, PNG or WebP.',415);
 const reader=request.body?.getReader();if(!reader)return error('Choose a photo.',400);
 const chunks=[];let size=0;while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>5*1024*1024){await reader.cancel();return error('Photo must be 5 MB or smaller.',413);}chunks.push(r.value);}
 const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
 const signature=String.fromCharCode(...bytes.slice(0,12));
 const valid=size>12&&(mime==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes[size-2]===255&&bytes[size-1]===217:signature.startsWith('RIFF')&&signature.slice(8)==='WEBP');
 if(!valid)return error('The file is not a supported photo.',415);
 let metadata=null,initials=(user.email.split('@')[0].replace(/[^a-z]/gi,'').slice(0,3)||'USR').toUpperCase();
 if(request.headers.has('x-photo-metadata')){
  try{const raw=JSON.parse(decodeURIComponent(request.headers.get('x-photo-metadata')));metadata=photoMetadata(raw);if(raw.photo_initials!==undefined){if(!/^[A-Z]{1,4}$/.test(raw.photo_initials))return error('Use 1–4 letters for photo initials.',400);initials=raw.photo_initials}}catch{}
  if(!metadata)return error('Enter valid photo details and reporting date.',400);
 }
 const dateCode=(metadata?.date_taken||period||new Date().toISOString().slice(0,10)).replaceAll('-','').slice(2),prefix=initials+'-'+dateCode+'-';
 if(kind==='progress'){const seq=await env.DB.prepare('SELECT last_number FROM photo_number_sequences WHERE prefix=?').bind(prefix).first();if(seq&&seq.last_number>=99)return error('The 99-photo limit for these initials and date has been reached.',409);}
 const id=crypto.randomUUID(),key='projects/'+pid+'/'+id;
 try{await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:mime}});await env.DB.batch([
  ...(kind==='progress'?[env.DB.prepare('INSERT INTO photo_number_sequences(prefix,last_number) VALUES(?,1) ON CONFLICT(prefix) DO UPDATE SET last_number=last_number+1').bind(prefix)]:[]),
  env.DB.prepare('INSERT INTO project_photos(id,project_id,kind,reporting_period,caption,object_key,mime,actor_email) VALUES(?,?,?,?,?,?,?,?)').bind(id,pid,kind,kind==='progress'?period:null,caption,key,mime,user.email),
  ...(kind==='progress'?[env.DB.prepare("UPDATE project_photos SET photo_number=? || printf('%02d',(SELECT last_number FROM photo_number_sequences WHERE prefix=?)) WHERE id=?").bind(prefix,prefix,id)]:[]),
  ...(metadata?[env.DB.prepare('UPDATE project_photos SET date_taken=?,taken_by=?,area=?,category=?,include_in_report=?,notes=?,caption=?,reporting_period=? WHERE id=?').bind(metadata.date_taken,metadata.taken_by,metadata.area,metadata.category,metadata.include_in_report,metadata.notes,metadata.caption,metadata.reporting_period,id)]:[]),
  env.DB.prepare("INSERT INTO audit_log(action,entity_type,entity_key,actor_id,actor_email,details) VALUES('project_photo','project',?,?,?,?)").bind(String(pid),user.id,user.email,JSON.stringify({id,kind,reporting_period:period,caption,...(metadata||{})}))
 ]);}catch(e){await env.BUCKET.delete(key).catch(()=>{});return error('Photo could not be saved. Please try again.',503);}
 const saved=await env.DB.prepare('SELECT photo_number FROM project_photos WHERE id=?').bind(id).first();
 return json({ok:true,id,photo_number:saved.photo_number},201);
}
