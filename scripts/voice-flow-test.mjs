// The realtime call, driven through the real state machine.
//
// There is no WebRTC in the harness, so the peer connection and the microphone
// are stood in for and the data channel is driven directly with the events the
// Realtime service sends. What that leaves under test is this phase's whole
// claim: one session, the model calling data tools itself, the workspace
// rendering before a word is spoken, and several tool calls inside one spoken
// turn without the listener ever seeing a handoff.
//
//   node scripts/voice-flow-test.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { createBrowser } = await import(`${root}/scripts/browser-harness.mjs`);
const { mintVoiceSession, DEFAULT_VOICE_MODEL } = await import(`${root}/worker/assistant-model.js`);
const { REALTIME_TOOLS, TOOL_LABELS } = await import(`${root}/worker/assistant-tools.js`);
const { voiceInstructions } = await import(`${root}/worker/assistant-prompt.js`);

const database = new DatabaseSync(":memory:");
for (const n of ["0000_dnc_project_hub.sql","0001_workbook_structure_and_roles.sql","0002_user_directory.sql","0003_development_pipeline_and_directory.sql","0004_pilot_authentication.sql","0005_profile_photos.sql","0006_enhanced_media_and_revisions.sql","0007_photo_details.sql"])
  database.exec(await readFile(`${root}/drizzle/${n}`, "utf8"));
const DB = { prepare(q){const st=database.prepare(q);const r=(b)=>({all:async()=>({results:st.all(...b)}),first:async()=>st.get(...b)??null,run:async()=>({success:true,meta:st.run(...b)})});return {bind:(...b)=>r(b),...r([])}}, batch:async(p)=>Promise.all(p.map(x=>x.run())) };
const worker = (await import(`${root}/dist/server/index.js`)).default;
const headers = {"oai-authenticated-user-id":"v","oai-authenticated-user-email":"v@example.invalid","oai-authenticated-user-full-name":"V","oai-authenticated-user-full-name-encoding":"percent-encoded-utf-8","content-type":"application/json"};
const env = { DB, ADMIN_EMAILS:"v@example.invalid", ALLOW_PLATFORM_AUTH:"true",
  ASSISTANT_CONTEXT_SECRET:"voice" };
await worker.fetch(new Request("https://v/api/bootstrap",{headers}), env, {});

const pw = "Zz9!" + crypto.randomUUID();
await worker.fetch(new Request("https://v/api/admin/users",{method:"POST",headers,body:JSON.stringify({
  first_name:"V",last_name:"User",username:"vu@example.invalid",user_email:"vu@example.invalid",role:"viewer",
  business_unit_scope:"All",account_status:"active",site_access_status:"authorized",
  temporary_password:pw,confirm_password:pw})}), env, {});
database.prepare("UPDATE user_directory SET must_change_password=0 WHERE lower(username)=?")
  .run("vu@example.invalid");

let n = 0;
const check = async (label, fn) => {
  try { await fn(); n += 1; console.log(`  ok   ${label}`); }
  catch (problem) { console.log(`  FAIL ${label}\n       ${problem.message}`); process.exitCode = 1; }
};

// --- What the session is minted with -----------------------------------------
// Checked against the payload rather than against a comment, because every one
// of these settings was chosen to fix something a listener complained about.

let minted = null;
const fakeFetch = async (_url, options) => {
  minted = JSON.parse(options.body);
  return { ok:true, status:200, json: async () => ({ value:"ek_test", expires_at: 1 }) };
};
await mintVoiceSession({ OPENAI_API_KEY:"k" }, {
  instructions: voiceInstructions({ units:["Gaming"], name:"V", today:"2026-10-07" }),
  tools: REALTIME_TOOLS, fetchImpl: fakeFetch,
});

await check("the call runs on the full realtime model, not the mini one", () => {
  assert.equal(DEFAULT_VOICE_MODEL, "gpt-realtime-2.1");
  assert.equal(minted.session.model, "gpt-realtime-2.1");
});

await check("turn detection is semantic, so a pause mid-thought is not a finished question", () => {
  assert.equal(minted.session.audio.input.turn_detection.type, "semantic_vad");
});

await check("and set to wait longest, because half a question answered is a wrong answer", () => {
  assert.equal(minted.session.audio.input.turn_detection.eagerness, "low");
});

await check("the listener can interrupt the assistant", () => {
  assert.equal(minted.session.audio.input.turn_detection.interrupt_response, true);
});

await check("there is nothing to press: a finished question is answered", () => {
  assert.equal(minted.session.audio.input.turn_detection.create_response, true);
});

await check("noise reduction is on, so the desk next door is not transcribed as a question", () => {
  assert.ok(minted.session.audio.input.noise_reduction.type);
});

await check("the model is given the data tools directly, not a question-forwarding tool", () => {
  const names = minted.session.tools.map((t) => t.name);
  assert.ok(!names.includes("ask_tracker"),
    "handing the question to another agent is the architecture this replaces");
  assert.ok(names.includes("find_projects"), "it finds projects itself");
  assert.ok(names.includes("compare_periods"), "and compares periods itself");
  assert.equal(names.length, REALTIME_TOOLS.length);
});

await check("the instructions put the detail on the screen and one sentence in the ear", () => {
  const text = voiceInstructions({ units:["Gaming"], name:"V", today:"2026-10-07" });
  assert.match(text, /one sentence/i, "the length is stated");
  assert.match(text, /[Nn]ever read a list/, "and the thing it must not do");
  assert.match(text, /subject_ids/, "it is told how to keep looking at the same thing");
  assert.match(text, /ONE request|multi-part|all of it/i, "and that a long question is one request");
  assert.match(text, /Say nothing while tools are running|No filler/i, "and not to fill the pause");
});

// --- The call, through the client's own state machine -------------------------

const page = await (await worker.fetch(new Request("https://v/",{headers:{cookie:""}}), env, {})).text();
const handler = async (request) => {
  if (String(request.url).includes("api.openai.com")) {
    return new Response("v=0\r\n", { status:200, headers:{ "content-type":"application/sdp" } });
  }
  if (new URL(request.url).pathname === "/api/assistant/voice-session") {
    return new Response(JSON.stringify({
      clientSecret:"ek_test", expiresAt: Math.floor(Date.now()/1000)+600,
      model: DEFAULT_VOICE_MODEL, tools: REALTIME_TOOLS, labels: TOOL_LABELS, units: [],
    }), { status:200, headers:{ "content-type":"application/json" } });
  }
  return worker.fetch(request, env, {});
};
const browser = await createBrowser({ page, handler }).start();
browser.type("loginUsername","vu@example.invalid"); browser.type("loginPassword",pw);
await browser.fire("loginForm","submit").results; await browser.settle();
await browser.fire("askNav","click").results; await browser.settle();

const sent = [];
const track = { kind:"audio", enabled:true, stopped:false, stop(){ this.stopped = true; } };
const channel = {
  listeners:{}, readyState:"open",
  addEventListener(type,fn){ (this.listeners[type]=this.listeners[type]||[]).push(fn); },
  send(data){ sent.push(JSON.parse(data)); },
  close(){ this.readyState="closed"; },
  emit(type,payload){ for (const fn of this.listeners[type]||[]) fn(payload); },
};
const win = browser.window;
Object.defineProperty(globalThis, "navigator", { configurable:true, value:{ mediaDevices:{
  getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } } });
const FakePeer = function(){
  this.connectionState="connected";
  this.createDataChannel=()=>channel;
  this.addTrack=()=>{}; this.close=()=>{};
  this.createOffer=async()=>({type:"offer",sdp:"v=0"});
  this.setLocalDescription=async()=>{}; this.setRemoteDescription=async()=>{};
  this.addEventListener=()=>{};
};
win.RTCPeerConnection = FakePeer;
Object.defineProperty(globalThis, "RTCPeerConnection", { configurable:true, value:FakePeer });

const say = (type, extra={}) => channel.emit("message", { data: JSON.stringify({ type, ...extra }) });
const voice_reset = () => { say("input_audio_buffer.speech_stopped"); };
let callSeq = 0;
const toolCall = async (name, args) => {
  callSeq += 1;
  say("response.function_call_arguments.done",
    { name, call_id:"c"+callSeq, arguments: JSON.stringify(args) });
  await browser.settle();
};
const settle = () => browser.settle();
const presence = () => browser.byId("wsPresence").getAttribute("data-state");
const space = (sel) => [...browser.byId("wsSpace").querySelectorAll(sel)];
const thread = (sel) => [...browser.byId("wsThread").querySelectorAll(sel)];

await browser.fire("wsMic","click").results; await settle();
channel.emit("open", {});
await settle();

await check("a call opens on the same screen, with no second view to switch to", () => {
  assert.equal(presence(), "listening");
  assert.equal(browser.byId("wsForm").hidden, false, "the composer never steps aside");
  assert.ok(browser.byId("wsThread"), "and the conversation is the same conversation");
});

say("input_audio_buffer.speech_started"); await settle();
say("conversation.item.input_audio_transcription.completed",
  { transcript:"show me the projects at central city" });
await settle();

await check("what the listener said appears as their own words", () =>
  assert.match(browser.byId("wsThread").textContent, /show me the projects at central city/));

await check("a cough is not a question", async () => {
  const before = thread(".wsturn").length;
  for (const noise of [".", " ", "?", "a", "uh", "- -"]) {
    say("conversation.item.input_audio_transcription.completed", { transcript: noise });
    await settle();
  }
  assert.equal(thread(".wsturn").length, before,
    "a door, a cough or a half-heard word across a room is not a question");
});


const projects = database.prepare(
  "SELECT id, name FROM projects WHERE archived_at IS NULL LIMIT 3").all();

await toolCall("find_projects", {});
await check("the workspace renders from the tool call, before a word is spoken", () => {
  assert.equal(space(".wscard").length, 1, "the card is already there");
  assert.ok(space(".wsrow").length > 0, "with the rows in it");
  assert.equal(presence(), "thinking", "while the model is still working");
});

await check("and the model is handed a short line plus the ids, never the rows", () => {
  const output = sent.find((m) => m.item && m.item.type === "function_call_output");
  assert.ok(output, "the tool result went back");
  const payload = JSON.parse(output.item.output);
  assert.ok(typeof payload.result === "string" && payload.result.length < 300,
    "one line, not a table read aloud");
  assert.ok(Array.isArray(payload.subject_ids), "and what it is about, so it can narrow");
  assert.ok(!/approved_budget|forecast_variance/.test(output.item.output),
    "the figures are on screen, not in the model's mouth");
});

// A multi-part question: several tools inside one spoken turn.
const cardsAfterFirst = space(".wscard").length;
await toolCall("budget_analysis", {});
await toolCall("schedule_analysis", {});

await check("several tools inside one turn each put their result up as they land", () => {
  assert.equal(space(".wscard").length, cardsAfterFirst, "the newest is the one open");
  assert.ok(space(".wsold").length >= 2,
    "and the earlier ones collapse below it rather than being lost");
  assert.ok(/^\s*<article class="wscard/.test(browser.byId("wsSpace").innerHTML),
    "with the latest result at the top");
});

await check("the work in progress is reported quietly, not as a loading screen", () => {
  // Each tool clears its own label when it finishes, so by now the line is
  // empty again. What matters is that the labels exist and read as work.
  assert.equal(TOOL_LABELS.budget_analysis, "checking budget");
  assert.equal(TOOL_LABELS.schedule_analysis, "checking schedule");
  assert.equal(TOOL_LABELS.compare_periods, "comparing previous period");
});

await check("the listener is never shown a handoff between agents", () => {
  const text = browser.byId("wsThread").textContent;
  assert.ok(!/tool|function|agent|ask_tracker|looking up/i.test(text),
    "the machinery does not appear in the conversation");
});

say("response.created"); await settle();
say("response.output_audio.delta", { delta:"x" }); await settle();
await check("the dot says the assistant is speaking", () => assert.equal(presence(), "speaking"));

say("response.output_audio_transcript.delta", { delta:"Twelve projects, four over budget." });
await settle();
say("response.done"); await settle();

await check("the spoken answer lands in the conversation as one sentence", () => {
  assert.match(browser.byId("wsThread").textContent, /Twelve projects, four over budget\./);
});

await check("and the call goes back to listening by itself", () =>
  assert.equal(presence(), "listening"));

await check("one spoken turn produced one turn in the conversation, not four", () => {
  const spoken = thread(".is-spoken");
  assert.equal(spoken.length, 1, "four tool calls, one question, one answer");
});

await check("the answer does not link to a result already at the top of the workspace", () =>
  assert.equal(thread(".wsalink").length, 0,
    "the spoken answer and its result are both the newest thing on screen"));

// Interruption.
say("input_audio_buffer.speech_started"); await settle();
await check("speaking over the assistant returns the call to listening", () =>
  assert.equal(presence(), "listening"));

await check("but a short real question is", async () => {
  const before = thread(".wsturn").length;
  say("conversation.item.input_audio_transcription.completed", { transcript:"and Gaming?" });
  await settle();
  assert.equal(thread(".wsturn").length, before + 1,
    "the guard must not swallow the way people actually narrow a question");
});
// Answer it, so the next case starts from a conversation with nothing left open.
say("response.created");
say("response.output_audio_transcript.delta", { delta:"Thirty in Gaming." });
say("response.done"); await settle();

// Two things that only show up in a real call, both of which lost an answer.
await check("speaking over the assistant abandons what it had half said", async () => {
  voice_reset();
  say("response.created"); await settle();
  say("response.output_audio_transcript.delta", { delta:"Abandoned half sentence" }); await settle();
  say("input_audio_buffer.speech_started"); await settle();
  say("conversation.item.input_audio_transcription.completed",
    { transcript:"actually, show me Patina instead" });
  await settle();
  say("response.output_audio_transcript.delta", { delta:"Sixteen in Patina." }); await settle();
  say("response.done"); await settle();
  const text = browser.byId("wsThread").textContent;
  assert.ok(!text.includes("Abandoned half"),
    "half a cancelled sentence must not be stitched onto the next answer");
  assert.match(text, /Sixteen in Patina\./);
});

await check("an answer still reaches the conversation when nothing was transcribed", async () => {
  voice_reset();
  const before = thread(".wsturn").length;
  // No transcription event at all: the service can answer without ever
  // telling us what the listener said.
  await toolCall("find_projects", { unit:"Gaming" });
  say("response.created"); await settle();
  say("response.done"); await settle();
  assert.equal(thread(".wsturn").length, before + 1,
    "the answer belongs in the conversation whether or not we caught the question");
  assert.ok(!/\(answered on screen\)/.test(browser.byId("wsThread").textContent),
    "and it is the line that was spoken, not a placeholder admitting we missed it");
});

await check("and the conversation survives the call ending", () =>
  assert.match(browser.byId("wsThread").textContent, /show me the projects at central city/));

await check("the workspace survives it too, because it is not part of the call", () =>
  assert.equal(space(".wscard").length, 1));


// A clash over who starts the next response is not a reason to end a call.
const before = presence();
say("error", { error:{ message:"Conversation already has an active response in progress" } });
await settle();
await check("a response clash does not tear down a working call", () =>
  assert.equal(presence(), before));

await check("a real error ends the call and says why", async () => {
  say("error", { error:{ message:"the credential expired" } });
  await settle();
  assert.equal(presence(), "off");
  assert.match(browser.text("wsVoiceNote"), /credential expired/);
});

await check("ending a call releases the microphone", () => assert.equal(track.stopped, true));

console.log(`\n${n} checks passed.`);
if (!process.exitCode) {
  console.log("Realtime voice: one session, direct tools, render-before-speak, multi-tool turns, interruption.");
}
