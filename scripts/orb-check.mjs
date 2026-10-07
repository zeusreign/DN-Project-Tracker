// Does the voice presence actually live?
//
// The DOM harness has no WebGL, no viewport and no audio, so the parts of the
// orb that matter most cannot be tested there: that the shader compiles, that
// each state looks unlike the others, that it moves to real microphone and
// real model audio rather than to a timer, and that ending a call takes it
// away cleanly. This measures all of that in real Chrome against the real app.
//
//   npm run dev                  # in another terminal
//   google-chrome --headless --remote-debugging-port=9222 \
//     --user-data-dir=/tmp/dnc-orb --use-fake-device-for-media-stream \
//     --use-fake-ui-for-media-stream about:blank &
//   npm run check:voice
//
// The fake media device gives a real stream carrying a real tone, so the level
// the orb reads is measured the same way it would be from a person speaking.
// Exits non-zero on any failure.

let list;
try {
  list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
} catch {
  console.error("No Chrome on 9222. See the header of this file for the command.");
  process.exit(2);
}
const target = list.find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const send = (m, p = {}) => new Promise((res, rej) => {
  const mine = ++id;
  const on = (e) => { const x = JSON.parse(e.data); if (x.id !== mine) return;
    ws.removeEventListener("message", on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); };
  ws.addEventListener("message", on); ws.send(JSON.stringify({ id: mine, method: m, params: p }));
});
const run = async (e) => {
  const out = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw new Error(JSON.stringify(out.exceptionDetails.exception));
  return out.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { writeFileSync } = await import("node:fs");

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:5173/?t=" + Date.now() + "#ask" });
await sleep(2500);
await run(`(() => { const u=document.getElementById('loginUsername');
  if(!u) return 0; u.value=${JSON.stringify(process.env.PREVIEW_USER || "testuser@gmail.com")};
  document.getElementById('loginPassword').value=${JSON.stringify(process.env.PREVIEW_PASS || process.env.PREVIEW_ADMIN_PASSWORD || "")};
  document.getElementById('loginForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  return 1; })()`);
await sleep(3500);
await run("document.getElementById('askNav') && document.getElementById('askNav').click(); 1");
await sleep(600);

const fail = (why) => { process.exitCode = 1; console.log("FAIL " + why); };
const ok = (what) => console.log("ok   " + what);
const seen = {};
if (!(await run("!!document.createElement('canvas').getContext('2d')")))
  fail("no 2D canvas, so nothing can be drawn at all");

const shot = async (name) => {
  // The stage is the unit now, not a cropped ball: what matters is how the
  // whole left panel reads.
  const clip = await run(`(() => { const b=document.querySelector('.wsp-chat').getBoundingClientRect();
    return JSON.stringify({x:b.x,y:b.y,width:b.width,height:b.height}); })()`);
  const box = JSON.parse(clip);
  const img = await send("Page.captureScreenshot",
    { format: "png", clip: { ...box, scale: 1.5 } });
  writeFileSync(`${process.env.OUT}/orb-${name}.png`, Buffer.from(img.data, "base64"));
};

for (const state of ["connecting", "listening", "thinking", "speaking"]) {
  await run(`setVoiceState(${JSON.stringify(state)}); 1`);
  await sleep(state === "connecting" ? 900 : 1400);
  const info = await run(`JSON.stringify({ state: voice.state, drawing: !!orb.ctx,
    looping: orb.raf !== 0, listening: orb.listen,
    staged: document.getElementById('wsStage').classList.contains('is-live'),
    receded: document.getElementById('wsChat').classList.contains('is-voice'),
    val: { emerge:+orb.val.emerge.toFixed(2), energy:+orb.val.energy.toFixed(2),
           arc:+orb.val.arc.toFixed(2), glow:+orb.val.glow.toFixed(2) } })`);
  const got = JSON.parse(info);
  seen[state] = got;
  if (!got.drawing) fail(state + ": nothing is drawing");
  if (!got.looping) fail(state + ": the loop is not running during a call");
  if (!got.staged) fail(state + ": the stage is not up during a call");
  if (!got.receded) fail(state + ": the conversation has not receded");
  console.log("ok   " + state.padEnd(11) + info);
  await shot(state);
}

// Real level, from a real stream, through the real analyser.
const mic = JSON.parse(await run(`(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  orbListen(stream, "in");
  await new Promise((r) => setTimeout(r, 900));
  setVoiceState("listening");
  await new Promise((r) => setTimeout(r, 900));
  const reads = [];
  for (let i = 0; i < 6; i++) { reads.push(+(orbLevel() ?? -1).toFixed(3));
    await new Promise((r) => setTimeout(r, 120)); }
  return JSON.stringify({ analyser: !!orb.inNode, reads,
    energyFollowed: +orb.val.energy.toFixed(3) });
})()`));
if (!mic.analyser) fail("no analyser was attached to the microphone stream");
else if (!mic.reads.some((r) => r > 0)) fail("the microphone stream produced no level");
else ok("it moves to the real microphone: " + JSON.stringify(mic.reads));

// Each state has to look unlike the others, or the orb is decoration.
const shape = (s) => JSON.stringify(seen[s] && seen[s].val);
if (shape("listening") === shape("thinking")) fail("thinking looks exactly like listening");
else ok("thinking looks unlike listening, so a wait does not read as a dropped call");
if (seen.thinking && seen.thinking.listening !== "")
  fail("thinking reacts to audio, of which there is none");
else ok("thinking owes nothing to audio");
if (seen.listening && seen.listening.listening !== "in") fail("listening is not on the microphone");
else if (seen.speaking && seen.speaking.listening !== "out") fail("speaking is not on the model's audio");
else ok("each state follows the stream it should");

const muted = await run(`(() => { voice.muted = true;
  const v = orbLevel(); voice.muted = false; return v; })()`);
if (muted !== 0) fail("a muted microphone still moves the orb (" + muted + ")");
else ok("a muted microphone reads as silence");

await run(`setVoiceState("off"); 1`);
await sleep(1400);
const ended = JSON.parse(await run(`JSON.stringify({ emerge:+orb.val.emerge.toFixed(3),
  looping: orb.raf !== 0, bandHidden: document.getElementById('wsStage').hidden,
  live: document.getElementById('wsStage').classList.contains('is-live'),
  restored: !document.getElementById('wsChat').classList.contains('is-voice') })`));
if (ended.emerge > 0.05) fail("the presence did not fade out");
else if (ended.looping) fail("the loop keeps running after the call: it must cost nothing when idle");
else if (!ended.bandHidden || ended.live) fail("the stage is still up after the call");
else if (!ended.restored) fail("the conversation did not come back out of recession");
else ok("ending a call returns to the conversation and stops costing anything");

// It must never be the slow part of a call.
const cost = JSON.parse(await run(`(async () => {
  setVoiceState("speaking");
  await new Promise((r) => setTimeout(r, 500));
  const times = [];
  await new Promise((done) => { let n = 0;
    const tick = (now) => { const t0 = performance.now(); orbFrame(now);
      times.push(performance.now() - t0);
      if (++n < 40) requestAnimationFrame(tick); else done(); };
    requestAnimationFrame(tick); });
  setVoiceState("off");
  times.sort((a, b) => a - b);
  return JSON.stringify({ median: +times[20].toFixed(3), worst: +times[39].toFixed(3) });
})()`));
if (cost.worst > 6) fail("a frame costs " + cost.worst + "ms, which is too much of a budget");
else ok("a frame costs " + cost.median + "ms, worst " + cost.worst + "ms");

// The whole arc, in order, as a person would live it. What is being checked
// is continuity: that this is one environment changing, and never a flicker
// back to the chat or a presence that drops out between states.
// A conversation to recede. Without one there is nothing to check is still
// there, and "reduced, not removed" is the whole point of the arrangement.
await run(`(() => { ws.turns = [{ question:"what slipped?", state:"done",
  answer:"Four projects.", spoken:false }]; renderAsk(); return 1; })()`);
const walk = ["off", "connecting", "listening", "speaking", "thinking", "speaking", "listening", "off"];
const trail = [];
for (let i = 0; i < walk.length; i++){
  await run(`setVoiceState(${JSON.stringify(walk[i])}); 1`);
  // Sampled across the easing, not after it: a cut would show up here.
  for (let f = 0; f < 5; f++){
    await sleep(90);
    trail.push(JSON.parse(await run(`JSON.stringify({ step:${i}, state:voice.state,
      emerge:+orb.val.emerge.toFixed(3),
      staged:document.getElementById('wsStage').classList.contains('is-live'),
      receded:document.getElementById('wsChat').classList.contains('is-voice'),
      threadThere:document.getElementById('wsThread').children.length > 0 })`)));
  }
}
const mid = trail.filter((x) => x.step > 0 && x.step < walk.length - 1);
if (mid.some((x) => !x.staged)) fail("the stage dropped out part way through the call");
else if (mid.some((x) => !x.receded)) fail("the conversation came back mid-call");
else if (mid.some((x) => x.emerge < 0.3)) fail("the presence dissolved between states");
else if (trail.some((x) => !x.threadThere)) fail("the conversation was taken away, not reduced");
else ok("text to connecting to speaking to thinking and back is one continuous environment");
const last = trail[trail.length - 1];
if (last.staged || last.receded) fail("the call did not return to the text conversation");
else ok("and it ends back in the text conversation");

console.log(process.exitCode ? "\nVoice presence check FAILED." : "\nVoice presence check passed.");
ws.close();
