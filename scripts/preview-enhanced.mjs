// Loopback-only developer preview. In-memory DB; no remote bindings or credentials.
import http from 'node:http';
import {importCentralCityExamples} from './central-city-examples.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';
const db=new DatabaseSync(':memory:');
for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
class Statement{constructor(sql){this.s=db.prepare(sql);this.v=[]}bind(...v){this.v=v;return this}async first(){return this.s.get(...this.v)||null}async all(){return {results:this.s.all(...this.v)}}async run(){return this.s.run(...this.v)}}
const DB={prepare:sql=>new Statement(sql),async batch(stmts){db.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
const objects=new Map(),BUCKET={async put(k,b){objects.set(k,b)},async get(k){return objects.has(k)?{body:objects.get(k)}:null},async delete(k){objects.delete(k)}};
const env={DB,BUCKET,ALLOW_PLATFORM_AUTH:'true',ADMIN_EMAILS:'preview@example.invalid'};
const identity={'oai-authenticated-user-id':'local-preview','oai-authenticated-user-email':'preview@example.invalid','oai-authenticated-user-full-name':'Local Preview'};
await worker.fetch(new Request('http://localhost/api/bootstrap',{headers:identity}),env,{});
const snapshotArg=process.argv.indexOf('--snapshot');
if(snapshotArg>=0){
 const data=JSON.parse(execFileSync('python3',['scripts/extract-preview-data.py',process.argv[snapshotArg+1]],{encoding:'utf8',maxBuffer:20*1024*1024}));
 db.exec('PRAGMA foreign_keys=OFF; BEGIN');
 try{for(const table of ['project_updates','development_details','projects','business_units'])db.exec('DELETE FROM '+table);
 for(const table of ['business_units','projects','development_details','project_updates'])for(const row of data[table]){const keys=Object.keys(row);db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]));}
 db.exec('COMMIT; PRAGMA foreign_keys=ON');}catch(e){db.exec('ROLLBACK');throw e}
}
for(const [email,role,scope] of [['viewer@example.invalid','viewer','All'],['editor@example.invalid','editor','All'],['gaming.viewer@example.invalid','viewer','Gaming']])db.prepare("INSERT INTO user_directory(user_email,username,first_name,last_name,role,business_unit_scope,account_status,site_access_status,created_by) VALUES(?,?,'Preview','User',?,?,'active','authorized','local-preview')").run(email,email,role,scope);
if(process.argv.includes('--examples'))await importCentralCityExamples(env,{apply:true});
http.createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);let headers={...req.headers,...identity};const match=(req.headers.cookie||'').match(/preview_role=([^;]+)/);if(match){headers['oai-authenticated-user-email']=match[1]+'@example.invalid';headers['oai-authenticated-user-id']=match[1]}
 const r=await worker.fetch(new Request('http://localhost'+req.url,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined}),env,{});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()))}catch(e){console.error(e);res.writeHead(500);res.end('Local preview error')}}).listen(4173,'127.0.0.1',()=>console.log('Local preview at http://127.0.0.1:4173 (in-memory data; resets on restart)'));
