export const CLIENT = `
var state={projects:[],summary:{},updates:[],me:null,csrf:null,preset:"progress",sortKey:"source_sort_order",sortDir:"asc",devSortKey:"source_sort_order",devSortDir:"asc",activityId:null,unitScope:"All",adminUsers:[],adminAudit:[],adminPage:1,adminLoginEvents:[],loginPage:1,kpiDragKey:null,kpiDragged:false};
var titles={portfolio:["Portfolio","Leadership summary by business unit"],projects:["Projects","Project activity, cost and schedule"],development:["Development Pipeline","Design & Development requests, estimates and promotion workflow"],cost:["Cost Control","Budgets, forecasts and variances"],risk:["Risk Register","All projects and all recorded risk levels"],admin:["Admin","User directory, roles and audit history"],help:["Help & User Guide","Quick reference and complete PDF instructions"]};
var money=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
var colors=["#087db5","#13a6c8","#008f78","#7ac143","#f2b134","#7357a6"];
function esc(v){return String(v==null?"":v).replace(/[&<>\"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]})}
function num(v){if(v==null||v==="")return null;var n=Number(v);return Number.isFinite(n)?n:null}
// null  = the field was left blank, which legitimately clears the stored amount.
// undefined = the field holds something that is not a number.
//
// These used to be the same answer, and that is the whole of the "invalid money
// clears the saved amount" defect: the browser turned "not a number" into null
// before sending, so the API received a valid instruction to clear the field and
// obliged. The server-side validator never saw the text and so never rejected
// it. Callers that save must refuse an undefined result rather than send it.
function moneyNumber(v){if(v==null||v==="")return null;var cleaned=String(v).replace(/[$,\\s]/g,"");if(/^\\(.*\\)$/.test(cleaned))cleaned="-"+cleaned.slice(1,-1);if(cleaned==="")return null;var n=Number(cleaned);return Number.isFinite(n)?n:undefined}
// Gathers money fields for a save, or names the first that is not a number so
// the caller can stop and tell the user instead of silently clearing it.
function collectMoney(pairs){var out={},bad=null;Object.keys(pairs).forEach(function(field){var parsed=moneyNumber(byId(pairs[field]).value);if(parsed===undefined){if(!bad)bad=field}else out[field]=parsed});return{values:out,invalid:bad}}
function moneyFieldLabel(field){return({precon_capp:"Preconstruction CAPP",construction_capp:"Construction CAPP",add_capp:"Additional CAPP",anticipated_final_cost:"Anticipated final cost",subsidiary_expense_total:"Subsidiary expense total",original_estimate:"Original estimate",current_estimate:"Current estimate"})[field]||field}
function moneyText(v){var n=num(v);return n==null?"—":money.format(n)}
function pctText(v){return v==null||!Number.isFinite(Number(v))?"—":new Intl.NumberFormat("en-US",{style:"percent",maximumFractionDigits:1}).format(Number(v))}
function dateText(v){if(!v)return"—";var s=String(v);var d=new Date(s.slice(0,10)+"T00:00:00Z");return Number.isNaN(d.valueOf())?s:d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}
var auditFieldLabels={name:"Project name",capp_number:"CAPP number",initiative_number:"Initiative number",project_manager:"Project manager",development_lead:"Development lead",status:"Status",phase:"Phase",budget_risk:"Budget risk",schedule_risk:"Schedule risk",original_start_date:"Original start date",current_start_date:"Current start date",original_turnover_date:"Original turnover date",current_turnover_date:"Current turnover date",scope_description:"Scope description",section_name:"Major-project heading",precon_capp:"Preconstruction CAPP",construction_capp:"Construction CAPP",add_capp:"Additional CAPP",anticipated_final_cost:"Anticipated final cost",request_date:"Request date",requestor:"Requestor",deliverable_due_date:"Deliverable due date",consultants:"Consultants",food_service_design:"Food service design",design_capp:"Design CAPP",original_estimate_date:"Original estimate date",current_estimate_date:"Current estimate date",subsidiary_expense_total:"Subsidiary expense total",original_estimate:"Original estimate",current_estimate:"Current estimate"};
function auditDateTime(value){if(!value)return"Time not recorded";var s=String(value).replace(" ","T");if(/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?$/.test(s))s+="Z";var d=new Date(s);return Number.isNaN(d.valueOf())?String(value):d.toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",timeZoneName:"short"})}
function auditValue(field,value){if(value==null||value==="")return"Not set";if(["precon_capp","construction_capp","add_capp","anticipated_final_cost","subsidiary_expense_total","original_estimate","current_estimate"].includes(field)&&typeof value==="number")return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:0,maximumFractionDigits:2}).format(value);if(field.endsWith("_date")&&/^\\d{4}-\\d{2}-\\d{2}$/.test(String(value)))return dateText(value);return String(value)}
function auditRowHtml(a){var details={};try{details=typeof a.details==="string"?JSON.parse(a.details):a.details||{};if(!details||typeof details!=="object")details={}}catch(e){}var changes=Array.isArray(details.changes)?details.changes.filter(function(c){return c&&Object.hasOwn(auditFieldLabels,c.field)&&Object.hasOwn(c,"before")&&Object.hasOwn(c,"after")}):[];var title=String(a.action||"Update").replaceAll("_"," "),body="";if(changes.length){title=(details.projectName||"Project "+a.entity_key)+": "+(changes.length===1?auditFieldLabels[changes[0].field]+" changed":changes.length+" fields changed");body=changes.map(function(c){var before=auditValue(c.field,c.before),after=auditValue(c.field,c.after),label=auditFieldLabels[c.field];if(before.length+after.length>260)return'<details class="audit-long-change"><summary>'+esc(label)+': show full change</summary><div class="audit-change"><b>Before:</b> '+esc(before)+'</div><div class="audit-change"><b>After:</b> '+esc(after)+'</div></details>';return'<div class="audit-change">'+(changes.length>1?'<b>'+esc(label)+':</b> ':"")+esc(before)+' → '+esc(after)+'</div>'}).join("")}else{body='<span>'+esc(a.entity_type+" • "+a.entity_key)+'</span>';if(a.action==="field_update"||a.action==="development_update")body+='<span>Before-and-after values were not recorded for this entry.</span>'}var actor=details.actorName||a.actor_email||"System";var identity=actor+(details.actorName&&a.actor_email&&details.actorName!==a.actor_email?" ("+a.actor_email+")":"");return'<div class="audit-row'+(changes.length?' audit-detailed':'')+'"><strong>'+esc(title)+'</strong>'+body+'<span>Changed by '+esc(identity)+' • '+esc(auditDateTime(a.created_at))+'</span></div>'}
function dateInput(v){return /^\\d{4}-\\d{2}-\\d{2}/.test(String(v||""))?String(v).slice(0,10):""}
function riskValue(v){var s=String(v||"Not Rated").trim().toLowerCase();return s==="high"?"High":s==="medium"?"Medium":s==="low"?"Low":"Not Rated"}
function riskClass(v){return"risk-"+riskValue(v).toLowerCase().replace(" ","-")}
function currentStatus(v){return["Active","On Hold","Closeout"].includes(v)}
function canWrite(){return state.me&&(state.me.role==="admin"||state.me.role==="editor")}
function byId(id){return document.getElementById(id)}
function setValue(id,value){byId(id).value=value==null?"":value}
// Seeds a currency INPUT with the stored value, not its display form. moneyText()
// formats to whole dollars (maximumFractionDigits:0), so writing that into the
// field and reading it back through moneyNumber() on save rounded the cents away
// -- 143336.8 was shown as "$143,337" and saved as 143337, even when the user
// never touched the field. The table's inline inputs already keep the raw value
// in data-raw for the same reason; this is the dialog's equivalent.
function setMoneyValue(id,value){var el=byId(id);el.value=value==null?"":String(value);el.dataset.raw=value==null?"":String(value)}
function toast(msg){if(!msg)return;var el=byId("toast");el.textContent=msg;el.classList.add("show");setTimeout(function(){el.classList.remove("show")},2800)}
async function api(path,options,retried){var defaults={"content-type":"application/json"};if(state.csrf)defaults["x-csrf-token"]=state.csrf;var config=Object.assign({},options||{});config.headers=Object.assign(defaults,(options&&options.headers)||{});config.credentials='same-origin';config.cache='no-store';config.redirect='error';var r=await fetch(path,config);var data=await r.json().catch(function(){return{}});if(!r.ok){
// A 403 on a write can simply mean this tab was open while a different sign-in
// replaced the shared cookie, leaving it holding the previous security token — the
// old "Stay signed in" failure that looked like a surprise logout. Ask the worker
// for the token that matches the session the cookie now names, and retry once.
//
// This does not weaken the check. The worker still rejects the first attempt, the
// request never ran, and if the token comes back unchanged the refusal was a real
// permission decision and is left to stand.
if(r.status===403&&!retried&&((options&&options.method)||"GET")!=="GET"){var fresh=null;try{fresh=await api("/api/session",null,true)}catch(probeError){fresh=null}
if(fresh&&fresh.csrf_token&&fresh.csrf_token!==state.csrf){state.csrf=fresh.csrf_token;return api(path,options,true)}}
var fallback=r.status===401?(path==="/api/login"?"The User ID or password is incorrect.":"Your session has expired. Please sign in again."):r.status===423?"This account is temporarily locked. Contact an Administrator or try again later.":r.status===403?"Your account does not have permission to complete this action.":"The tracker could not complete the request. Please try again.";if(r.status===401&&path!=="/api/login"){
// A 401 on anything except the sign-in request itself means the session is gone —
// timed out, expired, or ended elsewhere. The sign-in screen is the only correct
// destination, and reaching it must not depend on the warning modal having fired:
// a throttled timer in a background tab means it often has not. Callers catch this
// and report it with toast(error.message), so the message is deliberately empty and
// toast() ignores empty messages; showSignIn() has already said it on screen.
// Every tab shares this cookie, so if it is gone here it is gone everywhere. Tell
// the others rather than leaving them on a workspace that can no longer save.
announceSession({type:"signed-out"});
showSignIn("Your session has expired. Sign in again to continue.");
var expired=new Error("");expired.sessionExpired=true;throw expired}
throw new Error(data.error||fallback)}return data}
function passwordScore(value){var p=String(value||""),score=0;if(p.length>=10)score++;if(p.length>=14)score++;if(/[A-Z]/.test(p)&&/[a-z]/.test(p))score++;if(/[0-9]/.test(p))score++;if(/[^A-Za-z0-9]/.test(p))score++;return score}
function renderStrength(inputId,barId,textId){var value=byId(inputId).value,score=passwordScore(value),bar=byId(barId),label=byId(textId),width=Math.min(100,score*20),colors=["#c9384b","#c9384b","#df6a2e","#f2b134","#008f78","#008f78"];bar.style.width=width+"%";bar.style.background=colors[score];label.textContent=!value?"Enter at least 10 characters":score<=2?"Weak":score===3?"Fair":score===4?"Strong":"Very strong";label.style.color=score>=4?"#008f78":score===3?"#955700":"#c9384b"}
function setView(view,keepPosition){if(!titles[view])view="projects";if(view==="admin"&&state.me&&state.me.role!=="admin")view="projects";document.querySelectorAll("[data-pane]").forEach(function(p){p.hidden=p.dataset.pane!==view});document.querySelectorAll("[data-view]").forEach(function(b){b.classList.toggle("active",b.dataset.view===view)});byId("pageTitle").textContent=titles[view][0];byId("pageSub").textContent=titles[view][1];history.replaceState(null,"","#"+view);byId("projectsControls").hidden=!["projects","cost","risk"].includes(view);byId("developmentControls").hidden=view!=="development";byId("columnsBtn").parentElement.hidden=view!=="projects";byId("search").placeholder=view==="risk"?"Search risk register":view==="cost"?"Search cost register":"Search projects";if(view==="admin")loadAdmin();if(!keepPosition)window.scrollTo({top:0,behavior:"smooth"})}
function visibleProjects(){return state.unitScope==="All"?state.projects:state.projects.filter(function(p){return p.business_unit===state.unitScope})}
function capitalProjects(){return visibleProjects().filter(function(p){return p.project_type==="Capital"})}
function developmentProjects(){return visibleProjects().filter(function(p){return p.project_type==="Development"})}
function projectGroup(p){return p.business_unit+"|"+(p.section_name||p.venue||"Other")}
function groupLabel(p){return p.business_unit+" — "+(p.section_name||p.venue||"Other")}
function compare(a,b,key){var av=a[key],bv=b[key];if(key==="budget_risk"||key==="schedule_risk"){var rank={High:4,Medium:3,Low:2,"Not Rated":1};av=rank[riskValue(av)];bv=rank[riskValue(bv)]}if(av==null||av==="")return 1;if(bv==null||bv==="")return-1;if(typeof av==="number"||typeof bv==="number")return(Number(av)||0)-(Number(bv)||0);return String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:"base"})}
function groupedRows(rows,key,dir){var groups=new Map();rows.slice().sort(function(a,b){return Number(a.source_sort_order)-Number(b.source_sort_order)}).forEach(function(p){var g=projectGroup(p);if(!groups.has(g))groups.set(g,[]);groups.get(g).push(p)});groups.forEach(function(items){items.sort(function(a,b){var result=compare(a,b,key);return dir==="asc"?result:-result})});return Array.from(groups.values())}

var columns={progress:["name","capp","lead","status","budget_risk","schedule_risk","activity","actions"],schedule:["name","lead","original_start_date","current_start_date","original_turnover_date","current_turnover_date","duration_change_days","activity","actions"],cost:["name","precon_capp","construction_capp","add_capp","approved_budget","anticipated_final_cost","forecast_variance","variance_pct","actions"],all:["name","capp","lead","status","budget_risk","schedule_risk","approved_budget","anticipated_final_cost","current_turnover_date","activity","actions"]};
var labels={name:"Project",capp:"CAPP #",lead:"PM / Lead",status:"Status",budget_risk:"Budg. Risk",schedule_risk:"Sched. Risk",activity:"Activity Update",original_start_date:"Orig. Start",current_start_date:"Curr. Start",original_turnover_date:"Orig. Turnover",current_turnover_date:"Curr. Turnover",duration_change_days:"Days",precon_capp:"A&E / Pre-Con",construction_capp:"Const. CAPP",add_capp:"Add-CAPP",approved_budget:"Total Approved",anticipated_final_cost:"AFC",forecast_variance:"Variance",variance_pct:"% Var.",actions:"More"};
var keyMap={name:"name",capp:"capp_number",lead:"project_manager",status:"status",budget_risk:"budget_risk",schedule_risk:"schedule_risk",activity:"reporting_period",original_start_date:"original_start_date",current_start_date:"current_start_date",original_turnover_date:"original_turnover_date",current_turnover_date:"current_turnover_date",duration_change_days:"duration_change_days",precon_capp:"precon_capp",construction_capp:"construction_capp",add_capp:"add_capp",approved_budget:"approved_budget",anticipated_final_cost:"anticipated_final_cost",forecast_variance:"forecast_variance",variance_pct:"forecast_variance"};
function headHtml(cols){return"<tr>"+cols.map(function(c){if(c==="actions")return'<th class="col-actions"><span>More</span></th>';var key=keyMap[c]||c,active=state.sortKey===key;return'<th class="col-'+c+'"><button type="button" data-sort="'+key+'">'+labels[c]+' <span class="sort-mark '+(active?"active":"")+'">'+(active?(state.sortDir==="asc"?"▲":"▼"):"◇")+'</span></button></th>'}).join("")+"</tr>"}
function riskSelect(p,field){var value=riskValue(p[field]);if(!canWrite())return'<span class="risk-pill '+riskClass(value)+'">'+value+'</span>';return'<select class="inline-select '+riskClass(value)+'" data-field="'+field+'" data-id="'+p.id+'">'+["High","Medium","Low","Not Rated"].map(function(v){return'<option '+(v===value?"selected":"")+'>'+v+'</option>'}).join("")+"</select>"}
function statusSelect(p){if(!canWrite())return'<span class="status-text">'+esc(p.status)+'</span>';var values=p.project_type==="Development"?["Active","On Hold","Complete","Needs Status"]:["Active","On Hold","Closeout","Complete"];return'<select class="inline-select" data-field="status" data-id="'+p.id+'">'+values.map(function(v){return'<option '+(v===p.status?"selected":"")+'>'+v+'</option>'}).join("")+"</select>"}
function numberInput(p,field){var raw=p[field]==null?"":p[field];return canWrite()?'<input class="mini-input currency-input" inputmode="decimal" aria-label="'+esc(labels[field])+'" data-number-field="'+field+'" data-id="'+p.id+'" data-raw="'+esc(raw)+'" value="'+esc(moneyText(raw))+'">':'<span class="money">'+moneyText(raw)+"</span>"}
function cell(p,c){var lead=p.project_manager||p.development_lead||"—",identifier=p.capp_number||p.initiative_number||"—",variance=num(p.forecast_variance),percent=p.approved_budget?variance/Number(p.approved_budget):null;if(c==="name")return'<button class="project-link" data-details="'+p.id+'">'+esc(p.name)+'</button><span class="sub">'+esc(p.source_sheet||p.business_unit)+'</span>';if(c==="capp")return esc(identifier);if(c==="lead")return esc(lead);if(c==="status")return statusSelect(p);if(c==="budget_risk"||c==="schedule_risk")return riskSelect(p,c);if(c==="activity")return'<div class="activity-date">'+esc(dateText(p.reporting_period))+'</div><div class="activity-inline" '+(canWrite()?'contenteditable="true"':"")+' data-activity="'+p.id+'">'+esc(p.current_update||"")+'</div><div class="activity-hint">Click to edit • double-click for history</div>';if(["precon_capp","construction_capp","add_capp","anticipated_final_cost"].includes(c))return numberInput(p,c);if(c==="approved_budget")return'<span class="money">'+moneyText(p.approved_budget)+"</span>";if(c==="forecast_variance")return'<span class="'+(variance>0?"bad":variance<0?"good":"")+'">'+moneyText(variance)+"</span>";if(c==="variance_pct")return'<span class="'+(percent>0?"bad":percent<0?"good":"")+'">'+pctText(percent)+"</span>";if(c==="duration_change_days")return p.duration_change_days==null?"—":esc(p.duration_change_days);if(["original_start_date","current_start_date","original_turnover_date","current_turnover_date"].includes(c))return esc(dateText(p[c]));if(c==="actions")return'<button class="more-btn" data-details="'+p.id+'" aria-label="Open all project fields">•••</button>';return"—"}
function bodyHtml(rows,cols){var html="";groupedRows(rows,state.sortKey,state.sortDir).forEach(function(items){var p=items[0];html+='<tr class="section-row"><td colspan="'+cols.length+'">'+esc(groupLabel(p))+'<small>'+items.length+' project'+(items.length===1?"":"s")+'</small></td></tr>';items.forEach(function(project){html+='<tr class="project-row" data-record-row>'+cols.map(function(c){return'<td class="col-'+c+' '+(["precon_capp","construction_capp","add_capp","approved_budget","anticipated_final_cost","forecast_variance","variance_pct"].includes(c)?"money":"")+'">'+cell(project,c)+"</td>"}).join("")+"</tr>"})});return html||'<tr><td colspan="'+cols.length+'" class="loading">No projects match the current filters.</td></tr>'}
function filteredCapital(){var q=byId("search").value.trim().toLowerCase(),status=byId("statusFilter").value,risk=byId("riskFilter").value;return capitalProjects().filter(function(p){var text=[p.name,p.section_name,p.venue,p.business_unit,p.capp_number,p.project_manager,p.current_update].join(" ").toLowerCase();return(!q||text.includes(q))&&(!status||p.status===status)&&(!risk||riskValue(p.budget_risk)===risk||riskValue(p.schedule_risk)===risk)})}
function renderProjects(){var rows=filteredCapital(),cols=columns[state.preset];byId("projectsHead").innerHTML=headHtml(cols);byId("projectsBody").innerHTML=bodyHtml(rows,cols);enhanceTable("projectsBody",byId("search").value);byId("projectCount").textContent=rows.length+" of "+capitalProjects().length+" capital projects"}

function renderUnitBar(){var units=Array.from(new Set(state.projects.map(function(p){return p.business_unit})));byId("businessUnitBar").innerHTML=["All"].concat(units).map(function(unit){return'<button class="unit-btn '+(state.unitScope===unit?"active":"")+'" data-business-unit="'+esc(unit)+'">'+esc(unit==="All"?"All":unit)+"</button>"}).join("");byId("unitSelectionText").textContent=state.unitScope==="All"?"Entire D&C portfolio":state.unitScope+" portfolio"}
function renderDonut(list){var total=list.reduce(function(s,u){return s+u.projects},0),circ=351.858,offset=0;var circles=list.map(function(u,i){var length=total?u.projects/total*circ:0,color=colors[i%colors.length],dash=length+" "+(circ-length),circle='<circle class="donut-segment" cx="70" cy="70" r="56" fill="none" stroke="'+color+'" stroke-width="24" stroke-dasharray="'+dash+'" stroke-dashoffset="'+(-offset)+'" data-pie-unit="'+esc(u.name)+'" tabindex="0" role="button" aria-label="'+esc(u.name+": "+u.projects+" current projects")+'" data-tooltip="'+esc(u.name+": "+u.projects+" current projects")+'"></circle>';offset+=length;return circle}).join("");byId("portfolioDonut").innerHTML='<svg class="donut" viewBox="0 0 140 140" aria-label="Current projects by business unit"><circle cx="70" cy="70" r="56" fill="none" stroke="#e6eef1" stroke-width="24"></circle><g transform="rotate(-90 70 70)">'+circles+'</g><text x="70" y="66" text-anchor="middle" class="donut-total">'+total+'</text><text x="70" y="82" text-anchor="middle" class="donut-label">CURRENT</text></svg>';byId("portfolioLegend").innerHTML=list.map(function(u,i){return'<button data-pie-unit="'+esc(u.name)+'"><span style="background:'+colors[i%colors.length]+'"></span><strong>'+esc(u.name)+'</strong><em>'+u.projects+'</em></button>'}).join("")}
function applyKpiOrder(){var container=byId("portfolioKpis"),order=[];try{order=JSON.parse(localStorage.getItem("dn-dc-kpi-order")||"[]")}catch(e){}order.forEach(function(key){var card=container.querySelector('[data-kpi="'+CSS.escape(key)+'"]');if(card)container.appendChild(card)})}
function saveKpiOrder(){var order=Array.from(byId("portfolioKpis").querySelectorAll("[data-kpi]")).map(function(card){return card.dataset.kpi});try{localStorage.setItem("dn-dc-kpi-order",JSON.stringify(order))}catch(e){}}
function renderPortfolio(){var rows=visibleProjects(),current=rows.filter(function(p){return currentStatus(p.status)}),units={};current.forEach(function(p){var u=units[p.business_unit]||(units[p.business_unit]={name:p.business_unit,projects:0,capital:0,highRisk:0});u.projects++;u.capital+=Number(p.approved_budget)||0;if(riskValue(p.budget_risk)==="High"||riskValue(p.schedule_risk)==="High")u.highRisk++});var list=Object.values(units),budget=current.reduce(function(sum,p){return sum+(Number(p.approved_budget)||0)},0),high=current.filter(function(p){return riskValue(p.budget_risk)==="High"||riskValue(p.schedule_risk)==="High"}),development=current.filter(function(p){return p.project_type==="Development"}),needs=rows.filter(function(p){return p.status==="Needs Status"});byId("kpiActive").textContent=current.length;byId("kpiBudget").textContent=moneyText(budget);byId("kpiHigh").textContent=high.length;byId("kpiDevelopment").textContent=development.length;byId("needsStatusCallout").hidden=!needs.length;byId("needsStatusCallout").innerHTML='<strong>'+needs.length+' development record'+(needs.length===1?"":"s")+' require a status.</strong> They remain visible in Development Pipeline and are excluded from current-work counts.';var max=Math.max.apply(null,list.map(function(u){return u.projects}).concat([1]));byId("unitSummary").innerHTML=list.map(function(u){return'<button class="unit-row unit-row-button" data-business-unit="'+esc(u.name)+'"><strong>'+esc(u.name)+'</strong><div class="track"><div class="fill" style="width:'+(u.projects/max*100)+'%"></div></div><span>'+u.projects+'</span></button>'}).join("")||'<div class="count-note">No projects in this selection.</div>';byId("attentionList").innerHTML=high.slice(0,8).map(function(p){var flags=(riskValue(p.budget_risk)==="High"?'<span class="risk-flag budget">B High</span>':"")+(riskValue(p.schedule_risk)==="High"?'<span class="risk-flag schedule">S High</span>':"");return'<div class="attention" data-record-row><div class="attention-copy"><strong>'+esc(p.name)+'</strong><small>'+esc(p.business_unit+" • "+(p.section_name||p.venue))+'</small><div class="risk-flags">'+flags+'</div></div><button class="more-btn" data-details="'+p.id+'">•••</button></div>'}).join("")||'<div class="count-note">No High-risk projects recorded.</div>';renderDonut(list);applyKpiOrder()}

function developmentRows(){var q=byId("developmentSearch").value.trim().toLowerCase(),status=byId("developmentStatus").value;return developmentProjects().filter(function(p){var text=[p.name,p.initiative_number,p.business_unit,p.development_lead,p.development_requestor,p.current_update].join(" ").toLowerCase();return(!q||text.includes(q))&&(!status||p.status===status)})}
var devCols=[{key:"name",label:"Project"},{key:"initiative_number",label:"Initiative #"},{key:"development_lead",label:"Dev. Lead"},{key:"status",label:"Status"},{key:"development_requestor",label:"Requestor"},{key:"development_deliverable_due_date",label:"Due"},{key:"development_original_estimate",label:"Orig. Est."},{key:"development_current_estimate",label:"Curr. Est."},{key:"current_update",label:"Activity Update"},{key:"actions",label:"More"}];
function devHead(){return"<tr>"+devCols.map(function(c){if(c.key==="actions")return'<th class="col-actions">More</th>';var active=state.devSortKey===c.key;return'<th class="dev-'+c.key+'"><button data-dev-sort="'+c.key+'">'+c.label+' <span class="sort-mark '+(active?"active":"")+'">'+(active?(state.devSortDir==="asc"?"▲":"▼"):"◇")+'</span></button></th>'}).join("")+"</tr>"}
function renderDevelopment(){var all=developmentProjects(),rows=developmentRows(),groups=new Map();rows.slice().sort(function(a,b){var r=compare(a,b,state.devSortKey);return state.devSortDir==="asc"?r:-r}).forEach(function(p){if(!groups.has(p.business_unit))groups.set(p.business_unit,[]);groups.get(p.business_unit).push(p)});var html="";groups.forEach(function(items,unit){html+='<tr class="section-row"><td colspan="'+devCols.length+'">'+esc(unit)+'<small>'+items.length+' record'+(items.length===1?"":"s")+'</small></td></tr>';items.forEach(function(p){html+='<tr class="project-row" data-record-row><td><button class="project-link" data-development="'+p.id+'">'+esc(p.name)+'</button></td><td class="dev-initiative">'+esc(p.initiative_number||"—")+'</td><td>'+esc(p.development_lead||"—")+'</td><td class="col-status">'+statusSelect(p)+'</td><td>'+esc(p.development_requestor||"—")+'</td><td class="dev-date">'+esc(dateText(p.development_deliverable_due_date))+'</td><td class="money">'+moneyText(p.development_original_estimate)+'</td><td class="money">'+moneyText(p.development_current_estimate)+'</td><td class="dev-update"><div class="activity-date">'+dateText(p.reporting_period)+'</div><div class="activity-inline" '+(canWrite()?'contenteditable="true"':"")+' data-activity="'+p.id+'">'+esc(p.current_update||"")+'</div><div class="activity-hint">Click to edit • double-click for history</div></td><td class="dev-actions"><button class="more-btn" data-development="'+p.id+'">•••</button>'+(canWrite()?'<button class="promote-btn" data-promote="'+p.id+'">Promote</button>':"")+'</td></tr>'})});byId("developmentHead").innerHTML=devHead();byId("developmentBody").innerHTML=html||'<tr><td colspan="'+devCols.length+'" class="loading">No development records match.</td></tr>';enhanceTable("developmentBody",byId("developmentSearch").value);var current=all.filter(function(p){return["Active","On Hold"].includes(p.status)}),needs=all.filter(function(p){return p.status==="Needs Status"}),estimate=all.reduce(function(s,p){return s+(Number(p.development_current_estimate)||0)},0);byId("devTotal").textContent=all.length;byId("devCurrent").textContent=current.length;byId("devNeeds").textContent=needs.length;byId("devEstimate").textContent=moneyText(estimate);byId("developmentCount").textContent=rows.length+" of "+all.length+" development records"}

function renderCost(){var rows=filteredCapital();var sums={precon_capp:0,construction_capp:0,approved_budget:0,anticipated_final_cost:0};rows.forEach(function(p){Object.keys(sums).forEach(function(k){sums[k]+=Number(p[k])||0})});byId("sumPrecon").textContent=moneyText(sums.precon_capp);byId("sumConstruction").textContent=moneyText(sums.construction_capp);byId("sumApproved").textContent=moneyText(sums.approved_budget);byId("sumAfc").textContent=moneyText(sums.anticipated_final_cost);var cols=columns.cost;byId("costHead").innerHTML=headHtml(cols);byId("costBody").innerHTML=bodyHtml(rows,cols);enhanceTable("costBody",byId("search").value)}
function renderRisk(){var rows=visibleProjects().filter(matchesProjectFilters),counts={High:0,Medium:0,Low:0,"Not Rated":0};rows.forEach(function(p){var levels=[riskValue(p.budget_risk),riskValue(p.schedule_risk)],level=levels.includes("High")?"High":levels.includes("Medium")?"Medium":levels.includes("Low")?"Low":"Not Rated";counts[level]++});byId("riskHigh").textContent=counts.High;byId("riskMedium").textContent=counts.Medium;byId("riskLow").textContent=counts.Low;byId("riskUnrated").textContent=counts["Not Rated"];var high=rows.filter(function(p){return riskValue(p.budget_risk)==="High"||riskValue(p.schedule_risk)==="High"});byId("highRiskCards").innerHTML=high.map(function(p){return'<div class="card high-card"><strong>'+esc(p.name)+'</strong><p>'+esc(p.business_unit)+'</p><div class="risk-flags">'+(riskValue(p.budget_risk)==="High"?'<span class="risk-flag budget">B High</span>':"")+(riskValue(p.schedule_risk)==="High"?'<span class="risk-flag schedule">S High</span>':"")+'</div></div>'}).join("");var cols=["name","budget_risk","schedule_risk","approved_budget","anticipated_final_cost","forecast_variance","variance_pct","original_turnover_date","current_turnover_date","duration_change_days","actions"];byId("riskHead").innerHTML=headHtml(cols);byId("riskBody").innerHTML=bodyHtml(rows,cols);enhanceTable("riskBody",byId("search").value)}
function renderAll(){renderUnitBar();renderProjects();renderPortfolio();renderDevelopment();renderCost();renderRisk();fitFilterControls()}

// --- Account transition -------------------------------------------------------
// Everything below turns on one fact: the workspace is HIDDEN when an account
// leaves, never unloaded. Hiding is enough while the same person signs back in,
// because load() overwrites every container before the workspace is shown again.
// It is not enough when the account CHANGES, because the next account can be
// shown that same workspace before any of its own data exists — a
// temporary-password sign-in does exactly that, since the shell has to be
// revealed to put the password form in front of it. The previous Editor's rows,
// totals, history and audit entries were still sitting there, in the DOM, under
// the dialog. So they are removed on the way out rather than covered up.
//
// These two lists are every container renderAll(), renderProfileHeader() and the
// admin views write account data into. They are deliberately written out rather
// than derived from a selector: a container that stops being cleared should break
// a named assertion, not silently drop out of a query.
var ACCOUNT_HTML=["projectsHead","projectsBody","costHead","costBody","riskHead","riskBody","developmentHead","developmentBody","businessUnitBar","unitSummary","attentionList","highRiskCards","portfolioDonut","portfolioLegend","needsStatusCallout","historyList","roleList","auditList","adminPagination","loginEventList","loginPagination","headerAvatar"];
var ACCOUNT_TEXT=["projectCount","developmentCount","unitSelectionText","kpiActive","kpiBudget","kpiHigh","kpiDevelopment","devTotal","devCurrent","devNeeds","devEstimate","sumPrecon","sumConstruction","sumApproved","sumAfc","riskHigh","riskMedium","riskLow","riskUnrated","adminCounts","directoryCount","loginEventCount","userChip","activityTitle","activityMeta","detailsTitle","detailsMeta","developmentTitle","developmentMeta","promoteMeta"];
var ACCOUNT_FORMS=["detailsForm","developmentForm","promoteForm","userForm","profileForm","addForm","passwordForm"];
function clearAccountData(){
  state.projects=[];state.summary={};state.updates=[];
  state.adminUsers=[];state.adminAudit=[];state.adminLoginEvents=[];
  state.adminPage=1;state.loginPage=1;state.activityId=null;state.unitScope="All";
  ACCOUNT_HTML.forEach(function(id){var el=byId(id);if(el)el.innerHTML=""});
  ACCOUNT_TEXT.forEach(function(id){var el=byId(id);if(el)el.textContent=""});
  ACCOUNT_FORMS.forEach(function(id){var form=byId(id);if(form)form.reset()});
  byId("needsStatusCallout").hidden=true;
  byId("activityEditor").value="";
  // Filters belong to the person who typed them. Left in place they would keep
  // silently narrowing the next account's table.
  ["search","developmentSearch","statusFilter","riskFilter","developmentStatus"].forEach(function(id){byId(id).value=""});
}

// Every control whose visibility depends on WHO is signed in, resolved in one
// place from state.me. It used to be spread across load() and
// showPasswordChangeOnly(), and the two disagreed: the password shell hid
// exportBtn and columnsBtn, and load() — which only ever set the controls it
// knew about — never set them back. That is DNC-008: after a successful password
// change the tracker returned, but Download and Choose Columns stayed hidden
// until the page was reloaded by hand.
//
// Download and Choose Columns are VIEW capabilities: neither changes any stored
// value, both only re-present data the account has already been served. So every
// signed-in role keeps them, Viewer included — which is exactly what the worker
// enforces, since /api/export.* asks only for a resolved role and a replaced
// temporary password.
function canDownload(){return Boolean(state.me&&state.me.role&&!state.me.must_change_password)}
function canChooseColumns(){return canDownload()}
function applyCapabilities(){
  var me=state.me,local=Boolean(me)&&me.auth_source==="local";
  byId("adminNav").hidden=!me||me.role!=="admin";
  byId("addBtn").hidden=!canWrite();
  byId("saveActivityBtn").hidden=!canWrite();
  byId("exportBtn").hidden=!canDownload();
  byId("columnsBtn").hidden=!canChooseColumns();
  byId("logoutBtn").hidden=!local;
  byId("changePasswordBtn").hidden=!local;
}

// Minimal shell for an account that must replace its temporary password before
// anything else. No project data is fetched or rendered; the only way out is to
// change the password or sign out.
async function showPasswordChangeOnly(){
  var session;
  try{session=await(await fetch("/api/session",{cache:"no-store",credentials:"same-origin",redirect:"error"})).json()}
  catch(error){showSignIn("Sign in again to continue.");return false}
  if(!session||!session.ok){showSignIn("Sign in again to continue.");return false}
  state.me={email:session.email,name:session.name,role:null,auth_source:session.auth_source,must_change_password:true,csrf_token:session.csrf_token};
  state.csrf=session.csrf_token||null;
  // Emptied first, then kept hidden. Either alone would do for the screen the
  // user sees, but neither alone is honest: revealing the workspace here is what
  // put the previous Editor's rows behind the password form, and leaving those
  // rows in the document means they are one stray unhide away from being shown
  // again. The password dialog is a sibling of the workspace, not a child of it,
  // so keeping the workspace hidden costs nothing — the form is still there.
  clearAccountData();
  byId("loading").hidden=true;byId("signedOut").hidden=true;byId("workspace").hidden=true;
  // state.me.role is null here, so this hides everything that would need project
  // data we have not been given, and leaves only sign-out and the password form.
  applyCapabilities();
  // Inside the hidden workspace, and hidden in their own right, so that revealing
  // the workspace could never on its own hand this account a control it may not use.
  ["projectsControls","developmentControls"].forEach(function(id){byId(id).hidden=true});
  byId("columnsBtn").parentElement.hidden=true;
  byId("passwordDialogClose").hidden=true;byId("passwordDialogCancel").hidden=true;byId("passwordDialogSignOut").hidden=false;
  if(!byId("passwordDialog").open)byId("passwordDialog").showModal();
  toast("Replace your temporary password to continue.");
  return false;
}
async function load(reset){if(reset){state.preset="progress";state.sortKey="source_sort_order";state.sortDir="asc";state.devSortKey="source_sort_order";state.devSortDir="asc";state.unitScope="All";["search","developmentSearch"].forEach(function(id){byId(id).value=""});["statusFilter","riskFilter","developmentStatus"].forEach(function(id){byId(id).value=""});document.querySelectorAll(".preset").forEach(function(b){b.classList.toggle("active",b.dataset.preset==="progress")})}var r=await fetch("/api/bootstrap",{cache:"no-store",credentials:"same-origin",redirect:"error"});if(r.status===401){showSignIn(state.me?"Your session has expired. Sign in again to continue.":"");return false}
// 428 means the account is signed in but still on a temporary password. The
// workspace payload is deliberately withheld, so there is no me object to use —
// the details come from /api/session instead, which sits above that gate. Before
// this the user was simply told to replace the password with no form to do it in.
if(r.status===428)return showPasswordChangeOnly();
var data=await r.json();if(!r.ok)throw new Error(data.error||"Tracker unavailable");state.projects=data.projects;state.summary=data.summary;state.updates=data.updates;state.me=data.me;state.csrf=data.me.csrf_token||null;renderProfileHeader();applyCapabilities();renderAll();byId("loading").hidden=true;byId("signedOut").hidden=true;byId("workspace").hidden=false;setView(location.hash.replace("#","")||"projects",!reset);startIdleWatch();if(state.me.auth_source==="local"&&state.me.must_change_password){byId("passwordDialogClose").hidden=true;byId("passwordDialogCancel").hidden=true;byId("passwordDialogSignOut").hidden=false;setTimeout(function(){if(!byId("passwordDialog").open)byId("passwordDialog").showModal()},80)}return true}
async function signIn(event){event.preventDefault();var button=byId("loginBtn"),message=byId("loginError"),username=byId("loginUsername").value.trim(),password=byId("loginPassword").value;message.textContent="";button.disabled=true;button.textContent="Signing in…";try{await api("/api/login",{method:"POST",body:JSON.stringify({username:username,password:password})});byId("loginForm").reset();await load(true);announceSession({type:"signed-in"})}catch(error){message.textContent=error.message+" Confirm that the User ID above is your Delaware North email."}finally{button.disabled=false;button.textContent="Sign in"}}
// --- Inactivity timeout -------------------------------------------------------
// The duration lives in the worker (IDLE_SECONDS) and arrives on state.me, so
// nothing here hardcodes a period. These timers only decide when to WARN — the
// worker is what actually ends a session, which is why a timer firing in a tab
// that has been sitting idle can never sign anyone out on its own.
var idleTimers={warn:null,tick:null},idleDeadline=0,idleLastPing=0,idleLastLocal=0,idleChannel=null;
function idleSeconds(){return Number(state.me&&state.me.idle_seconds)||0}
function idleWarningSeconds(){return Number(state.me&&state.me.idle_warning_seconds)||60}
// How often real input may tell the worker the user is still here. This bounds how
// stale the worker's last_used_at can be, so it must stay comfortably shorter than
// the warning window — otherwise the warning loses its lead and can arrive after
// the session has already ended. Half the warning is a wide margin.
function idlePingMs(){return Math.max(5000,Math.min(60000,idleWarningSeconds()*500))}
function clearIdleTimers(){if(idleTimers.warn){clearTimeout(idleTimers.warn);idleTimers.warn=null}if(idleTimers.tick){clearInterval(idleTimers.tick);idleTimers.tick=null}}
function stopIdleWatch(){clearIdleTimers();if(byId("idleDialog").open)byId("idleDialog").close()}
// Take the worker at its word: the security token, which changes when a different
// sign-in replaces the shared cookie, and the authoritative time remaining.
function adoptSession(data){
  if(!data)return 0;
  if(data.csrf_token)state.csrf=data.csrf_token;
  return Number(data.idle_remaining)||0;
}
// The seconds argument is always a figure the worker supplied. With none, fall to
// what the last bootstrap reported — loading the workspace is a read and does not
// refresh the session, so a full period must never be assumed here.
function startIdleWatch(seconds){
  clearIdleTimers();
  if(!state.me||state.me.auth_source!=="local")return;
  var total=Number(seconds);
  if(!(total>0))total=Number(state.me.idle_remaining)||idleSeconds();
  if(!total)return;
  if(byId("idleDialog").open)byId("idleDialog").close();
  idleDeadline=Date.now()+total*1000;
  idleTimers.warn=setTimeout(function(){openIdleWarning()},Math.max(0,total-idleWarningSeconds())*1000);
}
// Never warn on the strength of a local timer alone. It may have been throttled in
// a background tab and fired after the worker already ended the session, and
// another tab sharing this login may have kept the session alive. Ask first — the
// probe is a GET, so asking never extends anything, and api() sends an expired
// session straight to the sign-in screen.
async function openIdleWarning(){
  if(!state.me)return;
  var data;
  // An expired session has already been sent to the sign-in screen by api(). Any
  // other failure means the question could not be asked — offline, or a blip — so
  // try again shortly rather than going quiet and never warning at all.
  try{data=await api("/api/session")}catch(error){
    if(!error||!error.sessionExpired){clearIdleTimers();idleTimers.warn=setTimeout(function(){openIdleWarning()},15000)}
    return;
  }
  var left=adoptSession(data);
  if(left<=0){stopIdleWatch();showSignIn("You were signed out after a period of inactivity. Sign in again to continue.");return}
  if(left>idleWarningSeconds()+1){startIdleWatch(left);return}
  clearIdleTimers();
  idleDeadline=Date.now()+left*1000;
  if(!byId("idleDialog").open)byId("idleDialog").showModal();
  renderIdleCountdown();
  idleTimers.tick=setInterval(renderIdleCountdown,1000);
}
function renderIdleCountdown(){
  var left=Math.max(0,Math.round((idleDeadline-Date.now())/1000));
  byId("idleMessage").textContent=left>0
    ?"You have been inactive. Your session will end in "+Math.floor(left/60)+":"+String(left%60).padStart(2,"0")+"."
    :"Checking whether your session is still active…";
  if(left<=0){clearIdleTimers();confirmIdleExpiry()}
}
// The countdown reaching zero is not proof the session ended — another tab may have
// kept it alive. Ask the worker, which is the only authority, and never end the
// session from here.
async function confirmIdleExpiry(){
  try{
    var left=adoptSession(await api("/api/session"));
    if(left>0){startIdleWatch(left);return}
  }catch(error){}
  stopIdleWatch();
  showSignIn("You were signed out after a period of inactivity. Sign in again to continue.");
}
async function staySignedIn(){
  try{
    var data=await api("/api/session",{method:"POST",body:"{}"});
    idleLastPing=Date.now();
    startIdleWatch(adoptSession(data));
    announceSession({type:"extended"});
  }catch(error){
    stopIdleWatch();
    showSignIn("You were signed out after a period of inactivity. Sign in again to continue.");
  }
}
// Real input is the only thing that extends a session, and it does so by telling
// the worker — the local clock is never allowed to grant time on its own.
//
// The previous version pushed the local deadline forward on every keystroke while
// only pinging the worker every few minutes. The two drifted apart, and the warning
// could be scheduled for long after the worker had already ended the session. Now
// input does exactly one thing: send a throttled ping. The reply sets the deadline,
// so the browser can only ever count down to a moment the worker agreed to.
function noteActivity(){
  if(!state.me||state.me.auth_source!=="local")return;
  if(byId("idleDialog").open)return;
  if(!idleSeconds())return;
  var now=Date.now();
  // Scroll and pointer events arrive in bursts; this keeps the common case to a
  // couple of comparisons without affecting when the ping itself is due.
  if(now-idleLastLocal<1000)return;
  idleLastLocal=now;
  if(now-idleLastPing<idlePingMs())return;
  idleLastPing=now;
  api("/api/session",{method:"POST",body:"{}"}).then(function(data){
    startIdleWatch(adoptSession(data));
    announceSession({type:"extended"});
  }).catch(function(){});
}

// Browsers throttle timers in a hidden tab — Firefox aggressively — so a warning
// scheduled before the tab went to the background can fire late or not at all.
// On return, ask the worker what is actually left instead of trusting the local
// clock. The probe is a GET, so asking does not itself extend the session, and an
// expired one is routed to the sign-in screen by api().
async function resyncIdleWatch(){
  if(!state.me||state.me.auth_source!=="local")return;
  try{
    var left=adoptSession(await api("/api/session"));
    if(left<=0){stopIdleWatch();showSignIn("You were signed out after a period of inactivity. Sign in again to continue.");return}
    startIdleWatch(left);
  }catch(error){}
}

// --- Tab synchronisation ------------------------------------------------------
// Tabs in the same browser share one cookie, so they share one session. With no
// channel between them a tab keeps stale state after another tab signs out or signs
// in as somebody else, and its next write fails with a 403 that reads as a surprise
// logout.
//
// Only a signal travels here, never a credential: no session token and no security
// token is ever posted to the channel. A tab that hears something asks the worker
// for its own copy, so the worker stays the authority for every tab. The channel is
// same-origin, so it cannot reach another browser, another profile or a private
// window — separate sign-ins stay isolated from each other.
function sessionChannel(){
  if(idleChannel!==null)return idleChannel;
  idleChannel=false;
  try{
    if(typeof BroadcastChannel!=="undefined"){
      idleChannel=new BroadcastChannel("dnc-session");
      idleChannel.onmessage=function(event){onSessionMessage(event.data)};
    }
  }catch(error){idleChannel=false}
  return idleChannel;
}
function announceSession(message){var channel=sessionChannel();if(channel){try{channel.postMessage(message)}catch(error){}}}
function onSessionMessage(message){
  if(!message||typeof message!=="object")return;
  if(message.type==="signed-out"){
    if(!state.me)return;
    stopIdleWatch();
    showSignIn("You were signed out in another tab. Sign in again to continue.");
    return;
  }
  // A different account may now hold the shared cookie, so reload rather than keep
  // cached projects, a cached role or a token that belongs to the previous session.
  if(message.type==="signed-in"){load(false).catch(function(){});return}
  if(message.type==="extended"){if(state.me)resyncIdleWatch()}
}

// Signing off always ends at the sign-in screen. Leaving the workspace on screen
// because the request failed strands the user in a session they cannot use and
// cannot leave; showSignIn() clears every piece of client-side state regardless.
async function signOut(){var failed=false;try{await api("/api/logout",{method:"POST",body:"{}"})}catch(error){failed=true}announceSession({type:"signed-out"});showSignIn(failed?"You were signed off on this device. Sign in again to confirm the session ended.":"")}
// A FORCED change is an account arriving, not a signed-in person editing a
// setting: the shell it happens in has no data, no filters and no capabilities
// resolved yet. Reloading with reset=true is what a manual browser refresh would
// do, and the point of DNC-008 is that no manual refresh should be needed. A
// voluntary change keeps reset=false so the person's filters and sort survive it.
async function changePassword(event){event.preventDefault();var forced=Boolean(state.me&&state.me.must_change_password),next=byId("newPassword").value,confirm=byId("newPasswordConfirm").value;if(next!==confirm)return toast("The new passwords do not match.");try{await api("/api/account/password",{method:"POST",body:JSON.stringify({current_password:byId("currentPassword").value,new_password:next,confirm_password:confirm})});byId("passwordForm").reset();byId("passwordDialog").close();toast("Your password was changed.");await load(forced)}catch(error){toast(error.message)}}
async function patchFields(id,fields,message){await api("/api/projects/"+id+"/fields",{method:"PATCH",body:JSON.stringify(fields)});if(message)toast(message);await load(false)}
async function saveInline(el){var before=el.dataset.before||"",after=el.textContent.trim();if(!after){el.textContent=before;return toast("Activity update cannot be blank.")}if(after===before)return;el.setAttribute("contenteditable","false");try{await api("/api/projects/"+el.dataset.activity+"/activity",{method:"POST",body:JSON.stringify({current_update:after})});toast("Activity saved with today's date.");await load(false)}catch(e){el.textContent=before;toast(e.message)}finally{if(canWrite())el.setAttribute("contenteditable","true")}}
async function openActivity(id){state.activityId=Number(id);var p=state.projects.find(function(x){return x.id===state.activityId});if(!p)return;byId("activityTitle").textContent=p.name;var location=p.project_type==="Development"?"Development Pipeline":(p.section_name||p.venue||"Project");byId("activityMeta").textContent=p.business_unit+" • "+location+" • "+dateText(p.reporting_period);byId("activityEditor").value=p.current_update||"";byId("activityEditor").readOnly=!canWrite();byId("historyList").innerHTML='<div class="loading"><div class="spinner"></div>Loading history…</div>';byId("activityDialog").showModal();try{var data=await api("/api/projects/"+id+"/history");byId("historyList").innerHTML=data.history.map(function(h){return'<article class="history-entry"><h4>'+esc(dateText(h.reporting_period))+'</h4><small>'+esc(h.author_name||h.author_email||"Workbook Import")+'</small><p>'+esc(h.current_summary)+'</p></article>'}).join("")||'<div class="count-note">No activity history recorded.</div>'}catch(e){byId("historyList").innerHTML='<div class="count-note">'+esc(e.message)+"</div>"}}
// The button is disabled for the duration of the request. Without it a second
// click fired a second POST before the first had returned, and the server's
// "same text as current" check could not help: both requests read the project
// row before either wrote, so both saw the old text and both proceeded. The
// server now derives a deterministic key so the database rejects the duplicate
// too -- this guard simply stops the pointless second round trip.
async function saveModalActivity(){var button=byId("saveActivityBtn");if(button.disabled)return;var text=byId("activityEditor").value.trim();if(!text)return toast("Activity update cannot be blank.");button.disabled=true;button.setAttribute("aria-busy","true");try{await api("/api/projects/"+state.activityId+"/activity",{method:"POST",body:JSON.stringify({current_update:text})});toast("Dated activity update saved.");byId("activityDialog").close();await load(false)}finally{button.disabled=false;button.removeAttribute("aria-busy")}}

function updateCalc(){var pre=moneyNumber(byId("fPrecon").value)||0,con=moneyNumber(byId("fConstruction").value)||0,add=moneyNumber(byId("fAddCapp").value)||0,afc=moneyNumber(byId("fAfc").value),approved=pre+con+add,variance=(afc==null||afc===undefined)?null:afc-approved;byId("calcApproved").textContent=moneyText(approved);byId("calcVariance").textContent=moneyText(variance);byId("calcPercent").textContent=approved&&variance!=null?pctText(variance/approved):"—"}
function openDetails(id){var p=state.projects.find(function(x){return x.id===Number(id)});if(!p)return;if(p.project_type==="Development")return openDevelopment(id);setValue("detailsId",p.id);byId("detailsTitle").textContent=p.name;byId("detailsMeta").textContent=p.business_unit+" • "+(p.section_name||p.venue);setValue("fName",p.name);setValue("fCapp",p.capp_number);setValue("fLead",p.project_manager);setValue("fStatus",p.status);setValue("fBudgetRisk",riskValue(p.budget_risk));setValue("fScheduleRisk",riskValue(p.schedule_risk));setValue("fSection",p.section_name||p.venue);setMoneyValue("fPrecon",p.precon_capp);setMoneyValue("fConstruction",p.construction_capp);setMoneyValue("fAddCapp",p.add_capp);setMoneyValue("fAfc",p.anticipated_final_cost);setValue("fOriginalStart",dateInput(p.original_start_date));setValue("fCurrentStart",dateInput(p.current_start_date));setValue("fOriginalTurn",dateInput(p.original_turnover_date));setValue("fCurrentTurn",dateInput(p.current_turnover_date));setValue("fScope",p.scope_description);updateCalc();byId("detailsForm").querySelectorAll("input,select,textarea").forEach(function(el){if(el.id!=="detailsId")el.disabled=!canWrite()});byId("detailsDialog").showModal()}
async function saveDetails(event){event.preventDefault();var id=byId("detailsId").value;
// Stop before sending if a cost field holds something that is not a number.
// Sending it as null would clear the stored amount, which is exactly what the
// user did not ask for.
var money=collectMoney({precon_capp:"fPrecon",construction_capp:"fConstruction",add_capp:"fAddCapp",anticipated_final_cost:"fAfc"});
if(money.invalid)return toast(moneyFieldLabel(money.invalid)+" must be a number, or left blank to clear it.");
await patchFields(id,Object.assign({name:byId("fName").value,capp_number:byId("fCapp").value,project_manager:byId("fLead").value,status:byId("fStatus").value,budget_risk:byId("fBudgetRisk").value,schedule_risk:byId("fScheduleRisk").value,section_name:byId("fSection").value,original_start_date:byId("fOriginalStart").value,current_start_date:byId("fCurrentStart").value,original_turnover_date:byId("fOriginalTurn").value,current_turnover_date:byId("fCurrentTurn").value,scope_description:byId("fScope").value},money.values),"Project fields saved.");byId("detailsDialog").close()}

function openDevelopment(id){var p=state.projects.find(function(x){return x.id===Number(id)});if(!p)return;setValue("developmentId",p.id);byId("developmentTitle").textContent=p.name;byId("developmentMeta").textContent=p.business_unit+" • Design & Development row "+(p.development_source_row||"—");setValue("dName",p.name);setValue("dInitiative",p.initiative_number);setValue("dLead",p.development_lead);setValue("dStatus",p.status);setValue("dRequestDate",dateInput(p.development_request_date));setValue("dRequestor",p.development_requestor);setValue("dDueDate",dateInput(p.development_deliverable_due_date));setValue("dScope",p.scope_description);setValue("dConsultants",p.development_consultants);setValue("dFoodService",p.development_food_service_design);setValue("dDesignCapp",p.development_design_capp);setMoneyValue("dExpense",p.development_subsidiary_expense_total);setMoneyValue("dOriginalEstimate",p.development_original_estimate);setValue("dOriginalEstimateDate",dateInput(p.development_original_estimate_date));setMoneyValue("dCurrentEstimate",p.development_current_estimate);setValue("dCurrentEstimateDate",dateInput(p.development_current_estimate_date));byId("developmentForm").querySelectorAll("input,select,textarea").forEach(function(el){if(el.id!=="developmentId")el.disabled=!canWrite()});byId("developmentDialog").showModal()}
async function saveDevelopment(event){event.preventDefault();var id=byId("developmentId").value;
var devMoney=collectMoney({subsidiary_expense_total:"dExpense",original_estimate:"dOriginalEstimate",current_estimate:"dCurrentEstimate"});
if(devMoney.invalid)return toast(moneyFieldLabel(devMoney.invalid)+" must be a number, or left blank to clear it.");await api("/api/projects/"+id+"/fields",{method:"PATCH",body:JSON.stringify({name:byId("dName").value,initiative_number:byId("dInitiative").value,development_lead:byId("dLead").value,status:byId("dStatus").value,scope_description:byId("dScope").value})});await api("/api/projects/"+id+"/development",{method:"PATCH",body:JSON.stringify({request_date:byId("dRequestDate").value,requestor:byId("dRequestor").value,deliverable_due_date:byId("dDueDate").value,consultants:byId("dConsultants").value,food_service_design:byId("dFoodService").value,design_capp:byId("dDesignCapp").value,subsidiary_expense_total:devMoney.values.subsidiary_expense_total,original_estimate:devMoney.values.original_estimate,original_estimate_date:byId("dOriginalEstimateDate").value,current_estimate:devMoney.values.current_estimate,current_estimate_date:byId("dCurrentEstimateDate").value})});toast("Development fields saved.");byId("developmentDialog").close();await load(false)}
function openPromote(id){var p=state.projects.find(function(x){return x.id===Number(id)});if(!p)return;setValue("promoteId",p.id);byId("promoteMeta").textContent=p.name+" • history will be preserved";var units=Array.from(new Set(state.projects.map(function(x){return x.business_unit})));byId("pUnit").innerHTML=units.map(function(unit){return'<option '+(unit===p.business_unit?"selected":"")+'>'+esc(unit)+"</option>"}).join("");setValue("pCapp",p.initiative_number);setValue("pManager",p.development_lead);setValue("pSection",p.name);byId("promoteDialog").showModal()}
async function promoteProject(event){event.preventDefault();var id=byId("promoteId").value;await api("/api/projects/"+id+"/promote",{method:"POST",body:JSON.stringify({business_unit:byId("pUnit").value,capp_number:byId("pCapp").value,project_manager:byId("pManager").value,section_name:byId("pSection").value})});toast("Development record promoted to Projects.");byId("promoteDialog").close();await load(false);setView("projects")}

async function loadAdmin(){if(!state.me||state.me.role!=="admin")return;try{var data=await api("/api/admin");state.adminUsers=data.roles;state.adminAudit=data.audit;state.adminLoginEvents=data.login_events||[];renderAdmin();byId("adminCounts").textContent=data.counts.projects+" projects • "+data.roles.length+" users"}catch(e){toast(e.message)}}
function filteredAdmin(){var q=byId("adminSearch").value.trim().toLowerCase(),role=byId("adminRoleFilter").value,status=byId("adminStatusFilter").value,sort=byId("adminSort").value;var rows=state.adminUsers.filter(function(u){var text=[u.first_name,u.last_name,u.username,u.user_email,u.title,u.company].join(" ").toLowerCase();return(!q||text.includes(q))&&(!role||u.role===role)&&(!status||u.account_status===status)});var rank={admin:1,editor:2,viewer:3};rows.sort(function(a,b){if(sort==="role")return rank[a.role]-rank[b.role]||a.last_name.localeCompare(b.last_name);if(sort==="status")return String(a.account_status).localeCompare(String(b.account_status))||a.last_name.localeCompare(b.last_name);if(sort==="updated")return String(b.updated_at).localeCompare(String(a.updated_at));return(a.last_name+" "+a.first_name).localeCompare(b.last_name+" "+b.first_name)});return rows}
// Sign-in history. The event types are the ones recordLoginEvent() writes in the
// worker: success, failed, locked_attempt and logout. Anything unrecognised is
// shown rather than dropped, so a new event type cannot silently disappear.
var loginOutcomes={success:{label:"Successful sign-in",kind:"ok"},failed:{label:"Failed attempt",kind:"bad"},locked_attempt:{label:"Blocked while locked",kind:"bad"},logout:{label:"Signed out",kind:"muted"}};
function loginOutcome(type){return loginOutcomes[type]||{label:String(type||"Unknown").replaceAll("_"," "),kind:"muted"}}
// A raw user agent is unreadable in a table cell, so the cell carries a summary and
// the untouched original sits in the tooltip.
function browserLabel(agent){
  if(!agent)return"—";
  // Plain substring tests: this script is emitted from a template literal, where a
  // regex backslash would have to be doubled to survive.
  var has=function(token){return agent.indexOf(token)!==-1};
  var browser=has("Edg/")?"Edge":has("OPR/")?"Opera":has("Chrome/")?"Chrome":has("Firefox/")?"Firefox":has("Safari/")?"Safari":has("curl/")?"curl":"Other";
  var platform=has("Windows")?"Windows":(has("Macintosh")||has("Mac OS"))?"macOS":(has("iPhone")||has("iPad"))?"iOS":has("Android")?"Android":has("Linux")?"Linux":"";
  return platform?browser+" on "+platform:browser;
}
function filteredLoginEvents(){
  var q=byId("loginSearch").value.trim().toLowerCase(),outcome=byId("loginOutcomeFilter").value;
  return state.adminLoginEvents.filter(function(e){
    var text=[e.username_attempted,e.user_email,e.first_name,e.last_name,e.ip_address,e.user_agent,loginOutcome(e.event_type).label].join(" ").toLowerCase();
    return(!q||text.includes(q))&&(!outcome||e.event_type===outcome);
  });
}
function renderLoginEvents(){
  var rows=filteredLoginEvents(),size=15,pages=Math.max(1,Math.ceil(rows.length/size));
  state.loginPage=Math.min(state.loginPage,pages);
  var pageRows=rows.slice((state.loginPage-1)*size,state.loginPage*size);
  byId("loginEventCount").textContent=rows.length+" of "+state.adminLoginEvents.length+" events";
  byId("loginEventList").innerHTML=pageRows.map(function(e){
    var outcome=loginOutcome(e.event_type);
    // A null match is the case an administrator most needs to see: a User ID that
    // belongs to no account at all.
    var account=e.user_email
      ? '<strong>'+esc(((e.first_name||"")+" "+(e.last_name||"")).trim()||e.user_email)+'</strong><small>'+esc(e.user_email)+'</small>'
      : '<span class="login-unmatched">No matching account</span>';
    return'<tr data-record-row><td>'+esc(auditDateTime(e.created_at))+'</td><td>'+esc(e.username_attempted||"—")+'</td><td>'+account+'</td><td><span class="login-outcome login-'+outcome.kind+'">'+esc(outcome.label)+'</span></td><td>'+esc(e.ip_address||"—")+'</td><td><span data-tooltip="'+esc(e.user_agent||"Not recorded")+'">'+esc(browserLabel(e.user_agent))+'</span></td></tr>';
  }).join("")||'<tr><td colspan="6" class="loading">No login activity recorded yet.</td></tr>';
  var buttons=[];for(var i=1;i<=pages;i++)buttons.push('<button class="'+(i===state.loginPage?"active":"")+'" data-login-page="'+i+'">'+i+"</button>");
  byId("loginPagination").innerHTML='<button data-login-page="'+Math.max(1,state.loginPage-1)+'">Previous</button>'+buttons.join("")+'<button data-login-page="'+Math.min(pages,state.loginPage+1)+'">Next</button>';
}
function renderAdmin(){var rows=filteredAdmin(),size=15,pages=Math.max(1,Math.ceil(rows.length/size));state.adminPage=Math.min(state.adminPage,pages);var pageRows=rows.slice((state.adminPage-1)*size,state.adminPage*size);byId("directoryCount").textContent=rows.length+" of "+state.adminUsers.length+" users";byId("roleList").innerHTML=pageRows.map(function(u){var password=u.password_configured?'<span class="password-status ready">Configured</span>':'<span class="password-status pending">Not set</span>';return'<tr data-record-row><td><div class="directory-person">'+avatarHtml(u)+'<div><strong>'+esc(u.first_name+" "+u.last_name)+'</strong><small>'+esc(u.title||u.company||"")+'</small></div></div></td><td>'+esc(u.username||"—")+'<small>'+esc(u.user_email||"")+'</small></td><td><span class="role-badge role-'+u.role+'">'+esc(u.role)+'</span></td><td><span class="access-badge">'+esc(u.account_status)+'</span></td><td>'+password+'</td><td>'+esc(u.business_unit_scope||"All")+'</td><td>'+esc(dateText(u.updated_at))+'</td><td><button class="btn small" data-user-edit="'+u.id+'">Edit</button></td></tr>'}).join("")||'<tr><td colspan="8" class="loading">No users match.</td></tr>';enhanceTable("roleList",byId("adminSearch").value);var buttons=[];for(var i=1;i<=pages;i++)buttons.push('<button class="'+(i===state.adminPage?"active":"")+'" data-admin-page="'+i+'">'+i+"</button>");byId("adminPagination").innerHTML='<button data-admin-page="'+Math.max(1,state.adminPage-1)+'">Previous</button>'+buttons.join("")+'<button data-admin-page="'+Math.min(pages,state.adminPage+1)+'">Next</button>';byId("auditList").innerHTML=state.adminAudit.map(auditRowHtml).join("")||'<div class="count-note">No audit activity yet.</div>';renderLoginEvents()}
function openUser(id){var u=id?state.adminUsers.find(function(x){return x.id===Number(id)}):null;resetPhotoDraft("admin",u);byId("userDialogTitle").textContent=u?"Edit user":"Add user";setValue("userId",u&&u.id);setValue("uFirst",u&&u.first_name);setValue("uLast",u&&u.last_name);setValue("uUsername",u&&u.username);setValue("uEmail",u&&u.user_email);setValue("uTitle",u&&u.title);setValue("uDepartment",u&&u.department||"Design & Construction");setValue("uCompany",u&&u.company||"Delaware North");setValue("uRole",u&&u.role||"viewer");var units=["All"].concat(Array.from(new Set(state.projects.map(function(p){return p.business_unit}))));byId("uBusinessUnit").innerHTML=units.map(function(unit){return'<option '+(unit===(u&&u.business_unit_scope||"All")?"selected":"")+'>'+esc(unit)+"</option>"}).join("");setValue("uLocation",u&&u.location);setValue("uPhone",u&&u.mobile_phone);setValue("uAccountStatus",u&&u.account_status||"pending");setValue("uSiteAccess",u&&u.site_access_status||"pending");setValue("uPassword","");setValue("uPasswordConfirm","");setValue("uNotes",u&&u.notes);byId("uPasswordStatus").textContent=u&&u.password_configured?"A password is configured. Enter a new password only to reset it; the existing password cannot be retrieved.":"No password is configured. Assign a temporary password before authorizing access.";renderStrength("uPassword","uStrengthBar","uStrengthText");byId("userDialog").showModal()}
async function saveUser(event){event.preventDefault();if(photoDrafts.admin&&photoDrafts.admin.busy)return toast("Please wait for the photo to finish preparing.");var password=byId("uPassword").value,confirmation=byId("uPasswordConfirm").value;if(password!==confirmation)return toast("The temporary passwords do not match.");var savedUser=await api("/api/admin/users",{method:"POST",body:JSON.stringify({id:num(byId("userId").value),first_name:byId("uFirst").value,last_name:byId("uLast").value,username:byId("uUsername").value,user_email:byId("uEmail").value,title:byId("uTitle").value,department:byId("uDepartment").value,company:byId("uCompany").value,role:byId("uRole").value,business_unit_scope:byId("uBusinessUnit").value,location:byId("uLocation").value,mobile_phone:byId("uPhone").value,account_status:byId("uAccountStatus").value,site_access_status:byId("uSiteAccess").value,temporary_password:password,confirm_password:confirmation,notes:byId("uNotes").value})});setValue("userId",savedUser.id);setValue("uPassword","");setValue("uPasswordConfirm","");try{await savePhotoDraft("admin",savedUser.id)}catch(error){await loadAdmin();throw new Error("User details saved, but photo was not saved: "+error.message)}if(state.me.profile&&state.me.profile.id===savedUser.id){await load(false)}toast(password?"User saved and temporary password replaced.":"User directory saved.");byId("userDialog").close();await loadAdmin()}
async function addProject(event){event.preventDefault();await api("/api/projects",{method:"POST",body:JSON.stringify({name:byId("aName").value,business_unit:byId("aUnit").value,section_name:byId("aSection").value,project_type:byId("aType").value,capp_number:byId("aCapp").value,initiative_number:byId("aCapp").value,project_manager:byId("aType").value==="Capital"?byId("aLead").value:null,development_lead:byId("aType").value==="Development"?byId("aLead").value:null,current_update:byId("aActivity").value})});toast("Project created.");byId("addDialog").close();byId("addForm").reset();await load(false)}

document.addEventListener("dragstart",function(e){var card=e.target.closest("[data-kpi]");if(!card)return;state.kpiDragKey=card.dataset.kpi;state.kpiDragged=true;card.classList.add("dragging");if(e.dataTransfer){e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",state.kpiDragKey)}});
document.addEventListener("dragover",function(e){var target=e.target.closest("[data-kpi]"),container=byId("portfolioKpis"),dragging=container&&container.querySelector(".kpi.dragging");if(!target||!dragging||target===dragging)return;e.preventDefault();var rect=target.getBoundingClientRect(),before=e.clientY<rect.top+rect.height*.45||(Math.abs(e.clientY-(rect.top+rect.height/2))<rect.height*.2&&e.clientX<rect.left+rect.width/2);container.insertBefore(dragging,before?target:target.nextSibling)});
document.addEventListener("drop",function(e){if(!e.target.closest("[data-kpi]"))return;e.preventDefault();saveKpiOrder()});
document.addEventListener("dragend",function(e){var card=e.target.closest("[data-kpi]");if(!card)return;card.classList.remove("dragging");saveKpiOrder();setTimeout(function(){state.kpiDragged=false;state.kpiDragKey=null},0)});
document.addEventListener("click",function(e){var toggle=e.target.closest("[data-password-toggle]");if(toggle){var input=byId(toggle.dataset.passwordToggle),show=input.type==="password";input.type=show?"text":"password";toggle.textContent=show?"Hide":"Show";toggle.setAttribute("aria-label",(show?"Hide":"Show")+" password");return}var kpi=e.target.closest("[data-kpi-target]");if(kpi){if(state.kpiDragged)return;return setView(kpi.dataset.kpiTarget)}var view=e.target.closest("[data-view]");if(view)return setView(view.dataset.view);var unit=e.target.closest("[data-business-unit]");if(unit){state.unitScope=unit.dataset.businessUnit;renderAll();return}var pie=e.target.closest("[data-pie-unit]");if(pie){state.unitScope=pie.dataset.pieUnit;renderAll();setView("projects");return}var sort=e.target.closest("[data-sort]");if(sort){var key=sort.dataset.sort;if(state.sortKey===key)state.sortDir=state.sortDir==="asc"?"desc":"asc";else{state.sortKey=key;state.sortDir="asc"}renderProjects();renderCost();renderRisk();return}var devSort=e.target.closest("[data-dev-sort]");if(devSort){var dk=devSort.dataset.devSort;if(state.devSortKey===dk)state.devSortDir=state.devSortDir==="asc"?"desc":"asc";else{state.devSortKey=dk;state.devSortDir="asc"}renderDevelopment();return}var preset=e.target.closest("[data-preset]");if(preset){state.preset=preset.dataset.preset;document.querySelectorAll(".preset").forEach(function(b){b.classList.toggle("active",b===preset)});byId("columnMenu").hidden=true;renderProjects();return}var details=e.target.closest("[data-details]");if(details)return openDetails(details.dataset.details);var development=e.target.closest("[data-development]");if(development)return openDevelopment(development.dataset.development);var promote=e.target.closest("[data-promote]");if(promote)return openPromote(promote.dataset.promote);var user=e.target.closest("[data-user-edit]");if(user)return openUser(user.dataset.userEdit);var page=e.target.closest("[data-admin-page]");if(page){state.adminPage=Number(page.dataset.adminPage);renderAdmin();return}var loginPageButton=e.target.closest("[data-login-page]");if(loginPageButton){state.loginPage=Number(loginPageButton.dataset.loginPage);renderLoginEvents();return}var close=e.target.closest("[data-close]");if(close)return byId(close.dataset.close).close()});
document.addEventListener("keydown",function(e){var kpi=e.target.closest&&e.target.closest("[data-kpi-target]");if(kpi&&(e.key==="Enter"||e.key===" ")){e.preventDefault();setView(kpi.dataset.kpiTarget);return}var pie=e.target.closest&&e.target.closest("[data-pie-unit]");if(pie&&(e.key==="Enter"||e.key===" ")){e.preventDefault();pie.click()}});
document.addEventListener("focusin",function(e){if(e.target.matches("[data-activity]")){e.target.dataset.before=e.target.textContent.trim();e.target.querySelectorAll("mark").forEach(function(mark){mark.replaceWith(document.createTextNode(mark.textContent))})}if(e.target.matches("[data-number-field]"))e.target.value=e.target.dataset.raw||""});
document.addEventListener("focusout",function(e){if(e.target.matches("[data-activity]"))saveInline(e.target);if(e.target.matches("[data-number-field]")){var el=e.target,value=moneyNumber(el.value),before=moneyNumber(el.dataset.raw);if(value===undefined){el.value=moneyText(before);toast(moneyFieldLabel(el.dataset.numberField)+" must be a number, or left blank to clear it.");return}el.value=moneyText(value);if(value!==before)patchFields(el.dataset.id,Object.fromEntries([[el.dataset.numberField,value]]),"Cost field saved.").catch(function(err){toast(err.message)})}});
function handleRowDoubleClick(e){
  var target=e.target;
  if(!target||!target.closest)return;
  // Activity text, date, hint and cell whitespace keep their dedicated editor.
  var activity=target.closest("[data-activity]"),activityCell=target.closest(".col-activity,.dev-update");
  if(!activity&&activityCell)activity=activityCell.querySelector("[data-activity]");
  if(activity){e.preventDefault();return openActivity(activity.dataset.activity)}
  // Leave in-place controls and their existing single-click actions alone.
  if(target.closest("button,a,input,select,textarea,[contenteditable]"))return;
  var row=target.closest("[data-record-row]");
  if(!row)return;
  var action=row.querySelector("[data-details],[data-development],[data-user-edit]");
  if(action){e.preventDefault();action.click()}
}
document.addEventListener("dblclick",handleRowDoubleClick);
document.addEventListener("change",function(e){if(e.target.matches("[data-field]"))patchFields(e.target.dataset.id,Object.fromEntries([[e.target.dataset.field,e.target.value]]),"Field saved.").catch(function(err){toast(err.message)})});
["search","statusFilter","riskFilter"].forEach(function(id){byId(id).addEventListener("input",function(){renderProjects();renderCost();renderRisk()})});["developmentSearch","developmentStatus"].forEach(function(id){byId(id).addEventListener("input",renderDevelopment)});["adminSearch","adminRoleFilter","adminStatusFilter","adminSort"].forEach(function(id){byId(id).addEventListener("input",function(){state.adminPage=1;renderAdmin()})});
["loginSearch","loginOutcomeFilter"].forEach(function(id){byId(id).addEventListener("input",function(){state.loginPage=1;renderLoginEvents()})});
// Genuine input only — no bare timer, or an unattended desk would look busy.
// Typing, clicking, tapping and scrolling are what "still at the desk" looks like.
// Scrolling was reachable only by mouse wheel before, so reading a long table on a
// touchscreen or with the scrollbar did not register as use.
["pointerdown","keydown","wheel","touchstart","scroll"].forEach(function(type){document.addEventListener(type,noteActivity,{passive:true,capture:type==="scroll"})});
byId("idleStay").addEventListener("click",staySignedIn);
byId("idleSignOut").addEventListener("click",function(){stopIdleWatch();signOut()});
// Escape is itself activity, so dismissing the warning means "stay signed in".
byId("idleDialog").addEventListener("cancel",function(event){event.preventDefault();staySignedIn()});
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")resyncIdleWatch()});
// Open the channel at start-up, not on the first message sent. A tab that only ever
// listens — the one sitting idle while the user signs out in another — would
// otherwise never subscribe, and would keep showing a workspace it cannot save.
sessionChannel();
byId("uPassword").addEventListener("input",function(){renderStrength("uPassword","uStrengthBar","uStrengthText")});byId("newPassword").addEventListener("input",function(){renderStrength("newPassword","newStrengthBar","newStrengthText")});
byId("columnsBtn").addEventListener("click",function(){byId("columnMenu").hidden=!byId("columnMenu").hidden});byId("refreshBtn").addEventListener("click",function(){load(true).then(function(loaded){if(loaded)toast("Projects refreshed. Filters and sorting reset.")}).catch(function(e){toast(e.message)})});byId("addBtn").addEventListener("click",function(){byId("addDialog").showModal()});byId("addUserBtn").addEventListener("click",function(){openUser(null)});byId("backupBtn").addEventListener("click",function(){downloadBackup()});byId("saveActivityBtn").addEventListener("click",function(){saveModalActivity().catch(function(e){toast(e.message)})});byId("developmentHistoryBtn").addEventListener("click",function(){var id=byId("developmentId").value;byId("developmentDialog").close();openActivity(id)});byId("detailsForm").addEventListener("submit",function(e){saveDetails(e).catch(function(err){toast(err.message)})});byId("developmentForm").addEventListener("submit",function(e){saveDevelopment(e).catch(function(err){toast(err.message)})});byId("promoteForm").addEventListener("submit",function(e){promoteProject(e).catch(function(err){toast(err.message)})});byId("userForm").addEventListener("submit",function(e){saveUser(e).catch(function(err){toast(err.message)})});byId("addForm").addEventListener("submit",function(e){addProject(e).catch(function(err){toast(err.message)})});["fPrecon","fConstruction","fAddCapp","fAfc"].forEach(function(id){byId(id).addEventListener("input",updateCalc)});
byId("loginForm").addEventListener("submit",signIn);byId("logoutBtn").addEventListener("click",signOut);byId("changePasswordBtn").addEventListener("click",function(){byId("profileDialog").close();byId("passwordForm").reset();byId("passwordDialogClose").hidden=false;byId("passwordDialogCancel").hidden=false;byId("passwordDialogSignOut").hidden=true;renderStrength("newPassword","newStrengthBar","newStrengthText");byId("passwordDialog").showModal()});byId("passwordDialogClose").addEventListener("click",function(){byId("passwordDialog").close()});byId("passwordDialogCancel").addEventListener("click",function(){byId("passwordDialog").close()});byId("passwordForm").addEventListener("submit",changePassword);
// The forced password-change dialog is modal and hides its close and cancel
// controls, which puts the header sign-off button out of reach. Without this the
// only way out of the screen is to set a new password.
byId("passwordDialogSignOut").addEventListener("click",signOut);
// Immediate, keyboard-accessible tooltips; no browser-native hover delay.
var tooltipOwner=null;
var tooltip=document.createElement("div");tooltip.id="instantTooltip";tooltip.className="instant-tooltip";
tooltip.setAttribute("role","tooltip");tooltip.hidden=true;document.body.appendChild(tooltip);
function tooltipTarget(target){
  return target&&target.closest?target.closest("[data-tooltip],[title],select[data-field],.more-btn"):null;
}
function tooltipLabel(owner){
  if(owner.hasAttribute("title")){owner.dataset.tooltip=owner.getAttribute("title");owner.removeAttribute("title")}
  var field=owner.dataset.field;
  var label=owner.dataset.tooltip||({status:"Project status",budget_risk:"Budget risk",schedule_risk:"Schedule risk"})[field]||(owner.classList.contains("more-btn")?"Open project details and edit fields":"");
  if(owner.tagName==="SELECT"&&owner.dataset.field){
    var choice=owner.value?owner.options[owner.selectedIndex].textContent:(owner.id==="riskFilter"?"All risk levels":"All statuses");
    return label+" — "+choice;
  }
  return label;
}
function hideTooltip(){
  if(tooltipOwner){
    var ids=(tooltipOwner.getAttribute("aria-describedby")||"").split(" ").filter(function(id){return id&&id!=="instantTooltip"});
    if(ids.length)tooltipOwner.setAttribute("aria-describedby",ids.join(" "));else tooltipOwner.removeAttribute("aria-describedby");
  }
  tooltipOwner=null;tooltip.hidden=true;
}
function showTooltip(owner){
  if(!owner||owner===tooltipOwner)return;hideTooltip();
  var label=tooltipLabel(owner);if(!label)return;
  tooltipOwner=owner;tooltip.textContent=label;
  (owner.closest("dialog")||document.body).appendChild(tooltip);
  tooltip.hidden=false;tooltip.style.left="0px";tooltip.style.top="0px";
  var rect=owner.getBoundingClientRect(),box=tooltip.getBoundingClientRect(),edge=8;
  var left=Math.max(edge,Math.min(rect.left+(rect.width-box.width)/2,window.innerWidth-box.width-edge));
  var top=rect.bottom;if(top+box.height>window.innerHeight-edge)top=Math.max(edge,rect.top-box.height);
  tooltip.style.left=left+"px";tooltip.style.top=top+"px";
  var previous=owner.getAttribute("aria-describedby");owner.setAttribute("aria-describedby",(previous?previous+" ":"")+"instantTooltip");
}
document.addEventListener("pointerover",function(event){if(event.pointerType!=="touch"&&!tooltip.contains(event.target))showTooltip(tooltipTarget(event.target))});
document.addEventListener("pointerout",function(event){
  if(!tooltipOwner)return;var next=event.relatedTarget;
  if(next&&(tooltipOwner.contains(next)||tooltip.contains(next)))return;
  if(tooltipOwner.contains(event.target)||tooltip.contains(event.target))hideTooltip();
});
document.addEventListener("focusin",function(event){showTooltip(tooltipTarget(event.target))});
document.addEventListener("focusout",function(event){if(tooltipOwner&&tooltipOwner.contains(event.target))hideTooltip()});
document.addEventListener("pointerdown",hideTooltip,true);
document.addEventListener("click",function(event){
  hideTooltip();
  if(!event.target.closest(".menu-wrap"))byId("columnMenu").hidden=true;
  byId("columnsBtn").setAttribute("aria-expanded",String(!byId("columnMenu").hidden));
});
document.addEventListener("keydown",function(event){
  if(event.key==="Escape"){hideTooltip();byId("columnMenu").hidden=true;byId("columnsBtn").setAttribute("aria-expanded","false")}
});
document.addEventListener("scroll",hideTooltip,true);
window.addEventListener("resize",hideTooltip);
document.querySelectorAll("[title]").forEach(function(owner){owner.dataset.tooltip=owner.getAttribute("title");owner.removeAttribute("title")});

function matchesProjectFilters(p){
  var q=byId("search").value.trim().toLowerCase(),status=byId("statusFilter").value,risk=byId("riskFilter").value;
  var text=[p.name,p.section_name,p.venue,p.business_unit,p.capp_number,p.initiative_number,p.project_manager,p.development_lead,p.current_update].join(" ").toLowerCase();
  return(!q||text.includes(q))&&(!status||p.status===status)&&(!risk||riskValue(p.budget_risk)===risk||riskValue(p.schedule_risk)===risk);
}
function highlightMatches(root,query){
  var needle=query.trim().toLowerCase();if(!needle)return;
  var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[],node;
  while((node=walker.nextNode()))if(node.parentElement&&!node.parentElement.closest("select,textarea,script,style,mark,.avatar"))nodes.push(node);
  nodes.forEach(function(textNode){
    var text=textNode.nodeValue,lower=text.toLowerCase(),start=0,index=lower.indexOf(needle);if(index<0)return;
    var fragment=document.createDocumentFragment();
    while(index>=0){fragment.appendChild(document.createTextNode(text.slice(start,index)));var mark=document.createElement("mark");mark.className="search-match";mark.textContent=text.slice(index,index+needle.length);fragment.appendChild(mark);start=index+needle.length;index=lower.indexOf(needle,start)}
    fragment.appendChild(document.createTextNode(text.slice(start)));textNode.replaceWith(fragment);
  });
}
function enhanceTable(id,query){
  var root=byId(id);highlightMatches(root,query);
  root.querySelectorAll(".more-btn").forEach(function(button){button.title="Open details and edit fields";button.setAttribute("aria-label",button.title)});
  root.querySelectorAll("[data-activity]").forEach(function(el){el.title="Click to edit; double-click for dated activity history";el.setAttribute("aria-label","Activity update. Double-click for history.")});
}
function initials(p){return ((p&&p.first_name||"").trim().charAt(0)+(p&&p.last_name||"").trim().charAt(0)).toUpperCase()||"?"}
function avatarHtml(p){
  var frame=p&&p.avatar_frame,style="";
  if(frame&&Array.isArray(frame.crop)&&frame.crop.length===3){
    var x=Number(frame.crop[0]),y=Number(frame.crop[1]),size=Number(frame.crop[2]),w=Number(frame.width),h=Number(frame.height);
    if([x,y,size,w,h].every(Number.isFinite)&&size>0&&x>=0&&y>=0&&x+size<=w&&y+size<=h)
      style=' style="width:'+(w/size*100)+'%;height:'+(h/size*100)+'%;left:'+(-x/size*100)+'%;top:'+(-y/size*100)+'%;max-width:none"';
  }
  return '<span class="avatar"><span>'+esc(initials(p))+'</span>'+(p&&p.avatar_url?'<img src="'+esc(p.avatar_url)+'" alt="" loading="lazy"'+style+'>':'')+'</span>';
}
function renderProfileHeader(){
  var p=state.me&&state.me.profile;byId("profileBtn").hidden=!p;
  byId("headerAvatar").innerHTML=avatarHtml(p);byId("userChip").textContent=state.me?"Welcome "+(state.me.name||state.me.email)+" • "+state.me.role.charAt(0).toUpperCase()+state.me.role.slice(1):"";
}
function showSignIn(message){
  stopIdleWatch();
  closeExportMenu();
  state.me=null;state.csrf=null;
  // Not just the state: the rendered rows too. Hiding the workspace used to be
  // the whole of this, which left the previous account's portfolio in the DOM
  // for whoever signed in next to be shown. See clearAccountData().
  clearAccountData();
  document.querySelectorAll("dialog[open]").forEach(function(dialog){dialog.close()});
  byId("workspace").hidden=true;byId("loading").hidden=true;byId("signedOut").hidden=false;
  byId("profileBtn").hidden=true;applyCapabilities();
  byId("loginError").textContent=message;
  byId("loginPassword").value="";setTimeout(function(){byId("loginUsername").focus()},30);
}
function closeExportMenu(returnFocus){
  byId("exportMenu").hidden=true;byId("exportBtn").setAttribute("aria-expanded","false");
  if(returnFocus)byId("exportBtn").focus();
}
function openExportMenu(last){
  if(byId("exportBtn").disabled)return;
  hideTooltip();byId("columnMenu").hidden=true;byId("columnsBtn").setAttribute("aria-expanded","false");
  byId("exportMenu").hidden=false;byId("exportBtn").setAttribute("aria-expanded","true");
  var items=byId("exportMenu").querySelectorAll("[data-export]");items[last?items.length-1:0].focus();
}
async function downloadExport(format){
  var formats={xlsx:{label:"Excel",mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},csv:{label:"CSV",mime:"text/csv"},tsv:{label:"Tab-delimited",mime:"text/tab-separated-values"}},selected=formats[format];
  if(!selected||byId("exportBtn").disabled)return;
  closeExportMenu(true);hideTooltip();
  var button=byId("exportBtn");button.disabled=true;button.setAttribute("aria-busy","true");
  try{
    var response=await fetch("/api/export."+format,{credentials:"same-origin",cache:"no-store",redirect:"error"});
    if(response.status===401){showSignIn("Your session has expired. Sign in again before exporting.");return}
    if(!response.ok){var message=await response.json().catch(function(){return{}});throw new Error(message.error||selected.label+" export is unavailable. Please try again.")}
    if(!(response.headers.get("content-type")||"").includes(selected.mime))throw new Error("The download was interrupted. Please try again.");
    var blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="dn-dc-project-status."+format;document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url)},60000);toast(selected.label+" download started.");
  }catch(error){toast(error.message)}finally{button.disabled=false;button.removeAttribute("aria-busy")}
}
async function downloadBackup(){
  var button=byId("backupBtn");button.disabled=true;button.setAttribute("aria-busy","true");
  try{
    var response=await fetch("/api/admin/backup",{credentials:"same-origin",cache:"no-store",redirect:"error"});
    if(response.status===401){showSignIn("Your session has expired. Sign in again before downloading a backup.");return}
    if(response.status===403)throw new Error("Administrator access is required to download a backup.");
    if(!response.ok){var message=await response.json().catch(function(){return{}});throw new Error(message.error||"The backup could not be generated. Please try again.")}
    if(!(response.headers.get("content-type")||"").includes("zip"))throw new Error("The download was interrupted. Please try again.");
    var name=(/filename="([^"]+)"/.exec(response.headers.get("content-disposition")||"")||[])[1]||"dnc-tracker-backup.zip";
    var blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
    setTimeout(function(){URL.revokeObjectURL(url)},60000);
    toast("Backup downloaded. It contains staff data \u2014 store it securely.");
  }catch(error){toast(error.message)}finally{button.disabled=false;button.removeAttribute("aria-busy")}
}
var photoDrafts={};
function resetPhotoDraft(scope,profile){
  var old=photoDrafts[scope];if(old&&old.url)URL.revokeObjectURL(old.url);
  photoDrafts[scope]={profile:profile||{},blob:null,url:null,remove:false,busy:false};
  byId(scope+"Photo").value="";byId(scope+"Avatar").innerHTML=avatarHtml(profile);
}
async function preparePhoto(file){
  if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Choose a JPG, PNG or WebP image.");
  if(file.size>5*1024*1024)throw new Error("Choose an image smaller than 5 MB.");
  var url=URL.createObjectURL(file);
  try{
    var img=new Image();img.src=url;await img.decode();
    if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>40000000)throw new Error("Choose a smaller image.");
    var canvas=document.createElement("canvas");canvas.width=256;canvas.height=256;var context=canvas.getContext("2d");
    context.fillStyle="#ffffff";context.fillRect(0,0,256,256);
    var side=Math.min(img.naturalWidth,img.naturalHeight);
    context.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,256,256);
    var blob=await new Promise(function(resolve){canvas.toBlob(resolve,"image/jpeg",.88)});
    if(!blob||blob.size>256*1024)throw new Error("Unable to resize this photo. Please choose another image.");
    return blob;
  }finally{URL.revokeObjectURL(url)}
}
async function choosePhoto(scope,file){
  if(!file)return;var draft=photoDrafts[scope];draft.busy=true;
  try{
    var blob=await preparePhoto(file);if(photoDrafts[scope]!==draft)return;
    if(draft.url)URL.revokeObjectURL(draft.url);draft.blob=blob;draft.url=URL.createObjectURL(blob);draft.remove=false;
    byId(scope+"Avatar").innerHTML=avatarHtml(Object.assign({},draft.profile,{avatar_url:draft.url,avatar_frame:null}));
  }catch(error){toast(error.message)}finally{draft.busy=false}
}
function useInitials(scope){
  var draft=photoDrafts[scope];if(draft.url)URL.revokeObjectURL(draft.url);
  photoDrafts[scope]={profile:draft.profile,blob:null,url:null,remove:true,busy:false};
  byId(scope+"Photo").value="";byId(scope+"Avatar").innerHTML=avatarHtml(Object.assign({},draft.profile,{avatar_url:null}));
}
async function savePhotoDraft(scope,id){
  var draft=photoDrafts[scope];if(!draft)return;
  if(draft.busy)throw new Error("Please wait for the photo to finish preparing.");
  if(draft.blob||draft.remove){
    var result=await api("/api/users/"+id+"/avatar",{method:draft.remove?"DELETE":"PUT",headers:{"content-type":draft.blob?draft.blob.type:"application/json"},body:draft.remove?undefined:draft.blob});
    resetPhotoDraft(scope,result.profile);
  }
}
async function openProfile(){
  var data=await api("/api/account/profile"),p=data.profile;state.me.profile=p;
  resetPhotoDraft("profile",p);setValue("profileName",p.first_name+" "+p.last_name);setValue("profileEmail",p.user_email);
  setValue("profileUsername",p.username);setValue("profileTitleInput",p.title);setValue("profileLocation",p.location);setValue("profilePhone",p.mobile_phone);
  byId("profileDialog").showModal();
}
async function saveProfile(event){
  event.preventDefault();var button=byId("saveProfileBtn");button.disabled=true;
  try{
    if(photoDrafts.profile.busy)throw new Error("Please wait for the photo to finish preparing.");
    await api("/api/account/profile",{method:"PATCH",body:JSON.stringify({title:byId("profileTitleInput").value,location:byId("profileLocation").value,mobile_phone:byId("profilePhone").value})});
    await savePhotoDraft("profile",state.me.profile.id);
    state.me.profile=(await api("/api/account/profile")).profile;renderProfileHeader();byId("profileDialog").close();toast("Profile saved.");
    if(location.hash==="#admin")await loadAdmin();
  }catch(error){toast(error.message)}finally{button.disabled=false}
}
// Keep one shared control row and a single document-level vertical scroll.
byId("filterControls").append(byId("projectsControls"),byId("developmentControls"));
// Fit the selected label, not the longest option, and keep the caret close.
function fitFilterControls(){
  ["statusFilter","riskFilter","developmentStatus"].forEach(function(id){
    var select=byId(id),label=document.createElement("span"),style=getComputedStyle(select);
    label.textContent=select.options[select.selectedIndex].textContent;
    label.style.cssText="position:absolute;visibility:hidden;white-space:pre;pointer-events:none";
    label.style.fontFamily=style.fontFamily;label.style.fontSize=style.fontSize;
    label.style.fontWeight=style.fontWeight;label.style.letterSpacing=style.letterSpacing;
    document.body.appendChild(label);
    select.style.width=(Math.ceil(label.getBoundingClientRect().width)+22)+"px";
    label.remove();
  });
}
fitFilterControls();
byId("filterControls").addEventListener("change",fitFilterControls);
window.addEventListener("resize",fitFilterControls);
byId("profileBtn").addEventListener("click",function(){openProfile().catch(function(e){toast(e.message)})});
byId("profileForm").addEventListener("submit",saveProfile);
byId("exportBtn").addEventListener("click",function(){if(byId("exportMenu").hidden)openExportMenu();else closeExportMenu(true)});
byId("exportBtn").addEventListener("keydown",function(event){if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();openExportMenu(event.key==="ArrowUp")}});
byId("exportMenu").addEventListener("click",function(event){var item=event.target.closest("[data-export]");if(item)downloadExport(item.dataset.export)});
byId("exportMenu").addEventListener("keydown",function(event){
  var items=Array.from(this.querySelectorAll("[data-export]")),index=items.indexOf(document.activeElement);
  if(event.key==="ArrowDown"||event.key==="ArrowUp"||event.key==="Home"||event.key==="End"){
    event.preventDefault();index=event.key==="Home"?0:event.key==="End"?items.length-1:(index+(event.key==="ArrowDown"?1:-1)+items.length)%items.length;items[index].focus();
  }else if(event.key==="Escape"){event.preventDefault();closeExportMenu(true)}
  else if(event.key==="Tab"){closeExportMenu(true)}
});
document.addEventListener("click",function(event){if(!event.target.closest("#exportWrap"))closeExportMenu()});
document.addEventListener("focusin",function(event){if(!event.target.closest("#exportWrap"))closeExportMenu()});
window.addEventListener("hashchange",function(){closeExportMenu()});
["profile","admin"].forEach(function(scope){
  byId(scope+"Photo").addEventListener("change",function(e){choosePhoto(scope,e.target.files[0])});
  byId(scope==="profile"?"removeProfilePhoto":"removeAdminPhoto").addEventListener("click",function(){useInitials(scope)});
});
document.addEventListener("error",function(event){if(event.target.matches&&event.target.matches(".avatar img"))event.target.hidden=true},true);
load(true).catch(function(e){byId("loading").innerHTML="<strong>Unable to load tracker.</strong><br>"+esc(e.message)});
`;
