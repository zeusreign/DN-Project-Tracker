import { xlsxExport, delimitedExport, zipMembers, EXPORT_FORMATS } from './exports.js';
import { CAPITAL_COLUMNS, DEVELOPMENT_COLUMNS, reportSheets, reportValue } from './workbook-layout.js';
import { SEED_PROJECTS } from './seed.js';
import { WORKBOOK_HISTORY } from './workbook-history-data.js';
import { workbookImportReview } from './workbook-history.js';

// The supplied D&C workbook ends 23 October 2026. Override only after the team
// agrees a different fortnightly calendar. Dates are UTC calendar days.
export const REPORT_ANCHOR = '2026-10-23';
export const REPORT_NOTE = 'Activity is selected by its saved reporting date. Project membership, names, status, costs and schedule are current at generation, not historical financial snapshots. Previous Week Update preserves the selected source workbook’s previous note when supplied; its own date is unknown. Otherwise it shows the preceding fortnight’s dated notes. Undated notes stay with their source report. Colors follow the reference workbook; Low is green, Medium yellow and High red. Not Rated means no rating was supplied, even where the source cell was shaded green.';
const DAY = 86400000;
export function reportDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day;
}
export function shiftReportDay(day, days) { return new Date(Date.parse(day) + days * DAY).toISOString().slice(0,10); }
export function latestReportEnd(now = new Date(), anchor = REPORT_ANCHOR) {
  // Today is still in progress; a period is complete on the following day.
  const yesterday = Date.parse(now.toISOString().slice(0,10)) - DAY;
  return shiftReportDay(anchor, Math.floor((yesterday - Date.parse(anchor)) / (14 * DAY)) * 14);
}
export function validReportEnd(day, anchor = REPORT_ANCHOR) {
  return reportDay(day) && (Date.parse(day) - Date.parse(anchor)) % (14 * DAY) === 0;
}
export function periodProjectRows(projects, history, end) {
  const start = shiftReportDay(end, -13), priorStart = shiftReportDay(start, -14);
  const byId = new Map();
  for (const h of history) { if (!byId.has(h.project_id)) byId.set(h.project_id, []); byId.get(h.project_id).push(h); }
  const notes = rows => rows.length ? rows.map(h => rows.length===1 && h.author_name==='Workbook Import' ? h.current_summary : h.reporting_period + '\n' + h.current_summary).join('\n\n') : 'No activity recorded in this period.';
  return projects.map(p => {
    const rows = (byId.get(p.id) || []).slice().sort((a,b) => a.reporting_period.localeCompare(b.reporting_period) || String(a.created_at).localeCompare(String(b.created_at)) || a.id-b.id);
    const current=rows.filter(h => h.current_summary?.trim() && h.reporting_period >= start && h.reporting_period <= end);
    const previous=rows.filter(h => h.current_summary?.trim() && h.reporting_period >= priorStart && h.reporting_period < start);
    // Preserve the imported previous narrative without inventing a dated history entry.
    // Match immutable import identity, not name/CAPP or the mutable previous_update field.
    const source=SEED_PROJECTS.find(s=>s.source_key===p.source_key && s.reporting_period===end);
    const historical=WORKBOOK_HISTORY.updates.find(h=>h.target===p.source_key&&h.date===end);
    const imported=rows.find(h=>(h.source_key==='initial:'+p.source_key || h.source_key===historical?.source_key) && h.reporting_period===end && h.author_name==='Workbook Import');
    const undated=imported?.previous_summary || source?.previous_update || historical?.previous;
    return {...p, current_update:notes(current), previous_update:undated||(previous.length?notes(previous):notes([])), previous_update_origin:undated?'workbook_undated':previous.length?'dated_history':'none'};
  });
}
export function workbookData(projects, period, generated = new Date().toISOString(), review=null) {
  const sheets=reportSheets(projects);
  if(review)sheets.push(review);
  // Flat CSV/TSV retains section context. Excel and the browser share sheet-specific columns.
  const columns=[...CAPITAL_COLUMNS,...DEVELOPMENT_COLUMNS.filter(c=>!CAPITAL_COLUMNS.some(x=>x[0]===c[0]))];
  const headers=['Worksheet','Subheading',...columns.map(c=>c[1])];
  const rows=projects.map(p=>[p.source_sheet||p.business_unit,p.section_name||p.venue,...columns.map(c=>reportValue(p,c[0]))]);
  const sourceNotes=projects.filter(p=>p.previous_update_origin==='workbook_undated').length;
  sheets.push({name:'Report notes',kind:'notes',headers:['Report information','Value'],rows:[
    ['Activity period',shiftReportDay(period,-13)+' through '+period],
    ['Previous dated activity period',shiftReportDay(period,-27)+' through '+shiftReportDay(period,-14)],
    ['Imported previous notes',sourceNotes?sourceNotes+' previous notes from the selected source workbook have no explicit reporting date. They appear under Previous Week Update, as supplied.':'No undated source notes used in this report.'],
    ['Import review',review?review.rows.length+' source rows need identity confirmation. Their original notes are retained on the Import review tab and excluded from project totals.':'No unmatched source rows for this selection.'],
    ['Colors','Source section colors and cell shading are retained. Risk labels drive Low/Medium/High colors. A shaded Not Rated cell is not an inferred risk rating. Positive variance and schedule delay are red; zero or negative values are dark green.'],
    ['Generated (UTC)',generated],['Basis',REPORT_NOTE],
    ['Totals','Totals sum available amounts. Missing amounts remain blank on project rows. The total variance is blank when a project lacks a budget or forecast.'],
    ['Membership','Active register at generation. Archived projects are excluded. Complete projects remain until separately archived.'],
    ['Project count',rows.length]
  ],widths:[30,110]});
  return {headers,rows,sheets,projectCount:projects.length,undatedPreviousCount:sourceNotes,importReviewCount:review?.rows.length||0};
}

export async function reportingApi(request, env, user, role, scope, helpers) {
  const {json,error,projectRows,scopeFilter,canWrite,projectInScope}=helpers, url=new URL(request.url);
  const archiveMatch=url.pathname.match(/^\/api\/projects\/(\d+)\/archive$/);
  if(archiveMatch){
    if(request.method!=='PATCH')return error('Method not allowed.',405);
    if(!canWrite(role))return error('Editor access is required.',403);
    const id=Number(archiveMatch[1]);
    if(!await projectInScope(env.DB,id,scope))return error('Project not found.',404);
    const p=await env.DB.prepare('SELECT id,name,archived_at FROM projects WHERE id=?').bind(id).first();
    if(!p)return error('Project not found.',404);
    const body=await request.json().catch(()=>null);
    if(!body || typeof body.archived!=='boolean'||typeof body.expected_archived!=='boolean')return error('Choose Archive or Restore with the current record state.',400);
    if(Boolean(p.archived_at)!==body.expected_archived)return error('The project changed. Refresh before trying again.',409);
    if(body.archived===Boolean(p.archived_at))return json({ok:true,unchanged:true});
    const token=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE projects SET archived_at=CASE WHEN ? THEN datetime('now') ELSE NULL END,updated_at=datetime('now') WHERE id=? AND (archived_at IS NOT NULL)=?").bind(body.archived?1:0,id,body.expected_archived?1:0),
      env.DB.prepare("INSERT INTO audit_log(action,entity_type,entity_key,actor_id,actor_email,details) SELECT ?,'project',?,?,?,? WHERE changes()=1").bind(body.archived?'project_archive':'project_restore',String(id),user.id,user.email,JSON.stringify({token,projectName:p.name,archived:body.archived}))
    ]);
    const saved=await env.DB.prepare('SELECT id FROM audit_log WHERE details LIKE ?').bind('%'+token+'%').first();
    return saved?json({ok:true}):error('The project changed. Refresh before trying again.',409);
  }
  if(url.pathname==='/api/archive'&&request.method==='GET')return json({projects:await projectRows(env.DB,scope,'archived')});
  if(!['/api/reporting-periods','/api/workbook','/api/report-download'].includes(url.pathname))return null;
  if(request.method!=='GET')return error('Method not allowed.',405);
  const anchor=env.REPORTING_ANCHOR||REPORT_ANCHOR;
  if(!reportDay(anchor))return error('Reporting calendar configuration is invalid.',503);
  const latest=latestReportEnd(new Date(),anchor),filter=scopeFilter(scope,'b');
  // Apply the exact same BU authorization to history as to the project register.
  const historyResult=await env.DB.prepare(`SELECT u.* FROM project_updates u JOIN projects p ON p.id=u.project_id JOIN business_units b ON b.id=p.business_unit_id WHERE p.archived_at IS NULL${filter.sql} ORDER BY u.reporting_period,u.created_at,u.id`).bind(...filter.bindings).all();
  const history=historyResult.results||[], oldest=history.map(h=>h.reporting_period).filter(reportDay).sort()[0]||latest;
  if(url.pathname==='/api/reporting-periods'){
    const periods=[];for(let end=latest;periods.length<260;end=shiftReportDay(end,-14)){periods.push({start:shiftReportDay(end,-13),end});if(end<=oldest&&periods.length>=2)break;}
    return json({periods,latest,anchor,time_zone:'UTC',latest_activity:history.map(h=>h.reporting_period).filter(reportDay).sort().at(-1)||null,note:REPORT_NOTE});
  }
  const end=url.searchParams.get('end')||latest,startEnd=url.searchParams.get('from')||end;
  if(!validReportEnd(end,anchor)||!validReportEnd(startEnd,anchor)||startEnd>end||end>latest)return error('Choose completed reporting periods from the reporting calendar.',400);
  const count=(Date.parse(end)-Date.parse(startEnd))/(14*DAY)+1;
  if(count>26)return error('Select at most 26 reporting periods per download.',400);
  const module=url.searchParams.get('module')||'all',unit=url.searchParams.get('unit')||'All';
  if(!['all','projects','development'].includes(module))return error('Choose a valid project module.',400);
  let projects=await projectRows(env.DB,scope);
  projects=projects.filter(p=>(unit==='All'||p.business_unit===unit)&&(module==='all'||(module==='development')===(p.project_type==='Development')));
  const generated=new Date().toISOString(),rows=periodProjectRows(projects,history,end);
  if(url.pathname==='/api/workbook')return json({period:{start:shiftReportDay(end,-13),end},generated,note:REPORT_NOTE,projects:rows,data:workbookData(rows,end,generated,workbookImportReview(end,unit,module,scope))});
  const format=url.searchParams.get('format')||'xlsx';
  if(!Object.hasOwn(EXPORT_FORMATS,format))return error('Choose Excel, CSV or tab-delimited.',400);
  const members={};
  try{
    for(let day=startEnd;day<=end;day=shiftReportDay(day,14)){
      const data=workbookData(periodProjectRows(projects,history,day),day,generated,workbookImportReview(day,unit,module,scope));
      // Flat formats keep provenance in every row; Excel includes a Read me tab.
      const flat={headers:['Activity period start','Activity period end','Generated UTC','Reporting basis',...data.headers],rows:data.rows.map(r=>[shiftReportDay(day,-13),day,generated,REPORT_NOTE,...r])};
      members['DNC-report-'+day+'.'+format]=format==='xlsx'?xlsxExport(data):delimitedExport(flat,format==='tsv'?'\t':',');
    }
    const multi=count>1,filename=multi?'DNC-reports-'+startEnd+'-to-'+end+'.zip':Object.keys(members)[0];
    return new Response(multi?zipMembers(members):Object.values(members)[0],{headers:{'content-type':multi?'application/zip':EXPORT_FORMATS[format],'content-disposition':'attachment; filename="'+filename+'"','cache-control':'no-store','x-content-type-options':'nosniff'}});
  }catch{return error('The report could not be generated. Shorten the range or use CSV for exceptionally long notes.',503);}
}
