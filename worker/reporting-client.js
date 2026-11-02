// Shared by Classic and Enhanced. No independent data copy or AI-generated rows.
export const REPORTING_CLIENT = String.raw`
var reportState={calendar:null,module:'projects',end:null,version:0,archiveVersion:0,archived:[],format:'xlsx',sheet:null,report:null};
var moduleInfo={
 portfolio:['Portfolio summarizes current work by business unit, approved capital and recorded risk. Select a business unit or a summary item to focus your review.','Counts follow the saved project status. Complete projects remain in the active register until an Editor or Administrator archives them; Archive is separate from the progress status.'],
 projects:['Projects brings together capital project activity, budgets, forecasts and schedule. Use the business-unit, search, status and risk controls to find your records. Enhanced adds Record and Cards alongside List.','Use the small spreadsheet icon for Workbook view. It follows the reference workbook’s columns and subheadings, with separate business-unit tabs. Current and previous updates appear side by side for capital projects. Dated history remains available from the activity controls.','Editors and Administrators can update permitted projects or archive them from project details. Viewers can review and download. Archive preserves history and photos and supports restoration.'],
 development:['Development Pipeline tracks proposed work, scope, leads, estimates and delivery dates before promotion to a capital project. Filter by business unit or search for an initiative.','Open a record to review or edit its development details. Promotion retains the project history. Workbook view and period downloads are available from the spreadsheet and Download controls.','Archive inactive initiatives instead of deleting them. Restoring an initiative returns it to the register with its previous progress status.'],
 cost:['Cost Control compares approved budgets, anticipated final costs and recorded variances. Positive cost variance means the forecast exceeds the approved budget; missing values are not zero budgets.','Financial values reflect the current saved record. Selecting a past reporting period changes activity notes only; the Tracker does not reconstruct past financial snapshots. Check the reporting-basis note in every download.'],
 risk:['Risk Register shows the budget and schedule risks recorded by the project team. Use business-unit, search, status and risk filters to narrow the review.','Risk ratings reflect current saved information. Review the project and its activity history before making a decision; a rating alone does not explain its cause. Authorized editors can update the project.'],
 photos:['Project Photos keeps reference and progress images with their project, reporting date, description and other details. Choose a project and use Card, List or Collage to review its photos.','Editors can upload supported images and manage photo details within their business-unit access. Archiving a project retains its images; restore the project before changing them. Project archival does not delete any photo file.'],
 admin:['Admin provides the user directory, access controls, audit history and backup tools for Administrators. Roles and business-unit scope determine what each person may see or change.','Archive and Restore actions are logged with the actor and time. Keep backups and review the deployment notes before changing a release. An application download is a report, not a database backup.'],
 help:['Help contains the user guide and practical instructions for the Tracker. The Info button also gives a short explanation of whichever module you are viewing.','The updated training guide covers Workbook view, reporting periods, downloads and Archive. If an expected update is missing, check the selected dates and refresh the data before reporting the issue.'],
 workbook:['Workbook is a read-only view of the team’s spreadsheet layout. Capital tabs use Project Name, CAPP #, PM, Project Update and Previous Week Update, followed by costs and schedule. Development uses its own scope, request, consultant and estimate columns. The same headings and subheadings appear in the Excel download.','The default is the latest completed fortnight. Dated entries are selected for that period and the preceding fortnight. Previous Week Update preserves the selected source workbook’s previous note where supplied; its own date is unknown. Otherwise it shows the prior fortnight. Source colors and shading appear here and in Excel; shaded Not Rated cells do not imply a risk rating. No activity recorded means no dated note exists in the selected window.','Choose another completed period or use Download for one period or a range. Older rows without a confirmed project match are retained in Import review. Project membership, status, financials and schedule are current, even when activity is historical. Reports cover the selected business unit and project module; list search and risk filters do not narrow them.'],
 archive:['Archive holds inactive capital and development projects without removing their records, history or photos. These records are excluded from the active register and ordinary reports.','Complete is a progress status and does not archive a project automatically. An authorized Editor or Administrator may restore an archived record; it returns with its prior status and history. Archived records are read-only until restored.']
};
titles.workbook=['Workbook','Two-week activity review · Current financial and schedule values'];
titles.archive=['Archive','Inactive projects · History and photos retained'];
function reportCurrentModule(){return location.hash==='#workbook'?reportState.module:location.hash==='#development'?'development':'projects'}
function reportOptions(calendar,selected){return calendar.periods.map(function(p){return '<option value="'+p.end+'" '+(p.end===selected?'selected':'')+'>'+p.start+' to '+p.end+'</option>'}).join('')}
async function reportCalendar(){var account=state.me;if(reportState.calendar)return reportState.calendar;var calendar=await api('/api/reporting-periods');if(account!==state.me)throw Error('The signed-in account changed.');reportState.calendar=calendar;return calendar}
function reportControls(){
 var view=location.hash.slice(1)||'projects';
 byId('moduleInfoBtn').hidden=!state.me;byId('workbookBtn').hidden=!state.me||view!=='portfolio';
 byId('archiveNav').hidden=!state.me;
}
function showModuleInfo(){var view=location.hash.slice(1)||'projects';byId('moduleInfoTitle').textContent='About '+(titles[view]?titles[view][0]:'this module');byId('moduleInfoBody').innerHTML=(moduleInfo[view]||moduleInfo.projects).map(function(p){return '<p>'+esc(p)+'</p>'}).join('');byId('moduleInfoDialog').showModal()}
async function renderWorkbook(){
 var version=++reportState.version,account=state.me;if(!account)return;
 reportState.report=null;byId('workbookSheets').replaceChildren();
 byId('workbookTable').innerHTML='<p role="status">Loading reporting period…</p>';
 try{
  var calendar=await reportCalendar();if(version!==reportState.version||account!==state.me)return;
  reportState.end=reportState.end||calendar.latest;
  byId('workbookPeriod').innerHTML=reportOptions(calendar,reportState.end);byId('workbookModule').value=reportState.module;
  var query=new URLSearchParams({end:reportState.end,module:reportState.module,unit:state.unitScope});
  var report=await api('/api/workbook?'+query);if(version!==reportState.version||account!==state.me)return;
  byId('workbookBasis').textContent=report.note;
  byId('workbookCaption').textContent=report.data.rows.length+' projects · '+report.period.start+' to '+report.period.end+' · '+state.unitScope+' · Latest saved activity: '+(calendar.latest_activity||'none')+(report.data.importReviewCount?' · '+report.data.importReviewCount+' source rows in Import review':'');
  reportState.report=report;
  renderWorkbookSheet();
 }catch(e){if(version===reportState.version&&account===state.me)byId('workbookTable').textContent=e.message}
}
function reportCellText(v,type){
 if(v==null)return '';
 if(type==='money')return moneyText(v);
 if(type==='percent')return (Number(v)*100).toFixed(1)+'%';
 if(type==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(String(v)))return String(v).slice(5,7)+'/'+String(v).slice(8,10)+'/'+String(v).slice(2,4);
 return String(v);
}
function renderWorkbookSheet(){
 var report=reportState.report;if(!report)return;
 var sheets=report.data.sheets.filter(function(s){return s.kind!=='notes'});
 var sheet=sheets.find(function(s){return s.name===reportState.sheet})||sheets[0];
 reportState.sheet=sheet?sheet.name:null;
 byId('workbookSheets').innerHTML=sheets.map(function(s){return '<button class="report-sheet-tab '+(s===sheet?'selected':'')+'" type="button" data-report-sheet="'+esc(s.name)+'" aria-pressed="'+(s===sheet?'true':'false')+'">'+esc(s.name)+' <span>'+s.rows.length+'</span></button>'}).join('');
 if(!sheet){byId('workbookTable').innerHTML='<p>No projects in this module and business-unit selection.</p>';return}
 var widths=sheet.widths.map(function(w){return Math.round(w*7+5)}),total=widths.reduce(function(a,b){return a+b},0);
 var offsets=[0,widths[0],widths[0]+widths[1]],sections={};sheet.sections.forEach(function(s){sections[s.index]=s});
 function colorCss(style){style=style||{};return (/^#[0-9a-f]{6}$/i.test(style.fill)?'background:'+style.fill+';':'')+(/^#[0-9a-f]{6}$/i.test(style.color)?'color:'+style.color+';':'')+(style.align==='center'?'text-align:center;':'')}
 function rowHtml(row,isTotal,rowIndex){return '<tr class="'+(isTotal?'report-total':'report-data')+'">'+row.map(function(v,i){var type=sheet.columnTypes[i],appearance=(isTotal?sheet.totalStyles:sheet.cellStyles&&sheet.cellStyles[rowIndex])||[],st=appearance[i]||{},classes=[i<3?'report-frozen':'',type==='money'||type==='percent'||type==='integer'?'report-number':'',type==='date'?'report-date':''];return '<td class="'+classes.join(' ')+'" style="'+(i<3?'--report-left:'+offsets[i]+'px;':'')+colorCss(st)+'"'+(st.title?' title="'+esc(st.title)+'"':'')+'>'+esc(reportCellText(v,type))+'</td>'}).join('')+'</tr>'}
 var body=sheet.rows.map(function(row,i){var section=sections[i],band=section?'<tr class="report-section"><th class="report-section-label" scope="rowgroup" colspan="3" style="'+colorCss(section.style)+'"><span>'+esc(section.label)+'</span></th><td class="report-section-fill" colspan="'+(sheet.headers.length-3)+'" style="'+colorCss(section.style)+'" aria-hidden="true"></td></tr>':'';return band+rowHtml(row,false,i)}).join('');
 if(sheet.total)body+=rowHtml(sheet.total,true,-1);
 byId('workbookTable').innerHTML='<table class="report-table report-'+sheet.kind+'" style="width:'+total+'px"><caption class="sr-only">'+esc(sheet.name)+' — D&C bi-weekly report</caption><colgroup>'+widths.map(function(w){return '<col style="width:'+w+'px">'}).join('')+'</colgroup><thead><tr>'+sheet.headers.map(function(h,i){return '<th scope="col" class="'+(i<3?'report-frozen':'')+'"'+(i<3?' style="--report-left:'+offsets[i]+'px"':'')+'>'+esc(h)+'</th>'}).join('')+'</tr></thead><tbody>'+body+'</tbody></table>';
 byId('workbookTable').scrollLeft=0;byId('workbookTable').scrollTop=0;
}
async function openReportDownload(format){
 if(!canDownload())return;closeExportMenu(true);hideTooltip();reportState.format=format;
 var account=state.me;
 try{var calendar=await reportCalendar();if(account!==state.me)return;var end=reportState.end||calendar.latest;byId('reportFrom').innerHTML=reportOptions(calendar,end);byId('reportTo').innerHTML=reportOptions(calendar,end);byId('reportModule').value=['projects','development','workbook'].includes(location.hash.slice(1))?reportCurrentModule():'all';byId('reportRange').checked=false;byId('reportFromField').hidden=true;byId('reportDownloadTitle').textContent='Download '+({xlsx:'Excel workbook',csv:'CSV',tsv:'tab-delimited report'}[format]);byId('reportScope').textContent='Business unit: '+state.unitScope+'. Includes the selected module’s active register; screen search, status and risk filters are not applied.';byId('reportError').textContent='';byId('reportDownloadDialog').showModal()}catch(e){toast(e.message)}
}
async function submitReportDownload(e){
 e.preventDefault();var button=byId('reportDownloadSubmit');if(button.disabled)return;
 var end=byId('reportTo').value,from=byId('reportRange').checked?byId('reportFrom').value:end;
 if(from>end){byId('reportError').textContent='The first period must be earlier than or equal to the last period.';return}
 var query=new URLSearchParams({format:reportState.format,end:end,from:from,module:byId('reportModule').value,unit:state.unitScope});
 button.disabled=true;byId('reportError').textContent='';
 try{
  var response=await fetch('/api/report-download?'+query,{credentials:'same-origin',cache:'no-store',redirect:'error'});
  if(response.status===401){showSignIn('Your session expired. Sign in again to download.');return}
  if(!response.ok){var failure=await response.json().catch(function(){return {}});throw Error(failure.error||'Report could not be downloaded.')}
  var mime=response.headers.get('content-type')||'';if(!/application\/zip|spreadsheetml|text\/csv|tab-separated-values/.test(mime))throw Error('The download was interrupted. Please try again.');
  var name=(response.headers.get('content-disposition')||'').match(/filename="([^"]+)"/),blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name?name[1]:'DNC-report.'+reportState.format;document.body.append(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},60000);byId('reportDownloadDialog').close();toast('Report download started.');
 }catch(err){byId('reportError').textContent=err.message}finally{button.disabled=false}
}
async function renderArchive(){
 var version=++reportState.archiveVersion,account=state.me;if(!account)return;byId('archiveRows').innerHTML='<p role="status">Loading archived projects…</p>';
 try{var data=await api('/api/archive');if(version!==reportState.archiveVersion||account!==state.me)return;reportState.archived=data.projects;
 var rows=data.projects.filter(function(p){return state.unitScope==='All'||p.business_unit===state.unitScope});
 byId('archiveRows').innerHTML=rows.length?'<table class="archive-table"><thead><tr><th>Project</th><th>CAPP / Initiative</th><th>PM / Lead</th><th>Progress status</th><th>Archived (UTC)</th><th>Actions</th></tr></thead><tbody>'+rows.map(function(p){return '<tr><td>'+esc(p.name)+'<small class="sub">'+esc(p.business_unit+' · '+(p.section_name||p.venue))+'</small></td><td>'+esc(p.capp_number||p.initiative_number||'—')+'</td><td>'+esc(p.project_manager||p.development_lead||'—')+'</td><td>'+esc(p.status)+'</td><td>'+esc(p.archived_at)+'</td><td><button class="btn small" data-archive-inspect="'+p.id+'">View history</button>'+(canWrite()?'<button class="btn small" data-restore-project="'+p.id+'">Restore</button>':'')+'</td></tr>'}).join('')+'</tbody></table>':'<p>No archived projects in this business-unit selection.</p>';
 }catch(e){if(version===reportState.archiveVersion&&account===state.me)byId('archiveRows').textContent=e.message}
}
async function inspectArchive(id){
 var p=reportState.archived.find(function(p){return p.id===Number(id)});if(!p)return;
 var account=state.me,version=++reportState.archiveVersion;
 byId('archiveDetailTitle').textContent=p.name;byId('archiveDetailBody').textContent='Loading saved history and photos…';byId('archiveDetailDialog').showModal();
 try{var results=await Promise.all([api('/api/projects/'+p.id+'/history'),api('/api/projects/'+p.id+'/photos')]);if(account!==state.me||version!==reportState.archiveVersion||!byId('archiveDetailDialog').open)return;
 byId('archiveDetailBody').innerHTML='<p>Archived (inactive) · Progress status: '+esc(p.status)+'</p><p>'+esc(p.scope_description||'No scope description recorded.')+'</p><p>Current approved budget: '+moneyText(p.approved_budget)+' · Anticipated final cost: '+moneyText(p.anticipated_final_cost)+'</p><h4>Activity history</h4>'+results[0].history.map(function(h){return '<article><strong>'+esc(h.reporting_period)+'</strong><p class="report-note">'+esc(h.current_summary)+'</p></article>'}).join('')+'<h4>Retained photos</h4>'+(results[1].photos.map(function(photo){return '<p><a target="_blank" rel="noopener" href="/api/projects/'+p.id+'/photos/'+encodeURIComponent(photo.id)+'">'+esc(photo.photo_number||photo.caption||'View photo')+'</a></p>'}).join('')||'<p>No photos recorded.</p>');
 }catch(e){if(account===state.me&&version===reportState.archiveVersion)byId('archiveDetailBody').textContent=e.message}
}
async function changeArchive(id,archived){
 var rows=archived?state.projects:reportState.archived,p=rows.find(function(p){return p.id===Number(id)});if(!p||!canWrite())return;
 if(archived&&typeof enDirty!=='undefined'&&(enDirty.has('detailsDialog')||enDirty.has('developmentDialog'))){toast('Save or discard the unsaved field changes before archiving.');return}
 if(!confirm((archived?'Archive “'+p.name+'”? It will leave the active register. History and photos will be retained.':'Restore “'+p.name+'” to the active register with its previous progress status?')))return;
 try{await api('/api/projects/'+p.id+'/archive',{method:'PATCH',body:JSON.stringify({archived:archived,expected_archived:!archived})});['detailsDialog','developmentDialog','archiveDetailDialog'].forEach(function(id){byId(id).close()});reportState.calendar=null;await load(false);if(location.hash==='#archive')renderArchive();toast(archived?'Project archived. You can restore it from Archive.':'Project restored to the active register.')}catch(e){toast(e.message)}
}
var reportingOriginalLoad=load;load=async function(reset){reportState.calendar=null;if(reset)reportState.end=null;return reportingOriginalLoad(reset)};
var reportingOriginalSetView=setView;setView=function(view,keep){reportingOriginalSetView(view,keep);reportControls();if(view==='workbook')renderWorkbook();if(view==='archive')renderArchive()};
var reportingOriginalRenderAll=renderAll;renderAll=function(){reportingOriginalRenderAll();reportControls();if(location.hash==='#workbook')renderWorkbook();if(location.hash==='#archive')renderArchive()};
var reportingOriginalSignIn=showSignIn;showSignIn=function(message){reportState.version++;reportState.archiveVersion++;reportState.calendar=null;reportState.end=null;reportState.archived=[];reportState.report=null;reportState.sheet=null;['workbookTable','workbookSheets','workbookCaption','workbookBasis','archiveRows','archiveDetailBody'].forEach(function(id){byId(id).replaceChildren()});['moduleInfoDialog','reportDownloadDialog','archiveDetailDialog'].forEach(function(id){byId(id).close()});reportingOriginalSignIn(message);reportControls()};
var reportingOriginalDetails=openDetails;openDetails=function(id){reportingOriginalDetails(id);byId('archiveCapital').hidden=!canWrite()};
var reportingOriginalDevelopment=openDevelopment;openDevelopment=function(id){reportingOriginalDevelopment(id);byId('archiveDevelopment').hidden=!canWrite()};
// The existing format menu now opens a period chooser instead of downloading silently.
downloadExport=openReportDownload;
['projectsControls','developmentControls'].forEach(function(id){var b=document.createElement('button');b.type='button';b.className='toolbar-icon-button classic-workbook-button';b.innerHTML=byId('workbookBtn').innerHTML;b.setAttribute('data-tooltip','Workbook / Spreadsheet view');b.setAttribute('aria-label','Workbook / Spreadsheet view');b.setAttribute('data-workbook-open','');byId(id).append(b)});
byId('moduleInfoBtn').addEventListener('click',showModuleInfo);
byId('workbookBtn').addEventListener('click',function(){reportState.module=location.hash==='#portfolio'?'all':reportCurrentModule();setView('workbook')});
byId('workbookSheets').addEventListener('click',function(e){var b=e.target.closest('[data-report-sheet]');if(!b)return;reportState.sheet=b.dataset.reportSheet;renderWorkbookSheet()});
byId('workbookPeriod').addEventListener('change',function(){reportState.end=this.value;renderWorkbook()});
byId('workbookModule').addEventListener('change',function(){reportState.module=this.value;renderWorkbook()});
byId('workbookDownload').addEventListener('click',function(){openReportDownload('xlsx')});
byId('workbookBack').addEventListener('click',function(){setView(reportState.module==='development'?'development':'projects')});
byId('reportRange').addEventListener('change',function(){byId('reportFromField').hidden=!this.checked});
byId('reportDownloadForm').addEventListener('submit',submitReportDownload);
byId('archiveCapital').addEventListener('click',function(){changeArchive(byId('detailsId').value,true)});
byId('archiveDevelopment').addEventListener('click',function(){changeArchive(byId('developmentId').value,true)});
document.addEventListener('click',function(e){var b=e.target.closest('[data-workbook-open],[data-restore-project],[data-archive-inspect]');if(!b)return;if(b.hasAttribute('data-workbook-open')){reportState.module=reportCurrentModule();setView('workbook')}if(b.dataset.restoreProject)changeArchive(b.dataset.restoreProject,false);if(b.dataset.archiveInspect)inspectArchive(b.dataset.archiveInspect)});
`;
