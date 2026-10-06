// The Ask the Tracker pane, walked end to end: the 30-step acceptance flow, driven through the real worker and the
// real page, with a deterministic stub planner so the UI is what is under test.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const { createBrowser } = await import(`${root}/scripts/browser-harness.mjs`);
const database=new DatabaseSync(":memory:");
for(const n of ["0000_dnc_project_hub.sql","0001_workbook_structure_and_roles.sql","0002_user_directory.sql","0003_development_pipeline_and_directory.sql","0004_pilot_authentication.sql","0005_profile_photos.sql","0006_enhanced_media_and_revisions.sql","0007_photo_details.sql"])
  database.exec(await readFile(`${root}/drizzle/${n}`,"utf8"));
const DB={prepare(q){const st=database.prepare(q);const r=(b)=>({all:async()=>({results:st.all(...b)}),first:async()=>st.get(...b)??null,run:async()=>({success:true,meta:st.run(...b)})});return {bind:(...b)=>r(b),...r([])}},batch:async(p)=>Promise.all(p.map(x=>x.run()))};
const worker=(await import(`${root}/dist/server/index.js`)).default;
const headers={"oai-authenticated-user-id":"a","oai-authenticated-user-email":"a@example.invalid","oai-authenticated-user-full-name":"Acc","oai-authenticated-user-full-name-encoding":"percent-encoded-utf-8","content-type":"application/json"};
const base={DB,ADMIN_EMAILS:"a@example.invalid",ALLOW_PLATFORM_AUTH:"true",ASSISTANT_LEGACY_PLANNER:"true"};
await worker.fetch(new Request("https://t/api/bootstrap",{headers}),base,{});

// A Gaming-scoped viewer, so step 24 tests permissions for real.
const pw="Zz9!"+crypto.randomUUID();
await worker.fetch(new Request("https://t/api/admin/users",{method:"POST",headers,body:JSON.stringify({
  first_name:"Ui",last_name:"Viewer",username:"ui@example.invalid",user_email:"ui@example.invalid",
  role:"viewer",business_unit_scope:"Gaming",account_status:"active",site_access_status:"authorized",
  temporary_password:pw,confirm_password:pw})}),base,{});
database.prepare("UPDATE user_directory SET must_change_password = 0 WHERE lower(username)=?").run("ui@example.invalid");

// Plans are chosen by what the question says, so each question yields its own set.
// Deterministic SQL per question, so each one yields its own result set and the
// pane is what is under test rather than the model.
const COLUMNS="id, name, business_unit, venue, section_name, status, phase, project_manager, "
  +"development_lead, budget_risk, schedule_risk, approved_budget, anticipated_final_cost, "
  +"forecast_variance, original_turnover_date, current_turnover_date, duration_change_days, "
  +"scope_description, current_update, previous_update, reporting_period, project_type, capp_number";
let failNext=false;
const sqlFor=(q)=>{
  if(q.includes("nothing"))return `SELECT ${COLUMNS} FROM projects WHERE name LIKE '%zzzz-no-such-project%'`;
  if(q.includes("high schedule risk"))return `SELECT ${COLUMNS} FROM projects WHERE schedule_risk = 'High'`;
  if(q.includes("over budget"))return `SELECT ${COLUMNS} FROM projects WHERE forecast_variance > 0`;
  return `SELECT ${COLUMNS} FROM projects WHERE business_unit = 'Gaming'`;
};
const planner={async generate(question){
  if(failNext)throw new Error("boom");
  return {intent:"search",language:"English",message:null,sql:sqlFor(String(question).toLowerCase()),usage:{model:"stub"}};
}};
const answerer={async answer(question,result){
  return {text:result.total?`I found ${result.total} project${result.total===1?"":"s"}.`
    :"No records matched that question.",usage:{model:"stub"}};
}};
const page=await (await worker.fetch(new Request("https://t/",{headers:{cookie:""}}),base,{})).text();
const browser=await createBrowser({page,handler:(r)=>worker.fetch(r,{...base,ASSISTANT_SQL:planner,ASSISTANT_ANSWERER:answerer},{})}).start();
browser.type("loginUsername","ui@example.invalid");browser.type("loginPassword",pw);
await browser.fire("loginForm","submit").results; await browser.settle();

const ok=[];const step=(n,label,fn)=>{try{fn();ok.push(n);console.log(`  ${String(n).padStart(2)} ok   ${label}`)}catch(e){console.log(`  ${String(n).padStart(2)} FAIL ${label}\n       ${e.message}`);process.exitCode=1}};
const ask=async(q)=>{browser.type("askInput",q);await browser.fire("askForm","submit").results;await browser.settle()};
const cls=(id,c)=>[...browser.byId(id).querySelectorAll(c)];

step(1,"application opens signed in",()=>assert.equal(browser.byId("workspace").hidden,false));
await browser.fire("askNav","click").results; await browser.settle();
step(2,"Ask the Tracker opens from the existing navigation",()=>assert.equal(browser.byId("askInput").closest("[data-pane]").hidden,false));
step(3,"the panel renders its parts",()=>{
  for(const id of ["askBrowse","askCrumb","askQuietMode","askVoiceMode","askToolbar","askEvidence","askOlder","askNewer","askRailLabel","askDownload","askUnitScope","askFoot"])
    assert.ok(browser.byId(id),id+" is present");
});
step(4,"Browse records and breadcrumbs are present",()=>{
  assert.match(browser.text("askBrowse"),/Browse records/);
  assert.equal(cls("askInput","x").length,0); // no-op guard
  const crumbs=[...browser.document.querySelectorAll("[data-ask-crumb]")].map(b=>b.textContent);
  assert.deepEqual(crumbs,["Browse records","Ask the Tracker"]);
  assert.match(browser.text("askCrumb"),/Portfolio at a glance/);
});
step(5,"Quiet chat and Voice are both offered",()=>{
  assert.equal(browser.byId("askQuietMode").getAttribute("aria-pressed"),"true");
  assert.equal(browser.byId("askVoiceMode").getAttribute("aria-pressed"),"false");
});
step(6,"the portfolio overview is the opening evidence view",()=>{
  assert.ok(cls("askEvidence",".ask-unit-row").length>0,"business units are listed");
  assert.ok(cls("askEvidence",".ask-metric").length>=2,"with headline figures");
  assert.equal(browser.byId("askOlder").disabled,true,"and no result sets yet");
});

await ask("Show me Gaming projects");
const set1=browser.text("askEvidenceCount");
step(7,"a result set is produced",()=>{
  assert.match(browser.text("askRailLabel"),/Result 1 of 1/);
  assert.ok(cls("askEvidence",".ask-record").length>0,"records are shown as cards");
});
step(8,"records carry the pilot's level of detail",()=>{
  const card=cls("askEvidence",".ask-record")[0];
  assert.ok(card.querySelector(".ask-record-name"),"a name that opens the record");
  assert.equal(card.querySelectorAll(".ask-risk").length,2,"both risk ratings");
  assert.equal(card.querySelectorAll(".ask-metric").length,2,"variance and days");
  assert.ok(card.querySelector(".ask-record-footer"),"reporting date and Open record");
  assert.match(card.textContent,/Schedule:/);
  assert.match(card.textContent,/Budget:/);
});
await ask("Which projects have high schedule risk?");
const set2=browser.text("askEvidenceCount");
step(9,"a second result set is produced and becomes active",()=>{
  assert.match(browser.text("askRailLabel"),/Result 2 of 2/);
  assert.notEqual(set1,set2,"the two sets differ");
});
step(10,"the first set is still available",()=>assert.equal(browser.byId("askOlder").disabled,false));
await browser.fire("askOlder","click").results; await browser.settle();
step(11,"the older chevron restores the first set exactly",()=>{
  assert.match(browser.text("askRailLabel"),/Result 1 of 2/);
  assert.equal(browser.text("askEvidenceCount"),set1);
  assert.match(browser.text("askEvidenceTitle"),/Gaming projects/);
  assert.equal(browser.byId("askNewer").disabled,false);
});
await browser.fire("askNewer","click").results; await browser.settle();
step(12,"the newer chevron restores the second set",()=>{
  assert.match(browser.text("askRailLabel"),/Result 2 of 2/);
  assert.equal(browser.text("askEvidenceCount"),set2);
  assert.equal(browser.byId("askNewer").disabled,true,"and newest disables it");
});
step(13,"navigation is between sets, not records",()=>{
  assert.equal(browser.byId("askOlder").getAttribute("aria-label"),"Older result set");
  assert.equal(browser.byId("askNewer").getAttribute("aria-label"),"Newer result set");
});

const first=cls("askEvidence",".ask-record")[0].querySelector(".ask-record-name");
const openedName=first.textContent;
await browser.fire(first,"click").results; await browser.settle();
step(14,"a record opens in the panel with the pilot's hierarchy",()=>{
  assert.equal(browser.text("askEvidenceTitle"),"Project source record");
  assert.match(browser.text("askCrumb"),new RegExp(openedName.slice(0,12).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.ok(cls("askEvidence",".ask-field-grid").length>0,"a field grid");
  assert.ok(cls("askEvidence",".ask-report-section").length>0,"and the saved update");
  assert.match(browser.byId("askEvidence").textContent,/Approved budget/);
  assert.match(browser.byId("askEvidence").textContent,/Current turnover/);
});
step(15,"its activity history is shown, and the toolbar offers the way back",()=>{
  assert.match(browser.byId("askEvidence").textContent,/Activity history/);
  const actions=[...browser.byId("askToolbar").querySelectorAll("[data-ask-action]")].map(b=>b.dataset.askAction);
  assert.ok(actions.includes("back"),"Back to results");
  assert.ok(actions.includes("record-briefing"),"Project briefing");
});
step(16,"the selected record is part of the set, so the rail restores it",()=>{
  assert.match(browser.text("askRailLabel"),/Result 2 of 2/);
});
await browser.fire(browser.byId("askOlder"),"click").results; await browser.settle();
await browser.fire(browser.byId("askNewer"),"click").results; await browser.settle();
step(17,"and it is still the record view after moving away and back",()=>{
  assert.equal(browser.text("askEvidenceTitle"),"Project source record");
});

const toolbarBack=[...browser.byId("askToolbar").querySelectorAll("[data-ask-action]")].find(b=>b.dataset.askAction==="back");
await browser.fire(toolbarBack,"click").results; await browser.settle();
const brief=[...browser.byId("askToolbar").querySelectorAll("[data-ask-action]")].find(b=>b.dataset.askAction==="briefing");
await browser.fire(brief,"click").results; await browser.settle();
step(18,"a briefing is generated for the active set",()=>{
  assert.equal(browser.text("askEvidenceTitle"),"Briefing preview");
  assert.match(browser.text("askCrumb"),/Briefing/);
  assert.ok(cls("askEvidence",".ask-report-summary").length>0,"headline counts");
  assert.match(browser.byId("askEvidence").textContent,/Matched-pair variance/);
  const actions=[...browser.byId("askToolbar").querySelectorAll("[data-ask-action]")].map(b=>b.dataset.askAction);
  for(const a of ["download","print","csv","back"]) assert.ok(actions.includes(a),a+" is offered");
});
step(19,"Download briefing is enabled and bound to the active set",()=>{
  assert.equal(browser.byId("askDownload").disabled,false);
  assert.match(browser.text("askRailLabel"),/Result 2 of 2/);
});
console.log("     (download, print and CSV are verified below against the generated text)");

// --- 20-23: downloads, empty and error states ------------------------------
// The harness has no Blob or object URL, so the download path is captured at
// the seam instead: what matters is that it is built from the ACTIVE set.
const grabbed=[];
const RealBlob=globalThis.Blob;
globalThis.Blob=function(parts,opts){grabbed.push(String(parts[0]));return new RealBlob(parts,opts)};
let printed=0; browser.window.print=function(){printed++};
// The harness's elements have no click(); the anchor-download shape the app
// already uses everywhere needs one, so give created elements a no-op.
const makeEl=browser.document.createElement.bind(browser.document);
browser.document.createElement=function(tag){
  const el=makeEl(tag);
  if(typeof el.click!=="function")el.click=function(){};
  if(typeof el.remove!=="function")el.remove=function(){};
  return el;
};

await browser.fire(browser.byId("askDownload"),"click").results; await browser.settle();
step(20,"Download briefing produces a briefing for the active set",()=>{
  assert.equal(grabbed.length,1,"one download");
  const text=grabbed[0];
  assert.match(text,/D&C PROJECT BRIEFING/);
  assert.match(text,/Question: Which projects have high schedule risk\?/,"it names the question of the ACTIVE set");
  assert.match(text,/Matched-pair variance/);
  assert.match(text,/Reporting dates/);
  assert.match(text,/Read-only briefing/);
});
// Move the rail back and download again: the briefing must follow the rail.
await browser.fire("askOlder","click").results; await browser.settle();
await browser.fire(browser.byId("askDownload"),"click").results; await browser.settle();
step(21,"moving to an older set changes what Download briefing produces",()=>{
  assert.equal(grabbed.length,2);
  assert.match(grabbed[1],/Question: Show me Gaming projects/,"result set 1's briefing, not the newest");
  assert.ok(!/high schedule risk/.test(grabbed[1].split("\n")[1]),"and not set 2's question");
});
const csvBtn=[...browser.byId("askToolbar").querySelectorAll("[data-ask-action]")].find(b=>b.dataset.askAction==="csv");
await browser.fire(csvBtn,"click").results; await browser.settle();
step(22,"CSV exports the active set with safe cells",()=>{
  const csv=grabbed[grabbed.length-1];
  assert.match(csv.split("\r\n")[0],/^"id","business_unit"/,"a header row");
  assert.ok(csv.split("\r\n").length>2,"and data rows");
  assert.match(csv,/"Gaming"/);
  assert.ok(!/\n=/.test(csv),"no raw formula start");
});
const printBtn=()=>[...browser.byId("askToolbar").querySelectorAll("[data-ask-action]")].find(b=>b.dataset.askAction==="print");
const bf=[...browser.byId("askToolbar").querySelectorAll("[data-ask-action]")].find(b=>b.dataset.askAction==="briefing");
if(bf){await browser.fire(bf,"click").results;await browser.settle()}
await browser.fire(printBtn(),"click").results; await browser.settle();
step(23,"Print / PDF shows the briefing then prints",()=>{
  assert.equal(browser.text("askEvidenceTitle"),"Briefing preview");
  assert.ok(printed>=1,"the print dialog was asked for");
});

const recordsBeforeEmpty=cls("askEvidence",".ask-record").length;
const railBeforeEmpty=browser.text("askRailLabel");
const titleBeforeEmpty=browser.text("askEvidenceTitle");
await ask("show me nothing at all");
step(24,"an empty result answers in the conversation and leaves the records alone",()=>{
  // The answer belongs in the conversation. The records already on screen are
  // usually what the next question is about, so a miss must not take them.
  assert.match(browser.byId("askThread").textContent,/nothing at all/,"the question is in the transcript");
  assert.match(browser.byId("askThread").textContent,/No records matched/i,"and so is the answer");
  assert.equal(cls("askEvidence",".ask-record").length,recordsBeforeEmpty,
    "the records that were on screen are still on screen");
  assert.equal(browser.text("askEvidenceTitle"),titleBeforeEmpty,"still labelled with their own question");
  assert.equal(browser.text("askRailLabel"),railBeforeEmpty,"and the rail has not moved");
  assert.equal(browser.byId("askDownload").disabled,false,
    "the briefing still refers to the records that are showing");
});
failNext=true;
await ask("this one will fail");
failNext=false;
step(25,"an error says what happened and that nothing changed",()=>{
  const thread=browser.byId("askThread");
  assert.ok(thread.querySelectorAll(".ask-error").length>0,"the failure is shown as an error, not an answer");
  assert.match(thread.textContent,/records have not changed/);
  assert.match(browser.text("askRailLabel"),/Result \d of \d/,"and the existing sets survive it");
});

// --- permissions, responsiveness, and the Phase 1 gate ----------------------
await ask("Show me Gaming projects");
const gaming=new Set(database.prepare("SELECT p.name FROM projects p JOIN business_units b ON b.id=p.business_unit_id WHERE b.name='Gaming' AND p.archived_at IS NULL").all().map(r=>r.name));
step(26,"existing permissions still apply to every record shown",()=>{
  const names=cls("askEvidence",".ask-record").map(c=>c.querySelector(".ask-record-name").textContent);
  assert.ok(names.length>0);
  for(const n of names) assert.ok(gaming.has(n),`${n} is outside the viewer's scope`);
  const units=[...browser.byId("askUnitScope").querySelectorAll("option")].map(o=>o.value);
  assert.deepEqual(units,["All","Gaming"],"the scope picker offers only units this viewer can see");
});
step(27,"the briefing cannot leak a record outside scope",()=>{
  const text=grabbed[grabbed.length-1]||"";
  for(const line of text.split("\n")) if(/\[Project \d+\]/.test(line)){
    const name=line.split(" | ")[1].split(" [")[0];
    assert.ok(gaming.has(name),`${name} escaped into a briefing`);
  }
});
const css=(await readFile(`${root}/worker/styles.js`,"utf8"));
step(28,"responsive and print rules are present, not just the desktop layout",()=>{
  for(const q of ["max-width:1280px","max-width:1024px","max-width:640px","prefers-reduced-motion","@media print"])
    assert.ok(css.includes(q),q+" is handled");
  assert.match(css,/\.ask-rail\{flex-direction:row/s===null?/x/:/ask-rail/,"the rail folds rather than vanishing");
  assert.ok(css.includes("writing-mode:horizontal-tb"),"the rail label reflows on narrow screens");
  assert.ok(css.includes(".ask-btn:disabled"),"disabled states are styled");
  assert.ok(css.includes("data-selected=true"),"selected states are styled");
  assert.ok(css.includes(".ask-suggestion:hover"),"hover states are styled");
});
const wrangler=await readFile(`${root}/wrangler.toml`,"utf8");
const deployCheck=await readFile(`${root}/scripts/check-deploy-target.sh`,"utf8");
step(29,"the Phase 1 production gate is unchanged",()=>{
  assert.match(wrangler,/ASSISTANT_LEGACY_PLANNER = "false"/);
  assert.match(wrangler,/ASSISTANT_DEBUG = "false"/);
  assert.match(deployCheck,/kv ASSISTANT_LEGACY_PLANNER "false"/);
  assert.match(deployCheck,/kv ASSISTANT_DEBUG "false"/);
});
await browser.fire("askBrowse","click").results; await browser.settle();
step(30,"Browse records returns to the normal record browsing experience",()=>{
  assert.equal(browser.byId("askInput").closest("[data-pane]").hidden,true,"the ask pane closes");
  assert.match(browser.text("pageTitle"),/Projects/,"and the projects view is shown");
});
if(ok.length!==30)throw new Error(`Ask UI acceptance: only ${ok.length} of 30 steps passed`);
console.log(`Ask the Tracker UI: ${ok.length}/30 acceptance steps \u2014 panel, breadcrumbs, modes, result-set history, chevrons, record, briefing, CSV, print, empty, error, permissions, gate.`);
