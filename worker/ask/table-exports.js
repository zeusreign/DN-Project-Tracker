/* Exports render the validated query result and requested columns, never a fixed report template. */
(() => {
 const C=globalThis.DNCAssistantCore;
 const defaults=[{key:'name',label:'Project',type:'text'},{key:'venue',label:'Venue',type:'text'},{key:'business_unit',label:'Business unit',type:'text'},{key:'status',label:'Status',type:'text'}];
 const identity=[{key:'name',label:'Project',type:'text'},{key:'capp_number',label:'CAPP ID',type:'text'}];
 const layoutNote='Grouped by business unit, then venue.';
 const isFlat=result=>result.table?.layout==='flat'||(Array.isArray(result.plan?.sort)?result.plan.sort.length>0:!!result.plan?.sort);
 function hierarchy(rows){
  const units=new Map(),totals=[];
  for(const row of rows){if(row.isTotal){totals.push(row);continue;}const unit=String(row.business_unit||'Business unit not recorded').trim(),venue=String(row.venue||'Venue not recorded').trim();if(!units.has(unit))units.set(unit,new Map());const venues=units.get(unit);if(!venues.has(venue))venues.set(venue,[]);venues.get(venue).push(row);}
  const entries=[];
  for(const [unit,venues] of units){entries.push({kind:'unit',label:unit,count:[...venues.values()].reduce((n,rs)=>n+rs.length,0)});for(const [venue,rs] of venues){entries.push({kind:'venue',label:venue,unit,count:rs.length});rs.forEach(row=>entries.push({kind:'row',row}));}}
  totals.forEach(row=>entries.push({kind:'row',row}));return entries;
 }
 function view(result){
  const explicitColumns=Array.isArray(result.plan?.columns)&&result.plan.columns.length>0;
  const original=result.table||{columns:defaults,rows:result.rows||[],grouped:false};
  const table={...original,columns:[...original.columns],rows:original.totalRow?[...original.rows,original.totalRow]:[...original.rows]};
  if(table.grouped)return {...table,entries:table.rows.map(row=>({kind:'row',row}))};
  const sources=new Map((result.rows||[]).map(row=>[String(row.id),row]));
  table.rows=table.rows.map(row=>row.isTotal?row:{...(sources.get(String(row.id))||{}),...row});
  if(isFlat(result)){
   const sortFields={forecast:'anticipated_final_cost',budget:'approved_budget',delay:'day_variance',variance:'cost_variance',name:'name',turnover:'current_turnover_date'};
   if(!result.table){const key=sortFields[result.plan?.sort];table.columns=[identity[0],...(key&&key!=='name'?[{key,label:{anticipated_final_cost:'AFC',approved_budget:'Approved budget',day_variance:'Days',cost_variance:'Variance',current_turnover_date:'Current turnover'}[key],type:key==='day_variance'?'number':key==='current_turnover_date'?'date':'currency'}]:[])];table.rows=table.rows.map(r=>({...r,day_variance:C.dayVariance(r),cost_variance:C.costVariance(r)}));}
   table.columns=(explicitColumns?table.columns:[identity[0],...table.columns.filter(c=>c.key!=='name')]).map(c=>({...c,label:({business_unit:'BU',project_manager:'PM',anticipated_final_cost:'AFC',cost_variance:'Variance'}[c.key]||c.label)}));
   return {...table,hierarchical:false,layout:'flat',layoutNote:'One list in the requested order.',entries:table.rows.map(row=>({kind:'row',row}))};
  }
  if(!explicitColumns)table.columns=[...identity,...table.columns.filter(c=>!['name','capp_number','business_unit','venue'].includes(c.key))];
  return {...table,hierarchical:true,layoutNote,entries:hierarchy(table.rows)};
 }
 function cell(row,col){return row.isTotal&&!Object.hasOwn(row,col.key)?'':format(row[col.key],col);}
 function coverage(row,col){const n=row.recordedCounts?.[col.key],count=row.sourceIds?.length;return typeof n==='number'&&typeof count==='number'&&n<count?n+' of '+count+' recorded':'';}
 function format(value,col){if(value===null||value===undefined||value==='')return 'Not recorded';if(col.type==='currency')return C.money(value);if(col.type==='percent')return new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:1}).format(value);if(col.type==='number')return new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(value);return String(value);}
 const centered=(col,header=false)=>['id','capp_number','status'].includes(col.key)||header&&['name','venue','project_manager','development_lead','lead','business_unit','status'].includes(col.key);
 const ascii=v=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/≥/g,'>=').replace(/≤/g,'<=').replace(/≠/g,'!=').replace(/[^\x20-\x7e]/g,' ');
 function wrap(text,font,size,width){const lines=[];let line='';for(const word of ascii(text).split(/\s+/)){if(line&&font.widthOfTextAtSize(line+' '+word,size)>width){lines.push(line);line='';}if(font.widthOfTextAtSize(word,size)>width){for(const char of word){if(font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}line+=char;}}else line+=(line?' ':'')+word;}lines.push(line);return lines;}
 async function pdf(data,result,lib=globalThis.PDFLib){
  const table=view(result),narrative=Array.isArray(result.analysis)&&result.analysis.length>0;
  if(!table.rows.length&&!narrative)throw new Error('There are no selected results to export.');
  const {PDFDocument,StandardFonts,rgb}=lib,doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const title=result.title||'D&C project results';doc.setTitle(title);doc.setAuthor('D&C Project Tracker');
  const portrait=narrative||table.columns.length<=4||result.onePage&&table.columns.length<=6&&table.rows.length>18;
  const pageWidth=portrait?612:table.columns.length>8?1008:792,pageHeight=portrait?792:612,left=28,width=pageWidth-56;
  const ink=rgb(.08,.20,.28),navy=rgb(.03,.21,.29),muted=rgb(.32,.4,.45),white=rgb(1,1,1);
  const weights=table.columns.map(c=>c.key==='id'?65:['currency','percent'].includes(c.type)?100:c.type==='date'?90:c.type==='number'?65:c.key==='name'?215:c.key==='venue'?130:/update|scope/.test(c.key)?290:95),sum=weights.reduce((a,b)=>a+b,0),widths=weights.map(w=>width*w/sum);
  let page,y,pages=0;
  const scope=[...C.describePlan(result.plan),...(table.layoutNote?[table.layoutNote]:[])].join(' | ');
  function header(){
   const cells=table.columns.map((c,i)=>wrap(c.label,bold,8,widths[i]-10)),height=Math.max(21,Math.max(...cells.map(x=>x.length))*10+6);
   page.drawRectangle({x:left,y:y-height,width,height,color:navy});let x=left;
   cells.forEach((lines,i)=>{lines.forEach((text,k)=>page.drawText(text,{x:centered(table.columns[i],true)?x+(widths[i]-bold.widthOfTextAtSize(text,8))/2:x+5,y:y-12-k*10,size:8,font:bold,color:white}));x+=widths[i];});y-=height;
  }
  function newPage(tableHeader=!narrative){
   page=doc.addPage([pageWidth,pageHeight]);pages++;y=pageHeight-30;
   for(const line of wrap(title,bold,16,width)){page.drawText(line,{x:left,y,size:16,font:bold,color:navy});y-=20;}
   for(const line of wrap(scope,font,8.5,width)){page.drawText(line,{x:left,y,size:8.5,font,color:ink});y-=11;}
   page.drawText(`${result.rows.length} source projects | Retrieved ${data.meta.snapshot_at} | Latest reporting period ${data.meta.latest_reporting_period}`,{x:left,y:y-3,size:8,font,color:muted});y-=23;
   page.drawText('Source: '+ascii(data.meta.source_file),{x:left,y:24,size:7,font,color:muted});
   if(tableHeader)header();
  }
  newPage();
  if(narrative){
   for(const section of result.analysis){const text=section.text+' [Projects '+section.project_ids.map(id=>'#'+id).join(', ')+']';for(const line of wrap(text,font,10.5,width)){if(y<65)newPage(false);page.drawText(line,{x:left,y:y-11,size:10.5,font,color:ink});y-=14;}y-=12;}
  }else{
   const size=8.5,leading=10.5;let activeUnit=null,activeVenue=null,index=0;
   function band(entry,continued=false){const unit=entry.kind==='unit',lines=wrap(entry.label+' - '+entry.count+' project'+(entry.count===1?'':'s')+(continued?' (continued)':''),bold,unit?9:8.5,width-14),height=lines.length*11+10;page.drawRectangle({x:left,y:y-height,width,height,color:unit?rgb(45/255,97/255,120/255):rgb(.88,.94,.96)});lines.forEach((line,i)=>page.drawText(line,{x:left+7,y:y-13-i*11,size:unit?9:8.5,font:bold,color:unit?white:navy}));y-=height;}
   function nextTablePage(){newPage();if(activeUnit)band(activeUnit,true);if(activeVenue)band(activeVenue,true);}
   for(const entry of table.entries){
    if(entry.kind==='unit'){activeUnit=entry;activeVenue=null;if(y<155)newPage();band(entry);continue;}
    if(entry.kind==='venue'){activeVenue=entry;if(y<110){newPage();if(activeUnit)band(activeUnit,true);}band(entry);continue;}
    const row=entry.row,cells=table.columns.map((c,i)=>wrap(cell(row,c)+(coverage(row,c)?' ('+coverage(row,c)+')':''),row.isTotal?bold:font,size,widths[i]-10));
    if(row.isTotal){activeUnit=null;activeVenue=null;}
    let offset=0,totalLines=Math.max(...cells.map(c=>c.length));
    while(offset<totalLines){
     if(y<85)nextTablePage();
     const count=Math.min(totalLines-offset,Math.max(1,Math.floor((y-65-6)/leading))),height=Math.max(18,count*leading+6);
     if(row.isTotal||index%2===0)page.drawRectangle({x:left,y:y-height,width,height,color:row.isTotal?rgb(.86,.94,.94):rgb(.95,.97,.98)});
     let x=left;cells.forEach((lines,i)=>{lines.slice(offset,offset+count).forEach((text,k)=>{const numeric=['currency','number','percent'].includes(table.columns[i].type);page.drawText(text,{x:centered(table.columns[i])?x+(widths[i]-(row.isTotal?bold:font).widthOfTextAtSize(text,size))/2:numeric?x+widths[i]-5-(row.isTotal?bold:font).widthOfTextAtSize(text,size):x+5,y:y-size-4-k*leading,size,font:row.isTotal?bold:font,color:ink});});x+=widths[i];});y-=height;offset+=count;if(offset<totalLines)nextTablePage();
    }
    index++;
   }
  }
  y-=12;
  for(const note of result.notes||[]){for(const line of wrap(note,font,7.5,width)){if(y<52)newPage(false);page.drawText(line,{x:left,y,size:7.5,font,color:muted});y-=10;}}
  doc.getPages().forEach((p,i)=>p.drawText(`${i+1} / ${pages}`,{x:pageWidth-50,y:24,size:7,font,color:muted}));
  return {bytes:await doc.save(),pages};
 }
 async function xlsx(data,result,lib=globalThis.ExcelJS){
  const table=view(result);if(!table.rows.length)throw new Error('There are no selected results to export.');
  const wb=new lib.Workbook();wb.creator='D&C Project Tracker';
  const sheet=wb.addWorksheet('Results',{views:[{state:'frozen',ySplit:6}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
  const cols=table.columns.flatMap(c=>table.grouped&&c.key.startsWith('aggregate_')&&table.rows.some(row=>coverage(row,c))?[c,{key:c.key+'_recorded',label:c.label+' - recorded count',type:'number',coverageKey:c.key}]:[c]);
  sheet.columns=cols.map(c=>({width:c.type==='text'?(/update|scope/.test(c.key)?70:c.key==='name'?55:28):c.type==='date'?17:23}));
  sheet.getCell('A1').value=result.title||'D&C project results';sheet.getCell('A1').font={name:'Arial',size:16,bold:true,color:{argb:'FF07364B'}};
  sheet.getCell('A2').value=C.describePlan(result.plan).join(' | ');sheet.getCell('A3').value=`Source: ${data.meta.source_file}; latest reporting period ${data.meta.latest_reporting_period}.`;
  sheet.getCell('A4').value=(result.notes||['Blank cells mean not recorded.']).join(' ');
  const safe=v=>typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?"'"+v:v;
  const valuesFor=(r,columns)=>columns.map(c=>c.coverageKey?r.recordedCounts?.[c.coverageKey]??null:c.type==='date'&&C.dateValue(r[c.key])!==null?new Date(r[c.key]+'T00:00:00Z'):safe(r[c.key]??null));
  const styleRow=(ws,i,columns,row={},isHeader=false)=>{const values=ws.getRow(i).values;ws.getRow(i).height=isHeader?32:Math.max(32,...columns.map((c,j)=>typeof values[j+1]==='string'?Math.ceil(values[j+1].length/(ws.columns[j].width-2))*15+8:32));columns.forEach((c,j)=>{const cell=ws.getCell(i,j+1);cell.font={name:'Arial',size:11,bold:isHeader||!!row.isTotal,color:{argb:isHeader?'FFFFFFFF':'FF173345'}};if(isHeader||row.isTotal)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:isHeader?'FF07364B':'FFDCEFEF'}};cell.alignment={vertical:'middle',wrapText:true,horizontal:centered(c,isHeader)?'center':['currency','number','percent'].includes(c.type)?'right':'left'};if(!isHeader)cell.numFmt=c.type==='currency'?'"$"#,##0;[Red]("$"#,##0);"$"0':c.type==='percent'?'0.0%':c.type==='date'?'yyyy-mm-dd':c.type==='number'?'#,##0.##':'General';});};
  if(table.hierarchical){
   sheet.getCell('A5').value=layoutNote;
   for(let i=1;i<=5;i++){if(cols.length>1)sheet.mergeCells(i,1,i,cols.length);sheet.getCell(i,1).alignment={wrapText:true,vertical:'middle'};sheet.getRow(i).height=i===1?38:30;}
   sheet.getRow(6).values=cols.map(c=>c.label);styleRow(sheet,6,cols,{},true);
   let rowNumber=7,stripe=0;
   for(const entry of table.entries){
    if(entry.kind!=='row'){const unit=entry.kind==='unit';sheet.mergeCells(rowNumber,1,rowNumber,cols.length);const cell=sheet.getCell(rowNumber,1);cell.value=safe(entry.label)+' — '+entry.count+' project'+(entry.count===1?'':'s');cell.font={name:'Arial',bold:true,size:unit?12:11,color:{argb:unit?'FFFFFFFF':'FF07364B'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:unit?'FF2D6178':'FFE3F0F4'}};cell.alignment={vertical:'middle',wrapText:true,indent:unit?0:1};sheet.getRow(rowNumber).height=30;}
    else{sheet.getRow(rowNumber).values=valuesFor(entry.row,cols);styleRow(sheet,rowNumber,cols,entry.row);if(!entry.row.isTotal&&stripe++%2===0)for(let j=1;j<=cols.length;j++)sheet.getCell(rowNumber,j).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F6F8'}};}
    rowNumber++;
   }
   // A separate real Excel table keeps filters and numeric values useful without group-heading rows.
   const raw=wb.addWorksheet('Source records',{views:[{state:'frozen',ySplit:1,xSplit:2}]});
   const rawCols=Array.isArray(result.plan?.columns)&&result.plan.columns.length? [...cols,...[{key:'business_unit',label:'Business unit',type:'text'},{key:'venue',label:'Venue',type:'text'}].filter(c=>!cols.some(x=>x.key===c.key))] : [...identity,{key:'business_unit',label:'Business unit',type:'text'},{key:'venue',label:'Venue',type:'text'},...cols.filter(c=>!identity.some(i=>i.key===c.key))];
   raw.columns=rawCols.map(c=>({width:c.key==='name'?55:c.type==='text'?28:23}));
   const records=table.entries.filter(e=>e.kind==='row'&&!e.row.isTotal).map(e=>e.row);
   if(records.length)raw.addTable({name:'QueryResults',ref:'A1',headerRow:true,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:rawCols.map(c=>({name:c.label,filterButton:true})),rows:records.map(r=>valuesFor(r,rawCols))});
   styleRow(raw,1,rawCols,{},true);records.forEach((r,i)=>styleRow(raw,i+2,rawCols,r));
  }else{
   sheet.getCell('A5').value=table.layoutNote||'';
   for(let i=1;i<=5;i++){if(cols.length>1)sheet.mergeCells(i,1,i,cols.length);sheet.getCell(i,1).alignment={wrapText:true,vertical:'middle'};sheet.getRow(i).height=i===1?38:30;}
   const values=table.rows.map(r=>valuesFor(r,cols));
   sheet.addTable({name:'QueryResults',ref:'A6',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:cols.map(c=>({name:c.label,filterButton:true})),rows:values.filter((_,i)=>!table.rows[i].isTotal)});
   table.rows.forEach((r,i)=>{if(r.isTotal)sheet.getRow(7+i).values=values[i];});
   for(let i=6;i<=6+values.length;i++)styleRow(sheet,i,cols,table.rows[i-7],i===6);
  }
  // Narrative answers remain available alongside their data in Excel as well.
  if(result.analysis?.length){const report=wb.addWorksheet('Written summary');report.columns=[{width:115},{width:30}];report.addRow(['Summary','Source projects']);for(const s of result.analysis){const row=report.addRow([safe(s.text),s.project_ids.map(id=>'#'+id).join(', ')]);row.alignment={wrapText:true,vertical:'top'};row.height=Math.max(40,Math.ceil(s.text.length/105)*16);}report.getRow(1).font={bold:true};}
  sheet.pageSetup.printTitlesRow='6:6';return new Uint8Array(await wb.xlsx.writeBuffer());
 }
 const loading={};
 function library(name,path){if(globalThis[name])return Promise.resolve(globalThis[name]);return loading[name]||=(new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=path;script.onload=()=>resolve(globalThis[name]);script.onerror=()=>{delete loading[name];reject(new Error('The download component did not load. Refresh and try again.'));};document.head.append(script);}));}
 async function download(type,data,result){const output=type==='pdf'?await pdf(data,result,await library('PDFLib','/api/ask/assets/vendor/pdf-lib.min.js')):await xlsx(data,result,await library('ExcelJS','/api/ask/assets/vendor/exceljs.min.js'));const bytes=type==='pdf'?output.bytes:output;const blob=new Blob([bytes],{type:type==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(result.title||'DNC Project Results').replace(/[^a-zA-Z0-9 -]/g,'').trim().replace(/\s+/g,'_').slice(0,80)+'.'+type;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return {pages:output.pages};}
 globalThis.DNCTableExports={view,hierarchy,isFlat,format,cell,coverage,pdf,xlsx,download};
})();
