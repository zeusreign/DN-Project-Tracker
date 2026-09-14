import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { CLIENT } from "../worker/client.js";
import { PROFILE_PHOTOS, PROFILE_PHOTO_BATCH } from "../worker/profile-photos.js";
import { EXPORT_FORMATS } from "../worker/exports.js";

// The browser script is embedded in a template; validate its generated syntax too.
new Function(CLIENT);

const auditHelpers = new Function(CLIENT.slice(CLIENT.indexOf("function esc("), CLIENT.indexOf("function dateInput(")) + ";return {auditRowHtml,auditDateTime,auditValue};")();
const originalTimezone = process.env.TZ;
process.env.TZ = "America/Denver";
assert.equal(auditHelpers.auditDateTime("2026-09-07 10:35:00"), auditHelpers.auditDateTime("2026-09-07T10:35:00Z"), "SQLite audit timestamps are UTC");
if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone;
assert.equal(auditHelpers.auditValue("anticipated_final_cost", 123.45), "$123.45");
assert.equal(auditHelpers.auditValue("anticipated_final_cost", 0), "$0");
assert.equal(auditHelpers.auditValue("current_start_date", null), "Not set");
const renderedAudit = auditHelpers.auditRowHtml({
  action: "field_update", entity_type: "project", entity_key: "1",
  actor_email: "review@example.invalid", created_at: "2026-09-07 10:35:00",
  details: JSON.stringify({ projectName: "Office <Refresh>", actorName: "Review Administrator",
    changes: [{ field: "budget_risk", before: "Low", after: "Medium" }] }),
});
assert.match(renderedAudit, /Office &lt;Refresh&gt;: Budget risk changed/);
assert.match(renderedAudit, /Low → Medium/);
assert.match(renderedAudit, /Changed by Review Administrator \(review@example.invalid\)/);
assert.doesNotMatch(renderedAudit, /<Refresh>/);
const legacyAudit = auditHelpers.auditRowHtml({action:"field_update",entity_type:"project",entity_key:"1",details:'{"fields":["budget_risk"]}',created_at:"2026-09-01 10:00:00"});
assert.match(legacyAudit, /values were not recorded/);
assert.doesNotMatch(legacyAudit, /Low|Medium/);
assert.doesNotThrow(() => auditHelpers.auditRowHtml({action:"field_update", details:"{invalid"}));

// Row double-click uses the existing edit action; Activity Update stays separate.
const rowHandlerSource = CLIENT.slice(CLIENT.indexOf("function handleRowDoubleClick("), CLIENT.indexOf('document.addEventListener("dblclick",handleRowDoubleClick)'));
const openedActivities = [];
const handleRowDoubleClick = new Function("openActivity", rowHandlerSource + ";return handleRowDoubleClick;")(id => openedActivities.push(id));
function rowDoubleClick({activity, activityCell, control, action} = {}) {
  let prevented = false;
  handleRowDoubleClick({
    preventDefault() { prevented = true; },
    target: { closest(selector) {
      if (selector === "[data-activity]") return activity;
      if (selector === ".col-activity,.dev-update") return activityCell;
      if (selector === "button,a,input,select,textarea,[contenteditable]") return control;
      if (selector === "[data-record-row]" && action) return {
        querySelector: selector => selector === "[data-details],[data-development],[data-user-edit]" ? action : null,
      };
      return null;
    }},
  });
  return prevented;
}
let editClicks = 0;
const editAction = { click() { editClicks++; } };
assert.equal(rowDoubleClick({action: editAction}), true);
assert.equal(editClicks, 1);
assert.equal(rowDoubleClick({action: editAction, activity: {dataset: {activity: "42"}}}), true);
assert.equal(rowDoubleClick({action: editAction, activityCell: {querySelector: () => ({dataset: {activity: "43"}})}}), true);
assert.deepEqual(openedActivities, ["42", "43"]);
assert.equal(editClicks, 1);
assert.equal(rowDoubleClick({action: editAction, control: {}}), false);
assert.equal(rowDoubleClick(), false);
assert.equal(editClicks, 1);
assert.match(CLIENT, /<tr class="project-row" data-record-row>/);
assert.match(CLIENT, /<tr data-record-row><td><div class="directory-person">/);
assert.match(CLIENT, /<div class="attention" data-record-row>/);
const pageSource = await readFile(new URL("../worker/page.js", import.meta.url), "utf8");
assert.match(pageSource, /<label>Business Unit Permissions<\/label>/);
assert.match(pageSource, /<th>Business Unit Permissions<\/th>/);
assert.doesNotMatch(pageSource, /business-unit scope/i);

// Tooltip labels are immediate UI text, not delayed native browser titles.
const labelSource = CLIENT.slice(CLIENT.indexOf("function tooltipLabel("), CLIENT.indexOf("function hideTooltip("));
const tooltipLabel = new Function(labelSource + ";return tooltipLabel;")();
function tooltipControl(properties = {}) {
  const attributes = new Map(Object.entries(properties.attributes || {}));
  return {
    dataset: properties.dataset || {}, tagName: properties.tagName || "BUTTON",
    id: properties.id, value: properties.value || "", selectedIndex: 0,
    options: [{ textContent: properties.option || "" }],
    classList: { contains: value => (properties.classes || []).includes(value) },
    hasAttribute: name => attributes.has(name), getAttribute: name => attributes.get(name),
    removeAttribute: name => attributes.delete(name),
  };
}
const signoffTip = tooltipControl({ attributes: { title: "Sign off" } });
assert.equal(tooltipLabel(signoffTip), "Sign off");
assert.equal(signoffTip.hasAttribute("title"), false);
assert.equal(signoffTip.dataset.tooltip, "Sign off");
assert.equal(tooltipLabel(tooltipControl({
  id: "statusFilter", tagName: "SELECT", dataset: { tooltip: "Filter Status" },
})), "Filter Status");
assert.equal(tooltipLabel(tooltipControl({
  id: "riskFilter", tagName: "SELECT", value: "High", option: "High",
  dataset: { tooltip: "Filter Risk" },
})), "Filter Risk");
assert.equal(tooltipLabel(tooltipControl({dataset: {tooltip: "Alternate Columns"}})), "Alternate Columns");
assert.equal(tooltipLabel(tooltipControl({
  tagName: "SELECT", value: "Low", option: "Low", dataset: { field: "schedule_risk" },
})), "Schedule risk — Low");
assert.equal(tooltipLabel(tooltipControl({ classes: ["more-btn"] })), "Open project details and edit fields");
const showTooltipSource = CLIENT.slice(CLIENT.indexOf("function showTooltip("), CLIENT.indexOf('document.addEventListener("pointerover"'));
assert.doesNotMatch(showTooltipSource, /setTimeout|setInterval/);

// Donut segments use the same immediate tooltip, without a delayed SVG title.
const donutSource = CLIENT.slice(CLIENT.indexOf("function renderDonut("), CLIENT.indexOf("function applyKpiOrder("));
const donutElements = {portfolioDonut: {}, portfolioLegend: {}};
const renderDonut = new Function("byId", "esc", "colors", donutSource + ";return renderDonut;")(
  id => donutElements[id], value => String(value).replaceAll("&", "&amp;"), ["#087db5"]
);
renderDonut([{name: "Parks & Resorts", projects: 20}]);
assert.match(donutElements.portfolioDonut.innerHTML, /data-tooltip="Parks &amp; Resorts: 20 current projects"/);
assert.match(donutElements.portfolioDonut.innerHTML, /aria-label="Parks &amp; Resorts: 20 current projects"/);
assert.match(donutElements.portfolioDonut.innerHTML, /data-pie-unit="Parks &amp; Resorts" tabindex="0" role="button"/);
assert.doesNotMatch(donutElements.portfolioDonut.innerHTML, /<title>|\stitle=/);

class D1Statement {
  constructor(database, sql) {
    this.statement = database.prepare(sql);
    this.values = [];
  }
  bind(...values) {
    this.values = values;
    return this;
  }
  first() {
    return Promise.resolve(this.statement.get(...this.values) || null);
  }
  all() {
    return Promise.resolve({ results: this.statement.all(...this.values) });
  }
  run() {
    return Promise.resolve(this.statement.run(...this.values));
  }
}

class D1Database {
  constructor(database) {
    this.database = database;
  }
  prepare(sql) {
    return new D1Statement(this.database, sql);
  }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (failure) {
      this.database.exec("ROLLBACK");
      throw failure;
    }
  }
}

const database = new DatabaseSync(":memory:");
database.exec(await readFile(new URL("../drizzle/0000_dnc_project_hub.sql", import.meta.url), "utf8"));
database.exec(await readFile(new URL("../drizzle/0001_workbook_structure_and_roles.sql", import.meta.url), "utf8"));
database.exec(await readFile(new URL("../drizzle/0002_user_directory.sql", import.meta.url), "utf8"));
database.exec(await readFile(new URL("../drizzle/0003_development_pipeline_and_directory.sql", import.meta.url), "utf8"));
database.exec(await readFile(new URL("../drizzle/0004_pilot_authentication.sql", import.meta.url), "utf8"));
database.exec(await readFile(new URL("../drizzle/0005_profile_photos.sql", import.meta.url), "utf8"));
const DB = new D1Database(database);
const photoObjects = new Map();
const BUCKET = {
  async put(key, bytes) { photoObjects.set(key, bytes.slice()); },
  async get(key) { return photoObjects.has(key) ? { body: photoObjects.get(key) } : null; },
  async delete(key) { photoObjects.delete(key); },
};
const env = { DB, BUCKET, ADMIN_EMAILS: "owner@example.com", ALLOW_PLATFORM_AUTH: "true" };
const worker = (await import("../dist/server/index.js?smoke=" + Date.now())).default;
const headers = {
  "oai-authenticated-user-id": "owner-id",
  "oai-authenticated-user-email": "owner@example.com",
  "oai-authenticated-user-full-name": "Pilot Owner",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

async function call(path, options = {}) {
  const request = new Request("https://tracker.example" + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  return worker.fetch(request, env, {});
}

const unauthorized = await worker.fetch(new Request("https://tracker.example/api/bootstrap"), env, {});
assert.equal(unauthorized.status, 401);
const platformBypassDisabled = await worker.fetch(new Request("https://tracker.example/api/bootstrap", { headers }), { DB, ADMIN_EMAILS: "owner@example.com" }, {});
assert.equal(platformBypassDisabled.status, 401);
assert.equal(photoObjects.size, 0, "Anonymous requests cannot import portraits");

const bootstrapResponse = await call("/api/bootstrap");
assert.equal(bootstrapResponse.status, 200);
const bootstrap = await bootstrapResponse.json();
assert.equal(photoObjects.size, 7);
assert.equal(database.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'profile_photo_import'").get().n, 7);
for (const photo of PROFILE_PHOTOS) {
  const row = database.prepare("SELECT id, avatar_key, avatar_version FROM user_directory WHERE lower(user_email) = ?").get(photo.email);
  assert.equal(row.avatar_version, PROFILE_PHOTO_BATCH + "-" + photo.key);
  assert.deepEqual(Buffer.from(photoObjects.get(row.avatar_key)), await readFile(new URL("../assets/profile-photos/" + photo.file, import.meta.url)));
  const [x, y, size] = photo.crop;
  assert.ok(x >= 0 && y >= 0 && size > 0 && x + size <= photo.width && y + size <= photo.height);
}
await call("/api/bootstrap");
assert.equal(database.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'profile_photo_import'").get().n, 7, "Refresh does not reimport portraits");
assert.equal(bootstrap.projects.length, 74);
assert.equal(bootstrap.projects[0].source_sort_order, 1);
assert.equal(bootstrap.projects.at(-1).source_sort_order, 74);
assert.equal(new Set(bootstrap.projects.map((project) => project.source_key)).size, 74);
assert.equal(bootstrap.me.role, "admin");
assert.equal(bootstrap.projects.filter((project) => project.project_type === "Capital").length, 53);
assert.equal(bootstrap.projects.filter((project) => project.budget_risk === "High" || project.schedule_risk === "High").length, 5);
assert.equal(bootstrap.summary.activeProjects, 69);
assert.equal(bootstrap.summary.developmentProjects, 16);
assert.equal(bootstrap.summary.needsStatus, 3);
assert.equal(bootstrap.projects.filter((project) => project.status === "Needs Status").length, 3);
assert.equal(bootstrap.projects.filter((project) => project.project_type === "Development" && project.development_source_row).length, 21);
const parksWaybound = bootstrap.projects.find((project) => project.source_key.includes("CACTUS MOON:Waybound Phase I"));
assert.ok(parksWaybound.current_update.length > 250);
assert.doesNotMatch(parksWaybound.current_update, /\.\.\.$/);

const adminResponse = await call("/api/admin");
assert.equal(adminResponse.status, 200);
const admin = await adminResponse.json();
assert.equal(admin.roles.length, 73);
assert.equal(admin.roles.filter((person) => person.role === "admin").length, 5);
assert.equal(admin.roles.filter((person) => person.role === "editor").length, 7);
assert.equal(admin.roles.find((person) => person.first_name === "Madeline" && person.last_name === "Cala").role, "admin");
assert.equal(admin.roles.find((person) => person.first_name === "Bill").username.toLowerCase(), "bnielsen@delawarenorth.com");
assert.ok(admin.roles.every((person) => !("password" in person)));
assert.equal(admin.roles.filter((person) => person.password_configured).length, 0, "Contractor export must not seed legacy passwords");
assert.equal(admin.roles.filter((person) => person.account_status === "active").length, 0, "Roster entries require fresh pilot authorization");
const passwordIterations = database.prepare("SELECT MIN(password_iterations) AS minimum, MAX(password_iterations) AS maximum FROM user_directory WHERE password_hash IS NOT NULL").get();
assert.equal(passwordIterations.minimum, null);
assert.equal(passwordIterations.maximum, null);

// Per-run test passwords exist only in the isolated in-memory test database.
const temporaryTestPassword = "Aa1!" + crypto.randomUUID();
const replacementTestPassword = "Bb2!" + crypto.randomUUID();

const billDirectory = admin.roles.find((person) => person.first_name === "Bill" && person.last_name === "Nielsen");
const passwordReset = await call("/api/admin/users", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: billDirectory.id,
    first_name: billDirectory.first_name,
    last_name: billDirectory.last_name,
    username: billDirectory.username,
    user_email: billDirectory.user_email,
    role: billDirectory.role,
    account_status: "active",
    site_access_status: "authorized",
    temporary_password: temporaryTestPassword,
    confirm_password: temporaryTestPassword,
  }),
});
assert.equal(passwordReset.status, 200);
const loginResponse = await worker.fetch(new Request("https://tracker.example/api/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: billDirectory.username, password: temporaryTestPassword }),
}), env, {});
assert.equal(loginResponse.status, 200);
assert.match(loginResponse.headers.get("set-cookie"), /^dnc_session=/);
const sessionCookie = loginResponse.headers.get("set-cookie").split(";")[0];
const localBootstrapResponse = await worker.fetch(new Request("https://tracker.example/api/bootstrap", {
  headers: { cookie: sessionCookie },
}), env, {});
assert.equal(localBootstrapResponse.status, 200);
const localBootstrap = await localBootstrapResponse.json();
assert.equal(localBootstrap.me.email.toLowerCase(), billDirectory.user_email.toLowerCase());
assert.equal(localBootstrap.me.auth_source, "local");
assert.equal(localBootstrap.me.must_change_password, true);
assert.ok(localBootstrap.me.csrf_token);
const blockedBeforePasswordChange = await worker.fetch(new Request("https://tracker.example/api/projects", {
  headers: { cookie: sessionCookie },
}), env, {});
assert.equal(blockedBeforePasswordChange.status, 428);
const noCsrfChange = await worker.fetch(new Request("https://tracker.example/api/account/password", {
  method: "POST",
  headers: { "content-type": "application/json", cookie: sessionCookie },
  body: JSON.stringify({
    current_password: temporaryTestPassword,
    new_password: replacementTestPassword,
    confirm_password: replacementTestPassword,
  }),
}), env, {});
assert.equal(noCsrfChange.status, 403);
const passwordChange = await worker.fetch(new Request("https://tracker.example/api/account/password", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie: sessionCookie,
    "x-csrf-token": localBootstrap.me.csrf_token,
  },
  body: JSON.stringify({
    current_password: temporaryTestPassword,
    new_password: replacementTestPassword,
    confirm_password: replacementTestPassword,
  }),
}), env, {});
assert.equal(passwordChange.status, 200);

// Profile, photo and session regression checks use only this in-memory database.
const localHeaders = { cookie: sessionCookie, "x-csrf-token": localBootstrap.me.csrf_token };
const localCall = (path, options = {}) => worker.fetch(new Request("https://tracker.example" + path, {
  ...options, headers: { ...localHeaders, ...(options.headers || {}) },
}), { DB, BUCKET }, {});
const sourceBeforeProfiles = JSON.stringify(database.prepare("SELECT * FROM projects ORDER BY id").all());
const historyBeforeProfiles = JSON.stringify(database.prepare("SELECT * FROM project_updates ORDER BY id").all());
const savedProfile = await localCall("/api/account/profile", {
  method: "PATCH", headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "Director", location: "Buffalo", mobile_phone: "555-0100" }),
});
assert.equal(savedProfile.status, 200);
const profile = (await savedProfile.json()).profile;
assert.equal(profile.id, billDirectory.id);
assert.equal(profile.location, "Buffalo");
assert.match(profile.avatar_url, /avatar\?v=staff-photos-/);
assert.deepEqual(profile.avatar_frame.crop, [3, 3, 136]);
assert.ok(!("password_hash" in profile));
const forbiddenProfile = await localCall("/api/account/profile", {
  method: "PATCH", headers: { "content-type": "application/json" },
  body: JSON.stringify({ role: "viewer", username: "changed@example.com" }),
});
assert.equal(forbiddenProfile.status, 400);
const noCsrfPhoto = await worker.fetch(new Request("https://tracker.example/api/users/" + billDirectory.id + "/avatar", {
  method: "DELETE", headers: { cookie: sessionCookie },
}), { DB, BUCKET }, {});
assert.equal(noCsrfPhoto.status, 403);
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH4sAAAAASUVORK5CYII=", "base64"));
const photoPath = "/api/users/" + billDirectory.id + "/avatar";
const uploaded = await localCall(photoPath, { method: "PUT", headers: { "content-type": "image/png" }, body: png });
assert.equal(uploaded.status, 200);
assert.match((await uploaded.json()).profile.avatar_url, /avatar\?v=/);
assert.equal(photoObjects.size, 7);
const downloaded = await localCall(photoPath);
assert.equal(downloaded.status, 200);
assert.equal(downloaded.headers.get("content-type"), "image/png");
assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), png);
assert.equal((await worker.fetch(new Request("https://tracker.example" + photoPath), { DB, BUCKET }, {})).status, 401);
assert.equal((await localCall(photoPath, { method: "PUT", headers: { "content-type": "image/svg+xml" }, body: "<svg/>" })).status, 415);
assert.equal((await localCall(photoPath, { method: "PUT", headers: { "content-type": "image/png" }, body: "This is not an image" })).status, 415);
assert.equal((await localCall(photoPath, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(262145) })).status, 413);
assert.equal(photoObjects.size, 7);
const otherUser = admin.roles.find(person => person.id !== billDirectory.id);
database.prepare("UPDATE user_directory SET role = 'viewer' WHERE id = ?").run(billDirectory.id);
assert.equal((await localCall("/api/users/" + otherUser.id + "/avatar", { method: "DELETE" })).status, 403);
assert.equal((await localCall(photoPath, { method: "DELETE" })).status, 200);
assert.equal(photoObjects.size, 6);
database.prepare("UPDATE user_directory SET role = 'admin' WHERE id = ?").run(billDirectory.id);
await localCall("/api/bootstrap");
assert.equal(photoObjects.size, 6, "A removed portrait must not return after refresh");
assert.equal((await (await localCall("/api/account/profile")).json()).profile.avatar_url, null);

const csvDownload = await localCall("/api/export.csv");
assert.equal(csvDownload.status, 200);
assert.match(csvDownload.headers.get("content-type"), /text\/csv/);
assert.equal(csvDownload.headers.get("cache-control"), "no-store");
assert.match(await csvDownload.text(), /Central City/i);
for (const [format, mime] of Object.entries(EXPORT_FORMATS)) {
  const response = await localCall("/api/export." + format);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), mime);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="dn-dc-project-status.' + format + '"');
  assert.equal(response.headers.get("cache-control"), "no-store");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (format === "xlsx") assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  else assert.match(bytes.toString(), /Central City/i);
  for (const prefix of ["/api/export.", "/export."]) {
    assert.equal((await worker.fetch(new Request("https://tracker.example" + prefix + format), { DB, BUCKET }, {})).status, 401);
  }
}
database.prepare("UPDATE user_directory SET must_change_password = 1 WHERE id = ?").run(billDirectory.id);
for (const format of Object.keys(EXPORT_FORMATS)) assert.equal((await localCall("/api/export." + format)).status, 428);
database.prepare("UPDATE user_directory SET must_change_password = 0, account_status = 'suspended' WHERE id = ?").run(billDirectory.id);
for (const format of Object.keys(EXPORT_FORMATS)) assert.equal((await localCall("/api/export." + format)).status, 401);
database.prepare("UPDATE user_directory SET account_status = 'active' WHERE id = ?").run(billDirectory.id);
const sessionRow = database.prepare("SELECT id FROM login_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(billDirectory.id);
database.prepare("UPDATE login_sessions SET expires_at = datetime('now', '+60 seconds') WHERE id = ?").run(sessionRow.id);
const refreshed = await localCall("/api/bootstrap");
assert.equal(refreshed.status, 200);
assert.equal((await refreshed.json()).me.profile.location, "Buffalo");
assert.match(refreshed.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/);
assert.ok(database.prepare("SELECT expires_at > datetime('now', '+7 hours') AS renewed FROM login_sessions WHERE id = ?").get(sessionRow.id).renewed);
assert.equal((await localCall("/api/export.csv")).status, 200);
database.prepare("UPDATE login_sessions SET expires_at = datetime('now', '-1 second') WHERE id = ?").run(sessionRow.id);
assert.equal((await localCall("/api/bootstrap")).status, 401);
assert.equal((await localCall("/api/export.csv")).status, 401);
assert.equal((await localCall("/api/export.xlsx")).status, 401);
assert.equal((await localCall("/api/export.tsv")).status, 401);
assert.equal(JSON.stringify(database.prepare("SELECT * FROM projects ORDER BY id").all()), sourceBeforeProfiles);
assert.equal(JSON.stringify(database.prepare("SELECT * FROM project_updates ORDER BY id").all()), historyBeforeProfiles);

const historyProject = bootstrap.projects.find((project) => project.previous_update);
assert.ok(historyProject);
const historyResponse = await call(`/api/projects/${historyProject.id}/history`);
const history = await historyResponse.json();
assert.equal(history.history.length, 2);
assert.equal(history.history[0].reporting_period, "2026-08-28");
assert.equal(history.history[1].reporting_period, "2026-08-21");

const capital = bootstrap.projects.find((project) => project.project_type === "Capital");
const costResponse = await call(`/api/projects/${capital.id}/fields`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ precon_capp: 100, construction_capp: 200, add_capp: 50, anticipated_final_cost: 400 }),
});
assert.equal(costResponse.status, 200);
const afterCost = await (await call("/api/projects")).json();
const updatedCapital = afterCost.projects.find((project) => project.id === capital.id);
assert.equal(updatedCapital.approved_budget, 350);
assert.equal(updatedCapital.forecast_variance, 50);

const costAudit = database.prepare("SELECT * FROM audit_log WHERE action = 'field_update' ORDER BY id DESC LIMIT 1").get();
const costDetails = JSON.parse(costAudit.details);
assert.equal(costDetails.projectName, capital.name);
assert.equal(costDetails.actorName, "Pilot Owner");
assert.equal(costAudit.actor_email, "owner@example.com");
assert.deepEqual(costDetails.changes.find(change => change.field === "precon_capp"), {field:"precon_capp",before:capital.precon_capp,after:100});
assert.equal(costDetails.changes.find(change => change.field === "anticipated_final_cost").after, 400);
const priorActivityHistory = JSON.stringify(database.prepare("SELECT * FROM project_updates ORDER BY id").all());
database.prepare("UPDATE projects SET budget_risk = 'Low' WHERE id = ?").run(capital.id);
const beforeRiskCount = database.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n;
const riskPatch = { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({budget_risk:"Medium",password:"must-not-be-logged"}) };
assert.equal((await call("/api/projects/"+capital.id+"/fields",riskPatch)).status,200);
const riskAudit = database.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1").get();
assert.deepEqual(JSON.parse(riskAudit.details).changes,[{field:"budget_risk",before:"Low",after:"Medium"}]);
assert.doesNotMatch(riskAudit.details,/password|must-not-be-logged/);
assert.ok(riskAudit.created_at);
assert.equal((await call("/api/projects/"+capital.id+"/fields",riskPatch)).status,200);
assert.equal(database.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n,beforeRiskCount+1,"Unchanged values do not create duplicate audit events");
assert.equal((await call("/api/projects/999999/fields",riskPatch)).status,404);
assert.equal(JSON.stringify(database.prepare("SELECT * FROM project_updates ORDER BY id").all()),priorActivityHistory,"Field auditing preserves dated project activity");
database.exec("CREATE TEMP TRIGGER audit_test_reject BEFORE UPDATE ON projects WHEN NEW.name = 'Audit rollback test' BEGIN SELECT RAISE(ABORT, 'audit rollback probe'); END");
await assert.rejects(call("/api/projects/"+capital.id+"/fields",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Audit rollback test"})}),/audit rollback probe/);
assert.equal(database.prepare("SELECT name FROM projects WHERE id = ?").get(capital.id).name,capital.name);
assert.equal(database.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n,beforeRiskCount+1,"Failed updates roll back their audit entries");
database.exec("DROP TRIGGER audit_test_reject");
assert.equal(database.prepare("SELECT details FROM audit_log WHERE id = ?").get(costAudit.id).details,costAudit.details,"Existing audit entries are unchanged");

const activityResponse = await call(`/api/projects/${capital.id}/activity`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ current_update: "Smoke-test dated activity update." }),
});
assert.equal(activityResponse.status, 200);
const afterActivity = await (await call(`/api/projects/${capital.id}/history`)).json();
assert.equal(afterActivity.history[0].current_summary, "Smoke-test dated activity update.");

const roleResponse = await call("/api/admin/users", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ first_name: "Pilot", last_name: "Viewer", username: "viewer@example.com", user_email: "viewer@example.com", role: "viewer" }),
});
assert.equal(roleResponse.status, 200);
const beforeDeniedAuditCount = database.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n;
const viewerWrite = await worker.fetch(new Request(`https://tracker.example/api/projects/${capital.id}/fields`, {
  method: "PATCH",
  headers: {
    "content-type": "application/json",
    "oai-authenticated-user-id": "viewer-id",
    "oai-authenticated-user-email": "viewer@example.com",
  },
  body: JSON.stringify({ status: "Complete" }),
}), env, {});
assert.equal(viewerWrite.status, 403);
assert.equal(database.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n,beforeDeniedAuditCount,"Denied edits cannot create audit entries");

const defaultViewerWrite = await worker.fetch(new Request(`https://tracker.example/api/projects/${capital.id}/fields`, {
  method: "PATCH",
  headers: {
    "content-type": "application/json",
    "oai-authenticated-user-id": "new-user-id",
    "oai-authenticated-user-email": "new.user@delawarenorth.com",
  },
  body: JSON.stringify({ status: "Complete" }),
}), env, {});
assert.equal(defaultViewerWrite.status, 403);

const unknownRead = await worker.fetch(new Request("https://tracker.example/api/bootstrap", {
  headers: {
    "oai-authenticated-user-id": "unknown-id",
    "oai-authenticated-user-email": "unknown.user@example.com",
  },
}), env, {});
assert.equal(unknownRead.status, 403);

const development = bootstrap.projects.find((project) => project.project_type === "Development" && project.status === "Needs Status");
const developmentUpdate = await call(`/api/projects/${development.id}/development`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ requestor: "Pilot requestor", current_estimate: 125000 }),
});
assert.equal(developmentUpdate.status, 200);
const afterDevelopment = await (await call("/api/projects")).json();
assert.equal(afterDevelopment.projects.find((project) => project.id === development.id).development_current_estimate, 125000);
const developmentAudit = JSON.parse(database.prepare("SELECT details FROM audit_log WHERE action = 'development_update' ORDER BY id DESC LIMIT 1").get().details);
assert.equal(developmentAudit.projectName,development.name);
assert.equal(developmentAudit.changes.find(change => change.field === "current_estimate").after,125000);

const guideResponse = await call("/user-guide.pdf");
assert.equal(guideResponse.status, 200);
assert.equal(guideResponse.headers.get("content-type"), "application/pdf");
assert.equal(guideResponse.headers.get("cache-control"), "private, no-cache");
assert.deepEqual(Buffer.from(await guideResponse.arrayBuffer()), await readFile(new URL("../assets/DN_DC_Project_Tracker_User_Guide.pdf", import.meta.url)));

const logoutImageResponse = await call("/logout-icon.png");
assert.equal(logoutImageResponse.status, 200);
assert.equal(logoutImageResponse.headers.get("content-type"), "image/png");
assert.deepEqual(Buffer.from(await logoutImageResponse.arrayBuffer()), await readFile(new URL("../assets/logout-icon.png", import.meta.url)));
for (const [asset, mime] of [["refresh-icon.png", "image/png"], ["download-icon.jpg", "image/jpeg"]]) {
  const response = await call("/" + asset);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), mime);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL("../assets/" + asset, import.meta.url)));
}

const exportResponse = await call("/export.csv");
assert.equal(exportResponse.status, 200);
assert.match(await exportResponse.text(), /A&E \/ Pre-Con CAPP/);

const secondBootstrap = await (await call("/api/bootstrap")).json();
assert.equal(secondBootstrap.projects.length, 74);

const createDevelopment = await call("/api/projects", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Pilot Development Request",
    business_unit: "Gaming",
    section_name: "Pilot Development",
    project_type: "Development",
    initiative_number: "DEV-TEST",
    development_lead: "Pilot Owner",
    current_update: "Initial pilot request.",
  }),
});
assert.equal(createDevelopment.status, 201);
const afterCreate = await (await call("/api/projects")).json();
const createdDevelopment = afterCreate.projects.find((project) => project.name === "Pilot Development Request");
assert.ok(createdDevelopment);
assert.equal(createdDevelopment.initiative_number, "DEV-TEST");

const promoteDevelopment = await call(`/api/projects/${createdDevelopment.id}/promote`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    business_unit: "Gaming",
    capp_number: "CAPP-TEST",
    project_manager: "Pilot Owner",
    section_name: "Pilot Capital Heading",
  }),
});
assert.equal(promoteDevelopment.status, 200);
const afterPromote = await (await call("/api/projects")).json();
const promoted = afterPromote.projects.find((project) => project.id === createdDevelopment.id);
assert.equal(promoted.project_type, "Capital");
assert.equal(promoted.capp_number, "CAPP-TEST");
assert.ok(promoted.development_promoted_at);

// The admin backup has to restore into real D1, and real D1 is stricter than the
// SQLite this test runs on: it rejects BEGIN TRANSACTION outright, does not honour
// PRAGMA foreign_keys, and enforces foreign keys throughout an import. None of that
// fails here, so the generated SQL is asserted directly. Archive members are stored
// uncompressed, so the dump text is readable straight out of the ZIP.
const backupResponse = await call("/api/admin/backup");
assert.equal(backupResponse.status, 200);
assert.equal(backupResponse.headers.get("content-type"), "application/zip");
const backupSql = Buffer.from(await backupResponse.arrayBuffer()).toString("utf8");
assert.ok(backupSql.includes("PRAGMA defer_foreign_keys=TRUE;"), "backup must defer foreign keys");
assert.ok(!/^BEGIN TRANSACTION;$/m.test(backupSql), "D1 rejects explicit transactions");
assert.ok(!/^COMMIT;$/m.test(backupSql), "D1 rejects explicit transactions");
assert.ok(!/PRAGMA foreign_keys/.test(backupSql), "D1 ignores PRAGMA foreign_keys");
// A parent has to be written before anything referencing it.
const insertedAt = (table) => backupSql.indexOf(`-- ${table}: `);
for (const [parent, child] of [
  ["business_units", "projects"],
  ["projects", "project_updates"],
  ["projects", "development_details"],
  ["user_directory", "login_sessions"],
  ["user_directory", "login_events"],
]) {
  assert.ok(insertedAt(parent) > -1 && insertedAt(parent) < insertedAt(child),
    `${parent} must be written before ${child}`);
}

console.log("Smoke test passed: source data, KPIs, development workflow, history, formulas, export, secure roles, directory, and PDF guide.");
