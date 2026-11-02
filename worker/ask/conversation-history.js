(() => {
 'use strict';
 if(!window.DNC_HOSTED_AI_READY){document.getElementById('historyStatus').textContent='Conversation saving is unavailable in guided mode.';document.getElementById('savedConversation').disabled=true;document.getElementById('historyRefresh').disabled=true;document.getElementById('historyExport').addEventListener('click',()=>window.DNC_REVIEW.exportTranscript());return;}
 const $=id=>document.getElementById(id),review=window.DNC_REVIEW,api=window.DNC_HOSTED_API;
 const pending=new Map();let saving=null,timer=null;
 const status=text=>{$('historyStatus').textContent=text;};
 async function flush(){
  clearTimeout(timer);if(saving){await saving;if(pending.size)return flush();return;}
  if(!pending.size)return;
  const entries=[...pending.values()].slice(0,2);
  saving=api('/api/assistant/history',{action:'transcripts',entries},{keepalive:true}).then(()=>{entries.forEach(e=>{if(pending.get(e.id)===e)pending.delete(e.id);});status('Conversation saved');}).catch(()=>{status('Conversation text has not saved. Select Retry save before leaving.');$('historyRetry').hidden=false;throw new Error('Conversation text could not be saved.');}).finally(()=>{saving=null;});
  await saving;$('historyRetry').hidden=true;if(pending.size)return flush();
 }
 function record(role,id,text){if(!text||text==='Listening…')return;pending.set(id,{id,role,text:text.slice(0,16000),createdAt:pending.get(id)?.createdAt||review.transcriptTime?.(id)||Date.now()});status('Saving conversation…');clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),250);}
 async function list(){const {threads}=await api('/api/assistant/history',{action:'list'});$('savedConversation').replaceChildren(new Option('Saved conversations',''),...threads.map(t=>new Option(t.title+' · '+window.DNC_TIME.format(t.started_at??t.first_saved_at??t.updated_at),t.id)));return threads;}
 async function open(id){
  window.DNC_VOICE?.quiet();review.setBusy(true);
  try{await flush();const {thread}=await api('/api/assistant/history',{action:'open',id});review.restore(thread);$('savedConversation').value=id;$('historyPicker').open=false;status('Conversation restored · voice can continue from here');}
  finally{review.setBusy(false);}
 }
 async function fresh(){await flush();const value=await api('/api/assistant/history',{action:'new'});review.setConversationStart(value.startedAt);status('New conversation');$('savedConversation').value='';await list();}
 $('savedConversation').addEventListener('change',()=>{if($('savedConversation').value)open($('savedConversation').value).catch(error=>status(error.message));});
 $('historyRefresh').onclick=()=>list().catch(()=>status('Saved conversations could not be loaded. Try again.'));
 $('historyRetry').onclick=()=>flush().catch(()=>{});
 $('historyExport').onclick=()=>review.exportTranscript();
 window.DNC_HISTORY={record,flush,fresh,status};
 window.addEventListener('pagehide',()=>flush().catch(()=>{}));
 if(window.DNC_HOSTED_AI_READY){review.setBusy(true);list().then(()=>status('Conversations save automatically · Open History to resume an earlier conversation')).catch(()=>status('History unavailable. New answers can still be displayed; use Export conversation to keep a copy.')).finally(()=>review.setBusy(false));}
})();
