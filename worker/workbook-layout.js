import { WORKBOOK_REFERENCE_STYLES } from './workbook-colors.js';
// Shared presentation contract for the browser Workbook and Excel download.
// Labels/order follow the supplied 2026_1023 D&C Bi-Weekly Report Data workbook.
export const CAPITAL_COLUMNS = [
  ['name','Project Name','text',36],
  ['capp_number','CAPP #','text',12],
  ['project_manager','PM','text',24],
  ['current_update','Project Update','text',81.71],
  ['previous_update','Previous Week Update','text',81.71],
  ['budget_risk','Budget Risk','text',13],
  ['schedule_risk','Schedule Risk','text',14],
  ['precon_capp','A & E / Pre-Con Capp','money',21],
  ['construction_capp','Construction Capp','money',20],
  ['add_capp','Add-CAPP (Cumulative)','money',22],
  ['approved_budget','Total Approved Budget','money',22],
  ['anticipated_final_cost','Anticipated Final Cost','money',22],
  ['cost_variance','Budget / Final Cost Variance','money',24],
  ['percent_variance','% Variance','percent',12],
  ['original_start_date','Original Start Date','date',17],
  ['current_start_date','Current Start Date','date',17],
  ['original_turnover_date','Original Turnover Date To Ops','date',22],
  ['current_turnover_date','Current Turnover Date To Ops','date',22],
  ['duration_change_days','Duration Change','integer',16],
];
export const DEVELOPMENT_COLUMNS = [
  ['name','Project Name','text',39],
  ['initiative_number','Initiative #','text',12],
  ['development_lead','Project Development Lead','text',25],
  ['scope_description','Project Scope/Description','text',55],
  ['current_update','Weekly Update','text',63],
  ['status','Status','text',14],
  ['development_request_date','Request Date','date',14],
  ['development_requestor','Requestor','text',16],
  ['development_deliverable_due_date','Deliverable Due Date','date',20],
  ['development_consultants','Architect, Engineers, CM Consultants','text',32],
  ['development_food_service_design','Food Service Design','text',20],
  ['development_design_capp','Design CAPP (Y/N)','text',18],
  ['development_subsidiary_expense_total','Subsidiary/Biz Dev Expense Total ($)','money',20],
  ['development_original_estimate','Original Estimate','money',18],
  ['development_original_estimate_date','Original Estimate Date','date',20],
  ['development_current_estimate','Current Estimate','money',18],
  ['development_current_estimate_date','Current Estimate Date','date',20],
];
const WORKBOOK_UNIT_NAMES = {Corporate:'CORP',Patina:'PATINA',Gaming:'GAMING','Parks & Resorts':'PARKS',Sportservice:'SS'};
const DEVELOPMENT_SUBHEADINGS = {Sportservice:'SPORTSERVICE','Parks & Resorts':'PARKS & RESORTS',Gaming:'GAMING',Patina:'PATINA',Corporate:'DELAWARE NORTH CORPORATE'};
// Activity is exactly ten Excel character units wider than the reference sheet.
const WORKBOOK_WIDTHS = {CORP:[34,13,20,68.71,35],PATINA:[36,11,14,91.57,56],GAMING:[38,12,24,81.71,63],PARKS:[36,10,25,89.29,64],SS:[24,12,14,52.57,46]};
export function reportValue(p,key) {
  const variance = p.approved_budget == null || p.anticipated_final_cost == null ? null : p.anticipated_final_cost-p.approved_budget;
  if(key==='cost_variance')return variance;
  if(key==='percent_variance')return variance==null||!Number(p.approved_budget)?null:variance/p.approved_budget;
  return p[key] ?? null;
}
export function workbookCellStyle(p,key,index,sheetName) {
  const source=WORKBOOK_REFERENCE_STYLES.rows[p.source_key];
  // New records inherit the worksheet's recurring shaded columns.
  const fallback=(sheetName==='CORP'?key==='anticipated_final_cost':key==='approved_budget'||(['GAMING','PARKS','SS'].includes(sheetName)&&key==='duration_change_days'))?{fill:'#BFBFBF'}:{};
  const style={...(source?.[index] || (p.project_type==='Development'?{}:fallback))};
  if(['project_manager','development_lead','budget_risk','schedule_risk','cost_variance','percent_variance'].includes(key))style.align='center';
  if(key==='budget_risk'||key==='schedule_risk'){
    const rating=String(p[key]||'').toLowerCase(),fill={low:'#00B050',medium:'#FFFF00',high:'#FF0000'}[rating];
    if(fill){style.fill=fill;style.color='#000000';}
    else if(style.fill){style.color='#000000';style.title='Source workbook shading retained. No risk rating was supplied.';}
  }
  if(key==='cost_variance'||key==='percent_variance'||key==='duration_change_days'){
    const n=reportValue(p,key);
    if(typeof n==='number')style.color=n>0?'#FF0000':'#385723';
  }
  return style;
}
export function reportSheets(projects) {
  const groups=new Map();
  const ordered=projects.slice().sort((a,b)=>(a.source_sort_order??Number.MAX_SAFE_INTEGER)-(b.source_sort_order??Number.MAX_SAFE_INTEGER)||a.id-b.id);
  for(const p of ordered){const name=p.project_type==='Development'?'Design & Development':WORKBOOK_UNIT_NAMES[p.business_unit]||p.business_unit||'Other';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(p);}
  const sheetOrder=['CORP','PATINA','GAMING','PARKS','SS','Design & Development'];
  return [...groups].sort(([a],[b])=>(sheetOrder.includes(a)?sheetOrder.indexOf(a):99)-(sheetOrder.includes(b)?sheetOrder.indexOf(b):99)).map(([name,items])=>{
    const development=name==='Design & Development',columns=development?DEVELOPMENT_COLUMNS:CAPITAL_COLUMNS;
    const widths=columns.map((c,i)=>!development&&i<5&&WORKBOOK_WIDTHS[name]?WORKBOOK_WIDTHS[name][i]:c[3]);
    widths[0]-=10;
    // Both narrative columns receive the same reading space on screen and in Excel.
    if(!development)widths[4]=widths[3];
    const sectionGroups=new Map();
    for(const p of items){const label=development?DEVELOPMENT_SUBHEADINGS[p.business_unit]||p.business_unit:p.section_name||p.venue||p.business_unit;if(!sectionGroups.has(label))sectionGroups.set(label,[]);sectionGroups.get(label).push(p);}
    const rows=[],sections=[],cellStyles=[];
    for(const [label,records] of sectionGroups){
      const sourceStyle=WORKBOOK_REFERENCE_STYLES.sections[name]?.[label];
      sections.push({index:rows.length,label,style:{fill:development?'#BFBFBF':name==='PATINA'?'#9BC2E6':'#9DC3E6',color:'#000000',...sourceStyle}});
      for(const p of records){rows.push(columns.map(c=>reportValue(p,c[0])));cellStyles.push(columns.map((c,i)=>workbookCellStyle(p,c[0],i,name)));}
    }
    const total=development||name==='CORP'?null:columns.map((c,i)=>i===0?'TOTAL':i>=7&&i<=12?(rows.some(r=>typeof r[i]==='number')?rows.reduce((sum,r)=>sum+(typeof r[i]==='number'?r[i]:0),0):null):null);
    if(total&&items.some(p=>p.approved_budget==null||p.anticipated_final_cost==null))total[12]=null;
    const totalStyles=columns.map((c,i)=>({...WORKBOOK_REFERENCE_STYLES.totals[name]?.[i],...(['cost_variance','percent_variance'].includes(c[0])?{align:'center'}:{}),...(c[0]==='cost_variance'&&typeof total?.[i]==='number'?{color:total[i]>0?'#FF0000':'#385723'}:{})}));
    return {name,kind:development?'development':'capital',headers:columns.map(c=>c[1]),keys:columns.map(c=>c[0]),columnTypes:columns.map(c=>c[2]),widths,rows,cellStyles,sections,total,totalStyles,freezeColumns:3,grouped:true,autoFilter:false};
  });
}
