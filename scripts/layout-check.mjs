// Does the panel scroll, or does the page?
//
// This one keeps coming back, and it cannot be caught in the DOM harness:
// nothing there has a viewport, a scroll position or a layout. So it is
// measured in real Chrome, against the real running app, at several window
// sizes — including short ones, where every version of this bug has shown up.
//
// What must hold at every size:
//   - the page itself does not scroll (the two columns do)
//   - the composer is on screen, because a question must always be one key away
//   - each column scrolls inside itself rather than pushing the panel taller
//
//   npm run dev                 # in another terminal
//   npm run check:layout
//
// Needs Chrome and a dev server on 5173. Exits non-zero on any failure.

const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch {
  console.error("No Chrome on " + PORT + ". Start one with:\n"
    + "  google-chrome --headless --remote-debugging-port=9222 "
    + "--user-data-dir=/tmp/dnc-layout-check about:blank &");
  process.exit(2);
}
let page = targets.find((t) => t.type === "page");
if (!page) {
  page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mine = ++id;
  const onMessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== mine) return;
    ws.removeEventListener("message", onMessage);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  };
  ws.addEventListener("message", onMessage);
  ws.send(JSON.stringify({ id: mine, method, params }));
});
const run = async (expression) => {
  const out = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw new Error(JSON.stringify(out.exceptionDetails.exception));
  return out.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride",
  { width: 1440, height: 760, deviceScaleFactor: 1, mobile: false });
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Page.navigate", { url: "http://127.0.0.1:5173/?t=" + Date.now() + "#ask" });
await sleep(2500);

const user = process.env.PREVIEW_USER || "testuser@gmail.com";
const pass = process.env.PREVIEW_PASS || process.env.PREVIEW_ADMIN_PASSWORD;
if (!pass) { console.error("Set PREVIEW_PASS (or PREVIEW_ADMIN_PASSWORD) to sign in."); process.exit(2); }
await run(`(() => {
  const u = document.getElementById('loginUsername'), p = document.getElementById('loginPassword');
  if (!u) return 'already in';
  u.value = ${JSON.stringify(user)}; p.value = ${JSON.stringify(pass)};
  document.getElementById('loginForm')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return 'submitted';
})()`);
await sleep(3500);

const state = await run(`(() => {
  const nav = document.getElementById('askNav');
  if (nav) nav.click();
  return document.getElementById('wsShell') ? 'ask open' : 'no shell';
})()`);
console.log("after sign-in:", state);

// A long result, without spending a model call on it.
await run(`(() => {
  const space = document.getElementById('wsSpace');
  let html = '';
  for (let i = 0; i < 4; i++) {
    html += '<article class="wscard"><header class="wscard-head"><h3>Card ' + i
      + '</h3></header><div class="wscard-body"><ul class="wslist">';
    for (let r = 0; r < 20; r++) {
      html += '<li><button class="wsrow"><span class="wsrow-main">'
        + '<span class="wsrow-name">Project ' + r + '</span>'
        + '<span class="wsrow-meta">VENUE · Unit</span></span></button></li>';
    }
    html += '</ul></div></article>';
  }
  space.innerHTML = html;
  if (typeof wsFit === 'function') wsFit();
  return space.children.length;
})()`);
await sleep(400);

// Stuff the conversation too: both columns have to scroll inside themselves.
await run(`(() => {
  const t = document.getElementById('wsThread');
  let html = '';
  for (let i = 0; i < 25; i++) {
    html += '<div class="wsturn"><p class="wsq-text">Question ' + i
      + '</p><p class="wsa">An answer that runs to a line or two.</p></div>';
  }
  t.innerHTML = html;
  return t.children.length;
})()`);

const probe = `(() => {
  const doc = document.documentElement;
  const composer = document.querySelector('.wsp-composer');
  const space = document.getElementById('wsSpace');
  const thread = document.getElementById('wsThread');
  const shell = document.getElementById('wsShell');
  const c = composer.getBoundingClientRect();
  const s = shell.getBoundingClientRect();
  const phone = window.innerWidth <= 640;
  return {
    pageOverflow: doc.scrollHeight - window.innerHeight,
    sideways: doc.scrollWidth - doc.clientWidth,
    composerVisible: c.bottom <= window.innerHeight + 1 && c.top >= 0,
    // The panel should reach the bottom of the window, not stop half way.
    unusedBelow: phone ? 0 : Math.round(window.innerHeight - s.bottom),
    spaceScrolls: space.scrollHeight > space.clientHeight + 1,
    threadScrolls: phone ? true : thread.scrollHeight > thread.clientHeight + 1,
    spaceSideways: space.scrollWidth - space.clientWidth,
    threadSideways: thread.scrollWidth - thread.clientWidth,
  };
})()`;

const sizes = [[1440, 760], [1440, 600], [1920, 1080], [1100, 700], [960, 640],
  [430, 932], [390, 844], [360, 740]];
for (const [w, h] of sizes) {
  await send("Emulation.setDeviceMetricsOverride",
    { width: w, height: h, deviceScaleFactor: 1, mobile: w <= 640 });
  // Scroll first: measuring from a scrolled page is how this broke before.
  await run("window.scrollTo(0, 500); typeof wsFit === 'function' && wsFit(); 1");
  await sleep(250);
  await run("typeof wsFit === 'function' && wsFit(); 1");
  await sleep(150);
  const out = await run(probe);
  const faults = [];
  if (out.pageOverflow > 1 && w > 640) faults.push("the page scrolls, not the panel");
  if (!out.composerVisible) faults.push("the composer is off screen");
  if (out.unusedBelow > 48) faults.push(`${out.unusedBelow}px of window left unused`);
  if (out.sideways > 1) faults.push("the page scrolls sideways");
  if (out.spaceSideways > 1 || out.threadSideways > 1) faults.push("a column scrolls sideways");
  if (faults.length) process.exitCode = 1;
  console.log(`${faults.length ? "FAIL" : "ok  "} ${String(w + "x" + h).padEnd(9)} `
    + (faults.length ? faults.join("; ") + "  " : "") + JSON.stringify(out));
}
console.log(process.exitCode ? "\nLayout check FAILED." : "\nLayout check passed.");
ws.close();
