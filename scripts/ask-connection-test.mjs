import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// Execute the real connection script, then the real voice controls in the same
// browser context. A string-bundled syntax error must fail this check and build.
const nodes=new Map(),requests=[];
class Element extends EventTarget{constructor(){super();this.dataset={};this.value='';this.hidden=false;this.disabled=false;}setAttribute(k,v){this[k]=v;}after(){} }
const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
const context={console,Event,setTimeout,clearTimeout,setInterval,clearInterval,document:{getElementById:get,createElement:()=>new Element(),querySelector:()=>new Element()},navigator:{},DNC_HOSTED_BOOT:{configured:true,conversation:'original-token',csrf:'csrf',trackerCsrf:'tracker-csrf'},DNC_TIME:{zone:()=> 'America/Denver'},DNC_REVIEW:{isBusy:()=>false},fetch:async(path,options)=>{requests.push({path,...options,body:JSON.parse(options.body)});return Response.json({result:{intent:'table',rows:[{id:20}]},conversation:'next-token'});}};
context.window=context;context.addEventListener=()=>{};context.dispatchEvent=()=>{};
vm.createContext(context);
vm.runInContext(readFileSync('worker/ask/hosted-connection.js','utf8'),context);
vm.runInContext(readFileSync('worker/ask/realtime-voice.js','utf8'),context);
assert.equal(context.DNC_HOSTED_AI_READY,true);assert.equal(get('engineSelect').value,'ai');assert.equal(get('voiceStart').disabled,false);
get('voiceMode').onclick();assert.equal(get('voicePanel').hidden,false);assert.equal(get('voiceStart').disabled,false);
const r=await context.DNC_ASSISTANT_ADAPTER.ask({question:'Projects over $1 million',unit:'All',voice:false});assert.equal(r.rows[0].id,20);
await context.DNC_ASSISTANT_ADAPTER.ask({question:'Sort those descending',unit:'All',voice:true});
assert.equal(requests[0].body.timeZone,'America/Denver');assert.equal(requests[1].body.conversation,'next-token');assert.equal(requests[1].body.voice,true);
assert.equal(requests[0].headers['X-CSRF-Token'],'tracker-csrf');
get('engineSelect').value='guided';get('engineSelect').dispatchEvent(new Event('change'));assert.equal(context.DNC_ASSISTANT_ADAPTER,null);
console.log('PASS: actual client script initializes AI, enables Start conversation, passes timezone and preserves follow-up session tokens.');
