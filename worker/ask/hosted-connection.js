(() => {
  'use strict';
  const boot=window.DNC_HOSTED_BOOT,$=id=>document.getElementById(id);
  let conversation=boot.conversation,queue=Promise.resolve();
  window.DNC_HOSTED_AI_READY=boot.configured;
  async function request(path,body,options={}){
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-DNC-CSRF':boot.csrf,'X-CSRF-Token':boot.trackerCsrf||''},body:JSON.stringify({...body,conversation}),...options});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'Please refresh and try again.');
    if(value.conversation)conversation=value.conversation;if(value.data){Object.assign(window.DNC_ASSISTANT_DATA,value.data);$('snapshotFooter').textContent=value.data.projects.length+' projects · '+value.data.history.length+' activity entries · Latest period '+value.data.meta.latest_reporting_period;}return value;
  }
  function api(path,body,options={}){const next=queue.then(()=>request(path,body,options));queue=next.catch(()=>{});return next;}
  const adapter={ask:async({question,unit,voice})=>{const value=await api('/api/assistant/query',{question,unit,voice,timeZone:window.DNC_TIME.zone()});window.DNC_HISTORY?.status(value.historySaved===false?'This answer is visible, but could not be saved. Export it before leaving.':'Conversation saved');return value.result;}};
  window.DNC_HOSTED_API=api;
  function setMode(){const ai=boot.configured&&$('engineSelect').value==='ai';window.DNC_ASSISTANT_ADAPTER=ai?adapter:null;$('connectionStatus').textContent=ai?'AI chat ready · answers link to your records':'Guided search · project records and reports';}
  $('engineSelect').disabled=!boot.configured;$('engineSelect').value=boot.configured?'ai':'guided';setMode();
  if(boot.error){const note=document.createElement('div');note.className='dnc-inline-note';note.setAttribute('role','alert');note.textContent=boot.error+' AI chat and voice are unavailable. Guided search can still use the records loaded here. Close and reopen Ask the Tracker to retry.';document.querySelector('.dnc-heading').after(note);$('connectionStatus').textContent='AI connection unavailable · Guided search only';}
  $('engineSelect').addEventListener('change',async()=>{setMode();if(boot.configured)await window.DNC_RESET_CONTEXT();});
  if(boot.configured)window.DNC_RESET_CONTEXT=()=>api('/api/assistant/reset',{});
  const context=document.modelContext;
  if(context?.registerTool){
    const lifecycle=new AbortController();
    const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
    register({name:'ask_tracker',title:'Ask the Tracker',description:'Ask a project question using the selected mode and update the visible conversation. OpenAI mode sends the question and selected records to OpenAI and uses API credit.',inputSchema:{type:'object',properties:{question:{type:'string',minLength:1,maxLength:4000}},required:['question'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},async execute(input){if(!input||typeof input.question!=='string'||!input.question.trim()||input.question.length>4000)throw new Error('A question of 1–4000 characters is required.');const result=await window.DNC_REVIEW.ask(input.question);if(!result)throw new Error('Wait for the current question or check the visible error.');return {intent:result.intent,projects:(result.rows||[]).map(p=>({id:p.id,name:p.name,venue:p.venue})),analysis:result.analysis||null};}});
    register({name:'read_tracker_selection',title:'Read selected projects',description:'Read the projects currently selected in the visible source panel.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(){const r=window.DNC_REVIEW.getResult();return {projects:(r?.rows||[]).map(p=>({id:p.id,name:p.name,venue:p.venue}))};}});
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  }
})();
