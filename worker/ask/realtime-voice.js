(() => {
  'use strict';
  const $ = id => document.getElementById(id), review = window.DNC_REVIEW;
  let current = null, mode = false, serial = 0;
  const status = text => { $('voiceStatus').textContent = text; };
  function controls() {
    const active = !!current?.ready, connecting = !!current && !active;
    $('voiceStart').disabled = !!current || review.isBusy() || !window.DNC_HOSTED_AI_READY;
    $('voiceStart').hidden = active;
    $('voiceStart').textContent = connecting ? 'Connecting…' : 'Start conversation';
    $('voiceEnd').hidden = !current;
    $('voiceMute').hidden = !active;
    $('voiceInterrupt').hidden = !active;
    $('voiceMute').textContent = current?.muted ? 'Unmute microphone' : 'Mute microphone';
    $('voiceMute').setAttribute('aria-pressed', String(!!current?.muted));
    $('voicePanel').dataset.active = String(active && !current.muted);
    $('composerHint').textContent = active ? (current.muted ? 'Microphone muted · Voice answers remain on' : 'Voice connected · Speak naturally, or type to switch to quiet chat') : mode ? 'Microphone off · Select Start conversation' : 'Quiet mode · microphone and audio off';
  }
  function selectMode(voice) {
    mode = voice;
    if (!voice) end();
    $('voicePanel').hidden = !voice;
    $('voiceMode').setAttribute('aria-pressed', String(voice));
    $('quietMode').setAttribute('aria-pressed', String(!voice));
    controls();
  }
  function send(session, event) {
    if (session === current && session.channel?.readyState === 'open') session.channel.send(JSON.stringify(event));
  }
  function hangup(token) {
    if (token) window.DNC_HOSTED_API('/api/assistant/voice', { action: 'end', voiceToken: token }, { keepalive: true }).catch(() => {});
  }
  function end(note = 'Conversation ended. Microphone and audio are off.') {
    const session = current; current = null;
    if (session) {
      for(const [id,text] of session.transcripts)window.DNC_HISTORY?.record('assistant',id,text);
      window.DNC_HISTORY?.flush().catch(()=>{});
      clearTimeout(session.goodbyeTimer); clearTimeout(session.connectTimer); clearInterval(session.clock); clearTimeout(session.disconnectTimer);
      session.stream?.getTracks().forEach(track => track.stop());
      session.channel?.close(); session.peer?.close();
      if (session.audio) { session.audio.pause(); session.audio.srcObject = null; session.audio.remove(); }
      hangup(session.token);
    }
    $('voicePlayback').hidden = true;
    $('voiceElapsed').textContent = '';
    status(note); controls();
  }
  function fail(message) { end(message); }
  function refreshStatus(session) {
    if (session !== current) return;
    if(session.idleClosing){status('Ending conversation · Microphone off');return;}
    status(session.pending ? 'Checking your project records…' : session.muted ? 'Microphone muted. You can still hear the answer.' : session.speaking ? 'Listening…' : session.playing ? 'Speaking · You can interrupt' : 'Listening · Ask a question or follow up');
  }
  function noiseKind(text) {
    const t=text.toLowerCase().replace(/[.!?,…()[\]{}]/g,'').trim();
    if(/^(?:achoo|atchoo|sneeze|sneezes|sneezing)$/.test(t))return 'sneeze';
    return !t||/^(?:cough(?:s|ing)?|throat clearing|clears? throat|clearing throat|breathing|sigh(?:s)?|background noise|noise|silence|inaudible|unintelligible|um+|uh+|hmm+|mhm+|erm+|음|어)$/.test(t)?'ignore':'speech';
  }
  function courtesy(session,text,kind) {
    session.courtesy={text,kind}; respond(session);
  }
  function farewell(text){
    const t=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N} ]/gu,' ').replace(/\s+/g,' ').trim();
    const prefix='(?:(?:okay|ok|well|alright|all right|thanks(?: for (?:trying|your help|the help|everything|that))?|thank you(?: for (?:trying|your help|the help|everything|that))?|and|thats all(?: for (?:now|tonight))?|im done(?: for (?:now|tonight))?) )*';
    const ending='(?:good ?bye|bye(?: bye)?|good ?night|see you (?:later|tomorrow)|end (?:the |this |our )?(?:voice )?(?:conversation|chat))';
    const suffix='(?: (?:please|thanks|thank you|and thank you|for now|take care|chat|tracker))*';
    if(new RegExp('^'+prefix+ending+suffix+'$').test(t))return /night/.test(t)?'Good night. Take care.':'Goodbye. Take care.';
    if(/^(?:καληνυχτα|αντιο)(?: (?:και ευχαριστω|ευχαριστω|σας|σου))*$/.test(t))return 'Καληνύχτα. Να είσαι καλά.';
    if(/^(?:adios|hasta luego|hasta manana)$/.test(t))return 'Adiós. Que estés bien.';
    if(/^(?:au revoir|bonne nuit)$/.test(t))return 'Au revoir. Prenez soin de vous.';
    if(/^(?:auf wiedersehen|gute nacht)$/.test(t))return 'Auf Wiedersehen.';
    if(t==='晚安'||t==='再见')return '再见。';
    return null;
  }
  function finishVoice(session,message,note){
    if(session!==current||session.idleClosing)return;
    session.idleClosing=true;session.endNote=note;session.wantResponse=false;session.awaitingTranscript=false;session.speaking=false;
    session.stream?.getTracks().forEach(track=>track.stop());
    if(session.responseActive)send(session,{type:'response.cancel'});
    if(session.playing)send(session,{type:'output_audio_buffer.clear'});
    courtesy(session,message,'goodbye');
    session.goodbyeTimer=setTimeout(()=>{if(current===session)end(note);},12000);
  }
  function idleCheck(session) {
    const quiet=Date.now()-session.lastUserAt;
    if(quiet>=25*60000&&!session.idleClosing){
      finishVoice(session,'Goodbye for now. I am turning off voice.','Voice ended after 25 minutes without a reply. Microphone and audio are off.');
    }else if(quiet>=20*60000&&!session.idlePrompted&&!session.idleClosing){
      session.idlePrompted=true;
      courtesy(session,'Is there anything else I can help you with? I will turn off voice in five minutes if there is no reply.','check-in');
    }
  }
  function respond(session) {
    if (session !== current || session.responseActive || session.speaking || (session.pending&&!session.idleClosing) || session.awaitingTranscript) return;
    if(session.courtesy){const note=session.courtesy;session.courtesy=null;session.responseActive=true;session.courtesyKind=note.kind;send(session,{type:'response.create',response:{tool_choice:'none',max_output_tokens:180,instructions:'Say only this brief courtesy, without project facts or tool calls: '+note.text}});return;}
    if(!session.wantResponse||session.idleClosing)return;
    session.wantResponse = false; session.responseActive = true;session.courtesyKind=null;
    send(session, { type: 'response.create' });
  }
  // Send only the selected answer/excerpt to the voice model, never the whole snapshot or photo bytes.
  function voiceResult(result) {
    if (!result) return { ok: false, message: 'The project query failed. Ask the user to try again; do not reuse earlier results.' };
    const rows = result.rows || [], table = result.table ? (window.DNCTableExports?.view(result)||result.table) : null;
    const needsClarification=!!result.retainContext||['unsupported','clarify','refuse'].includes(result.intent);
    const out = { ok: !needsClarification, needsClarification, intent: result.intent, message: result.message || null, title: result.title || null, projectCount: rows.length,
      snapshotDate: window.DNC_ASSISTANT_DATA.meta.snapshot_at.slice(0, 10), reportingThrough: window.DNC_ASSISTANT_DATA.meta.latest_reporting_period,
      filters: result.filters || [], notes: result.notes || [], displayedOnScreen: true,
      downloadsOnScreen: (rows.length || table?.rows?.length) && (result.intent === 'table' || result.requestedFormats?.length) ? ['pdf', 'xlsx'] : [],
      downloadStatus: 'Buttons are available when listed; the user clicks to generate and save the file. Pagination has not been checked yet.',
    };
    if (result.summary) out.summary = result.summary;
    if (table) out.table = { columns: table.columns, rows: table.rows.filter(r=>!r.isTotal).slice(0, 3).map(r=>Object.fromEntries(['id',...table.columns.map(c=>c.key)].filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]))), totalRow:table.totalRow||null, totalRows: table.rows.filter(r=>!r.isTotal).length, excerptOnly: table.rows.length > 3, layout:table.hierarchical?'business unit then venue':'flat list in query order' };
    out.selectionProjectCount=result.selectionIds?.length||rows.length;
    out.spokenSummary=needsClarification?result.message:table?'The screen shows '+table.rows.filter(r=>!r.isTotal).length+(table.grouped?' summary rows covering ':' individual project rows covering ')+rows.length+' projects. The displayed columns are '+table.columns.map(c=>c.label).join(', ')+(table.totalRow?'. A grand total row is included.':'.'):result.message||'The result covers '+rows.length+' projects. Refer to the returned facts for the answer.';
    if (result.analysis) { out.analysis = result.analysis.slice(0, 6).map(x => ({ text: x.text.slice(0, 1800), sourceProjectIds: x.project_ids })); out.analysisMayBeExcerpt = result.analysis.length > 6 || result.analysis.some(x => x.text.length > 1800); }
    if (result.updates) out.updates = result.updates.slice(0, 3).map(x => ({ projectId: x.project.id, project: x.project.name, date: x.latest.reporting_period, text: x.latest.current_summary.slice(0, 1800), previous: result.intent === 'compare' ? (x.history[1]?.current_summary || x.latest.previous_summary || '').slice(0, 1800) : undefined }));
    if (!table && !result.analysis && !result.updates) out.projects = rows.slice(0, 3).map(p => ({ id: p.id, name: p.name, venue: p.venue, status: p.status }));
    if (result.photos) out.photoCount = result.photos.length;
    return out;
  }
  function executeTool(session, call) {
    if (session.idleClosing || session.handled.has(call.call_id)) return;
    session.handled.add(call.call_id); session.pending++; refreshStatus(session);
    session.queue = session.queue.then(async () => {
      if (session !== current || session.idleClosing) return;
      let output;
      try {
        session.toolAttempts=(session.toolAttempts||0)+1;
        if(session.toolAttempts>2)throw new Error('This request has already been retried. It could not be completed correctly. Explain the issue and wait for the user; do not call the tool again for this turn.');
        const args = JSON.parse(call.arguments);
        if (call.name !== 'ask_tracker' || typeof args.question !== 'string' || !args.question.trim() || args.question.length > 4000) throw new Error('Please repeat the project question.');
        const result = await review.ask(args.question, { voice: true });
        if (session !== current || session.idleClosing) return;
        output = voiceResult(result);
        const fingerprint=JSON.stringify({intent:result?.intent,table:result?.table,message:result?.message});
        if(session.toolAttempts>1&&fingerprint===session.lastToolFingerprint)output={ok:false,message:'The retry returned the same result. Do not claim the requested changes were made or suggest that downloads contain missing detail. Explain that the request could not be completed and wait for the user.'};
        session.lastToolFingerprint=fingerprint;
      } catch (error) { output = { ok: false, message: error.message || 'The query failed. Please try again.' }; }
      send(session, { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) } });
      session.wantResponse = session.toolAttempts<=2;
      if(!session.wantResponse)status("That request could not be completed. Please ask a new question or use quiet chat.");
    }).finally(() => { session.pending--; refreshStatus(session); respond(session); });
  }
  function eventReceived(session, event) {
    if (session !== current) return;
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        session.toolAttempts=0;session.lastToolFingerprint=null;session.awaitingTranscript=true;
        session.speaking = true;
        review.transcript('user', event.item_id, 'Listening…');
        refreshStatus(session); break;
      case 'input_audio_buffer.speech_stopped':
        session.speaking = false; status('Understanding your question…'); break;
      case 'conversation.item.input_audio_transcription.completed':
        {
         session.awaitingTranscript=false;
         const text=(event.transcript||'').trim(),kind=noiseKind(text);
         session.speaking=false;
         const goodbye=kind==='speech'?farewell(text):null;
         if(goodbye&&!session.idleClosing){review.transcript('user',event.item_id,text);window.DNC_HISTORY?.record('user',event.item_id,text);window.DNC_USER_ACTIVITY?.();finishVoice(session,goodbye,'Conversation ended. Microphone and audio are off.');break;}
         if(kind==='speech'&&!session.idleClosing){
           session.lastUserAt=Date.now();session.idlePrompted=false;session.courtesy=null;
           window.DNC_USER_ACTIVITY?.();
           if(session.responseActive&&!session.pending)send(session,{type:'response.cancel'});
           if(session.playing)send(session,{type:'output_audio_buffer.clear'});
           review.transcript('user',event.item_id,text);window.DNC_HISTORY?.record('user',event.item_id,text);session.wantResponse=true;
         }else{review.removeTranscript?.(event.item_id);send(session,{type:'conversation.item.delete',item_id:event.item_id});if(kind==='sneeze'&&!session.idleClosing)courtesy(session,'God bless you.','sneeze');}
         respond(session);
        }break;
      case 'conversation.item.input_audio_transcription.failed':
        session.awaitingTranscript=false;review.removeTranscript?.(event.item_id);status('I could not hear that clearly. Please repeat it.');break;
      case 'response.output_audio_transcript.delta': {
        const text = (session.transcripts.get(event.item_id) || '') + event.delta;
        session.transcripts.set(event.item_id, text); review.transcript('assistant', event.item_id, text); break;
      }
      case 'response.output_audio_transcript.done':
        {const text=event.transcript || session.transcripts.get(event.item_id) || '';review.transcript('assistant', event.item_id,text);window.DNC_HISTORY?.record('assistant',event.item_id,text);} break;
      case 'response.created': session.responseActive = true; break;
      case 'response.done':
        session.responseActive = false;
        if (event.response?.status === 'failed') status('The spoken answer failed. Please try asking again.');
        if (event.response?.status === 'completed') for (const item of event.response.output || []) if (item.type === 'function_call') executeTool(session, item);
        respond(session); break;
      case 'output_audio_buffer.started': session.playing = true;if(session.idleClosing&&session.courtesyKind==='goodbye')session.goodbyePlaying=true; refreshStatus(session); break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared': session.playing = false;if(session.idleClosing&&session.courtesyKind==='goodbye'&&session.goodbyePlaying&&event.type==='output_audio_buffer.stopped'){end(session.endNote||'Conversation ended. Microphone and audio are off.');break;}refreshStatus(session); break;
      case 'error':
        if (['response_cancel_not_active', 'input_audio_buffer_commit_empty', 'output_audio_buffer_empty'].includes(event.error?.code)) break;
        // Do not disclose raw provider payloads, session identifiers, or credentials.
        if (/insufficient_quota|rate_limit|invalid_api_key|model_not_found/.test(event.error?.code || '')) fail('OpenAI voice reached an account or usage limit. Typed chat remains available.');
        else status('Voice could not complete that turn. Try again, or end and restart the conversation.');
        break;
    }
  }
  async function start() {
    if (current || review.isBusy()) return;
    if (!window.DNC_HOSTED_AI_READY) return status('The server API connection is not configured.');
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return status('This browser does not support microphone conversations. Try a current Chrome, Edge, or Safari browser.');
    if ($('engineSelect').value !== 'ai') { $('engineSelect').value = 'ai'; $('engineSelect').dispatchEvent(new Event('change')); }
    const session = { id: ++serial, ready: false, muted: false, pending: 0, handled: new Set(), transcripts: new Map(), queue: Promise.resolve(), responseActive: false, wantResponse: false };
    current = session; controls(); status('Allow microphone access to begin.');
    try {
      // The microphone starts only after this explicit Start button and browser permission.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (current !== session) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream;
      const peer = session.peer = new RTCPeerConnection();
      const audio = session.audio = document.createElement('audio');
      audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.hidden = true; document.body.append(audio);
      peer.ontrack = e => { if (current !== session) return; audio.srcObject = e.streams[0] || new MediaStream([e.track]); audio.play().catch(() => { if (current === session) $('voicePlayback').hidden = false; }); };
      for (const track of stream.getAudioTracks()) { peer.addTrack(track, stream); track.addEventListener('ended', () => { if (current === session && !session.idleClosing) end('Microphone disconnected. Select Start to reconnect.'); }); }
      const channel = session.channel = peer.createDataChannel('oai-events');
      channel.onmessage = e => { try { eventReceived(session, JSON.parse(e.data)); } catch { status('A voice message could not be read. Please try again.'); } };
      channel.onclose = () => { if (current === session) end('Voice disconnected. Select Start to reconnect.'); };
      channel.onopen = () => {
        if (current !== session) return;
        session.ready = true; session.started = Date.now();session.lastUserAt=session.started; clearTimeout(session.connectTimer); controls(); refreshStatus(session);
        session.clock = setInterval(() => {
          if (current !== session) return;
          const seconds = Math.floor((Date.now() - session.started) / 1000);
          const minutes=session.maxMinutes||60;
          idleCheck(session);
          $('voiceElapsed').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + ' / '+minutes+':00';
          if (seconds >= minutes*60) end('Voice paused after '+minutes+' minutes. Select Start to continue with this conversation.');
        }, 1000);
        session.responseActive = true;
        const recap=review.resume?.();
        if(recap?.turns?.length||recap?.selection)send(session,{type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Saved-conversation recap for continuity only. This is not a new request. Historical text and result metadata: '+JSON.stringify(recap)}]}});
        send(session, { type: 'response.create', response: { tool_choice:'none',max_output_tokens:180,instructions:'Start with this exact greeting: '+(window.DNC_GREETING?.()||'Good day. How can I help you today?')+' Then wait for the user. Do not repeat or execute earlier questions, mention retrieval dates, or invent project facts.' } });
      };
      peer.onconnectionstatechange = () => {
        if (current !== session) return;
        clearTimeout(session.disconnectTimer);
        if (peer.connectionState === 'failed') fail('The audio connection failed. Try again or use typed chat.');
        if (peer.connectionState === 'disconnected') session.disconnectTimer = setTimeout(() => { if (current === session) end('The audio connection was lost. Select Start to reconnect.'); }, 10000);
      };
      status('Connecting to OpenAI voice…');
      session.connectTimer = setTimeout(() => { if (current === session) fail('The voice connection timed out. Please try again.'); }, 35000);
      await peer.setLocalDescription(await peer.createOffer());
      const answer = await window.DNC_HOSTED_API('/api/assistant/voice', { action: 'start', sdp: peer.localDescription.sdp });
      if (current !== session) { hangup(answer.voiceToken); return; }
      session.token = answer.voiceToken;
      session.maxMinutes=Math.min(60,Math.max(1,answer.maxMinutes||60));
      await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    } catch (error) {
      if (current !== session) return;
      const message = error.name === 'NotAllowedError' ? 'Microphone access was declined. Allow the microphone for this site in your browser, then select Start.' : error.name === 'NotFoundError' ? 'No microphone was found. Connect a microphone and try again.' : error.name === 'NotReadableError' ? 'The microphone is unavailable. Check whether another application is using it.' : error.message || 'Voice could not connect. Please try again.';
      fail(message);
    }
  }
  $('voiceStart').onclick = start;
  $('voiceEnd').onclick = () => end();
  $('voiceMute').onclick = () => {
    if (!current?.ready) return;
    current.muted = !current.muted;
    current.stream.getAudioTracks().forEach(track => { track.enabled = !current.muted; });
    if (current.muted) { send(current, { type: 'input_audio_buffer.clear' }); current.speaking = false; }
    controls(); refreshStatus(current);
  };
  $('voiceInterrupt').onclick = () => {
    if (!current?.ready) return;
    if (current.responseActive) send(current, { type: 'response.cancel' });
    if (current.playing) send(current, { type: 'output_audio_buffer.clear' });
    current.wantResponse = false; status('Stopped speaking. Ask your next question.');
  };
  $('voicePlayback').onclick = async () => { if (current?.audio) { try { await current.audio.play(); $('voicePlayback').hidden = true; } catch { status('Your browser blocked audio playback. Check its sound permissions.'); } } };
  $('voiceMode').onclick = () => selectMode(true);
  $('quietMode').onclick = () => selectMode(false);
  for (const id of ['unitScope', 'newConversation', 'engineSelect']) $(id).addEventListener(id === 'newConversation' ? 'click' : 'change', () => { if (current) end('Voice ended because the conversation or search scope changed. Select Start to continue.'); }, { capture: true });
  window.addEventListener('dnc:busy', controls);
  window.addEventListener('pagehide', () => end());
  window.DNC_VOICE = { end, quiet: () => selectMode(false), active: () => !!current };
  controls();
})();
