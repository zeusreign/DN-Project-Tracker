// Read-only assistant. All identity, permission and data inputs originate here.
// The service owns OpenAI credentials; no long-lived credential enters the page.
const ASK_PROJECT_FIELDS = 'id name venue business_unit project_type status phase project_manager development_lead capp_number initiative_number scope_description budget_risk schedule_risk approved_budget anticipated_final_cost original_start_date current_start_date original_turnover_date current_turnover_date current_update previous_update reporting_period precon_capp construction_capp add_capp development_original_estimate development_current_estimate'.split(' ');
async function askTrackerData(db,scope){
 const projects=(await projectRows(db,scope)).map(p=>Object.fromEntries(ASK_PROJECT_FIELDS.map(k=>[k,p[k]??null])));
 const filter=scopeFilter(scope,'b');
 const history=(await runScoped(db,`SELECT u.id,u.project_id,u.reporting_period,u.current_summary,u.previous_summary,u.created_at FROM project_updates u JOIN projects p ON p.id=u.project_id JOIN business_units b ON b.id=p.business_unit_id WHERE p.archived_at IS NULL${filter.sql} ORDER BY u.reporting_period DESC,u.id DESC`,filter)).results||[];
 const photos=((await runScoped(db,`SELECT f.id,f.project_id,f.caption,f.reporting_period,f.created_at FROM project_photos f JOIN projects p ON p.id=f.project_id JOIN business_units b ON b.id=p.business_unit_id WHERE p.archived_at IS NULL${filter.sql}`,filter)).results||[]).map(p=>({...p,photo_number:p.id,date_taken:p.reporting_period,src:'/api/projects/'+p.project_id+'/photos/'+encodeURIComponent(p.id),notes:'',notes_source:'Private Tracker photo record'}));
 const periods=[...projects.map(p=>p.reporting_period),...history.map(h=>h.reporting_period)].filter(Boolean).sort();
 return {meta:{snapshot_at:new Date().toISOString(),latest_reporting_period:periods.at(-1)||'Not recorded',source:'Current private Enhanced Tracker database',source_file:'Current private Enhanced Tracker database',photo_note:'Only photos stored in this private Tracker are included. Live DNC photo files have not been transferred.'},projects,history,photos};
}
async function askTrackerOwner(user,role,scope,data){
 // Bind saved conversations to this account and its actual record permissions.
 const raw=JSON.stringify({site:DNC_REVIEW_BUILD?'dnc-enhanced-review':'dnc-production',id:user.id,auth:user.auth_source,role,scope:scope===null?null:[...scope].sort(),ids:data.projects.map(p=>p.id).sort((a,b)=>a-b)});
 return 'enhanced:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function askTrackerBridge(env,payload){
 const endpoint=env.DNC_AI_SERVICE_URL,secret=env.DNC_AI_SERVICE_TOKEN;
 const previewEndpoint='https://dnc-ask-the-tracker.tom33714.chatgpt.site/api/tracker-service';
 let parsed;try{parsed=new URL(endpoint)}catch{}
 const allowed=DNC_REVIEW_BUILD?endpoint===previewEndpoint:parsed?.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&parsed.pathname==='/api/tracker-service'&&endpoint!==previewEndpoint;
 if(!allowed||!secret||secret.length<32)return {status:503,value:{error:'Ask the Tracker is waiting for its server connection.'}};
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(DNC_REVIEW_BUILD?{'OAI-Sites-Authorization':'Bearer '+secret}:{}),'X-DNC-Service-Key':secret},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(payload.operation==='query'?165000:35000)});
  if(response.status>=300&&response.status<400)return {status:502,value:{error:'The private AI service returned an unexpected redirect. Please contact the Tracker administrator.'}};
  if(!(response.headers.get('content-type')||'').includes('application/json'))return {status:502,value:{error:'The private AI service is unavailable. Please try again.'}};
  const value=await response.json();return {status:response.status,value};
 }catch(e){console.error('ask_tracker_bridge_failure',JSON.stringify({name:e.name,message:e.message,code:e.cause?.code}));return {status:502,diagnostic:{name:e.name,message:String(e.message).replaceAll(secret,'[redacted]'),code:e.cause?.code||null},value:{error:e.name==='TimeoutError'?'The answer took too long. Please try again.':'The private AI service could not connect. Please try again.'}};}
}
const askScriptSafe=s=>s.replace(/<\/script/gi,'<\\/script');
function askTrackerPage(data,boot){
 const scriptKeys=['conversation-time.js','assistant-core.js','table-exports.js','assistant-ui.js','hosted-connection.js','realtime-voice.js','conversation-history.js'];
 const scripts=scriptKeys.map(k=>'<script>'+askScriptSafe(ASK_ASSETS[k].replace(/^export /gm,''))+'</script>').join('');
 return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ask the Tracker</title><link rel="stylesheet" href="/api/ask/assets/tracker.css?v='+ASK_STYLE_VERSION+'"></head><body>'+ASK_ASSETS['shell.html']+'<script>window.DNC_ASSISTANT_DATA='+JSON.stringify(data).replace(/</g,'\\u003c')+';window.DNC_HOSTED_BOOT='+JSON.stringify(boot).replace(/</g,'\\u003c')+';</script>'+scripts+'</body></html>',{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.openai.com; media-src 'self' blob:; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",'Permissions-Policy':'microphone=(self), camera=()'}});
}
async function askTrackerApi(request,env,url,user,role,scope){
 const path=url.pathname;
 if(path.startsWith('/api/ask/assets/')&&request.method==='GET'){
  const key=path.slice('/api/ask/assets/'.length),asset=ASK_ASSETS[key];
  if(!asset||!['tracker.css','vendor/exceljs.min.js','vendor/pdf-lib.min.js','vendor/exceljs-LICENSE','vendor/pdf-lib-LICENSE.md'].includes(key))return error('Not found.',404);
  return new Response(asset,{headers:{'Content-Type':key.endsWith('.css')?'text/css':key.endsWith('.js')?'text/javascript':'text/plain','Cache-Control':'private,max-age=3600','X-Content-Type-Options':'nosniff'}});
 }
 if(path==='/api/ask/workspace'&&request.method==='GET'){
  const profile=user.directory_id?await readProfile(env.DB,user.directory_id):null;
  const data=await askTrackerData(env.DB,scope),owner=await askTrackerOwner(user,role,scope,data),result=await askTrackerBridge(env,{operation:'bootstrap',owner});
  if(result.status!==200)return askTrackerPage(data,{configured:false,error:result.value.error,trackerCsrf:user.csrf_token||'',greetingName:String(user.name||'').trim().split(/\s+/)[0]||'',timeZone:profile?.time_zone||null});
  return askTrackerPage(data,{...result.value,trackerCsrf:user.csrf_token||'',greetingName:String(user.name||'').trim().split(/\s+/)[0]||'',timeZone:profile?.time_zone||null});
 }
 const operation=path.match(/^\/api\/assistant\/(query|history|reset|voice)$/)?.[1];
 if(!operation||request.method!=='POST')return error('Not found.',404);
 if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'||!(request.headers.get('content-type')||'').startsWith('application/json'))return error('Refresh this page and try again.',403);
 const raw=await request.text();if(raw.length>160000)return error('That request is too large.',413);
 let body;try{body=JSON.parse(raw)}catch{return error('Send a valid question.',400)}
 const data=await askTrackerData(env.DB,scope),owner=await askTrackerOwner(user,role,scope,data);
 // Explicit allowlist: never forward a client-provided owner, scope, data or URL.
 const forwarded=Object.fromEntries(['conversation','action','id','entries','question','unit','voice','sdp','voiceToken'].filter(k=>Object.hasOwn(body,k)).map(k=>[k,body[k]]));
 const payload={...forwarded,operation,owner,csrf:request.headers.get('x-dnc-csrf')};
 if(operation==='query'){const profile=user.directory_id?await readProfile(env.DB,user.directory_id):null;payload.timeZone=profile?.time_zone||validTimeZone(body.timeZone)||'UTC';payload.data=data;payload.authorizedUnits=[...new Set(data.projects.map(p=>p.business_unit))];}
 const result=await askTrackerBridge(env,payload);
 if(result.status===200&&operation==='query')result.value.data=data;
 return json(result.value,result.status);
}

// Operations-only connectivity check: no user identity or database records accepted.
async function askTrackerServiceHealth(request,env){
 const actual=request.headers.get('x-dnc-service-key')||'',expected=env.DNC_AI_SERVICE_TOKEN||'';
 let mismatch=actual.length^expected.length;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^(actual.charCodeAt(i)||0);
 if(expected.length<32||mismatch!==0)return error('Not authorized.',401);
 const result=await askTrackerBridge(env,{operation:'bootstrap',owner:'enhanced:'+'0'.repeat(64)});
 return json(result.status===200?{connected:true,configured:result.value.configured,model:result.value.model,voiceModel:result.value.voiceModel}:{connected:false,error:result.value.error,diagnostic:result.diagnostic||null},result.status);
}
