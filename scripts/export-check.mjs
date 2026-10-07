// Does a saved result actually leave the product?
//
// Two things went wrong here and neither could be seen from the DOM harness,
// which has no print media, no computed styles and no access to the client's
// scope. The PDF came out blank because the print container sat inside .app,
// which the print stylesheet hides - and a display:none ancestor hides every
// descendant whatever the descendant's own rule says. The CSV came out nearly
// empty because only list-shaped results had rows to give, so a figure, a
// period comparison, a timeline and a breakdown each exported nothing.
//
// So this builds four results of four different shapes through the real
// scoped tool, saves them, and checks what comes out.
//
//   npm run dev                  # in another terminal
//   google-chrome --headless --remote-debugging-port=9222 \
//     --user-data-dir=/tmp/dnc-export about:blank &
//   npm run check:export
//
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
const send = (m, p = {}) => new Promise((res, rej) => { const mine = ++id;
  const on = (e) => { const x = JSON.parse(e.data); if (x.id !== mine) return;
    ws.removeEventListener("message", on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); };
  ws.addEventListener("message", on); ws.send(JSON.stringify({ id: mine, method: m, params: p })); });
const run = async (e) => { const o = await send("Runtime.evaluate",
  { expression: e, awaitPromise: true, returnByValue: true });
  if (o.exceptionDetails) throw new Error(JSON.stringify(o.exceptionDetails.exception));
  return o.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Page.navigate", { url: "http://127.0.0.1:5173/?t=" + Date.now() + "#ask" });
await sleep(2500);
await run(`(() => { const u=document.getElementById('loginUsername'); if(!u) return 0;
  u.value=${JSON.stringify(process.env.PREVIEW_USER || "testuser@gmail.com")};
  document.getElementById('loginPassword').value=${JSON.stringify(process.env.PREVIEW_PASS || process.env.PREVIEW_ADMIN_PASSWORD || "")};
  document.getElementById('loginForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  return 1; })()`);
await sleep(3500);
await run("document.getElementById('askNav').click(); 1");
await sleep(600);

// Real results of four different shapes, through the real scoped tool.
console.log("seeded:", await run(`(async () => {
  const call = (name, args) => api("/api/assistant/tool",
    { method:"POST", body: JSON.stringify({ name, arguments: args }) });
  const a = await call("find_projects", { limit: 6 });
  wsPush(a.view, "show me projects", false);
  const b = await call("budget_analysis", { limit: 6 });
  wsPush(b.view, "what are the budgets", true);
  const first = (a.subject.ids || [])[0];
  const c = await call("compare_periods", { project_id: first });
  wsPush(c.view, "compare with last period", true);
  // A figure, the shape that used to export nothing at all.
  wsPush({ kind:"figure", title:null, subtitle:null, count:null, truncated:false,
    data:{ metrics:[{ label:null, unit:"projects", value:74, format:"number" }],
           breakdown:[{label:"Gaming",value:30},{label:"Parks & Resorts",value:21}] } },
    "how many projects", false);
  ws.views.forEach((v) => wsPin(v.id));
  ws.picked = ws.saved.map((s) => s.viewId);
  return ws.saved.map((s) => s.kind).join(", ");
})()`));

const csvFull = await run(`wsCsv(wsChosen(), true)`);
const csvSum  = await run(`wsCsv(wsChosen(), false)`);
let bad = 0;
const check = (ok, what) => { if (!ok) { bad++; console.log("FAIL " + what); } else console.log("ok   " + what); };

const lines = csvFull.split("\r\n");
check(lines.length > 20, `full CSV has real rows (${lines.length} lines)`);
check(/Mardi Gras|Gaming|CENTRAL|\$/.test(csvFull), "full CSV carries actual project data");
check(!/No rows recorded/.test(csvFull), "no saved result exported as empty");
check(/Previous,Current,Change/.test(csvFull), "the period comparison exported its own table");
check(/Figure,Value/.test(csvFull), "the figure exported too");
check(/74 projects/.test(csvFull), "including its value, with its unit");
check(/Gaming,30/.test(csvFull), "and the breakdown that came with it");

const sumLines = csvSum.split("\r\n");
check(sumLines.length === 5, `summary CSV is one line per saved result (${sumLines.length})`);
check(/Matched/.test(sumLines[0]) && /Rows included/.test(sumLines[0]),
  "and separates what matched from what the totals were computed over");
check(!/^0 projects/m.test(csvSum), "no saved result is named after a count it does not have");
check(/Approved budget/.test(sumLines[0]), "summary carries figures, not just names");
check(sumLines.slice(1).every((l) => l.split(",").length >= 6), "and every row is filled in");

// The print page.
const printed = await run(`(() => { const host = document.getElementById('wsPrint');
  const was = window.print; window.print = function(){};
  wsPrint(wsChosen(), true); window.print = was;
  return JSON.stringify({ html: host.innerHTML.length,
    tables: host.querySelectorAll('table').length,
    bodyRows: host.querySelectorAll('tbody tr').length,
    insideApp: !!host.closest('.app'),
    insidePane: !!host.closest('[data-pane]') }); })()`);
const p = JSON.parse(printed);
check(p.tables >= 4, `the print page has a table per saved result (${p.tables})`);
check(p.bodyRows > 10, `with rows in them (${p.bodyRows})`);
check(!p.insideApp, "and it sits outside .app, which print hides");
check(!p.insidePane, "and outside the pane, which is hidden unless active");

// What the printer would actually see.
await send("Emulation.setEmulatedMedia", { media: "print" });
await sleep(200);
const visible = await run(`(() => { const host = document.getElementById('wsPrint');
  const r = host.getBoundingClientRect();
  return JSON.stringify({ display: getComputedStyle(host).display,
    height: Math.round(r.height), text: host.innerText.slice(0, 60) }); })()`);
const v = JSON.parse(visible);
check(v.display !== "none", "it is displayed under print media");
check(v.height > 100, `and has height on the printed page (${v.height}px)`);
await send("Emulation.setEmulatedMedia", { media: "" });

console.log("\n--- summary CSV ---\n" + csvSum);
console.log("\n--- first 14 lines of full CSV ---\n" + lines.slice(0, 14).join("\n"));
if (bad) process.exitCode = 1;
console.log(bad ? "\nExport check FAILED." : "\nExport check passed.");
ws.close();
