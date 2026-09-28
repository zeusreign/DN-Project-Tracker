import { PHOTO_DROP } from './enhanced-drop.js';
import { PHOTO_MODULE } from './enhanced-photos.js';
import { ENHANCED_WORKFLOWS } from "./enhanced-workflows.js";
import { PROJECT_IMAGES } from "./project-images.js";

// Reuse Classic found sets and forms; Enhanced workflows add scoped media and history editing.
export const ENHANCED_CLIENT = 'var enhancedImages=' + JSON.stringify(PROJECT_IMAGES) + ';\n' + String.raw`
var enhanced={mode:'classic',module:'projects',layout:{projects:'list',development:'list'},selected:{projects:null,development:null},navigator:'rolodex',meeting:false,user:null,historyVersion:0,pending:0};
function enhancedPreferenceKey(){return 'dn-tracker-enhanced-v1:'+String(state.me&&(state.me.email||state.me.profile&&state.me.profile.id)||'anonymous')}
function enhancedSavePrefs(){try{localStorage.setItem(enhancedPreferenceKey(),JSON.stringify({mode:enhanced.mode,layout:enhanced.layout,navigator:enhanced.navigator}))}catch(e){}}
function enhancedReadPrefs(){
 var user=state.me&&(state.me.email||state.me.profile&&state.me.profile.id);if(!user||user===enhanced.user)return;
 enhanced.user=user;enhanced.selected={projects:null,development:null};enhanced.mode='classic';enhanced.layout={projects:'list',development:'list'};enhanced.navigator='rolodex';enhanced.meeting=false;
 try{var p=JSON.parse(localStorage.getItem(enhancedPreferenceKey())||'{}');if(p.mode==='enhanced')enhanced.mode=p.mode;['projects','development'].forEach(function(m){if(p.layout&&['list','record','cards'].includes(p.layout[m]))enhanced.layout[m]=p.layout[m]});if(['strip','slider','rolodex'].includes(p.navigator))enhanced.navigator=p.navigator==='strip'?'slider':p.navigator}catch(e){}
}
function enhancedRows(module){
 if(module==='development'){
  if(state.devSortKey!=='source_sort_order')return developmentRows().slice().sort(function(a,b){var r=compare(a,b,state.devSortKey);return (state.devSortDir==='asc'?r:-r)||a.source_sort_order-b.source_sort_order});
  var groups=new Map();developmentRows().slice().sort(function(a,b){var n=compare(a,b,state.devSortKey);return state.devSortDir==='asc'?n:-n}).forEach(function(p){if(!groups.has(p.business_unit))groups.set(p.business_unit,[]);groups.get(p.business_unit).push(p)});return Array.from(groups.values()).flat();
 }
 return groupedRows(filteredCapital(),state.sortKey,state.sortDir).flat();
}
function enhancedPhoto(p){return p.business_unit==='Gaming'&&['08649','08688','08312'].includes(p.capp_number)?enhancedImages[p.capp_number]:p.business_unit==='Parks & Resorts'&&p.capp_number==='08661'?enhancedImages['08661']:null}
function enhancedPhotoHtml(p){
 var photo=enhancedPhoto(p),placeholder='<div class="en-photo-placeholder"><span aria-hidden="true">?</span><strong>'+esc(p.name)+' Pic</strong><small>Project photo needed</small></div>';
 if(!photo)return '<figure class="en-photo">'+placeholder+'</figure>';
 return '<figure class="en-photo"><img loading="lazy" src="'+photo.src+'" alt="'+esc(photo.label)+'"><figcaption>'+esc(photo.label)+'<span>Capture date unknown · Not a progress update</span>'+(photo.source.startsWith('https://')?'<a href="'+esc(photo.source)+'" target="_blank" rel="noopener noreferrer">Photo source</a>':'<span>'+esc(photo.source)+'</span>')+'</figcaption></figure>';
}
function enhancedRisk(p){return '<div class="en-risk-pair"><span>Budget <b class="risk-pill '+riskClass(p.budget_risk)+'">'+esc(riskValue(p.budget_risk))+'</b></span><span>Schedule <b class="risk-pill '+riskClass(p.schedule_risk)+'">'+esc(riskValue(p.schedule_risk))+'</b></span></div>'}
function enhancedField(label,value){return '<div><dt>'+esc(label)+'</dt><dd>'+esc(value==null||value===''?'Not recorded':value)+'</dd></div>'}
function enhancedRecord(p){
 var dev=p.project_type==='Development',fields=enhancedField(dev?'Initiative':'CAPP',dev?p.initiative_number:p.capp_number)+enhancedField('Business unit',p.business_unit)+enhancedField(dev?'Development lead':'Project manager',dev?p.development_lead:p.project_manager)+enhancedField('Status',p.status)+enhancedField('Property / heading',p.section_name||p.venue)+enhancedField('Report period',dateText(p.reporting_period));
 var costs=dev?enhancedField('Original estimate',moneyText(p.development_original_estimate))+enhancedField('Current estimate',moneyText(p.development_current_estimate))+enhancedField('Subsidiary expense',moneyText(p.development_subsidiary_expense_total)):enhancedField('Approved budget',moneyText(p.approved_budget))+enhancedField('Anticipated final cost',moneyText(p.anticipated_final_cost))+enhancedField('Forecast variance',moneyText(p.forecast_variance));
 var dates=dev?enhancedField('Requested',dateText(p.development_request_date))+enhancedField('Deliverable due',dateText(p.development_deliverable_due_date)):enhancedField('Original start',dateText(p.original_start_date))+enhancedField('Current start',dateText(p.current_start_date))+enhancedField('Original turnover',dateText(p.original_turnover_date))+enhancedField('Current turnover',dateText(p.current_turnover_date));
 return '<article class="en-record"><div class="en-record-hero">'+enhancedPhotoHtml(p)+'<div class="en-record-identity"><span class="en-eyebrow">'+esc(p.business_unit)+' / '+(dev?'Development':'Capital project')+'</span><h2>'+esc(p.name)+'</h2>'+enhancedRisk(p)+'<dl class="en-facts">'+fields+'</dl><div class="en-record-actions"><button class="btn primary" '+(dev?'data-development':'data-details')+'="'+p.id+'">'+(canWrite()?'Edit project':'All project fields')+'</button><button class="btn" data-en-activity="'+p.id+'">'+(canWrite()?'Update activity / history':'Activity history')+'</button>'+(dev&&canWrite()?'<button class="btn" data-promote="'+p.id+'">Promote</button>':'')+'</div></div></div><div class="en-record-body"><section class="en-update"><div class="en-section-heading"><h3>Current activity</h3><span>'+esc(dateText(p.reporting_period))+'</span></div><p>'+esc(p.current_update||'No current update recorded. Needs confirmation.')+'</p></section><section class="en-costs"><h3>Cost overview</h3><dl class="en-facts">'+costs+'</dl></section><section><h3>Schedule</h3><dl class="en-facts">'+dates+'</dl></section><section><h3>Scope</h3><p>'+esc(p.scope_description||'No scope description recorded.')+'</p></section><section class="en-history-section"><div class="en-section-heading"><h3>Activity history</h3><button class="btn small" data-en-history="'+p.id+'">Load history</button></div><div id="enHistory-'+p.id+'" aria-live="polite"><p class="en-muted">Open the dated history for this project.</p></div></section></div></article>';
}
function enhancedCard(p,collage){
 var selected=enhanced.selected[enhanced.module]===p.id;
 return '<article class="en-card '+(selected?'is-selected':'')+'" data-en-card="'+p.id+'">'+enhancedPhotoHtml(p)+'<div class="en-card-body"><span class="en-eyebrow">'+esc(p.business_unit)+' · '+esc(p.capp_number||p.initiative_number||'No identifier')+'</span><h3><button data-en-open="'+p.id+'">'+esc(p.name)+'</button></h3>'+(collage?'':enhancedRisk(p)+'<p class="en-card-update">'+esc(p.current_update||'No current update recorded.')+'</p><div class="en-card-meta"><span>'+esc(p.project_manager||p.development_lead||'Lead not recorded')+'</span><span>'+esc(dateText(p.reporting_period))+'</span></div>')+'<button class="btn en-open" data-en-open="'+p.id+'">Open record <span aria-hidden="true">↗</span></button></div></article>';
}
function enhancedPagination(rows,module){
 var i=rows.findIndex(function(p){return p.id===enhanced.selected[module]});
 return '<div class="en-pagination"><button class="btn" data-en-move="first" aria-label="First project" '+(i<=0?'disabled':'')+'>|‹</button><button class="btn" data-en-move="previous" aria-label="Previous project" data-tooltip="Previous project" '+(i<=0?'disabled':'')+'>‹</button><input type="range" data-en-slider aria-label="Project position" min="1" max="'+Math.max(1,rows.length)+'" value="'+(i+1)+'" '+(!rows.length?'disabled':'')+'><button class="btn" data-en-move="next" aria-label="Next project" data-tooltip="Next project" '+(i>=rows.length-1?'disabled':'')+'>›</button><button class="btn" data-en-move="last" aria-label="Last project" '+(i>=rows.length-1?'disabled':'')+'>›|</button><label><input type="number" data-en-position aria-label="Record number" min="1" max="'+rows.length+'" value="'+(i+1)+'" '+(!rows.length?'disabled':'')+'></label><span>of '+rows.length+' records</span></div>';
}
function enhancedNav(rows,module){return enhanced.navigator==='strip'?'<div class="en-navigator">'+enhancedPagination(rows,module)+'</div>':''}
function enhancedRolodex(rows,module){
 var i=rows.findIndex(function(p){return p.id===enhanced.selected[module]}),p=rows[i];
 return '<h3>Record Navigation</h3><div class="en-ro-inner"><div><div class="en-book '+(i<=0?'en-first-record ':'')+(i>=rows.length-1?'en-last-record':'')+'"><svg viewBox="0 0 140 110" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="enMetal" x1="0%" y1="0%" x2="55%" y2="100%"><stop stop-color="#fff"/><stop offset=".2" stop-color="#777"/><stop offset=".45" stop-color="#f5f5f5"/><stop offset=".7" stop-color="#333"/><stop offset="1" stop-color="#c3c3c3"/></linearGradient><linearGradient id="enPaper" x1="0%" y1="0%" x2="25%" y2="100%"><stop stop-color="#fff"/><stop offset=".75" stop-color="#f0f0ed"/><stop offset="1" stop-color="#d4d7d8"/></linearGradient><linearGradient id="enPlastic" x1="0%" y1="0%" x2="55%" y2="100%"><stop stop-color="#c7ccd0"/><stop offset="1" stop-color="#a1a8ad"/></linearGradient><filter id="enCardShadow" x="-20%" y="-25%" width="155%" height="170%"><feDropShadow dx="2.4" dy="3.2" stdDeviation="1" flood-color="#182129" flood-opacity=".48"/></filter><filter id="enRingShadow" x="-80%" y="-35%" width="260%" height="190%"><feDropShadow dx="1.7" dy="2.5" stdDeviation=".7" flood-color="#111820" flood-opacity=".65"/></filter></defs><path d="M8 7h126v99H8z" fill="#555" opacity=".5"/><path d="M4 3h124v99H4z" fill="#b4b4b4" stroke="#777"/><path class="en-upper-paper" d="M10 10h110v40H10z" fill="url(#enPaper)" stroke="#777" stroke-width="2"/><path class="en-lower-paper" d="M10 57h110v39H10z" fill="url(#enPaper)" stroke="#777" stroke-width="2"/><path d="M12 12h106M12 59h106" stroke="#fff" stroke-width="2"/><path class="en-upper-lines" d="M27 22h48M27 30h77M27 38h67" stroke="#31b5fa" stroke-width="3" stroke-linecap="round"/><path class="en-lower-lines" d="M27 72h48M27 80h77M27 88h67" stroke="#31b5fa" stroke-width="3" stroke-linecap="round"/><g fill="#222"><ellipse cx="34" cy="47" rx="4" ry="3"/><ellipse cx="66" cy="47" rx="4" ry="3"/><ellipse cx="98" cy="47" rx="4" ry="3"/><ellipse cx="34" cy="67" rx="4" ry="3"/><ellipse cx="66" cy="67" rx="4" ry="3"/><ellipse cx="98" cy="67" rx="4" ry="3"/></g><g fill="none" stroke="url(#enMetal)" stroke-width="5"><path d="M34 47c-10-8-10 28 0 20"/><path d="M66 47c-10-8-10 28 0 20"/><path d="M98 47c-10-8-10 28 0 20"/></g></svg><button class="en-book-half en-book-back" data-en-move="previous" aria-label="Top of book: previous project" '+(i<=0?'disabled':'')+'></button><button class="en-book-half en-book-forward" data-en-move="next" aria-label="Bottom of book: next project" '+(i>=rows.length-1?'disabled':'')+'></button></div><input class="en-ro-number" type="number" data-en-position aria-label="Record number" min="1" max="'+rows.length+'" value="'+(i+1)+'" '+(!rows.length?'disabled':'')+'></div><div class="en-ro-track"><button data-en-move="previous" aria-label="Previous project" '+(i<=0?'disabled':'')+'>▲</button><input type="range" data-en-slider aria-label="Rolodex project position" aria-orientation="vertical" min="1" max="'+Math.max(1,rows.length)+'" value="'+(i+1)+'" '+(!rows.length?'disabled':'')+'><button data-en-move="next" aria-label="Next project" '+(i>=rows.length-1?'disabled':'')+'>▼</button></div></div><div class="en-ro-count">'+(i+1)+' of '+rows.length+' records</div><div class="en-ro-name">'+esc(p?p.name:'No matching projects')+'</div>';
}
var enBookIcon='<svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="4" y="3" width="20" height="22" rx="2" fill="#eef4f7" stroke="currentColor"/><path d="M4 14h20M9 8h10M9 10h8" stroke="currentColor"/><path d="M9 12v5m5-5v5m5-5v5" stroke="#078cca" stroke-width="2"/></svg>';
function enPositionIcon(top){return '<svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="3" y="3" width="22" height="22" rx="3" stroke="currentColor"/><path d="M7 '+(top?'8':'20')+'h14" stroke="#087db5" stroke-width="3"/><circle cx="14" cy="'+(top?'8':'20')+'" r="3" fill="#087db5"/><path d="M8 13h12M8 16h9" stroke="currentColor"/></svg>'}
var enPageIcon='<svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 4h14l4 5v15H5z" fill="#eef4f7" stroke="currentColor"/><path d="m9 10 4 4-4 4m6-8 4 4-4 4M8 22h12" stroke="currentColor" stroke-width="2"/></svg>';
function enhancedExtras(){
 var module=enhancedCurrentModule(),view=location.hash.slice(1)||'projects',active=enhanced.mode==='enhanced'&&!!state.me,available=!!state.me&&(view==='photos'||active&&['projects','development'].includes(view)),rows=enhancedRows(module);
 var toggle=byId('enToggle');toggle.innerHTML='<span class="en-switch-arrows" aria-hidden="true">⇄</span><span>'+(active?'Classic':'Enhanced')+'</span>';toggle.setAttribute('aria-label','Switch to '+(active?'Classic':'Enhanced'));toggle.removeAttribute('data-tooltip');toggle.removeAttribute('aria-pressed');
 byId('enRolodex').hidden=!available||enhanced.navigator!=='rolodex';byId('enRolodex').innerHTML=available&&enhanced.navigator==='rolodex'?enhancedRolodex(rows,module):'';
 byId('enBottomNav').hidden=!available||enhanced.navigator!=='slider';byId('enBottomNav').innerHTML=available&&enhanced.navigator==='slider'?enhancedPagination(rows,module):'';
 document.body.classList.toggle('has-bottom-nav',!byId('enBottomNav').hidden);document.body.classList.toggle('freeze-list',!!state.me&&['projects','development','photos'].includes(view));
 document.querySelectorAll('.en-nav-picker').forEach(function(p){p.hidden=!available;var b=p.querySelector('[data-en-picker]');var names={rolodex:'Rolodex',strip:'Top pagination',slider:'Bottom pagination'},next={rolodex:'slider',strip:'slider',slider:'rolodex'};b.innerHTML=enhanced.navigator==='rolodex'?enBookIcon:enPositionIcon(enhanced.navigator==='strip');b.dataset.tooltip='Rolodex/Pagination';b.setAttribute('aria-label',b.dataset.tooltip);p.querySelectorAll('[data-en-choice]').forEach(function(o){o.setAttribute('aria-pressed',String(o.dataset.enChoice===enhanced.navigator))})});
 enhancedBottomPosition();
}
function enhancedBottomPosition(){var main=document.querySelector('main').getBoundingClientRect(),bottom=byId('enBottomNav');if(bottom){bottom.style.left=main.left+'px';bottom.style.right=Math.max(0,innerWidth-main.right)+'px'}}
function renderEnhanced(){
 if(!byId('enExperience'))return;if(typeof hideTooltip==='function')hideTooltip();enhancedReadPrefs();
 var focused=document.activeElement,focusPane=focused&&focused.closest('.en-toolbar'),focusAttr=focused&&Array.from(focused.attributes).find(function(a){return a.name.startsWith('data-en-')}),focusSelector=focusPane&&focusAttr?'#'+focusPane.id+' ['+focusAttr.name+'="'+CSS.escape(focusAttr.value)+'"]':null;
 var active=enhanced.mode==='enhanced'&&!!state.me;document.body.classList.toggle('is-enhanced',active);document.body.classList.toggle('en-meeting',active&&enhanced.meeting);byId('enExperience').hidden=!state.me;
 byId('enExperience').querySelectorAll('[data-en-mode]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.enMode===enhanced.mode))});
 ['projects','development'].forEach(function(module){
  var pane=document.querySelector('[data-pane="'+module+'"]'),toolbar=byId('enToolbar-'+module),panel=byId('enPanel-'+module),layout=enhanced.layout[module],rows=enhancedRows(module);
  toolbar.hidden=!active;panel.hidden=!active||layout==='list';pane.querySelector('.card.workspace').hidden=active&&layout!=='list';
  if(!active){panel.replaceChildren();return}
  if(!rows.some(function(p){return p.id===enhanced.selected[module]}))enhanced.selected[module]=rows.length?rows[0].id:null;
  toolbar.innerHTML='<div class="en-toolbar-top"><div><span class="en-eyebrow">Enhanced workspace</span><strong>'+rows.length+' matching '+(module==='development'?'development records':'projects')+'</strong></div><div class="en-layouts" role="group" aria-label="Project layout">'+['list','record','cards'].map(function(v){return '<button data-en-layout="'+v+'" aria-pressed="'+(layout===v)+'">'+v.charAt(0).toUpperCase()+v.slice(1)+'</button>'}).join('')+'</div><label class="en-sort-label">Sort Order <select data-en-sort aria-label="Project order">'+[['source_sort_order','Workbook'],['name','Project name'],[module==='development'?'development_lead':'project_manager','Lead'],['budget_risk','Budget risk'],['schedule_risk','Schedule risk']].map(function(v){return '<option value="'+v[0]+'" '+((module==='development'?state.devSortKey:state.sortKey)===v[0]?'selected':'')+'>'+v[1]+'</option>'}).join('')+'</select></label></div>'+enhancedNav(rows,module);
  if(!rows.length){panel.innerHTML='<div class="en-empty"><h2>No projects match these filters</h2><p>Change your search, status, risk or business-unit selection.</p></div>';return}
  if(layout==='record')panel.innerHTML=enhancedRecord(rows.find(function(p){return p.id===enhanced.selected[module]}));
  if(layout==='cards'||layout==='collage')panel.innerHTML=(layout==='collage'?'<p class="en-photo-note">Reference images and placeholders · Project order follows the current filters. Photos do not establish progress.</p>':'')+'<div class="en-grid '+(layout==='collage'?'en-collage':'')+'">'+rows.map(function(p){var old=enhanced.module;enhanced.module=module;var html=enhancedCard(p,layout==='collage');enhanced.module=old;return html}).join('')+'</div>';
  pane.querySelectorAll('tr.project-row').forEach(function(row){var b=row.querySelector('[data-details],[data-development]'),id=b&&Number(b.dataset.details||b.dataset.development);row.classList.toggle('en-selected-row',id===enhanced.selected[module])});
 });
 enhancedExtras();
 if(focusSelector){var replacement=document.querySelector(focusSelector);if(replacement&&!replacement.disabled&&replacement.offsetParent!==null)replacement.focus({preventScroll:true})}
}
function enhancedCurrentModule(){return location.hash==='#development'?'development':'projects'}
function enhancedBringIntoView(){
 var m=enhancedCurrentModule(),id=enhanced.selected[m],pane=document.querySelector('[data-pane="'+m+'"]');
 if(enhanced.layout[m]==='record'){byId('enPanel-'+m).scrollTo({top:0,behavior:'instant'});return;}
 var el=pane.querySelector('[data-en-card="'+id+'"]')||pane.querySelector('[data-details="'+id+'"],[data-development="'+id+'"]');
 if(el)el.scrollIntoView({block:'nearest',behavior:'auto'});
}
async function enhancedHistory(id){
 var version=++enhanced.historyVersion,m=enhancedCurrentModule(),target=byId('enHistory-'+id);if(!target)return;target.innerHTML='<p>Loading history…</p>';
 try{var data=await api('/api/projects/'+id+'/history');if(version!==enhanced.historyVersion||!state.me||enhanced.selected[m]!==Number(id)||!target.isConnected)return;target.innerHTML=data.history.map(function(h){return '<article class="en-history-item"><strong>'+esc(dateText(h.reporting_period))+'</strong><small>'+esc(h.author_name||h.author_email||'Workbook Import')+'</small><p>'+esc(h.current_summary)+'</p></article>'}).join('')||'<p>No history recorded.</p>'}catch(e){if(target.isConnected)target.textContent=e.message||'Sign in to view history.'}
}
function enhancedMove(position){
 if(enhanced.pending){toast('Please wait for the edit to finish saving.');return}
 var m=enhancedCurrentModule(),rows=enhancedRows(m);if(!rows.length)return;
 var old=rows.findIndex(function(p){return p.id===enhanced.selected[m]}),i=Math.max(0,Math.min(rows.length-1,position));if(i===old)return;
 enhanced.selected[m]=rows[i].id;enhanced.historyVersion++;renderEnhanced();enhancedBringIntoView();
 if(enhanced.navigator==='rolodex'&&enhanced.mode==='enhanced'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  var book=byId('enRolodex').querySelector('.en-book');if(!book)return;
  var card=document.createElement('div'),forward=i>old;card.className='en-flipping-card '+(forward?'en-flip-forward':'en-flip-back');card.setAttribute('aria-hidden','true');card.innerHTML='<i></i><i></i><i></i>';book.append(card);
  var animation=card.animate([{transform:'rotateX(0deg)',filter:'brightness(1)'},{transform:'rotateX('+(forward?'90':'-90')+'deg)',filter:'brightness(.72)',offset:.5},{transform:'rotateX('+(forward?'180':'-180')+'deg)',filter:'brightness(1)'}],{duration:460,easing:'cubic-bezier(.35,.05,.3,1)',fill:'forwards'});
  animation.onfinish=function(){card.remove()};animation.oncancel=function(){card.remove()};
 }
}

var enHost=document.createElement('div');enHost.id='enExperience';enHost.className='en-experience';enHost.hidden=true;enHost.innerHTML='<button id="enToggle" class="nav-btn" data-en-toggle aria-label="Switch to Enhanced"><span class="nav-icon">⇄</span><span>Classic</span></button>';document.querySelector('.sidebar').append(enHost);
var enRolodex=document.createElement('div');enRolodex.id='enRolodex';enRolodex.className='en-rolodex-widget';enRolodex.hidden=true;document.querySelector('[data-view="portfolio"]').after(enRolodex);
var enBottom=document.createElement('div');enBottom.id='enBottomNav';enBottom.className='en-bottom-nav';enBottom.hidden=true;document.body.append(enBottom);
['search','developmentSearch'].forEach(function(id){var picker=document.createElement('div');picker.className='en-nav-picker';picker.hidden=true;picker.innerHTML='<button data-en-picker aria-label="Cycle navigator">'+enBookIcon+'</button>';byId(id).closest('.search').before(picker)});
window.addEventListener('resize',enhancedBottomPosition);
['projects','development'].forEach(function(m){var pane=document.querySelector('[data-pane="'+m+'"]'),toolbar=document.createElement('div'),panel=document.createElement('div');toolbar.id='enToolbar-'+m;toolbar.className='en-toolbar';toolbar.hidden=true;panel.id='enPanel-'+m;panel.className='en-panel';panel.hidden=true;pane.prepend(toolbar);pane.append(panel)});
var enOriginalProjects=renderProjects;renderProjects=function(){enOriginalProjects();renderEnhanced()};
var enOriginalDevelopment=renderDevelopment;renderDevelopment=function(){enOriginalDevelopment();renderEnhanced()};
var enOriginalView=setView;setView=function(view,keep){enOriginalView(view,keep);enhanced.module=view==='development'?'development':'projects';renderEnhanced()};
var enOriginalSignIn=showSignIn;showSignIn=function(message){enhanced.historyVersion++;enhanced.user=null;enhanced.selected={projects:null,development:null};enhanced.meeting=false;enOriginalSignIn(message);byId('enExperience').hidden=true;document.body.classList.remove('is-enhanced','en-meeting','freeze-list','has-bottom-nav');byId('enRolodex').hidden=true;byId('enRolodex').replaceChildren();byId('enBottomNav').hidden=true;byId('enBottomNav').replaceChildren();['projects','development'].forEach(function(m){byId('enPanel-'+m).replaceChildren();byId('enToolbar-'+m).replaceChildren()})};
// Prevent layout changes while an existing inline save is running.
var enOriginalInline=saveInline;saveInline=async function(el){enhanced.pending++;try{return await enOriginalInline(el)}finally{enhanced.pending--}};
var enOriginalPatch=patchFields;patchFields=async function(id,fields,message){enhanced.pending++;try{return await enOriginalPatch(id,fields,message)}finally{enhanced.pending--}};
document.addEventListener('click',function(e){
 var b=e.target.closest('[data-en-toggle],[data-en-mode],[data-en-layout],[data-en-open],[data-en-move],[data-en-meeting],[data-en-activity],[data-en-history]');if(!b)return;
 if(enhanced.pending){toast('Please wait for the current edit to finish saving.');return}
 var m=enhancedCurrentModule();
 if(b.hasAttribute('data-en-toggle')){enhanced.mode=enhanced.mode==='classic'?'enhanced':'classic';enhanced.meeting=false;enhancedSavePrefs();renderEnhanced();return}
 if(b.dataset.enMode){enhanced.mode=b.dataset.enMode;enhanced.meeting=false;enhancedSavePrefs();renderEnhanced();enhancedBringIntoView();return}
 if(b.dataset.enLayout){enhanced.layout[m]=b.dataset.enLayout;enhancedSavePrefs();renderEnhanced();enhancedBringIntoView();return}
 if(b.dataset.enOpen){enhanced.selected[m]=Number(b.dataset.enOpen);enhanced.layout[m]='record';enhancedSavePrefs();renderEnhanced();enhancedBringIntoView();return}
 if(b.dataset.enMove){var rows=enhancedRows(m),i=rows.findIndex(function(p){return p.id===enhanced.selected[m]}),move=b.dataset.enMove;enhancedMove(move==='first'?0:move==='last'?rows.length-1:i+(move==='next'?1:-1));return}
 if(b.hasAttribute('data-en-meeting')){enhanced.meeting=!enhanced.meeting;renderEnhanced();return}
 if(b.dataset.enActivity){openActivity(b.dataset.enActivity);return}
 if(b.dataset.enHistory)enhancedHistory(b.dataset.enHistory);
});
document.addEventListener('change',function(e){
 var m=enhancedCurrentModule(),el=e.target;
 if(el.matches('[data-en-position],[data-en-slider]')){var n=Number(el.value);if(!Number.isInteger(n)||n<1||n>enhancedRows(m).length){toast('Choose a record number within the current results.');renderEnhanced();return}enhancedMove(n-1)}
 if(el.matches('[data-en-nav]')){enhanced.navigator=el.value;enhancedSavePrefs();renderEnhanced()}
 if(el.matches('[data-en-sort]')){enhanced.selected[m]=null;if(m==='development'){state.devSortKey=el.value;state.devSortDir=el.value.includes('risk')?'desc':'asc';renderDevelopment()}else{state.sortKey=el.value;state.sortDir=el.value.includes('risk')?'desc':'asc';renderProjects();renderCost();renderRisk()}}
});
document.addEventListener('click',function(e){
 var picker=e.target.closest('[data-en-picker]'),choice=e.target.closest('[data-en-choice]');
 if(picker){if(enhanced.pending)return;enhanced.navigator={rolodex:'slider',strip:'slider',slider:'rolodex'}[enhanced.navigator];enhancedSavePrefs();renderEnhanced();return}
 if(choice){if(enhanced.pending)return toast('Please wait for the edit to finish saving.');enhanced.navigator=choice.dataset.enChoice;enhancedSavePrefs();document.querySelectorAll('.en-nav-menu').forEach(function(x){x.hidden=true});renderEnhanced()}
 if(!e.target.closest('.en-nav-picker'))document.querySelectorAll('.en-nav-menu').forEach(function(x){x.hidden=true;x.previousElementSibling.setAttribute('aria-expanded','false')});
});
document.addEventListener('keydown',function(e){if(e.key==='Escape')document.querySelectorAll('.en-nav-menu').forEach(function(x){x.hidden=true;x.previousElementSibling.setAttribute('aria-expanded','false')})});
// Selecting any list action keeps the corresponding record selected in other layouts.
document.addEventListener('click',function(e){var row=e.target.closest('tr.project-row');if(!row||enhanced.mode!=='enhanced')return;var b=row.querySelector('[data-details],[data-development]');if(b){enhanced.selected[enhancedCurrentModule()]=Number(b.dataset.details||b.dataset.development);var pane=row.closest('[data-pane]');pane.querySelectorAll('.en-selected-row').forEach(function(r){r.classList.remove('en-selected-row')});row.classList.add('en-selected-row')}},true);
// Dialog edits stay in Classic's forms. Closing a changed form is an explicit choice.
var enDirty=new Set();
document.addEventListener('input',function(e){var d=e.target.closest('dialog');if(d&&['detailsDialog','developmentDialog','activityDialog'].includes(d.id))enDirty.add(d.id)});
['detailsDialog','developmentDialog','activityDialog'].forEach(function(id){var d=byId(id);d.addEventListener('close',function(){enDirty.delete(id)});d.addEventListener('cancel',function(e){if(enDirty.has(id)&&!confirm('Discard the unsaved changes in this dialog?'))e.preventDefault()})});
document.addEventListener('click',function(e){var b=e.target.closest('[data-close]');if(b&&enDirty.has(b.dataset.close)&&!confirm('Discard the unsaved changes in this dialog?')){e.preventDefault();e.stopImmediatePropagation()}},true);
window.addEventListener('beforeunload',function(e){if(enDirty.size||enhanced.pending){e.preventDefault();e.returnValue=''}});
` + ENHANCED_WORKFLOWS + PHOTO_MODULE + PHOTO_DROP;
