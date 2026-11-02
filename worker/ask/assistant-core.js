/* Read-only query and report functions. No network, SQL execution, or data writes. */
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/(\d),(?=\d)/g,'$1').replace(/&/g,' and ').replace(/[^\p{L}\p{M}\p{N}$ .-]/gu,' ').replace(/\s+/g,' ').trim();
export const number = value => (typeof value==='number'||typeof value==='string') && String(value).trim()!=='' && Number.isFinite(Number(value)) ? Number(value) : null;
export const money = value => number(value) === null ? 'Not recorded' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(value));
export const shortMoney = value => number(value) === null ? 'Not recorded' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(Number(value));
export function dateValue(value) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const parsed=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10)===value ? parsed : null;
}
export function dayVariance(p) {const a=dateValue(p.original_turnover_date),b=dateValue(p.current_turnover_date);return a===null||b===null?null:Math.round((b-a)/86400000);}
export function costVariance(p) {const a=number(p.approved_budget),b=number(p.anticipated_final_cost);return a===null||b===null?null:b-a;}
export function latestUpdate(data,p) {
  const h=data.history.filter(h=>h.project_id===p.id).slice().sort((a,b)=>String(b.reporting_period).localeCompare(String(a.reporting_period))||String(b.created_at).localeCompare(String(a.created_at))||b.id-a.id);
  return h[0]||{project_id:p.id,reporting_period:p.reporting_period,current_summary:p.current_update||'No activity update recorded.',previous_summary:p.previous_update||'',id:null};
}
export function summarize(rows) {
  const budgets=rows.filter(p=>number(p.approved_budget)!==null), forecasts=rows.filter(p=>number(p.anticipated_final_cost)!==null), paired=rows.filter(p=>costVariance(p)!==null),dated=rows.filter(p=>dayVariance(p)!==null);
  return {count:rows.length,approved:budgets.reduce((s,p)=>s+Number(p.approved_budget),0),approvedCount:budgets.length,forecast:forecasts.reduce((s,p)=>s+Number(p.anticipated_final_cost),0),forecastCount:forecasts.length,pairedCount:paired.length,pairedVariance:paired.reduce((s,p)=>s+costVariance(p),0),overBudget:paired.filter(p=>costVariance(p)>0).length,delayed:dated.filter(p=>dayVariance(p)>0).length,datedCount:dated.length,highRisk:rows.filter(p=>p.schedule_risk==='High'||p.budget_risk==='High').length,highSchedule:rows.filter(p=>p.schedule_risk==='High').length};
}
export function runPlan(data,plan,allowedUnits=null) {
  if(!plan||typeof plan!=='object') throw new Error('A query plan is required.');
  if(allowedUnits!==null&&(!Array.isArray(allowedUnits)||allowedUnits.some(x=>typeof x!=='string'))) throw new Error('Invalid access scope.');
  let rows=data.projects.filter(p=>allowedUnits===null||allowedUnits.includes(p.business_unit));
  if(Array.isArray(plan.ids)) rows=rows.filter(p=>plan.ids.includes(p.id));
  if(plan.unit&&plan.unit!=='All')rows=rows.filter(p=>p.business_unit===plan.unit);
  if(plan.manager){const manager=normalize(plan.manager);rows=rows.filter(p=>manager&&normalize((p.project_manager||'')+' '+(p.development_lead||'')).includes(manager));}
  if(plan.status)rows=rows.filter(p=>p.status===plan.status);
  if(plan.excludeComplete)rows=rows.filter(p=>p.status!=='Complete');
  if(plan.type)rows=rows.filter(p=>p.project_type===plan.type);
  if(plan.risk==='schedule')rows=rows.filter(p=>p.schedule_risk===(plan.riskLevel||'High'));
  if(plan.risk==='budget')rows=rows.filter(p=>p.budget_risk===(plan.riskLevel||'High'));
  if(plan.risk==='either')rows=rows.filter(p=>p.schedule_risk===(plan.riskLevel||'High')||p.budget_risk===(plan.riskLevel||'High'));
  if(plan.delayed)rows=rows.filter(p=>dayVariance(p)!==null&&dayVariance(p)>0);
  if(plan.overBudget)rows=rows.filter(p=>costVariance(p)!==null&&costVariance(p)>0);
  if(plan.minAmount!==null&&plan.minAmount!==undefined){const above=(p,field)=>number(p[field])!==null&&number(p[field])>plan.minAmount;rows=rows.filter(p=>plan.amountField==='either'?above(p,'approved_budget')||above(p,'anticipated_final_cost'):plan.amountField==='both'?above(p,'approved_budget')&&above(p,'anticipated_final_cost'):above(p,plan.amountField==='approved_budget'?'approved_budget':'anticipated_final_cost'));}
  if(plan.search){const terms=normalize(plan.search).split(' ').filter(Boolean);rows=rows.filter(p=>{const h=latestUpdate(data,p),hay=normalize([p.name,p.venue,p.capp_number,p.initiative_number,p.project_manager,p.development_lead,p.scope_description,p.current_update,h.current_summary].join(' '));return terms.length>0&&terms.every(t=>hay.includes(t));});}
  const keys={forecast:'anticipated_final_cost',budget:'approved_budget',name:'name',turnover:'current_turnover_date'};
  if(typeof plan.sort==='string'){
    const key=keys[plan.sort],value=p=>plan.sort==='delay'?dayVariance(p):plan.sort==='variance'?costVariance(p):key==='name'?p.name:key==='current_turnover_date'?dateValue(p[key]):number(p[key]);
    const direction=plan.sortDirection==='asc'||plan.sort==='name'&&plan.sortDirection!=='desc'?1:-1;
    rows.sort((a,b)=>{const x=value(a),y=value(b);return x===null&&y===null?a.id-b.id:x===null?1:y===null?-1:(typeof x==='string'?x.localeCompare(y):x-y)*direction||a.id-b.id;});
  }
  if(plan.limit)rows=rows.slice(0,Math.max(1,Math.min(100,Math.floor(plan.limit))));
  return rows;
}
export function tablePresentation(text){
  const q=normalize(text);
  return /\b(table|tabular|pdf|excel|xlsx|spreadsheet)\b/.test(q)?{intent:'table',onePage:/\b(one|1|single)[ -]page\b/.test(q),requestedFormat:/\b(excel|xlsx|spreadsheet)\b/.test(q)?'xlsx':/\bpdf\b/.test(q)?'pdf':null}:null;
}
export function amountConstraint(text){
  const q=normalize(text),m=q.match(/(?:over|above|more than|greater than)\s*\$?\s*([\d.]+)\s*(million|billion|thousand|m\b|b\b|k\b)?/);
  if(!m)return null;
  const minAmount=Number(m[1])*({million:1e6,m:1e6,billion:1e9,b:1e9,thousand:1e3,k:1e3}[m[2]]||1);
  if(!Number.isFinite(minAmount))return null;
  const budget=/\b(budget|budgets|approved)\b/.test(q),forecast=/\b(anticipated|forecast|final cost)\b/.test(q);
  const amountField=budget&&forecast&&/\b(or|either)\b/.test(q)?'either':budget&&forecast&&/\b(and|both)\b/.test(q)?'both':budget?'approved_budget':'anticipated_final_cost';
  return {minAmount,amountField};
}
// A format-only follow-up operates on the existing selection, without another model call.
export function formatFollowUp(text,context={}){
  const presentation=tablePresentation(text);if(!presentation||!Array.isArray(context.ids))return null;
  const residual=normalize(text).replace(/\b(can|could|would|will|you|it|i|like|want|need|please|just|only|also|now|then|again|instead|potentially|provide|make|create|generate|give|show|download|export|put|turn|convert|produce|print|save|as|a|an|the|in|into|to|for|of|me|this|that|these|those|them|their|same|results|projects|records|data|simple|brief|summary|summarize|one|single|1|page|table|tabular|pdf|excel|xlsx|spreadsheet|file|report|and|or|format|sheet)\b/g,'').replace(/[ .-]/g,'');
  return residual?null:{...presentation,plan:{...context.plan,ids:context.ids.slice()},ambiguous:false};
}
export function interpret(data,text,context={},selectedUnit='All') {
  const q=normalize(text), units=[...new Set(data.projects.map(p=>p.business_unit))];
  if(!q)return {intent:'help'};
  const formatting=formatFollowUp(text,context);if(formatting)return formatting;
  if(/^(delete|remove|edit|save|add|set)\b/.test(q)||/^change\b.*\b(to|budget|date|status)\b/.test(q))return {intent:'refuse',message:'This pilot only reads project information. Use the existing Tracker controls for authorized edits.'};
  if(/\b(hello|help|capabilities)\b/.test(q)||/what can you/.test(q))return {intent:'help'};
  if(/\b(last week|last month|yesterday|today|this week|this month|since|between|under budget|below budget|not high|not low|not medium|both)\b/.test(q)||/^(why|recommend|what should)\b/.test(q))return {intent:'unsupported',message:'That question needs interpretation or a filter beyond this guided review. I can show saved updates, saved risk ratings, budget overruns, or recorded turnover changes. Broader reasoning will be available after the AI connection is added.'};
  if(/\bcompare\b/.test(q)&&!/\b(updates?|history|previous|progress)\b/.test(q))return {intent:'unsupported',message:'This review compares saved activity updates. Ask “Compare previous updates for [project]”, or request a budget summary for a selected group.'};
  if(/\b(explain|meaning|mean|calculated|calculate|definition)\b/.test(q)&&/\b(variance|days|risk|budget)\b/.test(q)&&!data.projects.some(p=>q.includes(normalize(p.venue))&&normalize(p.venue).length>4))return {intent:'definition'};
  const explicitUnit=units.find(u=>q.includes(normalize(u))) || (q.includes('parks')?units.find(u=>u.includes('Parks')):null) || (q.includes('sports')?units.find(u=>u.includes('Sport')):null);
  const allRequested=/\b(all (?:the )?projects|entire portfolio|whole portfolio|reset filters)\b/.test(q);
  const follow=/\b(those|them|these|their|its|that project|this project|same projects)\b/.test(q)||/^(only|exclude|without|sort|now|and|also|draft|create|generate|export|summarize|summary|report|what about)\b/.test(q);
  let plan=follow&&context.plan&&!allRequested?{...context.plan}:{unit:selectedUnit};
  if(allRequested)plan={unit:selectedUnit};
  if(explicitUnit){plan.unit=explicitUnit;delete plan.ids;delete plan.search;delete plan.manager;}
  if(/what about/.test(q)&&explicitUnit)delete plan.ids;
  let intent=/\b(photos?|pictures?|images?)\b/.test(q)?'photos':/\b(report|briefing|brief)\b/.test(q)?'report':/\b(compare|changed|difference between|previous)\b/.test(q)?'compare':/\b(updates?|history|happened|progress|summary|summarize)\b/.test(q)?'updates':'search';
  if(/\b(summary|summarize)\b/.test(q)&&/\b(budgets?|costs?|portfolio)\b/.test(q))intent='summary';
  if(/\b(budget|cost)\b/.test(q)&&!/\b(over|high|risk|under|above|largest|biggest|million)\b/.test(q)&&intent==='search')intent='summary';
  if(/\b(on hold|paused)\b/.test(q))plan.status='On Hold';
  else if(/\b(active)\b/.test(q))plan.status='Active';
  else if(/\b(closeout)\b/.test(q))plan.status='Closeout';
  else if(/\b(exclude|without|hide)\b.*\b(completed?|finished)\b/.test(q))plan.excludeComplete=true;
  else if(/\b(completed?|finished)\b/.test(q))plan.status='Complete';
  if(/\b(development|pipeline)\b/.test(q))plan.type='Development';
  if(/\b(capital)\b/.test(q)&&!/non capital/.test(q))plan.type='Capital';
  if(/\b(risk|risks|risky)\b/.test(q)){plan.risk=/\b(schedule|scheduling)\b/.test(q)?'schedule':/\b(budget|cost)\b/.test(q)?'budget':'either';plan.riskLevel=/\b(medium|moderate)\b/.test(q)?'Medium':/\blow\b/.test(q)?'Low':'High';}
  if(/\b(behind schedule|delayed|late|slippages?)\b/.test(q))plan.delayed=true;
  if(/\b(over budget|budget overruns?|cost overruns?)\b/.test(q))plan.overBudget=true;
  const threshold=amountConstraint(text);
  if(threshold)Object.assign(plan,threshold);
  const top=q.match(/\b(?:top|largest|biggest)\s+(\d{1,2})\b/);if(top)plan.limit=Number(top[1]);
  if(/\b(largest|biggest|most expensive|highest cost|sort by cost)\b/.test(q))plan.sort='forecast';
  if(/\b(biggest delay|largest delay|sort by delay)\b/.test(q))plan.sort='delay';
  if(/\b(sort|sorted|ascending|descending|lowest|highest|smallest|largest)\b/.test(q)){
    if(/\bvariance\b/.test(q))plan.sort='variance';
    else if(/\b(delay|days)\b/.test(q))plan.sort='delay';
    else if(/\b(turnover|completion)\b/.test(q))plan.sort='turnover';
    else if(/\bbudget\b/.test(q))plan.sort='budget';
    else if(/\b(cost|forecast|afc)\b/.test(q))plan.sort='forecast';
    else if(/\bname\b/.test(q))plan.sort='name';
    plan.sortDirection=/\b(ascending|lowest|smallest|earliest)\b/.test(q)?'asc':'desc';
    if(plan.sort)intent='table';
  }
  const managers=[...new Set(data.projects.map(p=>p.project_manager||p.development_lead).filter(Boolean))];
  const manager=managers.find(n=>q.includes(normalize(n))||new RegExp('\\b'+normalize(n).split(' ')[0]+' s?\\b').test(q));
  if(manager)plan.manager=manager;
  const quoted=text.match(/["“]([^"”]+)["”]/);if(quoted)plan.search=quoted[1];
  const venues=[...new Set(data.projects.map(p=>p.venue).filter(v=>v&&v!=='Development Pipeline'))].sort((a,b)=>b.length-a.length);
  const venue=venues.find(v=>normalize(v).length>3&&q.includes(normalize(v)));
  const name=data.projects.map(p=>p.name).sort((a,b)=>b.length-a.length).find(n=>normalize(n).length>4&&q.includes(normalize(n)));
  const capp=q.match(/\b(?:capp|project number|project id)\s*([a-z0-9-]+)\b/);
  if(name||venue||capp){const specific=[name,venue].filter(Boolean).sort((a,b)=>normalize(b).length-normalize(a).length)[0];plan={...plan,search:quoted?.[1]||specific||(capp&&capp[1])};delete plan.ids;if(!explicitUnit)plan.unit=selectedUnit;}
  const meaningful=explicitUnit||manager||name||venue||capp||quoted||plan.status||plan.type||plan.risk||plan.delayed||plan.overBudget||threshold||plan.sort||allRequested||/\b(portfolio|projects|report|briefing|budget|updates|photos|summary|history)\b/.test(q)||(follow&&context.ids);
  if(!meaningful||(/\b(project|projects)\b/.test(q)&&!explicitUnit&&!manager&&!name&&!venue&&!capp&&!allRequested&&!plan.status&&!plan.type&&!plan.risk&&!plan.delayed&&!plan.overBudget&&!plan.sort&&!threshold&&!follow)){
    const residual=q.replace(/\b(show|me|find|search|for|the|a|an|please|what|is|are|latest|project|projects|status|update|updates|tell|about|of|list|all|our|my)\b/g,' ').replace(/\s+/g,' ').trim();
    if(residual)plan.search=residual;
    else if(!meaningful)return {intent:'unsupported',message:'I can search this snapshot by project, venue, manager, business unit, risk, budget, or schedule. Try a suggested question below. Open-ended AI interpretation is not connected in this review.'};
  }
  if(follow&&context.ids&&!explicitUnit&&!name&&!venue&&!capp&&!allRequested&&!plan.search)plan.ids=context.ids.slice();
  return {intent,plan,ambiguous:!!venue&&!name&&['updates','compare','photos'].includes(intent),...tablePresentation(text)};
}
export function describePlan(plan={}) {
  if([2,3,4].includes(plan.queryVersion)&&Array.isArray(plan.scopeLabels))return plan.scopeLabels;
  const parts=[];
  if(plan.unit&&plan.unit!=='All')parts.push(plan.unit);
  if(plan.search)parts.push('Matching “'+plan.search+'”');
  if(plan.manager)parts.push(plan.manager);
  if(plan.status)parts.push(plan.status);
  if(plan.type)parts.push(plan.type);
  if(plan.excludeComplete)parts.push('Excludes complete');
  if(plan.risk)parts.push((plan.riskLevel||'High')+' '+(plan.risk==='either'?'budget or schedule':plan.risk)+' risk');
  if(plan.delayed)parts.push('Current turnover later than original');
  if(plan.overBudget)parts.push('Forecast above approved budget');
  if(plan.minAmount!==undefined)parts.push((plan.amountField==='either'?'Approved budget OR anticipated cost':plan.amountField==='both'?'Approved budget AND anticipated cost':plan.amountField==='approved_budget'?'Approved budget':'Anticipated cost')+' above '+money(plan.minAmount));
  if(plan.limit)parts.push('Top '+plan.limit);
  return parts.length?parts:['All available projects'];
}
export function answer(data,query,context={},selectedUnit='All') {
  const parsed=typeof query==='string'?interpret(data,query,context,selectedUnit):query;
  if(['refuse','help','definition','unsupported'].includes(parsed.intent))return {...parsed,rows:[],retainContext:true};
  const rows=runPlan(data,parsed.plan);
  if(parsed.ambiguous&&rows.length>1)return {...parsed,requestedIntent:parsed.intent,intent:'clarify',rows,message:'Several projects match that venue. Which project would you like to review?'};
  const result={...parsed,rows,summary:summarize(rows),sources:rows.map(p=>({id:p.id,name:p.name,date:latestUpdate(data,p).reporting_period})),filters:describePlan(parsed.plan)};
  if(rows.length===0)result.message='No matching records in this snapshot. Try a project name, venue, CAPP number, or a broader business-unit scope.';
  else if(parsed.intent==='photos'){result.photos=data.photos.filter(p=>rows.some(r=>r.id===p.project_id)).slice().sort((a,b)=>String(b.date_taken||'').localeCompare(String(a.date_taken||''))||String(b.photo_number||'').localeCompare(String(a.photo_number||'')));result.message=result.photos.length?result.photos.length+' archived project photos are available, newest dated photos first. Open a photo to read its saved caption and annotation.':'No photos for these projects are included in this archived review. That does not mean the live Tracker has none.';}
  else if(parsed.intent==='updates'||parsed.intent==='compare')result.updates=rows.map(p=>({project:p,latest:latestUpdate(data,p),history:data.history.filter(h=>h.project_id===p.id).sort((a,b)=>String(b.reporting_period).localeCompare(String(a.reporting_period))||String(b.created_at).localeCompare(String(a.created_at))||b.id-a.id).slice(0,2)}));
  return result;
}
export function reportText(data,result) {
  const s=summarize(result.rows);
  const lines=['D&C PROJECT BRIEFING','Snapshot: '+data.meta.snapshot_at+' | Latest saved reporting period: '+data.meta.latest_reporting_period,'Scope: '+describePlan(result.plan).join(' · '),'Project count: '+s.count,'Approved budgets: '+money(s.approved)+' ('+s.approvedCount+' of '+s.count+' recorded)','Forecast costs: '+money(s.forecast)+' ('+s.forecastCount+' of '+s.count+' recorded)','Comparable forecast minus budget: '+money(s.pairedVariance)+' ('+s.pairedCount+' matched pairs)','Data comes from the private Tracker. Saved dates remain as recorded. Blank values are not zero.',''];
  for(const p of result.rows){const u=latestUpdate(data,p);lines.push(p.venue+' | '+p.name+' [Project '+p.id+']',p.business_unit+' · '+p.status+' · '+(p.project_manager||p.development_lead||'Manager not recorded'),'Budget risk: '+p.budget_risk+' | Schedule risk: '+p.schedule_risk,'Approved: '+money(p.approved_budget)+' | Forecast: '+money(p.anticipated_final_cost),'Turnover: '+(p.original_turnover_date||'Not recorded')+' → '+(p.current_turnover_date||'Not recorded')+' | Calendar-day variance: '+(dayVariance(p)??'Not calculable'),'Saved update · '+u.reporting_period+':',u.current_summary||'No saved update.','');}
  return lines.join('\n');
}
export function csvText(rows) {
  const cols=['id','business_unit','venue','name','status','project_manager','approved_budget','anticipated_final_cost','budget_risk','schedule_risk','original_turnover_date','current_turnover_date'];
  const cell=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  return [cols,...rows.map(p=>cols.map(c=>p[c]))].map(r=>r.map(cell).join(',')).join('\r\n');
}
globalThis.DNCAssistantCore={normalize,number,money,shortMoney,dateValue,dayVariance,costVariance,latestUpdate,summarize,runPlan,interpret,describePlan,answer,reportText,csvText,tablePresentation,amountConstraint,formatFollowUp};
