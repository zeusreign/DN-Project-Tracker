import {centralCityMedia} from './central-city-examples.mjs';
import {interactiveDemo} from './interactive-demo.mjs';
// Produce a portable, read-only UI review file from the source seed, never production.
import {spawn} from 'node:child_process';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
const server=spawn(process.execPath,['scripts/preview-enhanced.mjs',...process.argv.slice(2)],{stdio:['ignore','pipe','inherit']});
try {
 await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(String(d).includes('Local preview'))resolve()});server.on('error',reject);server.on('exit',c=>reject(Error('Preview exited '+c)))});
 const get=async path=>fetch('http://127.0.0.1:4173'+path,{headers:{cookie:'preview_role=viewer'}});
 const boot=await (await get('/api/bootstrap')).json();
 boot.me.email='preview@example.invalid';boot.me.profile=null;boot.me.csrf_token=null;
 const history={};for(const p of boot.projects)history[p.id]=await(await get('/api/projects/'+p.id+'/history')).json();
 const periods=Array.from(new Set(Object.values(history).flatMap(x=>x.history.map(h=>h.reporting_period)))).sort();
 const dataLabel=process.argv.includes('--snapshot')?'September 18 backup · '+boot.projects.length+' projects · '+periods.length+' reporting dates through '+periods.at(-1):'Archived source records (August 28)';
 let html=await(await get('/')).text();
 const safe=x=>JSON.stringify(x).replace(/</g,'\\u003c');
 const seededPhotos={},seededUrls={},central=boot.projects.find(p=>p.venue==='CENTRAL CITY'&&p.name==='New Construction Complex');if(central){seededPhotos[central.id]=centralCityMedia().map(({src,...p})=>{seededUrls[central.id+'/'+p.id]=src;return {...p,revision:0,created_at:'2026-06-02 12:00:00',actor_email:'example-import'}})}
 const shim=process.argv.includes('--interactive')?interactiveDemo(boot,history,seededPhotos,seededUrls):`<script>window.enReadOnlyPreview=true;window.enDemoPhotoUrls=${safe(seededUrls)};const previewPhotos=${safe(seededPhotos)};const previewBootstrap=${safe(boot)},previewHistory=${safe(history)};window.fetch=async function(input,options){const path=String(input),method=(options&&options.method||'GET').toUpperCase();let data,status=200;if(method!=='GET'){data={error:'This is a read-only preview. No live connection.'};status=403}else if(path==='/api/bootstrap')data=previewBootstrap;else if(/^\\/api\\/projects\\/\\d+\\/history$/.test(path))data=previewHistory[path.split('/')[3]]||{history:[]};else if(/^\\/api\\/projects\\/\\d+\\/photos$/.test(path))data={photos:previewPhotos[path.split('/')[3]]||[]};else{data={error:'This feature needs the connected application. Preview is read-only.'};status=403}return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})};try{localStorage.setItem('dn-tracker-enhanced-v1:preview@example.invalid',JSON.stringify({mode:'enhanced',layout:{projects:'record',development:'record'},navigator:'rolodex'}))}catch{};document.addEventListener('click',function(e){const a=e.target.closest('a[href^="/"]');if(a){e.preventDefault();alert('The source package includes the user guide. This preview has no live connection.')}},true);</script>`;
 html=html.replace('<script>',shim+'<script>');
 html=html.replace('load(true).catch(',"load(true).then(function(ok){if(ok){enhanced.mode='enhanced';enhanced.layout={projects:'record',development:'record'};enhanced.navigator='rolodex';state.unitScope='Gaming';var central=state.projects.find(function(p){return p.venue==='CENTRAL CITY'&&p.name==='New Construction Complex'});if(central)enhanced.selected.projects=central.id;renderAll();setView('projects');byId('exportWrap').hidden=true;byId('profileBtn').hidden=true}}).catch(");
 for(const file of ['logo.png','refresh-icon.png','download-icon.jpg','logout-icon.png']){
  const r=await get('/'+file);if(r.ok)html=html.replaceAll('src="/'+file+'"','src="data:'+r.headers.get('content-type')+';base64,'+Buffer.from(await r.arrayBuffer()).toString('base64')+'"');
 }
 html=html.replace('</head>','<style>#previewBanner{height:36px;position:sticky;top:0;z-index:200;display:flex;align-items:center;justify-content:center}.sidebar{height:calc(100dvh - 36px);top:36px}.freeze-list .app{height:calc(100dvh - 36px)}@media(max-width:740px){.sidebar{height:auto;top:0}}</style></head>');
 html=html.replace('<body>','<body><div id="previewBanner" style="background:#fff1cf;color:#4b370c;padding:10px 20px;font:600 13px system-ui;text-align:center">Read-only Enhanced preview · '+dataLabel+' · No live connection</div>');
 if(process.argv.includes('--interactive'))html=html.replace('Read-only Enhanced preview','Interactive demo · Uploads/edits reset on reload');
 mkdirSync('deliverables',{recursive:true});writeFileSync('deliverables/'+(process.argv.includes('--interactive')?'DN_Tracker_Enhanced_Interactive_Demo.html':'DN_Tracker_Enhanced_Preview.html'),html);console.log('Created read-only preview:',boot.projects.length,'archived source records');
}finally{server.kill()}
