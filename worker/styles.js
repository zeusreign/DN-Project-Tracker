import { ENHANCED_STYLES } from "./enhanced-styles.js";
export const STYLES = `
:root{--navy:#063450;--navy2:#03283d;--blue:#087db5;--cyan:#16a7c8;--teal:#008f78;--green:#73bf44;--gold:#f2b134;--red:#c9384b;--ink:#23313a;--muted:#647783;--line:#d9e3e7;--soft:#f5f8f9;--pale:#eaf5f8;--shadow:0 12px 32px rgba(4,42,61,.12)}
*{box-sizing:border-box}[hidden]{display:none!important}html{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:#e3eaed}body{margin:0;min-height:100vh}button,input,select,textarea{font:inherit}.app{width:100%;max-width:1920px;min-height:100vh;margin:0 auto;display:grid;grid-template-columns:224px minmax(0,1fr);background:#edf2f4;box-shadow:0 0 34px rgba(4,42,61,.12)}
.sidebar{position:sticky;top:0;height:100vh;background:linear-gradient(180deg,var(--navy2),#042f45 64%,#05283a);padding:18px 14px;display:flex;flex-direction:column;color:#fff;z-index:30}.brand{background:#fff;border-radius:11px;padding:8px 10px}.brand img{width:100%;height:46px;object-fit:contain}.brand-copy{text-align:center;font-size:calc(9.0px + var(--en-font-adjust,0pt));line-height:1.45;letter-spacing:.13em;font-weight:850;color:#bfe6ee;margin:10px 0 20px}.nav-label{font-size:calc(9.0px + var(--en-font-adjust,0pt));letter-spacing:.16em;text-transform:uppercase;color:#7ea2b3;margin:0 9px 7px}.nav{display:grid;gap:6px}.nav-btn{border:0;border-radius:10px;background:transparent;color:#c6d9e2;padding:10px 9px;display:flex;align-items:center;gap:9px;text-align:left;font-size:calc(14.0px + var(--en-font-adjust,0pt));line-height:1.2}.nav-btn:hover{background:rgba(255,255,255,.08);color:#fff}.nav-btn.active{background:linear-gradient(90deg,#0b769f,#0e88a8);box-shadow:0 7px 18px rgba(0,0,0,.18);color:#fff}.nav-btn.principal{font-size:calc(15.0px + var(--en-font-adjust,0pt));color:#fff}.nav-icon{width:28px;height:28px;border:1px solid rgba(255,255,255,.2);border-radius:8px;display:grid;place-items:center;font-size:calc(9.0px + var(--en-font-adjust,0pt));font-weight:900;flex:0 0 auto}.nav-btn.active .nav-icon{background:rgba(255,255,255,.16)}.guide-nav{margin-top:5px;border:1px solid rgba(37,169,214,.38);background:rgba(37,169,214,.07)}
main{min-width:0}.topbar{min-height:76px;position:sticky;top:0;z-index:20;background:rgba(255,255,255,.96);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:10px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px}.kicker{color:var(--blue);font-size:calc(9.0px + var(--en-font-adjust,0pt));font-weight:850;text-transform:uppercase;letter-spacing:.13em}.heading h1{font-size:calc(21.0px + var(--en-font-adjust,0pt));margin:3px 0 0;color:var(--navy)}.heading p{font-size:calc(11.0px + var(--en-font-adjust,0pt));color:var(--muted);margin:4px 0 0}.top-actions,.toolbar,.row-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.user-chip{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--pale);border-radius:999px;padding:7px 10px;font-size:calc(10.0px + var(--en-font-adjust,0pt));font-weight:750;color:#17627e}.btn{border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:8px 10px;font-size:calc(11.0px + var(--en-font-adjust,0pt));font-weight:750;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:5px}.btn:hover{border-color:#8ea9b6}.btn.primary{background:var(--navy);border-color:var(--navy);color:#fff}.btn.small{font-size:calc(9.0px + var(--en-font-adjust,0pt));padding:4px 6px}.content{padding:18px 18px 46px;margin:0}.pane[hidden]{display:none!important}.card{background:#fff;border:1px solid var(--line);border-radius:13px;box-shadow:0 1px 0 rgba(255,255,255,.8)}.view-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}.view-head h2{font-size:calc(18.0px + var(--en-font-adjust,0pt));margin:0 0 4px;color:var(--navy)}.view-head p{font-size:calc(12.0px + var(--en-font-adjust,0pt));color:var(--muted);line-height:1.45;margin:0;max-width:980px}.count-note{font-size:calc(10.0px + var(--en-font-adjust,0pt));color:var(--muted)}
.unit-switcher{margin-bottom:13px;padding:11px 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-left:6px solid var(--cyan);box-shadow:0 6px 20px rgba(5,72,99,.07)}.unit-switcher-label{min-width:155px}.unit-switcher-label strong{display:block;color:var(--navy);font-size:calc(13.0px + var(--en-font-adjust,0pt))}.unit-switcher-label span{display:block;color:var(--blue);font-size:calc(9.0px + var(--en-font-adjust,0pt));font-weight:850;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}.unit-buttons{display:flex;gap:5px;overflow:auto;padding:2px}.unit-btn{white-space:nowrap;border:1px solid #bdd1da;background:#fff;color:#3c5c6a;border-radius:999px;padding:7px 10px;font-size:calc(10.0px + var(--en-font-adjust,0pt));font-weight:800}.unit-btn:hover,.unit-btn.active{color:#fff;background:linear-gradient(90deg,var(--navy),var(--blue));border-color:var(--navy);box-shadow:0 4px 12px rgba(5,70,97,.16)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.compact-kpis{margin-bottom:11px}.kpi{--accent:var(--blue);padding:14px;overflow:hidden;position:relative;isolation:isolate}.kpi:after{content:"";position:absolute;right:12px;top:12px;width:54px;height:54px;border-radius:50%;border:9px solid var(--accent);background:transparent;opacity:.08;z-index:0}.kpi>*{position:relative;z-index:1}.kpi[data-kpi]{cursor:pointer;transition:transform .16s,box-shadow .16s,border-color .16s}.kpi[data-kpi]:hover,.kpi[data-kpi]:focus-visible{transform:translateY(-2px);box-shadow:0 10px 24px rgba(4,42,61,.12);border-color:#a7c2cd;outline:none}.kpi.dragging{opacity:.48;transform:scale(.98);cursor:grabbing}.kpi-handle{position:absolute;right:10px;bottom:8px;color:#9ab0ba;font-size:calc(11.0px + var(--en-font-adjust,0pt));letter-spacing:-2px;cursor:grab}.kpi-label{font-size:calc(9.0px + var(--en-font-adjust,0pt));color:var(--muted);letter-spacing:.1em;text-transform:uppercase;font-weight:850;max-width:78%}.kpi-value{font-size:calc(26.0px + var(--en-font-adjust,0pt));font-weight:880;color:var(--navy);margin:7px 0 2px;white-space:nowrap}.kpi small{color:var(--muted);font-size:calc(10.0px + var(--en-font-adjust,0pt))}.kpi-blue{--accent:var(--blue);border-top:4px solid var(--blue)}.kpi-teal{--accent:var(--teal);border-top:4px solid var(--teal)}.kpi-red{--accent:var(--red);border-top:4px solid var(--red)}.kpi-red .kpi-value{color:var(--red)}.kpi-gold{--accent:var(--gold);border-top:4px solid var(--gold)}.dashboard-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(300px,.92fr);gap:11px;margin-top:11px}.panel{padding:14px}.section-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px}.section-head h3{font-size:calc(13.0px + var(--en-font-adjust,0pt));margin:0;color:var(--navy)}.section-head span{font-size:calc(10.0px + var(--en-font-adjust,0pt));color:var(--muted)}.status-callout{margin-bottom:10px;border:1px solid #f1d18a;border-left:5px solid var(--gold);background:#fff9ea;border-radius:10px;padding:9px 12px;color:#785515;font-size:calc(11.0px + var(--en-font-adjust,0pt))}.status-callout strong{margin-right:4px}.unit-row{width:100%;display:grid;grid-template-columns:115px 1fr 34px;gap:8px;align-items:center;padding:7px 2px;font-size:calc(10.0px + var(--en-font-adjust,0pt))}.unit-row-button{border:0;background:transparent;color:var(--navy);font-weight:800;text-align:left}.unit-row-button:hover{background:#f7fbfc}.track{height:9px;background:#e5eef2;border-radius:9px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#0a6eaa,var(--cyan));border-radius:9px}.attention-panel{border-top:4px solid var(--red)}.attention{padding:9px 0;border-bottom:1px solid #edf1f3;display:flex;justify-content:space-between;gap:10px}.attention:last-child{border:0}.attention-copy strong{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.attention-copy small{display:block;color:var(--muted);margin-top:3px;font-size:calc(10.0px + var(--en-font-adjust,0pt))}.risk-flags{display:flex;gap:5px;margin-top:6px}.risk-flag{display:inline-flex;border-radius:999px;padding:3px 7px;color:#fff;font-size:calc(8.0px + var(--en-font-adjust,0pt));font-weight:900;letter-spacing:.03em}.risk-flag.budget{background:var(--red)}.risk-flag.schedule{background:#df6a2e}.portfolio-donut-block{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}.donut-layout{display:grid;grid-template-columns:minmax(155px,210px) minmax(0,1fr);align-items:center;gap:14px}.donut{width:min(100%,190px);display:block;margin:auto}.donut-segment{cursor:pointer;transition:opacity .16s,stroke-width .16s}.donut-segment:hover,.donut-segment:focus{opacity:.8;stroke-width:28;outline:none}.donut-total{font-size:calc(23.0px + var(--en-font-adjust,0pt));font-weight:900;fill:var(--navy)}.donut-label{font-size:calc(7.0px + var(--en-font-adjust,0pt));letter-spacing:.1em;font-weight:850;fill:var(--muted)}.donut-legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.donut-legend button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:7px;display:grid;grid-template-columns:10px 1fr auto;gap:6px;align-items:center;text-align:left;color:var(--ink)}.donut-legend button:hover{background:var(--soft);border-color:#9eb6c1}.donut-legend span{width:10px;height:10px;border-radius:3px}.donut-legend strong{font-size:calc(9.0px + var(--en-font-adjust,0pt))}.donut-legend em{font-style:normal;color:var(--navy);font-weight:900;font-size:calc(11.0px + var(--en-font-adjust,0pt))}
.workspace{overflow:visible}.space-top{margin-top:10px}.workspace-bar{padding:11px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px;align-items:center}.search{position:relative}.search input{width:260px;padding:8px 9px 8px 30px;border:1px solid var(--line);border-radius:8px;outline:none;background:#fafcfd;font-size:calc(11.0px + var(--en-font-adjust,0pt))}.search:before{content:"⌕";position:absolute;left:9px;top:1px;font-size:calc(20.0px + var(--en-font-adjust,0pt));color:#6d7f89}.toolbar select,.field input,.field select,.field textarea,.admin-toolbar select{border:1px solid var(--line);border-radius:8px;background:#fff;padding:8px 8px;outline:none;color:var(--ink);font-size:calc(11.0px + var(--en-font-adjust,0pt))}.toolbar select{max-width:150px}.search input:focus,.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(8,125,181,.12)}.menu-wrap{position:relative}.column-menu{position:absolute;right:0;top:40px;width:210px;z-index:30;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:7px}.column-menu[hidden]{display:none}.preset{width:100%;border:0;background:#fff;border-radius:7px;padding:9px;text-align:left;font-size:calc(11.0px + var(--en-font-adjust,0pt))}.preset:hover,.preset.active{background:var(--pale);color:var(--navy);font-weight:800}.formula-note{padding:8px 11px;background:#f7fafb;border-bottom:1px solid var(--line);font-size:calc(10.0px + var(--en-font-adjust,0pt));color:var(--muted)}
.table-wrap{overflow:auto;max-height:none;overscroll-behavior:auto}table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:0}th{position:sticky;top:0;z-index:4;background:#f7f9fa;border-bottom:1px solid var(--line);padding:0;text-align:left}th button,th>span{width:100%;border:0;background:transparent;color:#60717b;padding:8px 5px;text-align:left;font-size:calc(9.0px + var(--en-font-adjust,0pt));text-transform:uppercase;letter-spacing:.035em;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}th>span{display:block}.sort-mark{color:#aab6bc;margin-left:1px}.sort-mark.active{color:var(--blue)}td{border-bottom:1px solid #e8eef1;padding:8px 5px;font-size:calc(10.5px + var(--en-font-adjust,0pt));vertical-align:top;background:#fff;overflow-wrap:anywhere}.project-row:hover td{background:#fbfdfd}.section-row td{position:sticky;top:30px;z-index:3;background:#e5f1f5;color:var(--navy);font-size:calc(10.0px + var(--en-font-adjust,0pt));font-weight:900;text-transform:uppercase;letter-spacing:.06em;padding:7px 8px;border-top:1px solid #c3dce5}.section-row small{color:#6c808a;font-weight:650;text-transform:none;letter-spacing:0;margin-left:7px}.project-link{border:0;background:none;padding:0;text-align:left;color:var(--navy);font-size:calc(10.5px + var(--en-font-adjust,0pt));font-weight:850}.project-link:hover{text-decoration:underline}.sub{display:block;color:var(--muted);font-size:calc(8.5px + var(--en-font-adjust,0pt));margin-top:3px}.money{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}.bad{color:var(--red);font-weight:850}.good{color:var(--teal);font-weight:850}.status-text{font-weight:750}.risk-pill{display:inline-block;border-radius:999px;padding:4px 6px;font-size:calc(8.5px + var(--en-font-adjust,0pt));font-weight:850;white-space:nowrap}.risk-high{background:#fde7eb!important;color:#a72e3b!important}.risk-medium{background:#fff0d2!important;color:#955700!important}.risk-low{background:#e3f5ed!important;color:#156e5c!important}.risk-not-rated{background:#edf1f3!important;color:#65767f!important}.inline-select{width:100%;border:1px solid transparent;background:transparent;border-radius:7px;padding:4px 2px;font-size:calc(9.5px + var(--en-font-adjust,0pt));max-width:100%}.inline-select:hover{border-color:var(--line);background:#fff!important}.activity-date{color:var(--blue);font-size:calc(9.0px + var(--en-font-adjust,0pt));font-weight:850;margin-bottom:4px}.activity-inline{min-width:0;width:100%;max-height:104px;overflow:auto;line-height:1.42;color:#40505a;border:1px solid transparent;border-radius:7px;padding:3px 4px;margin:-3px -4px;white-space:pre-line}.activity-inline:hover{background:#fff;border-color:#cbdbe2}.activity-inline:focus{max-height:210px;outline:0;border-color:var(--blue);box-shadow:0 0 0 3px rgba(8,125,181,.1);background:#fff}.activity-hint{font-size:calc(8.0px + var(--en-font-adjust,0pt));color:#91a0a8;margin-top:4px}.mini-input{width:100%;border:1px solid transparent;background:transparent;text-align:right;border-radius:6px;padding:4px 2px;font-size:calc(9.5px + var(--en-font-adjust,0pt))}.mini-input:hover,.mini-input:focus{border-color:var(--line);background:#fff;outline:0}.currency-input{width:100%;font-variant-numeric:tabular-nums}.more-btn{border:1px solid var(--line);background:#fff;border-radius:7px;padding:5px 7px;font-weight:900;color:var(--navy)}.more-btn:hover{border-color:var(--blue);color:var(--blue)}
.project-table .col-name{width:12%}.project-table .col-capp{width:5%}.project-table .col-lead{width:8%}.project-table .col-status{width:7%}.project-table .col-budget_risk,.project-table .col-schedule_risk{width:7%}.project-table .col-activity{width:50%}.project-table .col-actions{width:4%}.project-table .col-original_start_date,.project-table .col-current_start_date,.project-table .col-original_turnover_date,.project-table .col-current_turnover_date{width:8%}.project-table .col-duration_change_days{width:4%}.project-table .col-precon_capp{width:10%}.project-table .col-construction_capp{width:10%}.project-table .col-add_capp{width:9%}.project-table .col-approved_budget{width:10%}.project-table .col-anticipated_final_cost{width:10%}.project-table .col-forecast_variance{width:9%}.project-table .col-variance_pct{width:7%}.development-table .dev-name{width:10%}.development-table .dev-initiative_number{width:5%}.development-table .dev-development_lead{width:7%}.development-table .dev-status{width:6%}.development-table .dev-development_requestor{width:7%}.development-table .dev-development_deliverable_due_date{width:6%}.development-table .dev-development_original_estimate,.development-table .dev-development_current_estimate{width:7%}.development-table .dev-current_update{width:39%}.development-table .col-actions{width:6%}.dev-update{min-width:0}.dev-update .activity-inline{max-height:88px}.dev-actions{text-align:center}.promote-btn{margin-top:5px;border:0;background:var(--teal);color:#fff;border-radius:7px;padding:5px 6px;font-size:calc(8.0px + var(--en-font-adjust,0pt));font-weight:850}.development-table th.dev-initiative_number button,.development-table th.dev-status button,.development-table th.dev-development_deliverable_due_date button{text-align:center}.development-table th.dev-development_original_estimate button,.development-table th.dev-development_current_estimate button{text-align:right;padding-right:12px}.development-table td.dev-initiative,.development-table td.dev-date,.development-table td.col-status{text-align:center}.development-table td.money{padding-right:12px}.cost-table .col-name{width:180px}.cost-table .col-precon_capp{width:92px}.cost-table .col-construction_capp{width:98px}.cost-table .col-add_capp{width:88px}.cost-table .col-approved_budget{width:104px}.cost-table .col-anticipated_final_cost{width:102px}.cost-table .col-forecast_variance{width:88px}.cost-table .col-variance_pct{width:60px}.cost-table .col-actions{width:42px}.cost-table th:not(.col-name):not(.col-actions) button{text-align:right;padding-right:12px}.cost-table td.money{padding-right:12px}.cost-table th.col-actions span,.cost-table td.col-actions{text-align:center}.risk-table .col-name{width:155px}.risk-table .col-budget_risk,.risk-table .col-schedule_risk{width:72px}.risk-table .col-approved_budget{width:94px}.risk-table .col-anticipated_final_cost{width:98px}.risk-table .col-forecast_variance{width:86px}.risk-table .col-variance_pct{width:58px}.risk-table .col-original_turnover_date,.risk-table .col-current_turnover_date{width:88px}.risk-table .col-duration_change_days{width:45px}.risk-table .col-actions{width:42px}.risk-table th.col-budget_risk button,.risk-table th.col-schedule_risk button,.risk-table th.col-original_turnover_date button,.risk-table th.col-current_turnover_date button,.risk-table th.col-duration_change_days button{text-align:center}.risk-table th.col-approved_budget button,.risk-table th.col-anticipated_final_cost button,.risk-table th.col-forecast_variance button,.risk-table th.col-variance_pct button{text-align:right;padding-right:12px}.risk-table td.col-budget_risk,.risk-table td.col-schedule_risk,.risk-table td.col-original_turnover_date,.risk-table td.col-current_turnover_date,.risk-table td.col-duration_change_days,.risk-table td.col-actions{text-align:center}.risk-table td.money{padding-right:12px}.risk-table th.col-actions span{text-align:center}
.risk-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:11px}.risk-stat{padding:14px;border-top:4px solid #9eabb2}.risk-stat.high{border-color:var(--red)}.risk-stat.medium{border-color:var(--gold)}.risk-stat.low{border-color:var(--teal)}.risk-stat strong{font-size:calc(25.0px + var(--en-font-adjust,0pt));display:block;color:var(--navy)}.risk-stat.high strong{color:var(--red)}.risk-stat span{font-size:calc(10.0px + var(--en-font-adjust,0pt));color:var(--muted)}.high-list{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:12px}.high-card{padding:12px;border-left:4px solid var(--red)}.high-card strong{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.high-card p{font-size:calc(10.0px + var(--en-font-adjust,0pt));color:var(--muted);line-height:1.4;margin:5px 0 0}
.security-callout{margin-bottom:12px;padding:13px 15px;background:#eef8fb;border:1px solid #c8e5ee;border-left:5px solid var(--blue);border-radius:10px;font-size:calc(11.0px + var(--en-font-adjust,0pt));line-height:1.5;color:#39525f}.security-callout strong{display:block;color:var(--navy);margin-bottom:3px}.admin-grid{display:grid;grid-template-columns:1fr;gap:12px}.directory-panel{min-width:0}.admin-toolbar{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:11px}.admin-toolbar .search{flex:1;min-width:230px}.admin-toolbar .search input{width:100%}.admin-table-wrap{overflow:auto}.admin-table{min-width:0;table-layout:fixed}.admin-table th{position:static;padding:7px 4px;color:#60717b;font-size:calc(8.0px + var(--en-font-adjust,0pt));text-transform:uppercase;letter-spacing:.02em}.admin-table td{font-size:calc(9.0px + var(--en-font-adjust,0pt));padding:7px 4px;overflow-wrap:anywhere}.admin-table strong{font-size:calc(9.0px + var(--en-font-adjust,0pt))}.admin-table small{display:block;color:var(--muted);font-size:calc(7.5px + var(--en-font-adjust,0pt));margin-top:3px}.admin-table th:nth-child(1){width:16%}.admin-table th:nth-child(2){width:25%}.admin-table th:nth-child(3){width:9%}.admin-table th:nth-child(4){width:10%}.admin-table th:nth-child(5){width:12%}.admin-table th:nth-child(6){width:8%}.admin-table th:nth-child(7){width:11%}.admin-table th:nth-child(8){width:48px}.admin-table .btn.small{font-size:calc(8.0px + var(--en-font-adjust,0pt));padding:4px 5px}.role-badge,.access-badge{display:inline-flex;border-radius:999px;padding:4px 6px;font-size:calc(7.5px + var(--en-font-adjust,0pt));font-weight:850;text-transform:uppercase;letter-spacing:.03em}.role-admin{background:#e8ecfa;color:#344f9e}.role-editor{background:#e3f5ed;color:#12634f}.role-viewer{background:#edf1f3;color:#596b74}.access-badge{background:#f6efd9;color:#75580e}.pagination{display:flex;justify-content:flex-end;gap:4px;margin-top:11px;flex-wrap:wrap}.pagination button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:5px 7px;font-size:calc(9.0px + var(--en-font-adjust,0pt))}.pagination button.active{background:var(--navy);color:#fff}.audit-list{display:grid;gap:7px;max-height:310px;overflow:auto}.audit-row{padding:9px;border:1px solid #e7edef;border-radius:8px;font-size:calc(10.0px + var(--en-font-adjust,0pt))}.audit-row strong{font-size:calc(10.0px + var(--en-font-adjust,0pt));text-transform:capitalize}.audit-row span{display:block;color:var(--muted);margin-top:3px;line-height:1.45}
.guide-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:11px}.guide-card{padding:15px}.guide-card h3{margin:0 0 6px;font-size:calc(13.0px + var(--en-font-adjust,0pt));color:var(--navy)}.guide-card p,.guide-card li{font-size:calc(11.0px + var(--en-font-adjust,0pt));line-height:1.5;color:#53636d}.guide-card ul{padding-left:17px}.pdf-guide-btn{position:relative;background:linear-gradient(90deg,var(--teal),#0aab8f);border-color:var(--teal);color:#fff;box-shadow:0 6px 16px rgba(0,143,120,.18)}.pdf-guide-btn:hover{border-color:#006e5c;box-shadow:0 8px 20px rgba(0,143,120,.25)}.pdf-guide-btn:after{content:attr(data-tooltip);position:absolute;right:0;top:calc(100% + 7px);z-index:40;background:var(--navy2);color:#fff;border-radius:6px;padding:6px 8px;font-size:calc(8.0px + var(--en-font-adjust,0pt));white-space:nowrap;opacity:0;transform:translateY(-3px);pointer-events:none;transition:.15s}.pdf-guide-btn:hover:after,.pdf-guide-btn:focus-visible:after{opacity:1;transform:none}.loading{padding:70px 25px;text-align:center;color:var(--muted)}.spinner{width:28px;height:28px;border:3px solid #dbe7eb;border-top-color:var(--blue);border-radius:50%;margin:0 auto 10px;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.auth-overlay{position:fixed;inset:0;z-index:100;background:radial-gradient(circle at 16% 18%,rgba(22,167,200,.2),transparent 34%),linear-gradient(145deg,#03283d 0%,#063e5d 58%,#075875 100%);display:grid;place-items:center;padding:24px}.auth-overlay[hidden]{display:none}.auth-card{width:min(470px,100%);background:#fff;border-radius:20px;box-shadow:0 34px 90px rgba(0,0,0,.35);padding:30px}.auth-brand{display:flex;align-items:center;gap:16px;padding-bottom:20px;border-bottom:1px solid var(--line)}.auth-brand img{width:172px;height:56px;object-fit:contain;object-position:left center}.auth-brand div{border-left:1px solid var(--line);padding-left:15px}.auth-brand span,.auth-brand strong{display:block;text-transform:uppercase}.auth-brand span{font-size:calc(9.0px + var(--en-font-adjust,0pt));letter-spacing:.12em;color:var(--blue);font-weight:850}.auth-brand strong{font-size:calc(12.0px + var(--en-font-adjust,0pt));line-height:1.25;color:var(--navy);margin-top:3px}.auth-copy{margin:24px 0 18px}.auth-kicker{font-size:calc(10.0px + var(--en-font-adjust,0pt));color:var(--blue);font-weight:850;letter-spacing:.08em;text-transform:uppercase}.auth-copy h2{font-size:calc(28.0px + var(--en-font-adjust,0pt));color:var(--navy);margin:6px 0}.auth-copy p{font-size:calc(13.0px + var(--en-font-adjust,0pt));color:var(--muted);line-height:1.45;margin:0}.login-form{display:grid;gap:14px}.login-form>label{display:grid;gap:6px;font-size:calc(10.0px + var(--en-font-adjust,0pt));text-transform:uppercase;letter-spacing:.06em;color:#526773;font-weight:850}.login-form input{width:100%;border:1px solid #bfcfd6;border-radius:9px;padding:12px;font-size:calc(14.0px + var(--en-font-adjust,0pt));color:var(--ink);outline:none}.login-form input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(8,125,181,.13)}.auth-field-note{margin:-8px 0 0;font-size:calc(10.0px + var(--en-font-adjust,0pt));line-height:1.4;color:var(--muted)}.password-box{position:relative}.password-box input{width:100%;padding-right:62px}.password-toggle{position:absolute;right:7px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:var(--blue);font-size:calc(10.0px + var(--en-font-adjust,0pt));font-weight:850;padding:7px}.auth-submit{width:100%;padding:12px;font-size:calc(13.0px + var(--en-font-adjust,0pt))}.form-error{min-height:16px;color:var(--red);font-size:calc(11.0px + var(--en-font-adjust,0pt))}.auth-help{font-size:calc(10.0px + var(--en-font-adjust,0pt));line-height:1.45;color:var(--muted);margin:16px 0}
dialog{border:0;border-radius:15px;padding:0;width:min(760px,calc(100vw - 26px));box-shadow:0 30px 80px rgba(3,29,43,.3)}dialog.wide{width:min(1020px,calc(100vw - 26px))}dialog::backdrop{background:rgba(2,24,37,.58)}.modal-head{padding:17px 19px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:15px}.modal-head h3{font-size:calc(16.0px + var(--en-font-adjust,0pt));margin:0;color:var(--navy)}.modal-head p{font-size:calc(10.0px + var(--en-font-adjust,0pt));color:var(--muted);margin:4px 0 0}.close{border:0;background:#eef2f4;width:30px;height:30px;border-radius:50%;font-size:calc(17.0px + var(--en-font-adjust,0pt))}.modal-body{padding:17px 19px;max-height:72vh;overflow:auto}.modal-actions{padding:12px 19px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:7px;background:#fafcfc}
/* On the forced password-change screen this is the only way out, so it sits apart
   from the confirm action rather than beside it. */
#passwordDialogSignOut{margin-right:auto}.activity-editor{width:100%;min-height:170px;resize:vertical;border:1px solid var(--line);border-radius:9px;padding:11px;line-height:1.45}.history-title{font-size:calc(11.0px + var(--en-font-adjust,0pt));margin:16px 0 8px;color:var(--navy);text-transform:uppercase;letter-spacing:.08em}.history-scroll{max-height:330px;overflow:auto;border-left:2px solid #cde1e7;margin-left:6px;padding-left:17px}.history-entry{position:relative;padding:0 0 16px}.history-entry:before{content:"";position:absolute;left:-23px;top:2px;width:10px;height:10px;border-radius:50%;background:var(--cyan);border:2px solid #fff;box-shadow:0 0 0 1px #99c7d3}.history-entry h4{font-size:calc(11.0px + var(--en-font-adjust,0pt));margin:0}.history-entry small{font-size:calc(9.0px + var(--en-font-adjust,0pt));color:var(--muted)}.history-entry p{font-size:calc(11.0px + var(--en-font-adjust,0pt));line-height:1.45;white-space:pre-line;margin:6px 0 0}.form-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.field{display:grid;gap:5px}.field.full{grid-column:1/-1}.field label{font-size:calc(9.0px + var(--en-font-adjust,0pt));text-transform:uppercase;letter-spacing:.06em;color:#61727c;font-weight:800}.field textarea{min-height:90px;resize:vertical}.form-section{grid-column:1/-1;border-top:1px solid var(--line);padding-top:11px;margin-top:4px;font-size:calc(11.0px + var(--en-font-adjust,0pt));font-weight:850;color:var(--navy)}.calc-strip{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.calc{background:var(--soft);border-radius:8px;padding:9px}.calc span{font-size:calc(8.0px + var(--en-font-adjust,0pt));text-transform:uppercase;color:var(--muted)}.calc strong{display:block;margin-top:3px;font-size:calc(12.0px + var(--en-font-adjust,0pt))}.security-inline{grid-column:1/-1;background:#f7fafb;border:1px solid var(--line);border-radius:9px;padding:10px;font-size:calc(10.0px + var(--en-font-adjust,0pt));line-height:1.45;color:var(--muted)}.security-inline strong{display:block;color:var(--navy);margin-bottom:3px}.password-strength{display:grid;gap:5px}.strength-track{height:7px;background:#e5ecef;border-radius:99px;overflow:hidden}.strength-track span{display:block;height:100%;width:0;background:var(--red);transition:.18s}.password-strength strong{font-size:calc(10.0px + var(--en-font-adjust,0pt));color:var(--muted)}.password-strength small{font-size:calc(9.0px + var(--en-font-adjust,0pt));color:#82919a}.password-status{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 7px;font-size:calc(8.0px + var(--en-font-adjust,0pt));font-weight:850}.password-status.ready{background:#e3f5ed;color:#12634f}.password-status.pending{background:#fff0d2;color:#805600}.login-outcome{display:inline-flex;border-radius:999px;padding:4px 7px;font-size:calc(9.0px + var(--en-font-adjust,0pt));font-weight:850;white-space:nowrap}.login-ok{background:#e3f5ed;color:#12634f}.login-bad{background:#fbe6e4;color:#8d2018}.login-muted{background:#eef1f3;color:var(--muted)}.login-unmatched{color:#8d2018;font-style:italic}.login-table td{vertical-align:top}.login-table td small{display:block;color:var(--muted);font-size:calc(9.0px + var(--en-font-adjust,0pt))}.toast{position:fixed;right:20px;bottom:20px;z-index:160;background:var(--navy2);color:#fff;padding:11px 14px;border-radius:9px;font-size:calc(11.0px + var(--en-font-adjust,0pt));box-shadow:var(--shadow);opacity:0;transform:translateY(10px);pointer-events:none;transition:.18s}.toast.show{opacity:1;transform:none}
/* Restore the more readable visual scale of the original project register while preserving the compact responsive column geometry. */
.brand-copy,.nav-label,.kicker{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.nav-btn{font-size:calc(15.0px + var(--en-font-adjust,0pt))}.nav-btn.principal{font-size:calc(16.0px + var(--en-font-adjust,0pt))}.nav-icon{width:32px;height:32px;font-size:calc(11.0px + var(--en-font-adjust,0pt));letter-spacing:.02em}.heading h1{font-size:calc(22.0px + var(--en-font-adjust,0pt))}.heading p,.btn{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.user-chip,.count-note{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.view-head h2{font-size:calc(20.0px + var(--en-font-adjust,0pt))}.view-head p{font-size:calc(13.0px + var(--en-font-adjust,0pt))}.unit-switcher-label strong{font-size:calc(14.0px + var(--en-font-adjust,0pt))}.unit-switcher-label span{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.unit-btn{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.search input,.toolbar select,.field input,.field select,.field textarea,.admin-toolbar select{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.preset,.formula-note{font-size:calc(11.0px + var(--en-font-adjust,0pt))}th button,th>span{font-size:calc(10.0px + var(--en-font-adjust,0pt))}td{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.section-row td{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.project-link{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.sub{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.risk-pill{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.inline-select,.mini-input{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.activity-date{font-size:calc(10.5px + var(--en-font-adjust,0pt))}.activity-hint{font-size:calc(9.0px + var(--en-font-adjust,0pt))}.promote-btn{font-size:calc(9.0px + var(--en-font-adjust,0pt))}.security-callout{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.admin-table th{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.admin-table td,.admin-table strong{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.admin-table small{font-size:calc(9.0px + var(--en-font-adjust,0pt))}.admin-table .btn.small{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.role-badge,.access-badge{font-size:calc(9.0px + var(--en-font-adjust,0pt))}.pagination button{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.audit-row,.audit-row strong{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.guide-card h3{font-size:calc(15.0px + var(--en-font-adjust,0pt))}.guide-card p,.guide-card li{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.modal-head h3{font-size:calc(18.0px + var(--en-font-adjust,0pt))}.modal-head p{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.field label{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.history-title{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.history-entry h4{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.history-entry small{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.history-entry p{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.form-section{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.calc span{font-size:calc(9.0px + var(--en-font-adjust,0pt))}.calc strong{font-size:calc(13.0px + var(--en-font-adjust,0pt))}.security-inline{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.password-strength strong{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.password-strength small{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.password-status{font-size:calc(9.0px + var(--en-font-adjust,0pt))}.toast{font-size:calc(12.0px + var(--en-font-adjust,0pt))}
.kpi-label{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.kpi-value{font-size:calc(28.0px + var(--en-font-adjust,0pt))}.kpi small{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.section-head h3{font-size:calc(14.0px + var(--en-font-adjust,0pt))}.section-head span{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.status-callout{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.unit-row{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.attention-copy strong,.high-card strong{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.attention-copy small,.high-card p{font-size:calc(11.0px + var(--en-font-adjust,0pt))}.risk-flag{font-size:calc(9.0px + var(--en-font-adjust,0pt))}.donut-legend strong{font-size:calc(10.0px + var(--en-font-adjust,0pt))}.donut-legend em{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.risk-stat span{font-size:calc(11.0px + var(--en-font-adjust,0pt))}
@media(max-width:1180px){.app{grid-template-columns:86px 1fr}.sidebar{padding:17px 10px}.brand{padding:5px}.brand img{height:38px}.brand-copy,.nav-label,.nav-btn span:last-child{display:none}.nav-btn{justify-content:center}.dashboard-grid{grid-template-columns:1fr}.high-list{grid-template-columns:1fr 1fr}.kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:740px){.app{display:block}.sidebar{position:static;height:auto;padding:8px}.brand{display:none}.nav{display:flex;overflow:auto}.nav-btn{min-width:max-content;font-size:calc(12.0px + var(--en-font-adjust,0pt))}.nav-btn span:last-child{display:inline}.topbar{position:static;padding:11px 13px;align-items:flex-start}.heading p,.user-chip{display:none}.content{padding:13px}.unit-switcher{align-items:stretch;flex-direction:column}.unit-switcher-label{min-width:0}.kpis{grid-template-columns:1fr 1fr}.view-head,.workspace-bar{flex-direction:column;align-items:stretch}.toolbar{width:100%}.search,.search input{width:100%}.donut-layout{grid-template-columns:1fr}.donut-legend{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.field.full,.form-section,.calc-strip,.security-inline,.password-strength.full{grid-column:auto}.calc-strip{grid-template-columns:1fr}.risk-summary{grid-template-columns:1fr 1fr}.high-list,.guide-grid{grid-template-columns:1fr}.admin-toolbar{display:grid}.top-actions{justify-content:flex-end}.auth-overlay{padding:12px}.auth-card{padding:22px}.auth-brand{align-items:flex-start}.auth-brand img{width:135px;height:45px}.auth-brand div{padding-left:10px}.auth-copy h2{font-size:calc(24.0px + var(--en-font-adjust,0pt))}.project-table{min-width:900px}.development-table{min-width:930px}.cost-table{min-width:840px}.risk-table{min-width:900px}.admin-table{min-width:760px}}

/* Reserve readable space for the action heading, even in dense column presets. */
.project-table th.col-actions,.development-table th.col-actions,.cost-table th.col-actions,.risk-table th.col-actions{width:4rem;text-align:center;white-space:nowrap}
th.col-actions>span{padding:8px 2px;text-align:center;white-space:nowrap;overflow:visible;text-overflow:clip}
td.col-actions{text-align:center}

/* One page scroll: the full register, including its final section, remains reachable. */
main{min-width:0}
.table-wrap,.admin-table-wrap{max-height:none;overflow-x:auto;overflow-y:visible;overscroll-behavior:auto}
.table-wrap th,.section-row td{position:static}
.activity-inline,.activity-inline:focus,.development-table .activity-inline{max-height:none;overflow:visible}
.activity-hint{display:none}
.audit-list{max-height:none;overflow:visible}
.admin-head-actions{display:flex;gap:8px;align-items:center}
.audit-detailed{font-size:calc(14.0px + var(--en-font-adjust,0pt));line-height:1.5;overflow-wrap:anywhere}.audit-detailed strong{font-size:calc(14.0px + var(--en-font-adjust,0pt));text-transform:none}.audit-detailed>span{font-size:calc(12.0px + var(--en-font-adjust,0pt))}.audit-change{white-space:pre-wrap;margin-top:4px}.audit-long-change{margin-top:6px}.audit-long-change summary{cursor:pointer;color:var(--navy)}
.history-scroll{max-height:none;overflow:visible}
.topbar{position:static}
.table-caption{text-align:right;padding:0 2px 7px}
.unit-switcher{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;margin-bottom:14px;border-left:6px solid var(--cyan)}
.unit-switcher-label{flex:0 0 148px;min-width:0}
.unit-buttons{display:flex;flex:1 1 auto;flex-wrap:wrap;overflow:visible;gap:5px;justify-content:flex-start}
.unit-btn{padding:8px 10px;font-size:calc(12.0px + var(--en-font-adjust,0pt));white-space:nowrap}
.filter-controls{margin-left:auto;min-width:0}
.filter-controls .workspace-bar{border:0;padding:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.filter-controls .toolbar{gap:6px;flex-wrap:wrap}
.filter-controls .search input{width:180px;max-width:100%}
.filter-controls .toolbar select{max-width:122px}
.filter-controls .btn{padding:8px 10px}
.search-match{background:#fff176;color:inherit;padding:0;border-radius:2px}
.top-actions{gap:8px;flex-wrap:wrap}
.profile-control{display:flex;align-items:center;gap:9px;margin-left:6px}
.welcome-text{font-family:Helvetica,Arial,sans-serif;font-size:calc(12.0px + var(--en-font-adjust,0pt));font-weight:400;color:#405965;text-align:right;max-width:190px}
.avatar-button,.signoff-button{padding:0;display:inline-grid;place-items:center;border:1px solid var(--line);background:white;cursor:pointer;color:var(--navy);flex-shrink:0}
.avatar-button{width:42px;height:42px;border-radius:50%}
.avatar-button:hover,.signoff-button:hover{border-color:var(--blue);background:var(--pale)}
.signoff-button{width:40px;height:40px;border-radius:9px}
.toolbar-icon-button{width:42px;height:42px;flex:0 0 42px;padding:6px;display:inline-grid;place-items:center;border:1px solid var(--line);border-radius:9px;background:#fff;cursor:pointer}
.toolbar-icon-button img{display:block;max-width:100%;object-fit:contain;pointer-events:none}
#refreshBtn img{transform:scale(.6)}
.toolbar-icon-button:hover,.toolbar-icon-button[aria-expanded="true"]{border-color:var(--blue);background:var(--pale)}
.toolbar-icon-button:disabled{opacity:.5;cursor:wait}
.export-wrap{position:relative;flex:0 0 auto}
.export-menu{position:absolute;right:0;top:calc(100% + 7px);z-index:50;min-width:205px;max-width:calc(100vw - 24px);padding:6px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow)}
.export-menu button{width:100%;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:11px 10px;border:0;border-radius:6px;background:#fff;text-align:left;color:var(--navy);font-size:calc(14.0px + var(--en-font-adjust,0pt));font-weight:650;cursor:pointer}
.export-menu button span{font-size:calc(12.0px + var(--en-font-adjust,0pt));color:var(--muted);font-weight:400}
.export-menu button:hover,.export-menu button:focus-visible{background:var(--pale);outline:2px solid var(--blue);outline-offset:-2px}
@media(max-width:740px){.export-menu{right:auto;left:0}}
.avatar{position:relative;width:36px;height:36px;border-radius:50%;background:#d9f0f5;color:var(--navy);font-family:Helvetica,Arial,sans-serif;font-size:calc(13.0px + var(--en-font-adjust,0pt));font-weight:700;display:inline-grid;place-items:center;overflow:hidden;flex:0 0 auto;vertical-align:middle}
.avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.avatar-large{width:80px;height:80px;background:transparent}
.avatar-large>.avatar{width:80px;height:80px;font-size:calc(25.0px + var(--en-font-adjust,0pt))}
.photo-editor{display:flex;align-items:center;gap:16px;padding:0 0 20px;flex-wrap:wrap}
.photo-editor>div{display:grid;gap:8px;flex:1;min-width:180px}
.photo-editor input{max-width:100%;font-size:calc(12.0px + var(--en-font-adjust,0pt))}
.photo-editor label{font-size:calc(13.0px + var(--en-font-adjust,0pt));font-weight:700;color:var(--navy)}
.photo-editor small,.profile-note{font-size:calc(12.0px + var(--en-font-adjust,0pt));line-height:1.4;color:var(--muted)}
.photo-editor .btn{justify-self:start}
.directory-person{display:flex;gap:7px;align-items:center}
.directory-person>div{min-width:0}
.directory-person .avatar{width:30px;height:30px;font-size:calc(11.0px + var(--en-font-adjust,0pt))}
.field input[readonly]{background:#f2f6f7;color:#60717b}
button:focus-visible{outline:2px solid var(--blue);outline-offset:3px}
@media(max-width:1180px){.filter-controls{flex:1 1 100%;margin-left:0}.filter-controls .workspace-bar{justify-content:flex-end}.welcome-text{max-width:150px}}
@media(max-width:740px){.unit-switcher{flex-direction:row}.unit-switcher-label{flex-basis:100%}.unit-buttons{flex-basis:100%}.filter-controls .workspace-bar,.filter-controls .toolbar{width:100%}.filter-controls .search{flex:1 1 100%}.filter-controls .search input{width:100%}.topbar{flex-wrap:wrap}.top-actions{width:100%;justify-content:flex-start}.profile-control{margin-left:auto}.welcome-text{display:inline;font-size:calc(11.0px + var(--en-font-adjust,0pt))}.directory-person{align-items:flex-start}}

/* Let Search yield space before wrapping the complete control strip. */
.content{container-type:inline-size;container-name:workspace}
.unit-switcher{flex-wrap:nowrap;gap:8px}
.unit-switcher-label{flex:0 1 140px;min-width:115px}
.unit-buttons{flex:0 0 auto;flex-wrap:nowrap;gap:4px;padding:0}
.unit-btn{padding:8px}
.filter-controls{flex:0 1 auto;min-width:0;margin-left:auto}
.filter-controls .workspace-bar{flex-direction:row;flex-wrap:nowrap;justify-content:flex-end;gap:5px;width:100%}
.filter-controls .toolbar{display:flex;flex:0 1 auto;min-width:0;flex-wrap:nowrap;gap:5px;width:auto}
.filter-controls .search{flex:0 1 2.5in;min-width:4.5rem;width:2.5in;max-width:2.5in}
.filter-controls .search input{width:100%;min-width:0;padding-right:6px}
.filter-controls .toolbar select{flex:0 0 auto;width:60px;min-width:0;max-width:none;padding:8px 15px 8px 5px;appearance:none;-webkit-appearance:none;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 8px) center,calc(100% - 5px) center;background-size:3px 3px;background-repeat:no-repeat}
.filter-controls .toolbar select:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.filter-controls .menu-wrap{flex:0 0 34px}
.filter-controls #columnsBtn{width:34px;padding:8px 3px;letter-spacing:1px}
.instant-tooltip{position:fixed;z-index:250;max-width:min(300px,calc(100vw - 16px));margin:0;padding:8px 11px;border:1px solid #315970;border-radius:7px;background:var(--navy2);color:#fff;font-family:Helvetica,Arial,sans-serif;font-size:calc(13.0px + var(--en-font-adjust,0pt));font-weight:400;line-height:1.4;box-shadow:0 5px 16px rgba(3,29,43,.22);white-space:normal;overflow-wrap:anywhere;transition:none;animation:none;pointer-events:auto}
.pdf-guide-btn:after{display:none}
@container workspace (max-width:60rem){
  .unit-switcher{flex-wrap:wrap}
  .unit-switcher-label{flex:0 1 140px}
  .unit-buttons{flex:1 1 24rem;flex-wrap:wrap}
  .filter-controls{flex:1 1 100%;min-width:0;margin-left:0}
}
@container workspace (max-width:24rem){
  .filter-controls .workspace-bar{align-items:flex-end}
  .filter-controls .toolbar{flex-wrap:wrap}
  .filter-controls .search{flex-basis:100%;min-width:0}
}

${ENHANCED_STYLES}

/* The AI mark, in the sidebar and beside every assistant reply. */
.nav-icon-ai{background:linear-gradient(135deg,#0e8ea8,#14b8a6);color:#fff}
.ai-spark{width:15px;height:15px;display:block;fill:currentColor}
.ask-ai-mark{width:22px;height:22px;border-radius:6px;background:#e3f3f4;color:#00767e;
  display:inline-flex;align-items:center;justify-content:center;flex:none}
.ask-ai-mark .ai-spark{width:13px;height:13px}

/* --- Ask the Tracker ------------------------------------------------------ */
/* Follows the Ask the Tracker pilot: a conversation on the left, an evidence
   panel on the right, and a rail for moving between result sets. Every figure
   in an answer can be traced to the record it came from rather than being taken
   on trust, which is the whole reason the evidence panel exists. */
.pane[data-pane="ask"]{--ask-navy:#07364b;--ask-teal:#007f86;--ask-ink:#163548;
  --ask-muted:#586c7a;--ask-line:#dce5ea}

/* Top row: the way back, where you are, and what you are looking at. */
.ask-top{display:flex;align-items:center;justify-content:space-between;gap:16px;
  flex-wrap:wrap;padding:0 0 12px}
.ask-trail{display:flex;align-items:center;gap:14px;flex-wrap:wrap;min-width:0}
.ask-back{display:inline-flex;align-items:center;gap:6px;background:#fff;color:#284e63;
  border:1px solid #cbd9e1;border-radius:6px;padding:7px 12px 7px 9px;font-size:13px;
  font-weight:600;cursor:pointer;white-space:nowrap}
.ask-back:hover{background:#eaf4f6;border-color:#9ac8ca}
.ask-back svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;
  stroke-linecap:round;stroke-linejoin:round}
.ask-breadcrumb{display:flex;align-items:center;gap:0;font-size:13px;color:#486475;
  flex-wrap:wrap;min-width:0}
.ask-breadcrumb span{padding:0 8px;color:#9aaab5}
.ask-crumb{background:none;border:0;padding:0;font:inherit;color:#2a6b7c;cursor:pointer}
.ask-crumb:hover{text-decoration:underline}
.ask-crumb-now{color:#1d4a5e;font-weight:600;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;max-width:28ch}
.ask-top-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ask-context{font-size:12px;color:#486475;padding:6px 10px;border:1px solid #cedce5;
  border-radius:4px;background:#f9fbfc;max-width:34ch;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}

/* Heading row. */
.ask-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;
  flex-wrap:wrap;padding:4px 0 18px}
.ask-head h2{margin:0;font-size:26px;letter-spacing:-.6px;line-height:1.2;color:#07394e}
.ask-head p{margin:6px 0 0;color:var(--ask-muted);font-size:14px}
.ask-scope-pick{display:flex;align-items:center;gap:8px;font-size:12px;color:#54707f}
.ask-scope-pick select{border:1px solid #cbd9e1;border-radius:6px;padding:7px 9px;
  font-size:13px;color:#24495c;background:#fff;max-width:17rem}

/* Three columns: talk, evidence, and the rail that moves between result sets. */
.ask-workspace{display:grid;grid-template-columns:minmax(360px,1.2fr) minmax(320px,1fr) 46px;
  gap:18px;min-height:520px;height:calc(100vh - 330px);max-height:950px}
.ask-conversation{background:#fff;border:1px solid var(--ask-line);border-radius:10px;
  display:flex;flex-direction:column;min-width:0;overflow:hidden;box-shadow:0 2px 4px #17334505}
.ask-chat-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:14px 16px;border-bottom:1px solid #eef3f5;flex-wrap:wrap}
.ask-modes{display:flex;background:#edf2f5;padding:3px;border-radius:6px;flex:none}
.ask-modes button{border:0;background:transparent;color:#536d7c;padding:6px 14px;
  border-radius:4px;font-size:13px;cursor:pointer}
.ask-modes button[aria-pressed=true]{background:#fff;color:#006e78;font-weight:700;
  box-shadow:0 1px 4px #16354818}
.ask-scope{font-size:11px;color:#728894;text-align:right;min-width:0}

/* Voice. The orb is the state indicator; the phone button starts and ends a
   call; Stop interrupts speech without ending the call. */
.ask-voice-panel{padding:22px 20px;text-align:center;background:#f3f8fa;
  border-bottom:1px solid var(--ask-line)}
.ask-orb{width:92px;height:92px;border-radius:50%;margin:0 auto 14px;position:relative;
  background:radial-gradient(circle at 50% 40%,#d9eef0,#bfe2e5);display:grid;place-items:center}
.ask-orb-skin{width:62px;height:62px;border-radius:50%;
  background:linear-gradient(145deg,#1aa0a8,#0b6d78);box-shadow:0 6px 18px #0b6d7833}
.ask-orb[data-state=connecting] .ask-orb-skin{animation:askPulse 1.1s ease-in-out infinite}
.ask-orb[data-state=listening]{background:radial-gradient(circle at 50% 40%,#d6f1ef,#a9e0dc)}
.ask-orb[data-state=listening] .ask-orb-skin{animation:askPulse 1.9s ease-in-out infinite}
.ask-orb[data-state=speaking] .ask-orb-skin{animation:askPulse .8s ease-in-out infinite}
.ask-orb[data-state=error]{background:radial-gradient(circle at 50% 40%,#f7dcd6,#eabcb2)}
.ask-orb[data-state=error] .ask-orb-skin{background:linear-gradient(145deg,#c9705c,#9a3e2b)}
@keyframes askPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.11)}}
.ask-orb-call{width:48px;height:48px;border-radius:50%;border:0;background:#007c83;
  color:#fff;display:inline-grid;place-items:center;cursor:pointer}
.ask-orb-call:hover{background:#006970}
.ask-orb-call svg{width:22px;height:22px;fill:currentColor}
.ask-orb-call[data-live=true]{background:#9a3e2b}
.ask-stop{margin-left:8px;border:1px solid #cbd9e1;background:#fff;color:#284e63;
  border-radius:6px;padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer}
.ask-stop:hover{background:#eaf4f6}
.ask-voice-status{margin:12px auto 0;font-size:13px;color:#526f7f;max-width:40ch}

/* The conversation. */
.ask-messages{flex:1;min-height:150px;overflow:auto;padding:22px 20px 6px;
  scroll-behavior:smooth}
.ask-turn{margin-bottom:22px}
.ask-turn-user{display:flex;flex-direction:column;align-items:flex-end}
.ask-label{display:flex;align-items:center;gap:8px;color:#265569;font-size:12px;
  font-weight:700;margin-bottom:9px}
.ask-bubble{font-size:15px;line-height:1.62;color:#264554;overflow-wrap:anywhere}
.ask-turn-user .ask-bubble{background:#edf3f7;border:1px solid #e0e9ef;
  border-radius:11px 11px 3px 11px;padding:11px 14px;max-width:93%}
.ask-bubble p{margin:8px 0 12px}
.ask-bubble h3{font-size:21px;font-weight:600;margin:8px 0;color:#123f54;
  line-height:1.3;letter-spacing:-.3px}
.ask-bubble strong{color:#103c50}
.ask-bubble ul{margin:8px 0 12px;padding-left:20px}
.ask-bubble li{margin:4px 0;line-height:1.55}
.ask-chips{display:flex;gap:6px;flex-wrap:wrap;margin:9px 0}
.ask-chip{padding:4px 8px;border-radius:4px;background:#eef4f6;color:#486577;
  font-size:11px;line-height:1.5}
.ask-results{padding:0;list-style:none;margin:10px 0}
.ask-result{padding:9px 0;border-bottom:1px solid #e9eef1;line-height:1.4}
.ask-result-name{color:#087780;background:transparent;border:0;padding:0;text-align:left;
  font-size:14px;font-weight:600;cursor:pointer}
.ask-result-name:hover{text-decoration:underline}
.ask-result-meta{display:block;color:#667d89;font-size:12px;margin-top:4px}
.ask-note{color:#6a6d62;background:#f7f5ed;padding:10px 12px;border-left:3px solid #cebc77;
  font-size:12px;line-height:1.55;border-radius:0 4px 4px 0;margin:12px 0}
.ask-sources{color:#72848f;font-size:11px;margin-top:11px}
.ask-pending{color:#6d838f;font-size:13px;display:flex;align-items:center;gap:8px}
.ask-dots{width:34px;height:8px;display:inline-flex;gap:4px}
.ask-dots i{width:8px;height:8px;border-radius:50%;background:#9cc3c7;
  animation:askBlink 1.2s ease-in-out infinite}
.ask-dots i:nth-child(2){animation-delay:.18s}
.ask-dots i:nth-child(3){animation-delay:.36s}
@keyframes askBlink{0%,100%{opacity:.3}50%{opacity:1}}
.ask-error{background:#fdf1ee;border-left:3px solid #c9705c;color:#8e3c29;padding:10px 12px;
  font-size:13px;line-height:1.55;border-radius:0 4px 4px 0}
.ask-buttons{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}

/* Suggestions and composer. */
.ask-suggestions{display:flex;gap:7px;flex-wrap:wrap;padding:10px 18px 12px;
  border-top:1px solid #f0f3f5}
.ask-suggestion{border:1px solid #d9e4e9;background:#fff;color:#246174;border-radius:6px;
  padding:7px 10px;font-size:12px;text-align:left;cursor:pointer}
.ask-suggestion:hover{background:#edf8f8;border-color:#9ac8ca}
.ask-composer{margin:0 16px 16px;border:1px solid #b6d0d8;border-radius:9px;
  box-shadow:0 1px 4px #0a53600a;padding:10px 12px 8px}
.ask-composer:focus-within{border-color:#168f95;box-shadow:0 0 0 2px #007f8610}
.ask-composer textarea{resize:none;border:0;background:transparent;width:100%;outline:none;
  color:#1d4053;min-height:46px;font-size:15px;line-height:1.5;font-family:inherit}
.ask-composer textarea::placeholder{color:#83939d}
.ask-compose-footer{display:flex;align-items:center;justify-content:space-between;gap:10px}
.ask-compose-hint{font-size:11px;color:#728894}
.ask-send{border:0;border-radius:5px;background:#007c83;color:#fff;font-size:13px;
  font-weight:600;padding:8px 19px;cursor:pointer}
.ask-send:hover{background:#006970}
.ask-send:disabled{opacity:.5;cursor:default}
.ask-btn{background:#fff;color:#284e63;border:1px solid #cbd9e1;padding:8px 13px;
  border-radius:6px;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer}
.ask-btn:hover{background:#eaf4f6}
.ask-btn:disabled{opacity:.5;cursor:default}
.ask-btn-primary{background:var(--ask-teal);border-color:var(--ask-teal);color:#fff}
.ask-btn-primary:hover{background:#00676d}

/* The evidence panel: overview, record list, one record, or a briefing. */
.ask-evidence{display:flex;flex-direction:column;background:#fafcfd;
  border:1px solid var(--ask-line);border-radius:10px;min-width:0;overflow:hidden}
.ask-evidence-header{padding:18px 18px 15px;display:flex;justify-content:space-between;
  align-items:center;border-bottom:1px solid var(--ask-line);gap:10px}
.ask-kicker{font-size:11px;letter-spacing:1.5px;font-weight:700;color:#627786;
  text-transform:uppercase;display:block}
.ask-evidence-title{font-size:17px;line-height:1.3;margin:6px 0 0;color:#183f53;display:block}
.ask-count{padding:4px 9px;background:#e5edf2;color:#36596d;border-radius:5px;
  font-size:13px;font-weight:600;flex:none}
.ask-evidence-toolbar{display:flex;gap:7px;flex-wrap:wrap;padding:0 16px}
.ask-evidence-toolbar:not(:empty){padding-top:11px;padding-bottom:11px;
  border-bottom:1px solid var(--ask-line)}
.ask-evidence-toolbar .ask-btn{font-size:12px;padding:6px 10px}
.ask-evidence-body{overflow:auto;flex:1;padding:16px 18px 22px}
.ask-source-meta{color:#6c818e;font-size:12px;margin:0 0 16px}
.ask-metric-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-bottom:18px;
  border-bottom:1px solid var(--ask-line)}
.ask-metric span{font-size:12px;color:#637b8a;display:block}
.ask-metric strong{font-size:26px;letter-spacing:-1px;font-weight:600;color:#103f54;
  display:block;margin:4px 0 1px}
.ask-metric strong.over{color:#9a3e2b}
.ask-metric strong.late{color:#83601b}
.ask-metric small{font-size:11px;color:#70828e}
.ask-section-label{font-size:11px;letter-spacing:1.2px;font-weight:700;color:#627786;
  text-transform:uppercase;margin:18px 0 4px}
.ask-unit-row{display:grid;grid-template-columns:minmax(80px,110px) 1fr 28px;gap:10px;
  align-items:center;margin:12px 0;font-size:12px;color:#36596a}
.ask-unit-row button{padding:0;background:none;border:0;text-align:left;color:inherit;
  font-size:12px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ask-unit-row button:hover{color:#087780;text-decoration:underline}
.ask-unit-track{height:6px;background:#e5edf1;border-radius:3px;overflow:hidden}
.ask-unit-fill{height:100%;background:#208793;border-radius:3px}
.ask-unit-row b{text-align:right;font-size:12px;font-weight:500}

/* A record card in the list. */
.ask-record{background:#fff;border:1px solid #dce6eb;border-radius:7px;padding:14px;
  margin-bottom:12px}
.ask-record:hover{border-color:#b7d3db}
.ask-record[data-selected=true]{border-color:#1a9aa2;box-shadow:0 0 0 2px #007f8618}
.ask-record-top{display:flex;gap:8px;justify-content:space-between;font-size:10px;
  letter-spacing:.7px;color:#6e8290;text-transform:uppercase}
.ask-record-name{font-size:16px;margin:7px 0;color:#153f55;line-height:1.35;
  background:none;border:0;padding:0;text-align:left;font-weight:600;cursor:pointer;display:block}
.ask-record-name:hover{color:#087780;text-decoration:underline}
.ask-record p{font-size:13px;line-height:1.6;margin:7px 0;color:#43606f;
  white-space:pre-wrap;overflow-wrap:anywhere}
.ask-record-footer{display:flex;justify-content:space-between;gap:10px;margin-top:12px;
  align-items:center}
.ask-text-link{background:none;border:0;padding:0;color:#087780;font-size:13px;
  font-weight:600;cursor:pointer}
.ask-text-link:hover{text-decoration:underline}
.ask-risk{border-radius:4px;padding:3px 6px;font-size:11px;white-space:nowrap}
.ask-risk-high{background:#fce9e5;color:#9a3e2b}
.ask-risk-medium{background:#fff0d4;color:#83601b}
.ask-risk-low{background:#e5f2ed;color:#27664f}
.ask-risk-other{background:#edf1f4;color:#637783}
.ask-source-line{color:#72848f;font-size:11px;margin-top:11px}
.ask-small{display:block;font-size:11px;color:#6d838f;margin-top:8px}
.ask-empty{padding:24px 0;color:#667d8b;font-size:14px;line-height:1.7}
.ask-empty strong{display:block;color:#1d4a5e;font-size:15px;margin-bottom:6px}

/* One record, and a briefing. */
.ask-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;margin:15px 0;
  padding:0}
.ask-field-grid dt{font-size:11px;color:#6b818e;text-transform:uppercase;letter-spacing:.6px}
.ask-field-grid dd{margin:3px 0 0;font-size:14px;color:#234657;overflow-wrap:anywhere}
.ask-field-grid dd.over{color:#9a3e2b;font-weight:600}
.ask-field-grid dd.late{color:#83601b;font-weight:600}
.ask-report-title{font-size:21px;line-height:1.3;letter-spacing:-.3px;margin:4px 0 9px;
  color:#123f54}
.ask-report-summary{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
.ask-report-summary span{font-size:12px;padding:7px 9px;background:#e9f2f5;border-radius:5px}
.ask-report-section{margin:18px 0;border-top:1px solid #dce5ea;padding-top:14px}
.ask-report-section h4{font-size:15px;margin:0 0 6px;color:#163548}
.ask-report-section p{font-size:13px;line-height:1.6;white-space:pre-wrap;color:#456171;margin:7px 0}
.ask-history-entry{border-left:2px solid #a9cbd0;margin:16px 0;padding:1px 0 1px 13px}
.ask-history-entry time{font-size:12px;font-weight:700;color:#26717b}
.ask-history-entry p{white-space:pre-wrap;font-size:13px;color:#365363;line-height:1.6;margin:7px 0}

/* Photographs. Styled now so adding them later is a render call, not a redesign. */
.ask-photo{margin:0 0 18px}
.ask-photo img{display:block;width:100%;height:220px;object-fit:cover;border-radius:6px;
  background:#e7eef2}
.ask-photo figcaption{font-size:12px;color:#4c6777;padding:9px 0;line-height:1.5}
.ask-photo figcaption strong{display:block;color:#214c61;margin-bottom:4px}
.ask-photo button{padding:0;border:0;background:none;width:100%;text-align:left;cursor:pointer}

/* The rail. Older and newer move between result SETS, never between records. */
.ask-rail{display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0}
.ask-rail-btn{width:34px;height:34px;border-radius:8px;border:1px solid #cbd9e1;background:#fff;
  color:#2a6b7c;display:grid;place-items:center;cursor:pointer;flex:none}
.ask-rail-btn:hover:not(:disabled){background:#eaf4f6;border-color:#9ac8ca}
.ask-rail-btn:disabled{opacity:.38;cursor:default}
.ask-rail-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;
  stroke-linecap:round;stroke-linejoin:round}
.ask-rail-download{background:var(--ask-teal);border-color:var(--ask-teal);color:#fff}
.ask-rail-download:hover:not(:disabled){background:#00676d;border-color:#00676d}
.ask-rail-label{font-size:10px;line-height:1.3;color:#6b818e;text-align:center;
  writing-mode:vertical-rl;transform:rotate(180deg);max-height:150px;overflow:hidden;
  letter-spacing:.4px}
.ask-rail-rule{width:18px;height:1px;background:#d7e2e8;margin:4px 0}
.ask-foot{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#718591;
  padding:12px 2px 0;flex-wrap:wrap;margin:0}

/* The assistant's record dialog. Deliberately not the edit form: this pane only
   reads, and handing someone a form with a Save button contradicts that. */
.ask-record-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px 20px}
.ask-record-field span{display:block;font-size:10px;letter-spacing:.7px;text-transform:uppercase;color:#6e8290}
.ask-record-field strong{display:block;font-size:14px;color:#163548;margin-top:3px;font-weight:600}
.ask-record-field strong.over{color:#9a3e2b}
.ask-record-field strong.late{color:#83601b}
.ask-record-update{margin-top:18px;padding-top:14px;border-top:1px solid #dce5ea}
.ask-record-update h4{margin:0 0 6px;font-size:12px;letter-spacing:.6px;color:#586f7e;text-transform:uppercase}
.ask-record-update p{margin:0;font-size:14px;line-height:1.6;color:#243b49;white-space:pre-wrap}
.ask-record-note{font-size:12px;color:#6e8290;margin-right:auto}

.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0,0,0,0);white-space:nowrap;border:0}

/* Responsive. The rail folds into a row above the evidence panel rather than
   disappearing: moving between result sets is not a desktop-only affordance. */
@media (max-width:1280px){
  .ask-workspace{grid-template-columns:minmax(320px,1.1fr) minmax(300px,1fr) 44px;gap:14px}
}
@media (max-width:1024px){
  .ask-workspace{grid-template-columns:1fr;height:auto;max-height:none;min-height:0}
  .ask-conversation{min-height:520px}
  .ask-evidence{max-height:560px}
  .ask-rail{flex-direction:row;justify-content:flex-end;padding:0;order:-1}
  .ask-rail-label{writing-mode:horizontal-tb;transform:none;max-height:none;
    margin-right:auto;font-size:11px}
  .ask-rail-rule{width:1px;height:18px;margin:0 4px}
}
@media (max-width:640px){
  .ask-top,.ask-head{flex-direction:column;align-items:flex-start}
  .ask-crumb-now{max-width:18ch}
  .ask-context{max-width:100%}
  .ask-field-grid,.ask-metric-pair{grid-template-columns:1fr}
  .ask-scope-pick select{max-width:100%}
  .ask-messages{padding:16px 14px 4px}
  .ask-composer{margin:0 12px 12px}
}
@media (prefers-reduced-motion:reduce){
  .ask-orb-skin,.ask-dots i{animation:none!important}
  .ask-messages{scroll-behavior:auto}
}

/* Print: the briefing is the page. Everything that is furniture goes away, and
   the evidence body is allowed to flow onto as many sheets as it needs. */
@media print{
  body{background:#fff}
  .sidebar,.topbar,.ask-top,.ask-head,.ask-conversation,.ask-rail,
  .ask-evidence-toolbar,.ask-evidence-header,.ask-foot,.toast,
  .pane:not([data-pane="ask"]){display:none!important}
  .app{display:block!important;box-shadow:none!important;background:#fff!important}
  .ask-workspace,.ask-evidence,.ask-evidence-body{display:block!important;height:auto!important;
    max-height:none!important;overflow:visible!important;border:0!important;
    padding:0!important;margin:0!important;background:#fff!important}
  .ask-report-section,.ask-record,.ask-history-entry{break-inside:avoid}
  .ask-report-title{font-size:25px}
}
`;
