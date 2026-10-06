// The voice call, driven through the real state machine.
//
// There is no WebRTC in the harness, so the peer connection and the microphone
// are stood in for and the data channel is driven directly with the events the
// Realtime service sends. What that leaves under test is everything this phase
// is about: that a call keeps listening by itself, that nothing in the
// conversation is lost to an interruption or a noise, and that mute, stop and
// end each do one thing.
//
//   node scripts/voice-flow-test.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { createBrowser } = await import(`${root}/scripts/browser-harness.mjs`);
const database = new DatabaseSync(":memory:");
for (const n of ["0000_dnc_project_hub.sql","0001_workbook_structure_and_roles.sql","0002_user_directory.sql","0003_development_pipeline_and_directory.sql","0004_pilot_authentication.sql","0005_profile_photos.sql","0006_enhanced_media_and_revisions.sql","0007_photo_details.sql"])
  database.exec(await readFile(`${root}/drizzle/${n}`, "utf8"));
const DB = { prepare(q){const st=database.prepare(q);const r=(b)=>({all:async()=>({results:st.all(...b)}),first:async()=>st.get(...b)??null,run:async()=>({success:true,meta:st.run(...b)})});return {bind:(...b)=>r(b),...r([])}}, batch:async(p)=>Promise.all(p.map(x=>x.run())) };
const worker = (await import(`${root}/dist/server/index.js`)).default;
const headers = {"oai-authenticated-user-id":"v","oai-authenticated-user-email":"v@example.invalid","oai-authenticated-user-full-name":"V","oai-authenticated-user-full-name-encoding":"percent-encoded-utf-8","content-type":"application/json"};
const C = "id, name, business_unit, status, budget_risk, schedule_risk, approved_budget, "
  + "anticipated_final_cost, forecast_variance, duration_change_days, current_update, reporting_period, venue, project_manager";
const generator = { async generate(question){
  const q=String(question).toLowerCase();
  const sql = q.includes("corporate") ? `SELECT ${C} FROM projects WHERE business_unit='Corporate'`
    : q.includes("risk") ? `SELECT ${C} FROM projects WHERE schedule_risk='High'`
    : `SELECT ${C} FROM projects WHERE business_unit='Gaming'`;
  return { intent:"search", language:"English", message:null, sql, usage:{model:"stub"} };
} };
const answerer = { async answer(question,result){ return { text:`There are ${result.total} ${result.entityLabel}.`, usage:{} }; } };
const env = { DB, ADMIN_EMAILS:"v@example.invalid", ALLOW_PLATFORM_AUTH:"true",
  ASSISTANT_SQL:generator, ASSISTANT_ANSWERER:answerer,
  ASSISTANT_CONTEXT_SECRET:"voice", ASSISTANT_DEBUG:"true" };
await worker.fetch(new Request("https://v/api/bootstrap",{headers}),env,{});
const pw = "Zz9!"+crypto.randomUUID();
await worker.fetch(new Request("https://v/api/admin/users",{method:"POST",headers,body:JSON.stringify({
  first_name:"V",last_name:"User",username:"vu@example.invalid",user_email:"vu@example.invalid",role:"viewer",
  business_unit_scope:"All",account_status:"active",site_access_status:"authorized",
  temporary_password:pw,confirm_password:pw})}),env,{});
database.prepare("UPDATE user_directory SET must_change_password=0 WHERE lower(username)=?").run("vu@example.invalid");
const page = await (await worker.fetch(new Request("https://v/",{headers:{cookie:""}}),env,{})).text();
// Minting a realtime credential needs the account key and reaches OpenAI, so
// that one route is answered locally. Everything else goes to the real worker,
// including /api/assistant/ask, which is what the call actually queries with.
const handler = async (request) => {
  // The SDP exchange goes straight to OpenAI from the browser. Answered here,
  // because there is no WebRTC to negotiate with.
  if (String(request.url).includes("api.openai.com")) {
    return new Response("v=0\r\n", { status: 200, headers: { "content-type": "application/sdp" } });
  }
  if (new URL(request.url).pathname === "/api/assistant/voice-session") {
    return new Response(JSON.stringify({
      clientSecret: "ek_test", expiresAt: Math.floor(Date.now()/1000)+600, model: "gpt-realtime-2.1-mini",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return worker.fetch(request, env, {});
};
const browser = await createBrowser({page,handler}).start();
browser.type("loginUsername","vu@example.invalid"); browser.type("loginPassword",pw);
await browser.fire("loginForm","submit").results; await browser.settle();
await browser.fire("askNav","click").results; await browser.settle();

// --- A microphone and a peer connection, standing in ------------------------
const sent = [];
const track = { kind:"audio", enabled:true, stopped:false, stop(){this.stopped=true} };
const channel = {
  listeners:{}, readyState:"open",
  addEventListener(type,fn){ (this.listeners[type]=this.listeners[type]||[]).push(fn); },
  send(data){ sent.push(JSON.parse(data)); },
  close(){ this.readyState="closed"; },
  emit(type,payload){ for(const fn of this.listeners[type]||[]) fn(payload); },
};
const win = browser.window;
// The client reads a bare `navigator`, which in Node resolves to the global one
// and has no mediaDevices. Replacing it is how the microphone is stood in for.
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { mediaDevices: { getUserMedia: async () => ({
    getTracks: () => [track], getAudioTracks: () => [track],
  }) } },
});
const FakePeer = function(){
  this.connectionState="connected";
  this.createDataChannel=()=>channel;
  this.addTrack=()=>{}; this.close=()=>{};
  this.createOffer=async()=>({type:"offer",sdp:"v=0"});
  this.setLocalDescription=async()=>{}; this.setRemoteDescription=async()=>{};
  this.addEventListener=()=>{};
};
// The guard reads window.RTCPeerConnection; the constructor call is a bare
// global. Both have to be there.
win.RTCPeerConnection = FakePeer;
Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: FakePeer });

const say = (type, extra={}) => channel.emit("message",{data:JSON.stringify({type,...extra})});
const toolCall = (question, callId="c"+Math.random()) => {
  say("response.function_call_arguments.done",{name:"ask_tracker",call_id:callId,arguments:JSON.stringify({question})});
};
const settle = () => browser.settle();
const state = () => browser.byId("askOrb").getAttribute("data-state");
const heading = () => browser.text("askVoiceState");
const turns = () => browser.byId("askThread").querySelectorAll(".ask-turn").length;
const thread = () => browser.byId("askThread").textContent;

let checks = 0;
const check = async (label, fn) => {
  try { await fn(); } catch (problem) { problem.message = `${label}\n   ${problem.message}`; throw problem; }
  checks++;
  console.log(`  ok   ${label}`);
};

await browser.fire("askVoiceMode","click").results; await settle();
await check("the conversation is the content; the voice bar sits under it", () => {
  assert.equal(browser.byId("askVoicePanel").hidden, false, "the bar is shown in voice mode");
  assert.equal(browser.byId("askForm").hidden, true, "and the typing composer steps aside");
  assert.ok(browser.byId("askThread"), "the transcript is still the main area");
  assert.equal(browser.byId("askVoiceBtnLabel").textContent, "Start call");
  assert.equal(browser.byId("askMuteBtn").hidden, true, "mute is offered only on a call");
  assert.equal(browser.byId("askStopBtn").hidden, true, "and stop only while speaking");
});

await browser.fire("askVoiceBtn","click").results; await settle();
channel.emit("open");
await settle();
await check("a call opens listening, with nothing to press", () => {
  assert.equal(state(), "listening");
  assert.equal(heading(), "Listening");
  assert.equal(browser.byId("askVoiceBtnLabel").textContent, "End call");
  assert.equal(browser.byId("askMuteBtn").hidden, false, "mute is now offered");
});

// --- Three consecutive questions, with no press between them ----------------
const askAloud = async (question) => {
  say("input_audio_buffer.speech_started"); await settle();
  say("conversation.item.input_audio_transcription.completed",{transcript:question}); await settle();
  say("input_audio_buffer.speech_stopped"); await settle();
  toolCall(question); await settle();
  say("response.created"); await settle();
  say("response.output_audio.delta",{delta:"..."}); await settle();
  say("response.done"); await settle();
};
await askAloud("Show me Gaming projects");
await check("a spoken question is answered and the call goes back to listening", () => {
  assert.match(thread(), /Show me Gaming projects/, "the question is in the transcript, in their words");
  assert.match(thread(), /There are 30 projects/, "and so is the answer");
  assert.equal(state(), "listening", "listening resumed by itself");
  assert.match(browser.text("askRailLabel"), /Result 1 of 1/, "and it made a result set");
});
await askAloud("Which of those are high schedule risk");
await askAloud("Show me Corporate projects");
await check("three questions in a row, each its own result set", () => {
  assert.match(browser.text("askRailLabel"), /Result 3 of 3/);
  assert.equal(turns(), 6, "six articles: three questions and three answers");
  const text = thread();
  assert.ok(text.indexOf("Show me Gaming projects") < text.indexOf("Show me Corporate projects"),
    "in the order they were asked");
});

// --- Background speech, interruption and stop -------------------------------
await check("a noise that transcribes to nothing does not become the question", async () => {
  const before = thread();
  say("conversation.item.input_audio_transcription.completed",{transcript:"  . "});
  await settle();
  toolCall("show me the projects"); await settle();
  say("response.created"); say("response.done"); await settle();
  assert.ok(!thread().includes('">  . '), "punctuation did not land as a question");
  assert.ok(before.length < thread().length, "the turn still happened, with the tool's own wording");
});
await check("speech while the assistant is answering does not cancel it", async () => {
  say("response.created"); await settle();
  say("response.output_audio.delta",{delta:"..."}); await settle();
  assert.equal(state(), "speaking");
  const before = turns();
  // interrupt_response is off, so the service sends no cancellation; what
  // arrives is only that someone started talking.
  say("input_audio_buffer.speech_started"); await settle();
  assert.equal(state(), "speaking", "the reply is still being spoken");
  assert.equal(turns(), before, "and nothing was removed from the transcript");
  say("response.done"); await settle();
  assert.equal(state(), "listening");
});
await check("Stop speaking ends the reply and keeps the conversation", async () => {
  say("response.created"); say("response.output_audio.delta",{delta:"..."}); await settle();
  assert.equal(state(), "speaking");
  assert.equal(browser.byId("askStopBtn").hidden, false, "stop is offered while speaking");
  const before = turns(); const rail = browser.text("askRailLabel");
  sent.length = 0;
  await browser.fire("askStopBtn","click").results; await settle();
  assert.ok(sent.some((m) => m.type === "response.cancel"), "the response is cancelled");
  assert.ok(sent.some((m) => m.type === "output_audio_buffer.clear"), "and the buffered audio dropped");
  assert.equal(state(), "listening", "the call carries on listening");
  assert.equal(turns(), before, "the transcript is untouched");
  assert.equal(browser.text("askRailLabel"), rail, "and so are the result sets");
});

// --- Mute -------------------------------------------------------------------
await check("Mute stops the microphone without ending the call", async () => {
  const before = turns();
  await browser.fire("askMuteBtn","click").results; await settle();
  assert.equal(track.enabled, false, "the microphone track is disabled");
  assert.equal(state(), "muted", "and the bar says so");
  assert.equal(heading(), "Muted");
  assert.equal(browser.text("askMuteLabel"), "Unmute");
  assert.equal(browser.byId("askVoiceBtnLabel").textContent, "End call", "the call is still running");
  assert.equal(turns(), before, "and the conversation is untouched");
  await browser.fire("askMuteBtn","click").results; await settle();
  assert.equal(track.enabled, true, "unmute turns it back on");
  assert.equal(state(), "listening");
});

// --- The records, and the two buttons --------------------------------------
await check("Show these records opens that answer's set, not the newest", async () => {
  const buttons = [...browser.byId("askThread").querySelectorAll("[data-ask-set]")];
  assert.ok(buttons.length >= 3, "every answer with records offers one");
  await browser.fire(buttons[0],"click").results; await settle();
  assert.match(browser.text("askRailLabel"), /Result 1 of/, "the first answer's set");
  assert.match(browser.text("askEvidenceTitle"), /Gaming/, "showing its own question");
  await browser.fire(buttons[1],"click").results; await settle();
  assert.match(browser.text("askRailLabel"), /Result 2 of/, "and the second answer's set");
});
await check("Draft briefing builds from that answer's set", async () => {
  const grabbed = [];
  const RealBlob = globalThis.Blob;
  globalThis.Blob = function(parts,opts){ grabbed.push(String(parts[0])); return new RealBlob(parts,opts); };
  const make = browser.document.createElement.bind(browser.document);
  browser.document.createElement = function(tag){ const el=make(tag);
    if(typeof el.click!=="function")el.click=()=>{}; if(typeof el.remove!=="function")el.remove=()=>{}; return el; };
  const briefs = [...browser.byId("askThread").querySelectorAll("[data-ask-brief]")];
  await browser.fire(briefs[0],"click").results; await settle();
  assert.match(browser.text("askEvidenceTitle"), /Briefing preview/);
  assert.match(browser.text("askRailLabel"), /Result 1 of/, "on the set that answer produced");
  await browser.fire(browser.byId("askDownload"),"click").results; await settle();
  assert.ok(grabbed.length, "a briefing was written");
  assert.match(grabbed[0], /Show me Gaming projects/, "for that question, not the latest");
  globalThis.Blob = RealBlob;
});
await check("the chevrons still move between sets after voice turns", async () => {
  const before = browser.text("askEvidenceTitle");
  await browser.fire("askNewer","click").results; await settle();
  assert.notEqual(browser.text("askEvidenceTitle"), before);
  await browser.fire("askOlder","click").results; await settle();
  assert.equal(browser.text("askEvidenceTitle"), before, "and back again");
});
await check("no SQL, model or debug detail appears while on a call", () => {
  const everything = browser.document.body.textContent;
  for (const leak of ["SELECT","FROM projects","WITH projects AS","gpt-","inputTokens","business_unit ="]) {
    assert.ok(!everything.includes(leak), `"${leak}" is on screen during a call`);
  }
});

// --- End --------------------------------------------------------------------
await check("End ends the call and keeps everything else", async () => {
  const before = turns(); const rail = browser.text("askRailLabel");
  await browser.fire("askVoiceBtn","click").results; await settle();
  assert.equal(state(), "idle", "the bar is at rest");
  assert.equal(heading(), "Not connected");
  assert.equal(browser.byId("askVoiceBtnLabel").textContent, "Start call");
  assert.equal(track.stopped, true, "the microphone is released");
  assert.equal(browser.byId("askMuteBtn").hidden, true, "mute is withdrawn");
  assert.equal(turns(), before, "the transcript survives the call");
  assert.equal(browser.text("askRailLabel"), rail, "and so do the result sets");
});
await check("and the conversation continues by typing, in the same thread", async () => {
  await browser.fire("askQuietMode","click").results; await settle();
  const before = turns();
  browser.type("askInput","Show me Corporate projects");
  await browser.fire("askForm","submit").results; await settle();
  assert.equal(turns(), before + 2, "the typed turn joins the spoken ones");
  assert.match(thread(), /Show me Gaming projects/, "the spoken questions are still there");
});

console.log(`\nVoice flow: ${checks} checks — continuous listening, three consecutive questions, background speech, interruption, stop, mute, end, result-set buttons and chevrons.`);
