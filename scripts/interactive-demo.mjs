// Standalone sandbox: in-tab project/activity/photo changes only. No live API access.
export function interactiveDemo(boot,history,photos={},photoUrls={}){
 const safe=x=>JSON.stringify(x).replace(/</g,'\\u003c');
 return `<script>window.enReadOnlyPreview=false;window.enInteractiveDemo=true;window.enDemoPhotoUrls=${safe(photoUrls)};const demoBoot=${safe(boot)},demoHistory=${safe(history)},demoPhotos=${safe(photos)},demoPhotoSequences={};demoBoot.me.role='editor';demoBoot.me.name='Demo editor';demoBoot.me.email='demo@example.invalid';demoBoot.me.auth_source='demo';demoBoot.me.must_change_password=false;let demoId=100000;
 function demoReply(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})}
 window.fetch=async function(input,options={}){const path=String(input),url=new URL(path,'https://demo.invalid'),method=(options.method||'GET').toUpperCase();
 if(url.pathname==='/api/bootstrap')return demoReply(demoBoot);
 const m=url.pathname.match(/^\\/api\\/projects\\/(\\d+)\\/(photos|history|activity)(?:\\/([a-z0-9-]+))?$/);if(!m)return demoReply({error:'This offline demo supports activity and photo changes. Other changes require the connected application.'},403);
 const pid=Number(m[1]),kind=m[2],p=demoBoot.projects.find(p=>p.id===pid);if(!p)return demoReply({error:'Project not found.'},404);
 const list=demoHistory[pid].history;
 if(kind==='photos'){
 if(method==='GET')return demoReply({photos:demoPhotos[pid]||[]});
 if(method==='DELETE'){const list=demoPhotos[pid]||[],i=list.findIndex(p=>p.id===m[3]);if(i<0)return demoReply({error:'Photo not found.'},404);list.splice(i,1);URL.revokeObjectURL(window.enDemoPhotoUrls[pid+'/'+m[3]]);delete window.enDemoPhotoUrls[pid+'/'+m[3]];return demoReply({ok:true});}
 if(method==='PATCH'){const p=(demoPhotos[pid]||[]).find(p=>p.id===m[3]);if(!p)return demoReply({error:'Photo not found.'},404);const b=JSON.parse(options.body);if((p.revision||0)!==b.revision)return demoReply({error:'Photo changed.'},409);Object.assign(p,b,{revision:b.revision+1});return demoReply({ok:true});}
 if(method!=='POST')return demoReply({error:'Unsupported demo action.'},405);
 const file=options.body;if(!(file instanceof Blob)||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5242880)return demoReply({error:'Choose a JPG, PNG or WebP photo of 5 MB or less.'},400);
 const type=url.searchParams.get('kind'),period=url.searchParams.get('period');if(type==='progress'&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(period||''))return demoReply({error:'Choose a reporting date.'},400);
 const metadata=options.headers?.['x-photo-metadata']?JSON.parse(decodeURIComponent(options.headers['x-photo-metadata'])):{};const prefix=(metadata.photo_initials||'DE')+'-'+(metadata.date_taken||period||new Date().toISOString().slice(0,10)).replaceAll('-','').slice(2)+'-',seq=(demoPhotoSequences[prefix]||0)+1;if(seq>99)return demoReply({error:'99-photo limit reached for these initials/date.'},409);demoPhotoSequences[prefix]=seq;const photo_number=prefix+String(seq).padStart(2,'0');const id=String(++demoId);window.enDemoPhotoUrls[pid+'/'+id]=URL.createObjectURL(file);(demoPhotos[pid]??=[]).unshift({id,kind:type,reporting_period:period,caption:url.searchParams.get('caption')||'',created_at:new Date().toISOString(),actor_email:'demo@example.invalid',revision:0,photo_number,...metadata});return demoReply({ok:true,id,photo_number},201);
 }
 if(kind==='history'&&method==='GET')return demoReply({project:p,history:list.map(h=>({...h,editable:Date.now()<Date.parse(h.edit_deadline)}))});
 let b;try{b=JSON.parse(options.body)}catch{return demoReply({error:'Invalid update.'},400)}
 if(kind==='activity'&&method==='POST'){
 const text=(b.current_update||'').trim();if(!text)return demoReply({error:'An activity update is required.'},400);if(text===p.current_update)return demoReply({ok:true,unchanged:true});
 const now=new Date(),period=b.reporting_period||now.toISOString().slice(0,10);p.previous_update=p.current_update;p.current_update=text;p.reporting_period=period;
 list.unshift({id:++demoId,project_id:pid,reporting_period:period,current_summary:text,previous_summary:p.previous_update,author_name:'Demo editor',author_email:'demo@example.invalid',created_at:now.toISOString(),edit_deadline:new Date(+now+864000000).toISOString(),editable:true,revisions:[]});list.sort((a,b)=>b.reporting_period.localeCompare(a.reporting_period)||b.created_at.localeCompare(a.created_at)||b.id-a.id);return demoReply({ok:true});
 }
 if(kind==='history'&&method==='PATCH'){
 const h=list.find(h=>h.id===Number(m[3]));if(!h)return demoReply({error:'Entry not found.'},404);if(Date.now()>=Date.parse(h.edit_deadline))return demoReply({error:'This entry is locked after 10 days.'},423);if(h.current_summary!==b.expected_summary)return demoReply({error:'Entry changed. Reload history.'},409);if(!b.summary?.trim())return demoReply({error:'An activity update is required.'},400);
 (h.revisions??=[]).unshift({previous_text:h.current_summary,revised_text:b.summary.trim(),actor_email:'demo@example.invalid',created_at:new Date().toISOString()});if(list[0]===h&&p.current_update===h.current_summary)p.current_update=b.summary.trim();h.current_summary=b.summary.trim();return demoReply({ok:true});
 }return demoReply({error:'Unsupported demo action.'},405);
 };
 try{localStorage.setItem('dn-tracker-enhanced-v1:demo@example.invalid',JSON.stringify({mode:'enhanced',layout:{projects:'record',development:'record'},navigator:'rolodex'}))}catch{}
 document.addEventListener('click',function(e){const a=e.target.closest('a[href^="/"]');if(a){e.preventDefault();alert('This offline demo has no live connection.')}},true);
 </script>`;
}
