import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {createBrowser} from './browser-harness.mjs';
const db=new DatabaseSync(':memory:');for(const n of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+n,'utf8'));
class S{constructor(sql){this.s=db.prepare(sql);this.v=[]}bind(...v){this.v=v;return this}async first(){return this.s.get(...this.v)||null}async all(){return{results:this.s.all(...this.v)}}async run(){return this.s.run(...this.v)}}
const env={DB:{prepare:s=>new S(s),async batch(ss){const r=[];for(const s of ss)r.push(await s.run());return r;}},ALLOW_PLATFORM_AUTH:'true',SITES_OWNER_PREVIEW:'true'};
const headers={'oai-authenticated-user-id':'idle-owner','oai-authenticated-user-email':'tom@lagospm.com','oai-authenticated-user-full-name':'TJ%20Lagos','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8','content-type':'application/json',origin:'https://review.example'};
let cookie='';const call=async(path,opts={})=>{const r=await worker.fetch(new Request('https://review.example'+path,{...opts,headers:{...headers,cookie,...opts.headers}}),env,{});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
const boot=await(await call('/api/bootstrap')).json();assert.equal(boot.me.idle_seconds,2400);assert.equal(boot.me.idle_warning_seconds,600);
const firstCookie=cookie,key=db.prepare("SELECT key FROM app_meta WHERE key LIKE 'preview_session:%'").get().key;
const session=()=>JSON.parse(db.prepare('SELECT value FROM app_meta WHERE key=?').get(key).value);
const age=minutes=>{const row=session();row.lastUsed=Date.now()-minutes*60000;db.prepare('UPDATE app_meta SET value=? WHERE key=?').run(JSON.stringify(row),key);};
age(29);const last=session().lastUsed;
let state=await(await call('/api/session')).json();assert.ok(state.idle_remaining>=659&&state.idle_remaining<=661);assert.equal(session().lastUsed,last,'Reading must not extend the session');
await call('/api/assistant/history',{method:'POST',body:JSON.stringify({action:'list'})});assert.equal(session().lastUsed,last,'Automatic history saves/reads must not extend idle');
await call('/api/assistant/voice',{method:'POST',body:JSON.stringify({action:'end'})});assert.equal(session().lastUsed,last,'Automatic voice teardown must not extend idle');
age(30);
const browser=await createBrowser({page:await(await call('/')).text(),handler:req=>{const h=new Headers(req.headers);for(const [k,v] of Object.entries(headers))h.set(k,v);h.set('cookie',cookie);return worker.fetch(new Request(req,{headers:h}),env,{})}});await browser.start();
assert.equal(browser.byId('idleDialog').open,true);assert.match(browser.text('idleMessage'),/logged out in (10:00|9:59)/);assert.equal(browser.text('idleStay'),'Continue working');
await browser.fire('idleStay','click').results;await browser.settle();assert.equal(browser.byId('idleDialog').open,false);assert.ok(Date.now()-session().lastUsed<2000);
// A second browser has its own deadline; a stale cookie cannot silently recreate one.
cookie='';await call('/api/bootstrap');const secondCookie=cookie;assert.notEqual(secondCookie,firstCookie);cookie=firstCookie;age(40);
assert.equal((await call('/api/session')).status,401);assert.equal((await call('/api/bootstrap')).status,401);assert.equal((await call('/api/session',{method:'POST',body:'{}'})).status,401);
cookie=secondCookie;assert.equal((await call('/api/session')).status,200);
await call('/api/logout',{method:'POST',body:'{}'});assert.match(cookie,/dnc_preview_session=$/);cookie=secondCookie;assert.equal((await call('/api/session')).status,401);
console.log('PASS: 30/40-minute policy, real warning/countdown/Continue UI, server-enforced expiry, GET/history/voice teardown cannot renew, expired sessions cannot revive, separate browser deadlines and logout revocation.');
