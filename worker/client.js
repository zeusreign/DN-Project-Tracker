export const CLIENT = `
var state={projects:[],summary:{},updates:[],me:null,csrf:null,preset:"progress",sortKey:"source_sort_order",sortDir:"asc",devSortKey:"source_sort_order",devSortDir:"asc",activityId:null,unitScope:"All",adminUsers:[],adminAudit:[],adminPage:1,kpiDragKey:null,kpiDragged:false};
var titles={portfolio:["Portfolio","Leadership summary by business unit"],projects:["Projects","Project activity, cost and schedule"],development:["Development Pipeline","Design & Development requests, estimates and promotion workflow"],cost:["Cost Control","Budgets, forecasts and variances"],risk:["Risk Register","All projects and all recorded risk levels"],admin:["Admin","User directory, roles and audit history"],help:["Help & User Guide","Quick reference and complete PDF instructions"]};
var money=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
var colors=["#087db5","#13a6c8","#008f78","#7ac143","#f2b134","#7357a6"];
function esc(v){return String(v==null?"":v).replace(/[&<>\"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]})}
function num(v){if(v==null||v==="")return null;var n=Number(v);return Number.isFinite(n)?n:null}
function moneyNumber(v){if(v==null||v==="")return null;var cleaned=String(v).replace(/[$,\\s]/g,"");if(/^\\(.*\\)$/.test(cleaned))cleaned="-"+cleaned.slice(1,-1);var n=Number(cleaned);return Number.isFinite(n)?n:null}
function moneyText(v){var n=num(v);return n==null?"—":money.format(n)}
function pctText(v){return v==null||!Number.isFinite(Number(v))?"—":new Intl.NumberFormat("en-US",{style:"percent",maximumFractionDigits:1}).format(Number(v))}
function dateText(v){if(!v)return"—";var s=String(v);var d=new Date(s.slice(0,10)+"T00:00:00Z");return Number.isNaN(d.valueOf())?s:d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}
function dateInput(v){return /^\\d{4}-\\d{2}-\\d{2}/.test(String(v||""))?String(v).slice(0,10):""}
function riskValue(v){var s=String(v||"Not Rated").trim().toLowerCase();return s==="high"?"High":s==="medium"?"Medium":s==="low"?"Low":"Not Rated"}
function riskClass(v){return"risk-"+riskValue(v).toLowerCase().replace(" ","-")}
function currentStatus(v){return["Active","On Hold","Closeout"].includes(v)}
function canWrite(){return state.me&&(state.me.role==="admin"||state.me.role==="editor")}
function byId(id){return document.getElementById(id)}
function setValue(id,value){byId(id).value=value==null?"":value}
function setMoneyValue(id,value){byId(id).value=value==null?"":moneyText(value)}
function toast(msg){var el=byId("toast");el.textContent=msg;el.classList.add("show");setTimeout(function(){el.classList.remove("show")},2800)}
async function api(path,options){var defaults={"content-type":"application/json"};if(state.csrf)defaults["x-csrf-token"]=state.csrf;var config=Object.assign({},options||{});config.headers=Object.assign(defaults,(options&&options.headers)||{});config.credentials='same-origin';config.cache='no-store';config.redirect='error';var r=await fetch(path,config);var data=await r.json().catch(function(){return{}});if(!r.ok){var fallback=r.status===401?(path==="/api/login"?"The User ID or password is incorrect.":"Your session has expired. Please sign in again."):r.status===423?"This account is temporarily locked. Contact an Administrator or try again later.":r.status===403?"Your account does not have permission to complete this action.":"The tracker could not complete the request. Please try again.";throw new Error(data.error||fallback)}return data}
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

async function load(reset){if(reset){state.preset="progress";state.sortKey="source_sort_order";state.sortDir="asc";state.devSortKey="source_sort_order";state.devSortDir="asc";state.unitScope="All";["search","developmentSearch"].forEach(function(id){byId(id).value=""});["statusFilter","riskFilter","developmentStatus"].forEach(function(id){byId(id).value=""});document.querySelectorAll(".preset").forEach(function(b){b.classList.toggle("active",b.dataset.preset==="progress")})}var r=await fetch("/api/bootstrap",{cache:"no-store",credentials:"same-origin",redirect:"error"});if(r.status===401){showSignIn(state.me?"Your session has expired. Sign in again to continue.":"");return false}var data=await r.json();if(!r.ok)throw new Error(data.error||"Tracker unavailable");state.projects=data.projects;state.summary=data.summary;state.updates=data.updates;state.me=data.me;state.csrf=data.me.csrf_token||null;renderProfileHeader();byId("adminNav").hidden=state.me.role!=="admin";byId("addBtn").hidden=!canWrite();byId("saveActivityBtn").hidden=!canWrite();byId("logoutBtn").hidden=state.me.auth_source!=="local";byId("changePasswordBtn").hidden=state.me.auth_source!=="local";renderAll();byId("loading").hidden=true;byId("signedOut").hidden=true;byId("workspace").hidden=false;setView(location.hash.replace("#","")||"projects",!reset);if(state.me.auth_source==="local"&&state.me.must_change_password){byId("passwordDialogClose").hidden=true;byId("passwordDialogCancel").hidden=true;setTimeout(function(){if(!byId("passwordDialog").open)byId("passwordDialog").showModal()},80)}return true}
async function signIn(event){event.preventDefault();var button=byId("loginBtn"),message=byId("loginError"),username=byId("loginUsername").value.trim(),password=byId("loginPassword").value;message.textContent="";button.disabled=true;button.textContent="Signing in…";try{await api("/api/login",{method:"POST",body:JSON.stringify({username:username,password:password})});byId("loginForm").reset();await load(true)}catch(error){message.textContent=error.message+" Confirm that the User ID above is your Delaware North email."}finally{button.disabled=false;button.textContent="Sign in"}}
async function signOut(){try{await api("/api/logout",{method:"POST",body:"{}"});showSignIn("")}catch(error){toast("Could not sign off. Please try again. "+error.message)}}
async function changePassword(event){event.preventDefault();var next=byId("newPassword").value,confirm=byId("newPasswordConfirm").value;if(next!==confirm)return toast("The new passwords do not match.");try{await api("/api/account/password",{method:"POST",body:JSON.stringify({current_password:byId("currentPassword").value,new_password:next,confirm_password:confirm})});byId("passwordForm").reset();byId("passwordDialog").close();toast("Your password was changed.");await load(false)}catch(error){toast(error.message)}}
async function patchFields(id,fields,message){await api("/api/projects/"+id+"/fields",{method:"PATCH",body:JSON.stringify(fields)});if(message)toast(message);await load(false)}
async function saveInline(el){var before=el.dataset.before||"",after=el.textContent.trim();if(!after){el.textContent=before;return toast("Activity update cannot be blank.")}if(after===before)return;el.setAttribute("contenteditable","false");try{await api("/api/projects/"+el.dataset.activity+"/activity",{method:"POST",body:JSON.stringify({current_update:after})});toast("Activity saved with today's date.");await load(false)}catch(e){el.textContent=before;toast(e.message)}finally{if(canWrite())el.setAttribute("contenteditable","true")}}
async function openActivity(id){state.activityId=Number(id);var p=state.projects.find(function(x){return x.id===state.activityId});if(!p)return;byId("activityTitle").textContent=p.name;var location=p.project_type==="Development"?"Development Pipeline":(p.section_name||p.venue||"Project");byId("activityMeta").textContent=p.business_unit+" • "+location+" • "+dateText(p.reporting_period);byId("activityEditor").value=p.current_update||"";byId("activityEditor").readOnly=!canWrite();byId("historyList").innerHTML='<div class="loading"><div class="spinner"></div>Loading history…</div>';byId("activityDialog").showModal();try{var data=await api("/api/projects/"+id+"/history");byId("historyList").innerHTML=data.history.map(function(h){return'<article class="history-entry"><h4>'+esc(dateText(h.reporting_period))+'</h4><small>'+esc(h.author_name||h.author_email||"Workbook Import")+'</small><p>'+esc(h.current_summary)+'</p></article>'}).join("")||'<div class="count-note">No activity history recorded.</div>'}catch(e){byId("historyList").innerHTML='<div class="count-note">'+esc(e.message)+"</div>"}}
async function saveModalActivity(){var text=byId("activityEditor").value.trim();if(!text)return toast("Activity update cannot be blank.");await api("/api/projects/"+state.activityId+"/activity",{method:"POST",body:JSON.stringify({current_update:text})});toast("Dated activity update saved.");byId("activityDialog").close();await load(false)}

function updateCalc(){var pre=moneyNumber(byId("fPrecon").value)||0,con=moneyNumber(byId("fConstruction").value)||0,add=moneyNumber(byId("fAddCapp").value)||0,afc=moneyNumber(byId("fAfc").value),approved=pre+con+add,variance=afc==null?null:afc-approved;byId("calcApproved").textContent=moneyText(approved);byId("calcVariance").textContent=moneyText(variance);byId("calcPercent").textContent=approved&&variance!=null?pctText(variance/approved):"—"}
function openDetails(id){var p=state.projects.find(function(x){return x.id===Number(id)});if(!p)return;if(p.project_type==="Development")return openDevelopment(id);setValue("detailsId",p.id);byId("detailsTitle").textContent=p.name;byId("detailsMeta").textContent=p.business_unit+" • "+(p.section_name||p.venue);setValue("fName",p.name);setValue("fCapp",p.capp_number);setValue("fLead",p.project_manager);setValue("fStatus",p.status);setValue("fBudgetRisk",riskValue(p.budget_risk));setValue("fScheduleRisk",riskValue(p.schedule_risk));setValue("fSection",p.section_name||p.venue);setMoneyValue("fPrecon",p.precon_capp);setMoneyValue("fConstruction",p.construction_capp);setMoneyValue("fAddCapp",p.add_capp);setMoneyValue("fAfc",p.anticipated_final_cost);setValue("fOriginalStart",dateInput(p.original_start_date));setValue("fCurrentStart",dateInput(p.current_start_date));setValue("fOriginalTurn",dateInput(p.original_turnover_date));setValue("fCurrentTurn",dateInput(p.current_turnover_date));setValue("fScope",p.scope_description);updateCalc();byId("detailsForm").querySelectorAll("input,select,textarea").forEach(function(el){if(el.id!=="detailsId")el.disabled=!canWrite()});byId("detailsDialog").showModal()}
async function saveDetails(event){event.preventDefault();var id=byId("detailsId").value;await patchFields(id,{name:byId("fName").value,capp_number:byId("fCapp").value,project_manager:byId("fLead").value,status:byId("fStatus").value,budget_risk:byId("fBudgetRisk").value,schedule_risk:byId("fScheduleRisk").value,section_name:byId("fSection").value,precon_capp:moneyNumber(byId("fPrecon").value),construction_capp:moneyNumber(byId("fConstruction").value),add_capp:moneyNumber(byId("fAddCapp").value),anticipated_final_cost:moneyNumber(byId("fAfc").value),original_start_date:byId("fOriginalStart").value,current_start_date:byId("fCurrentStart").value,original_turnover_date:byId("fOriginalTurn").value,current_turnover_date:byId("fCurrentTurn").value,scope_description:byId("fScope").value},"Project fields saved.");byId("detailsDialog").close()}

function openDevelopment(id){var p=state.projects.find(function(x){return x.id===Number(id)});if(!p)return;setValue("developmentId",p.id);byId("developmentTitle").textContent=p.name;byId("developmentMeta").textContent=p.business_unit+" • Design & Development row "+(p.development_source_row||"—");setValue("dName",p.name);setValue("dInitiative",p.initiative_number);setValue("dLead",p.development_lead);setValue("dStatus",p.status);setValue("dRequestDate",dateInput(p.development_request_date));setValue("dRequestor",p.development_requestor);setValue("dDueDate",dateInput(p.development_deliverable_due_date));setValue("dScope",p.scope_description);setValue("dConsultants",p.development_consultants);setValue("dFoodService",p.development_food_service_design);setValue("dDesignCapp",p.development_design_capp);setMoneyValue("dExpense",p.development_subsidiary_expense_total);setMoneyValue("dOriginalEstimate",p.development_original_estimate);setValue("dOriginalEstimateDate",dateInput(p.development_original_estimate_date));setMoneyValue("dCurrentEstimate",p.development_current_estimate);setValue("dCurrentEstimateDate",dateInput(p.development_current_estimate_date));byId("developmentForm").querySelectorAll("input,select,textarea").forEach(function(el){if(el.id!=="developmentId")el.disabled=!canWrite()});byId("developmentDialog").showModal()}
async function saveDevelopment(event){event.preventDefault();var id=byId("developmentId").value;await api("/api/projects/"+id+"/fields",{method:"PATCH",body:JSON.stringify({name:byId("dName").value,initiative_number:byId("dInitiative").value,development_lead:byId("dLead").value,status:byId("dStatus").value,scope_description:byId("dScope").value})});await api("/api/projects/"+id+"/development",{method:"PATCH",body:JSON.stringify({request_date:byId("dRequestDate").value,requestor:byId("dRequestor").value,deliverable_due_date:byId("dDueDate").value,consultants:byId("dConsultants").value,food_service_design:byId("dFoodService").value,design_capp:byId("dDesignCapp").value,subsidiary_expense_total:moneyNumber(byId("dExpense").value),original_estimate:moneyNumber(byId("dOriginalEstimate").value),original_estimate_date:byId("dOriginalEstimateDate").value,current_estimate:moneyNumber(byId("dCurrentEstimate").value),current_estimate_date:byId("dCurrentEstimateDate").value})});toast("Development fields saved.");byId("developmentDialog").close();await load(false)}
function openPromote(id){var p=state.projects.find(function(x){return x.id===Number(id)});if(!p)return;setValue("promoteId",p.id);byId("promoteMeta").textContent=p.name+" • history will be preserved";var units=Array.from(new Set(state.projects.map(function(x){return x.business_unit})));byId("pUnit").innerHTML=units.map(function(unit){return'<option '+(unit===p.business_unit?"selected":"")+'>'+esc(unit)+"</option>"}).join("");setValue("pCapp",p.initiative_number);setValue("pManager",p.development_lead);setValue("pSection",p.name);byId("promoteDialog").showModal()}
async function promoteProject(event){event.preventDefault();var id=byId("promoteId").value;await api("/api/projects/"+id+"/promote",{method:"POST",body:JSON.stringify({business_unit:byId("pUnit").value,capp_number:byId("pCapp").value,project_manager:byId("pManager").value,section_name:byId("pSection").value})});toast("Development record promoted to Projects.");byId("promoteDialog").close();await load(false);setView("projects")}

async function loadAdmin(){if(!state.me||state.me.role!=="admin")return;try{var data=await api("/api/admin");state.adminUsers=data.roles;state.adminAudit=data.audit;renderAdmin();byId("adminCounts").textContent=data.counts.projects+" projects • "+data.roles.length+" users"}catch(e){toast(e.message)}}
function filteredAdmin(){var q=byId("adminSearch").value.trim().toLowerCase(),role=byId("adminRoleFilter").value,status=byId("adminStatusFilter").value,sort=byId("adminSort").value;var rows=state.adminUsers.filter(function(u){var text=[u.first_name,u.last_name,u.username,u.user_email,u.title,u.company].join(" ").toLowerCase();return(!q||text.includes(q))&&(!role||u.role===role)&&(!status||u.account_status===status)});var rank={admin:1,editor:2,viewer:3};rows.sort(function(a,b){if(sort==="role")return rank[a.role]-rank[b.role]||a.last_name.localeCompare(b.last_name);if(sort==="status")return String(a.account_status).localeCompare(String(b.account_status))||a.last_name.localeCompare(b.last_name);if(sort==="updated")return String(b.updated_at).localeCompare(String(a.updated_at));return(a.last_name+" "+a.first_name).localeCompare(b.last_name+" "+b.first_name)});return rows}
function renderAdmin(){var rows=filteredAdmin(),size=15,pages=Math.max(1,Math.ceil(rows.length/size));state.adminPage=Math.min(state.adminPage,pages);var pageRows=rows.slice((state.adminPage-1)*size,state.adminPage*size);byId("directoryCount").textContent=rows.length+" of "+state.adminUsers.length+" users";byId("roleList").innerHTML=pageRows.map(function(u){var password=u.password_configured?'<span class="password-status ready">Configured</span>':'<span class="password-status pending">Not set</span>';return'<tr data-record-row><td><div class="directory-person">'+avatarHtml(u)+'<div><strong>'+esc(u.first_name+" "+u.last_name)+'</strong><small>'+esc(u.title||u.company||"")+'</small></div></div></td><td>'+esc(u.username||"—")+'<small>'+esc(u.user_email||"")+'</small></td><td><span class="role-badge role-'+u.role+'">'+esc(u.role)+'</span></td><td><span class="access-badge">'+esc(u.account_status)+'</span></td><td>'+password+'</td><td>'+esc(u.business_unit_scope||"All")+'</td><td>'+esc(dateText(u.updated_at))+'</td><td><button class="btn small" data-user-edit="'+u.id+'">Edit</button></td></tr>'}).join("")||'<tr><td colspan="8" class="loading">No users match.</td></tr>';enhanceTable("roleList",byId("adminSearch").value);var buttons=[];for(var i=1;i<=pages;i++)buttons.push('<button class="'+(i===state.adminPage?"active":"")+'" data-admin-page="'+i+'">'+i+"</button>");byId("adminPagination").innerHTML='<button data-admin-page="'+Math.max(1,state.adminPage-1)+'">Previous</button>'+buttons.join("")+'<button data-admin-page="'+Math.min(pages,state.adminPage+1)+'">Next</button>';byId("auditList").innerHTML=state.adminAudit.map(function(a){return'<div class="audit-row"><strong>'+esc(a.action.replaceAll("_"," "))+'</strong><span>'+esc(a.entity_type+" • "+a.entity_key)+"<br>"+esc(a.actor_email||"System")+" • "+esc(dateText(a.created_at))+"</span></div>"}).join("")||'<div class="count-note">No audit activity yet.</div>'}
function openUser(id){var u=id?state.adminUsers.find(function(x){return x.id===Number(id)}):null;resetPhotoDraft("admin",u);byId("userDialogTitle").textContent=u?"Edit user":"Add user";setValue("userId",u&&u.id);setValue("uFirst",u&&u.first_name);setValue("uLast",u&&u.last_name);setValue("uUsername",u&&u.username);setValue("uEmail",u&&u.user_email);setValue("uTitle",u&&u.title);setValue("uDepartment",u&&u.department||"Design & Construction");setValue("uCompany",u&&u.company||"Delaware North");setValue("uRole",u&&u.role||"viewer");var units=["All"].concat(Array.from(new Set(state.projects.map(function(p){return p.business_unit}))));byId("uBusinessUnit").innerHTML=units.map(function(unit){return'<option '+(unit===(u&&u.business_unit_scope||"All")?"selected":"")+'>'+esc(unit)+"</option>"}).join("");setValue("uLocation",u&&u.location);setValue("uPhone",u&&u.mobile_phone);setValue("uAccountStatus",u&&u.account_status||"pending");setValue("uSiteAccess",u&&u.site_access_status||"pending");setValue("uPassword","");setValue("uPasswordConfirm","");setValue("uNotes",u&&u.notes);byId("uPasswordStatus").textContent=u&&u.password_configured?"A password is configured. Enter a new password only to reset it; the existing password cannot be retrieved.":"No password is configured. Assign a temporary password before authorizing access.";renderStrength("uPassword","uStrengthBar","uStrengthText");byId("userDialog").showModal()}
async function saveUser(event){event.preventDefault();if(photoDrafts.admin&&photoDrafts.admin.busy)return toast("Please wait for the photo to finish preparing.");var password=byId("uPassword").value,confirmation=byId("uPasswordConfirm").value;if(password!==confirmation)return toast("The temporary passwords do not match.");var savedUser=await api("/api/admin/users",{method:"POST",body:JSON.stringify({id:num(byId("userId").value),first_name:byId("uFirst").value,last_name:byId("uLast").value,username:byId("uUsername").value,user_email:byId("uEmail").value,title:byId("uTitle").value,department:byId("uDepartment").value,company:byId("uCompany").value,role:byId("uRole").value,business_unit_scope:byId("uBusinessUnit").value,location:byId("uLocation").value,mobile_phone:byId("uPhone").value,account_status:byId("uAccountStatus").value,site_access_status:byId("uSiteAccess").value,temporary_password:password,confirm_password:confirmation,notes:byId("uNotes").value})});setValue("userId",savedUser.id);setValue("uPassword","");setValue("uPasswordConfirm","");try{await savePhotoDraft("admin",savedUser.id)}catch(error){await loadAdmin();throw new Error("User details saved, but photo was not saved: "+error.message)}if(state.me.profile&&state.me.profile.id===savedUser.id){await load(false)}toast(password?"User saved and temporary password replaced.":"User directory saved.");byId("userDialog").close();await loadAdmin()}
async function addProject(event){event.preventDefault();await api("/api/projects",{method:"POST",body:JSON.stringify({name:byId("aName").value,business_unit:byId("aUnit").value,section_name:byId("aSection").value,project_type:byId("aType").value,capp_number:byId("aCapp").value,initiative_number:byId("aCapp").value,project_manager:byId("aType").value==="Capital"?byId("aLead").value:null,development_lead:byId("aType").value==="Development"?byId("aLead").value:null,current_update:byId("aActivity").value})});toast("Project created.");byId("addDialog").close();byId("addForm").reset();await load(false)}

document.addEventListener("dragstart",function(e){var card=e.target.closest("[data-kpi]");if(!card)return;state.kpiDragKey=card.dataset.kpi;state.kpiDragged=true;card.classList.add("dragging");if(e.dataTransfer){e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",state.kpiDragKey)}});
document.addEventListener("dragover",function(e){var target=e.target.closest("[data-kpi]"),container=byId("portfolioKpis"),dragging=container&&container.querySelector(".kpi.dragging");if(!target||!dragging||target===dragging)return;e.preventDefault();var rect=target.getBoundingClientRect(),before=e.clientY<rect.top+rect.height*.45||(Math.abs(e.clientY-(rect.top+rect.height/2))<rect.height*.2&&e.clientX<rect.left+rect.width/2);container.insertBefore(dragging,before?target:target.nextSibling)});
document.addEventListener("drop",function(e){if(!e.target.closest("[data-kpi]"))return;e.preventDefault();saveKpiOrder()});
document.addEventListener("dragend",function(e){var card=e.target.closest("[data-kpi]");if(!card)return;card.classList.remove("dragging");saveKpiOrder();setTimeout(function(){state.kpiDragged=false;state.kpiDragKey=null},0)});
document.addEventListener("click",function(e){var toggle=e.target.closest("[data-password-toggle]");if(toggle){var input=byId(toggle.dataset.passwordToggle),show=input.type==="password";input.type=show?"text":"password";toggle.textContent=show?"Hide":"Show";toggle.setAttribute("aria-label",(show?"Hide":"Show")+" password");return}var kpi=e.target.closest("[data-kpi-target]");if(kpi){if(state.kpiDragged)return;return setView(kpi.dataset.kpiTarget)}var view=e.target.closest("[data-view]");if(view)return setView(view.dataset.view);var unit=e.target.closest("[data-business-unit]");if(unit){state.unitScope=unit.dataset.businessUnit;renderAll();return}var pie=e.target.closest("[data-pie-unit]");if(pie){state.unitScope=pie.dataset.pieUnit;renderAll();setView("projects");return}var sort=e.target.closest("[data-sort]");if(sort){var key=sort.dataset.sort;if(state.sortKey===key)state.sortDir=state.sortDir==="asc"?"desc":"asc";else{state.sortKey=key;state.sortDir="asc"}renderProjects();renderCost();renderRisk();return}var devSort=e.target.closest("[data-dev-sort]");if(devSort){var dk=devSort.dataset.devSort;if(state.devSortKey===dk)state.devSortDir=state.devSortDir==="asc"?"desc":"asc";else{state.devSortKey=dk;state.devSortDir="asc"}renderDevelopment();return}var preset=e.target.closest("[data-preset]");if(preset){state.preset=preset.dataset.preset;document.querySelectorAll(".preset").forEach(function(b){b.classList.toggle("active",b===preset)});byId("columnMenu").hidden=true;renderProjects();return}var details=e.target.closest("[data-details]");if(details)return openDetails(details.dataset.details);var development=e.target.closest("[data-development]");if(development)return openDevelopment(development.dataset.development);var promote=e.target.closest("[data-promote]");if(promote)return openPromote(promote.dataset.promote);var user=e.target.closest("[data-user-edit]");if(user)return openUser(user.dataset.userEdit);var page=e.target.closest("[data-admin-page]");if(page){state.adminPage=Number(page.dataset.adminPage);renderAdmin();return}var close=e.target.closest("[data-close]");if(close)return byId(close.dataset.close).close()});
document.addEventListener("keydown",function(e){var kpi=e.target.closest&&e.target.closest("[data-kpi-target]");if(kpi&&(e.key==="Enter"||e.key===" ")){e.preventDefault();setView(kpi.dataset.kpiTarget);return}var pie=e.target.closest&&e.target.closest("[data-pie-unit]");if(pie&&(e.key==="Enter"||e.key===" ")){e.preventDefault();pie.click()}});
document.addEventListener("focusin",function(e){if(e.target.matches("[data-activity]")){e.target.dataset.before=e.target.textContent.trim();e.target.querySelectorAll("mark").forEach(function(mark){mark.replaceWith(document.createTextNode(mark.textContent))})}if(e.target.matches("[data-number-field]"))e.target.value=e.target.dataset.raw||""});
document.addEventListener("focusout",function(e){if(e.target.matches("[data-activity]"))saveInline(e.target);if(e.target.matches("[data-number-field]")){var el=e.target,value=moneyNumber(el.value),before=moneyNumber(el.dataset.raw);el.value=moneyText(value);if(value!==before)patchFields(el.dataset.id,Object.fromEntries([[el.dataset.numberField,value]]),"Cost field saved.").catch(function(err){toast(err.message)})}});
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
byId("uPassword").addEventListener("input",function(){renderStrength("uPassword","uStrengthBar","uStrengthText")});byId("newPassword").addEventListener("input",function(){renderStrength("newPassword","newStrengthBar","newStrengthText")});
byId("columnsBtn").addEventListener("click",function(){byId("columnMenu").hidden=!byId("columnMenu").hidden});byId("refreshBtn").addEventListener("click",function(){load(true).then(function(loaded){if(loaded)toast("Projects refreshed. Filters and sorting reset.")}).catch(function(e){toast(e.message)})});byId("addBtn").addEventListener("click",function(){byId("addDialog").showModal()});byId("addUserBtn").addEventListener("click",function(){openUser(null)});byId("saveActivityBtn").addEventListener("click",function(){saveModalActivity().catch(function(e){toast(e.message)})});byId("developmentHistoryBtn").addEventListener("click",function(){var id=byId("developmentId").value;byId("developmentDialog").close();openActivity(id)});byId("detailsForm").addEventListener("submit",function(e){saveDetails(e).catch(function(err){toast(err.message)})});byId("developmentForm").addEventListener("submit",function(e){saveDevelopment(e).catch(function(err){toast(err.message)})});byId("promoteForm").addEventListener("submit",function(e){promoteProject(e).catch(function(err){toast(err.message)})});byId("userForm").addEventListener("submit",function(e){saveUser(e).catch(function(err){toast(err.message)})});byId("addForm").addEventListener("submit",function(e){addProject(e).catch(function(err){toast(err.message)})});["fPrecon","fConstruction","fAddCapp","fAfc"].forEach(function(id){byId(id).addEventListener("input",updateCalc)});
byId("loginForm").addEventListener("submit",signIn);byId("logoutBtn").addEventListener("click",signOut);byId("changePasswordBtn").addEventListener("click",function(){byId("profileDialog").close();byId("passwordForm").reset();byId("passwordDialogClose").hidden=false;byId("passwordDialogCancel").hidden=false;renderStrength("newPassword","newStrengthBar","newStrengthText");byId("passwordDialog").showModal()});byId("passwordDialogClose").addEventListener("click",function(){byId("passwordDialog").close()});byId("passwordDialogCancel").addEventListener("click",function(){byId("passwordDialog").close()});byId("passwordForm").addEventListener("submit",changePassword);
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
  closeExportMenu();
  state.me=null;state.csrf=null;state.projects=[];state.adminUsers=[];state.adminAudit=[];
  document.querySelectorAll("dialog[open]").forEach(function(dialog){dialog.close()});
  byId("workspace").hidden=true;byId("loading").hidden=true;byId("signedOut").hidden=false;
  ["profileBtn","logoutBtn","changePasswordBtn","adminNav"].forEach(function(id){byId(id).hidden=true});
  byId("userChip").textContent="";byId("loginError").textContent=message;
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
