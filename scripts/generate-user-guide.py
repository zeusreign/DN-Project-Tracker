from pathlib import Path
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,KeepTogether
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
# Embed fonts so the guide has consistent spacing in browser PDF viewers.
pdfmetrics.registerFont(TTFont('DNC', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DNC-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
pdfmetrics.registerFontFamily('DNC',normal='DNC',bold='DNC-Bold',italic='DNC',boldItalic='DNC-Bold')
root=Path(__file__).resolve().parents[1]
out=root/'assets/DN_DC_Project_Tracker_User_Guide.pdf'
styles=getSampleStyleSheet()
navy=colors.HexColor('#063450');teal=colors.HexColor('#00859a');muted=colors.HexColor('#526875')
styles.add(ParagraphStyle(name='TitleDNC',fontName='DNC-Bold',fontSize=25,leading=29,textColor=navy,spaceAfter=15))
styles.add(ParagraphStyle(name='SubDNC',fontName='DNC',fontSize=12,leading=18,textColor=muted,spaceAfter=16))
styles.add(ParagraphStyle(name='H2DNC',fontName='DNC-Bold',fontSize=15,leading=20,textColor=navy,spaceBefore=13,spaceAfter=8))
styles.add(ParagraphStyle(name='BodyDNC',fontName='DNC',fontSize=9.5,leading=13.2,spaceAfter=6,textColor=colors.HexColor('#243944')))
styles.add(ParagraphStyle(name='CellDNC',parent=styles['BodyDNC'],fontSize=9.5,leading=13,spaceAfter=0))
styles.add(ParagraphStyle(name='HeadDNC',parent=styles['CellDNC'],fontName='DNC-Bold',textColor=colors.white))
styles.add(ParagraphStyle(name='NoteDNC',parent=styles['BodyDNC'],fontSize=9.5,leading=14,backColor=colors.HexColor('#eaf4f7'),borderPadding=8,spaceBefore=8,spaceAfter=10))
story=[]
def p(s):story.append(Paragraph(s,styles['BodyDNC']))
def h(s):story.append(Paragraph(s,styles['H2DNC']))
def note(s):story.append(Paragraph(s,styles['NoteDNC']))
def title(n,s,sub):
 if story:story.append(PageBreak())
 story.append(Paragraph(n,styles['SubDNC']));story.append(Paragraph(s,styles['TitleDNC']));story.append(Paragraph(sub,styles['SubDNC']))
def table(headers,rows,widths):
 cells=[[Paragraph(x,styles['HeadDNC']) for x in headers]]+[[Paragraph(str(x),styles['CellDNC']) for x in row] for row in rows]
 t=Table(cells,colWidths=widths,repeatRows=1,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f0f5f7')]),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#d9e5e9'))]));story.append(t);story.append(Spacer(1,8))

title('USER GUIDE / 2 NOVEMBER 2026','D&C Project Tracker','Workbook colors, reporting history and Archive')
p('Use this guide with the updated Classic / Enhanced Tracker. Your access remains governed by your assigned role and business-unit permissions. Availability on the live site depends on installation of this release.')
h('A two-minute start')
for s in ['<b>1.</b> Open the Tracker link supplied by your Administrator and sign in with your own assigned account. Replace a temporary password when prompted.','<b>2.</b> Choose a Business Unit, then Projects or Development Pipeline. Use search and filters to find a familiar record.','<b>3.</b> Use List for the register, or switch to Enhanced for Record and Cards. The lower spreadsheet icon opens Workbook view; Portfolio keeps its shortcut at the top.','<b>4.</b> Click the blue <b>Info</b> control at the top right for a short explanation of the module you are viewing.']:p(s)
table(['Control','Purpose'],[['Info','Two or three short paragraphs about the current module. Close with Got it, the close button or Escape.'],['Spreadsheet icon','Workbook view: dated activity for a completed fortnight, alongside current financial and schedule values.'],['Download','Choose Excel, CSV or tab-delimited; then select a reporting period or a range.'],['Refresh','Reload records and reset business-unit selection, filters and sorting.'],['Profile / sign off','Your photo or initials opens settings. The door icon ends your session.']],[123,393])
note('For feedback, record the project identifier, selected reporting dates, action, expected result and actual result. Include a screenshot when useful, with passwords hidden.')

title('01 / NAVIGATION','Choose the right module','Business-unit selection follows you between the working modules.')
table(['Module','Use it for'],[['Portfolio','Current-work counts, approved capital and recorded risks by business unit.'],['Projects','Capital projects, current activity, costs and schedule; alternate column sets and Enhanced layouts.'],['Development Pipeline','Proposed work, scope, leads, estimates and promotion to capital projects.'],['Cost Control','Approved-capital inputs, forecast final costs and variances.'],['Risk Register','Current saved budget and schedule risk ratings.'],['Project Photos','Reference and progress images with descriptions, dates and other metadata.'],['Archive','Inactive projects retained for review and later restoration.'],['Admin','Administrator user management, access controls, audit history and backups.'],['Help','Quick reference and the downloadable training guide.']],[123,393])
h('Filters and layout')
p('Projects, Cost Control and Risk share search, status and risk filters. Development has its own search and status controls. Click the magnifying glass to activate search; results filter as you type. Enhanced offers List, Record and Cards plus a compact Workbook icon. Sorting changes only the view. Cost Control and Risk Register keep the column headings fixed while records scroll.')
p('Portfolio current-work counts include Active, On Hold and Closeout. Complete and Needs Status are not included in those current-work counts. Complete records remain in the active register until separately archived.')
note('Workbook reports use the selected business unit and project module. The list search, status and risk filters do not narrow the reporting population; the download dialog states this explicitly.')

title('02 / PROJECT RECORDS','Edit and review activity','Use an approved test record when practicing edits.')
table(['Action','Result'],[['Double-click a record row / Card','Rows open project or development details. Double-click a Card to open its Record view.'],['Click an editable field','Editors and Administrators can change permitted fields within their business-unit access.'],['Edit Activity Update inline','Save appears while editing. Click it or click outside the field to save a changed, nonblank narrative.'],['Open Activity / history','Double-click Activity Update to review history and edit. Save update is to the right of Complete project history, directly below the editor.']],[180,336])
h('Write a useful update')
p('Identify progress, the issue or decision, who owns the next action and its due date. Include the event date in the text if it differs from the reporting date. Verify the saved entry before retrying a failed save.')
h('Dates, comparisons and corrections')
p('New entries normally use the server date (UTC); imported entries retain their source reporting date. Workbook view groups entries by this saved date, not by a date mentioned inside the narrative.')
p('Enhanced supports corrections to an activity entry within ten days of its creation. The original text is retained in the revision audit. The original reporting date and author are preserved. Older entries are locked; post a clearly identified correction as a new update when needed.')
p('Double-click Activity to open the latest four updates: two side by side and the preceding pair directly below. Show more history expands a scrollable area with room for approximately three more paired rows, depending on screen height and note length. Scroll for older reports; all saved text remains accessible. Previous-week notes retain their source report label because their exact date is unknown. Compare Past Activities can select either narrative; it defaults to the latest report and its supplied previous-week note.')
note('Archived projects are read-only. Restore the project before editing its details, activity or photo records. Reading history does not post an update.')

title('03 / WORKBOOK VIEW','Review the last fortnight','A spreadsheet-style view for the project meeting.')
for s in ['<b>1.</b> Open Projects or Development, select a Business Unit and click the small spreadsheet icon. The Enhanced layout controls include the same shortcut.','<b>2.</b> Check the displayed period. The default is the latest completed two-week period, not simply the latest date with a saved note.','<b>3.</b> Choose a worksheet tab. Capital shows Project Name, CAPP #, PM, Project Update and Previous Week Update. Development uses its own scope, request, consultant and estimate columns.','<b>4.</b> Choose another completed period or another module using the controls above the workbook. Use Back to records when you want to edit.']:p(s)
h('How periods work')
p('The calendar follows consecutive 14-day periods anchored to the supplied report ending 23 October 2026. That report covers 10-23 October; the preceding period covers 26 September-9 October. A period is complete on the following UTC day. The next period ends 6 November. An Administrator or developer can configure a different anchor after the team agrees it.')
p('History includes matched notes from 28 August, 11 and 25 September, and 9 and 23 October. Previous Week Update preserves the selected workbook’s supplied previous note; its date is unknown. If absent, the preceding fortnight’s dated notes appear. Undated notes stay with their source report.')
note('<b>No activity recorded in this period</b> means no dated history entry exists in that window. It does not mean no work occurred. The Tracker does not silently carry an old narrative into a new period.')
h('Read the reporting basis')
p('Project membership, names, status, costs and schedule reflect the current saved register at generation. They are <b>not</b> reconstructed financial snapshots for a past period. Import review retains older rows without a confirmed current project match, excluded from project totals. Archived projects are excluded; Complete projects remain until separately archived.')

title('04 / DOWNLOADS','Choose the period to share','One workbook for one period, or a ZIP containing several period reports.')
for s in ['<b>1.</b> Click Download and choose Excel, CSV or tab-delimited. Workbook view also has a direct Download workbook button.','<b>2.</b> Confirm the Business Unit shown in the dialog and choose Capital projects, Development or All projects.','<b>3.</b> Select the reporting period. For several periods, select Download a range and choose the first and last periods. A range may contain up to 26 completed periods.','<b>4.</b> Click Download. Open the saved file and review it before sharing.']:p(s)
table(['Format','What you receive'],[['Excel (.xlsx)','Capital business-unit tabs and Design &amp; Development use the reference headings, subheadings and column widths. Report notes is the last tab and explains dates and reporting basis.'],['CSV / tab-delimited','One flat table. Period dates, generation time and reporting basis are repeated in each row so the file retains its context.'],['Range (.zip)','One file per selected fortnight in the chosen format. The filenames identify each period end date.']],[123,393])
h('Layout and values')
p('Capital has 19 columns and Development has 17, matching the team workbook. Venue and business-unit subheadings replace repeated columns. Project Update is ten characters wider than the reference; Previous Week Update has the same width. Project Name is ten characters narrower than the prior preview. Other columns are tightened. Excel freezes the first three columns and the header. Source colors and shading match in both views. PM, risk and variance columns are centered; section names stay with the frozen identity columns.')
p('CAPP and initiative identifiers remain text so leading zeros are preserved. Money is numeric in Excel. Variance is anticipated final cost minus approved budget; percent variance uses the approved budget as its denominator. Missing costs remain blank. Risk labels use green (Low), yellow (Medium) and red (High). A shaded Not Rated cell retains source shading without inferring a rating. Positive variance or delay is red; zero or negative is dark green.')
note('Reports exclude photo files and the audit trail. They use current project membership, even for past activity periods; they are not historical database backups.')

title('05 / ARCHIVE','Keep inactive work safely','Archive replaces project deletion and supports restoration.')
table(['Concept','Meaning'],[['Active register','Projects available in the normal modules and reports, including Complete until it is separately archived.'],['Progress status','Active, On Hold, Closeout, Complete or the applicable development status. This describes progress, independently of archival.'],['Archive (inactive)','A retained project removed from the active register. Its existing progress status, history and photo files are preserved.']],[135,381])
h('Archive a project')
p('Open project or development details. Editors and Administrators see <b>Archive project</b>. Read the confirmation and accept it to move that project out of the active register. Unsaved field edits are not part of an archive action; save or discard them first.')
h('Find or restore a project')
p('Open <b>Archive</b> in the sidebar. The Business Unit selection narrows the list. View history opens the retained dated notes, scope and current cost summary, plus links to stored photos. Authorized Editors and Administrators can choose <b>Restore</b>.')
p('Restoration returns the same record, identifiers, history and progress status to the active register. Restoring a Complete project leaves its progress status Complete; change that status separately if appropriate.')
note('No automatic project purge is introduced. Archive and Restore are audited. A Viewer can review archived records within permitted business units but cannot archive or restore them.')
h('If the record changed')
p('If another person archived or restored the record while you were reviewing it, refresh before trying again. Archived records cannot be edited until restored; this restriction is also enforced by the API.')

title('06 / DEVELOPMENT & PHOTOS','Keep context with the project','Development details, financial inputs, risk and photos stay connected.')
h('Development and promotion')
p('Use + Add project to create a Capital or Development record, then complete its details. For approved development work, use Promote and supply the business unit, CAPP ID, project manager and major-project heading. The same project identity and history are retained.')
h('Financial and schedule review')
p('Approved capital is calculated from A&E / Pre-Con, Construction and cumulative Add-CAPP inputs. Anticipated Final Cost is the total forecast, not just remaining invoices. Positive variance indicates a forecast above budget. Verify imported inputs before correcting a figure.')
p('Duration change is recalculated when the relevant turnover dates are changed. Existing imported duration values are not automatically backfilled by this release. Blank dates and costs are not zero values.')
h('Risk ratings')
p('Budget and schedule risks are separate: High, Medium, Low or Not Rated. Ratings reflect current saved assessments. Agree the team’s criteria and read the supporting narrative before relying on a rating.')
h('Project Photos')
p('Select an authorized project, then use Card, List or Collage. Editors can upload reference or progress images and save reporting date, date taken, photographer, area, category, description and notes. Save & Take Next keeps shared metadata for a photo series.')
p('Use JPG, PNG or WebP. Large supported images may be resized by the browser; HEIC is not supported. Photos and project changes require a network connection. Check iPad camera and library behavior on the actual device.')
note('Archive retains all project photo objects. Photo deletion is a separate existing operation; it is not performed when a project is archived. The report workbook contains activity and project fields, not embedded photo images.')

title('07 / ACCESS & TEAM TESTING','Review before rollout','Keep the current approved records and accounts as the data authority.')
table(['Role','Access'],[['Viewer','Read and download permitted project data, including retained Archive history.'],['Editor','Viewer capabilities plus project, activity and photo changes, Archive and Restore within assigned business units.'],['Administrator','Application administration, user access, audit and backup tools in addition to project editing.']],[123,393])
p('Business-unit restrictions are enforced by the server. The visible Business Unit filter narrows your authorized population; it does not grant extra access. Changing your own profile does not change your role or permissions.')
h('Account and session basics')
p('Your photo or initials opens Profile & settings. You may update your photo, title, location, mobile phone and password. An Administrator manages name, User ID, email and access. New or reset temporary passwords must be replaced before project data is available. Sign off when finished; inactive sessions expire.')
h('Team acceptance checks')
for s in ['<b>Info:</b> Navigate to each module; verify the explanation matches it and can be dismissed by keyboard.','<b>Workbook:</b> Compare two known projects against their dated history. Check boundary dates, multiple entries and a project with no notes in the period.','<b>Downloads:</b> Open a single Excel report and a two-period ZIP. Confirm the headings and subheadings match Workbook view, leading zeros remain, previous notes appear, and financial values match the current record.','<b>Archive:</b> On an approved test project, archive, inspect history/photos, restore and confirm the original status and records remain. Complete alone must not archive it.','<b>Access:</b> Test Viewer, Editor and restricted-business-unit accounts in both Classic and Enhanced. Verify another unit’s records cannot be reached directly.']:p(s)

title('08 / ASK THE TRACKER','Ask in your own words','Typed questions, voice, source records and reports in one workspace.')
p('Click Ask the Tracker at the top of the left navigation panel. The assistant reads your current authorized Tracker records for each AI question and follows your account’s record permissions. It is read-only: it cannot edit or delete project records. Archived projects are excluded. Use the environment link provided by your administrator; a review preview has its own copied data.')
h('Start with the result you need')
p('Try: “Show all projects with approved budget over $1 million OR anticipated final cost over $1 million. Include project, venue and both amounts.” Then ask: “Give me that exact table in a one-page PDF and Excel.” Open the displayed download controls to save the files. Very wide or long tables may require additional pages for readability.')
p('Specify approved budget when that is the field you mean. If you mean an original baseline that is not stored, the assistant should ask a clarification. Missing amounts are not zero. Inspect source records when an answer looks unexpected; a retrieval date does not make an older saved activity note current.')
h('Speak and continue the conversation')
p('Choose Voice, then Start conversation and allow your microphone in the browser. You may interrupt, mute or end the conversation. Quiet chat stops audio. Closing Ask the Tracker also ends the voice connection. Voice requires a supported browser, microphone permission and available API access; sessions have a 60-minute cap. After 20 minutes of silence the assistant checks whether you need more help; another five minutes without a reply ends voice. Saying goodbye or good night also ends the conversation.')
title('09 / CONVERSATIONS','History and follow-ups','Keep your context clear and your results traceable.')
p('Typed and voice questions use the same project query tools. Open History to select a saved conversation; old conversations do not resume automatically. Conversation start and message date/time appear in the transcript in your profile time zone, or your browser time zone if unset. Administrators can set a profile time zone. Export conversation keeps those timestamps in its text copy. Audio recordings are not stored by the Tracker. A change in your permitted project population may require reopening the assistant and starts a separate conversation scope.')
p('Ask to move PM first, remove an ID column, add a financial field, or sort by a value. Column-only changes keep the current projects. Sorting creates one ordered list. To remove an earlier risk restriction while retaining your financial threshold, say: Start from the beginning for all the projects. Clear all filters starts a fully unfiltered authorized selection.')
h('When a service is unavailable')
p('AI chat and voice use the API connection configured on the server. If that connection fails, the screen explains the problem and offers Guided search over the records already loaded. Guided mode supports fewer question patterns and does not save conversations. Close and reopen Ask the Tracker to retry. API usage or billing limits must be resolved in the API account.')
note('For team testing: compare a known query with the database, refine the same selection, open both PDF and Excel, and test microphone start, interruption and stop on your own device. Report the exact question, observed result and expected correction.')

def footer(c,doc):
 c.setStrokeColor(teal);c.setLineWidth(1);c.line(48,753,564,753)
 c.setFillColor(muted);c.setFont('DNC',8);c.drawString(48,764,'DELAWARE NORTH  /  DESIGN & CONSTRUCTION')
 c.drawString(48,29,'D&C Project Tracker  |  Workbook / Archive / Ask the Tracker  |  2 November 2026')
 c.drawRightString(564,29,str(doc.page))
SimpleDocTemplate(str(out),pagesize=letter,rightMargin=48,leftMargin=48,topMargin=55,bottomMargin=49,title='D&C Project Tracker - Training Guide',author='D&C Project Team').build(story,onFirstPage=footer,onLaterPages=footer)
(root/'assets/DN_DC_Project_Tracker_User_Guide.pdf').write_bytes(out.read_bytes())
print(out)
