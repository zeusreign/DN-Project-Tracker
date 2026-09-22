import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

// The forced password-change dialog is modal and hides its close and cancel
// controls, which also puts the header sign-off button out of reach. It needs its
// own way out, or the screen is a dead end for anyone unwilling to set a password.
const passwordDialogStart = pageSource.indexOf('<dialog id="passwordDialog"');
const passwordDialogMarkup = pageSource.slice(passwordDialogStart, pageSource.indexOf("</dialog>", passwordDialogStart));
assert.match(passwordDialogMarkup, /<button type="button" class="btn" id="passwordDialogSignOut" hidden>Sign out<\/button>/);
// Revealed only when the change is forced; the voluntary path keeps Cancel instead.
assert.match(CLIENT, /must_change_password\)\{[^}]*byId\("passwordDialogSignOut"\)\.hidden=false/);
assert.match(CLIENT, /changePasswordBtn[\s\S]{0,400}?byId\("passwordDialogSignOut"\)\.hidden=true/);
// It reuses the existing sign-out flow rather than introducing a second one.
assert.match(CLIENT, /byId\("passwordDialogSignOut"\)\.addEventListener\("click",signOut\)/);

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
// DNC-003. A temporary password grants no access to project data. Bootstrap is
// the whole workspace payload — projects, KPI summary and recent updates — and
// it used to answer 200 here because the 428 gate sat BELOW it in the route
// list and bootstrap returns early.
const localBootstrapResponse = await worker.fetch(new Request("https://tracker.example/api/bootstrap", {
  headers: { cookie: sessionCookie },
}), env, {});
assert.equal(localBootstrapResponse.status, 428, "bootstrap is blocked until the temporary password is replaced");
const blockedBootstrapBody = await localBootstrapResponse.json();
for (const leak of ["projects", "updates", "summary", "me"]) {
  assert.equal(blockedBootstrapBody[leak], undefined, `the 428 body must not carry ${leak}`);
}
for (const route of ["/api/projects", "/api/updates", "/api/projects/1/history", "/api/admin"]) {
  assert.equal((await worker.fetch(new Request("https://tracker.example" + route, {
    headers: { cookie: sessionCookie },
  }), env, {})).status, 428, `${route} is blocked before the password change`);
}
// The account must still be able to get out of this state: /api/session supplies
// the CSRF token, /api/account/password performs the change, /api/logout leaves.
const gatedSessionResponse = await worker.fetch(new Request("https://tracker.example/api/session", {
  headers: { cookie: sessionCookie },
}), env, {});
assert.equal(gatedSessionResponse.status, 200, "/api/session stays reachable while must_change_password is set");
const localBootstrap = { me: await gatedSessionResponse.json() };
assert.ok(localBootstrap.me.csrf_token, "the session probe still returns a CSRF token");
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

// --- Sign-out reliability -----------------------------------------------------
// Sign-out has to end the session and clear the cookie even when that session can no
// longer authenticate. Each case below used to fail a gate in handleApi() and come
// back 401 or 403 with the cookie still in place, which stranded the browser in a
// session it could neither use nor leave. All of it runs against the in-memory
// database created by this test.
const CLEARED_COOKIE = /^dnc_session=;/;
const loginAs = async (username, password) => {
  const response = await worker.fetch(new Request("https://tracker.example/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  }), env, {});
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
};
const logout = (cookie, extra = {}) => worker.fetch(new Request("https://tracker.example/api/logout", {
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...extra },
  body: "{}",
}), env, {});
const bootstrapWith = (cookie) => worker.fetch(
  new Request("https://tracker.example/api/bootstrap", { headers: { cookie } }), env, {},
);
const csrfFor = async (cookie) => (await (await bootstrapWith(cookie)).json()).me.csrf_token;
const sessionCount = (userId) =>
  database.prepare("SELECT COUNT(*) AS total FROM login_sessions WHERE user_id = ?").get(userId).total;
const liveSession = (id) =>
  database.prepare("SELECT COUNT(*) AS total FROM login_sessions WHERE id = ?").get(id).total;

// An expired session still signs out. This is the case Tom reported: /api/bootstrap
// is already returning 401 above, and sign-out used to return 401 with it.
const expiredLogout = await logout(sessionCookie, { "x-csrf-token": localBootstrap.me.csrf_token });
assert.equal(expiredLogout.status, 200, "an expired session must still sign out");
assert.match(expiredLogout.headers.get("set-cookie"), CLEARED_COOKIE);
assert.equal(liveSession(sessionRow.id), 0, "the expired session row must be deleted");

// Ordinary login then sign-out, and the session is unusable afterwards.
const freshCookie = await loginAs(billDirectory.username, replacementTestPassword);
assert.equal((await bootstrapWith(freshCookie)).status, 200);
const normalLogout = await logout(freshCookie, { "x-csrf-token": await csrfFor(freshCookie) });
assert.equal(normalLogout.status, 200);
assert.match(normalLogout.headers.get("set-cookie"), CLEARED_COOKIE);
assert.equal((await bootstrapWith(freshCookie)).status, 401, "a signed-out cookie must not authenticate");
assert.equal((await (await logout(freshCookie)).json()).ok, true, "signing out twice must not error");

// Another tab signs in and replaces the active session. The first tab is still
// holding the previous CSRF token, which used to fail the CSRF gate with a 403.
const tabOne = await loginAs(billDirectory.username, replacementTestPassword);
const tabOneCsrf = await csrfFor(tabOne);
const tabTwo = await loginAs(billDirectory.username, replacementTestPassword);
assert.notEqual(tabOne, tabTwo);
const crossTabLogout = await logout(tabTwo, { "x-csrf-token": tabOneCsrf });
assert.equal(crossTabLogout.status, 200, "a stale CSRF token must not block sign-out");
assert.match(crossTabLogout.headers.get("set-cookie"), CLEARED_COOKIE);
assert.equal((await bootstrapWith(tabTwo)).status, 401);

// A second account signed in at the same time is untouched by any of it.
const otherDirectory = admin.roles.find((person) =>
  person.id !== billDirectory.id && person.username && person.user_email && person.role);
assert.ok(otherDirectory, "a second directory account is required for session isolation");
const otherTestPassword = "Cc3!" + crypto.randomUUID();
const otherActivation = await call("/api/admin/users", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: otherDirectory.id,
    first_name: otherDirectory.first_name,
    last_name: otherDirectory.last_name,
    username: otherDirectory.username,
    user_email: otherDirectory.user_email,
    role: otherDirectory.role,
    account_status: "active",
    site_access_status: "authorized",
    temporary_password: otherTestPassword,
    confirm_password: otherTestPassword,
  }),
});
assert.equal(otherActivation.status, 200);
// Activation issues a temporary password, so this account starts behind the 428
// gate. Cleared here because the subject of this block is multi-tab session
// behaviour, not the password gate — which has its own coverage above.
database.prepare("UPDATE user_directory SET must_change_password = 0 WHERE id = ?").run(otherDirectory.id);
const otherCookie = await loginAs(otherDirectory.username, otherTestPassword);
assert.equal((await bootstrapWith(otherCookie)).status, 200);
assert.equal(sessionCount(otherDirectory.id), 1);

// Sign the first tab out as well, so the account ends with nothing open.
assert.equal((await logout(tabOne, { "x-csrf-token": tabOneCsrf })).status, 200);
assert.equal(sessionCount(billDirectory.id), 0, "sign-out must leave no session for that account");
assert.equal((await bootstrapWith(otherCookie)).status, 200, "another account's session must survive");
assert.equal(sessionCount(otherDirectory.id), 1);

// No cookie, and a cookie holding a token that matches nothing, both clear cleanly
// without touching anyone else's session.
const noCookieLogout = await logout(null);
assert.equal(noCookieLogout.status, 200);
assert.match(noCookieLogout.headers.get("set-cookie"), CLEARED_COOKIE);
const unknownTokenLogout = await logout("dnc_session=" + crypto.randomUUID());
assert.equal(unknownTokenLogout.status, 200);
assert.match(unknownTokenLogout.headers.get("set-cookie"), CLEARED_COOKIE);
assert.equal(sessionCount(otherDirectory.id), 1, "an unknown token must delete nothing");

// Sign-out stays audited, including from the expired session.
assert.ok(database.prepare(
  "SELECT COUNT(*) AS total FROM login_events WHERE user_directory_id = ? AND event_type = 'logout'",
).get(billDirectory.id).total >= 4, "each sign-out must be recorded");

// Sign-out is still not a way to reach anything else while unauthenticated.
assert.equal((await worker.fetch(new Request("https://tracker.example/api/projects", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
}), env, {})).status, 401);

// The browser half has to reach the sign-in screen either way. Returning early on a
// failed request is what left the workspace on screen behind an unusable session.
const signOutSource = CLIENT.slice(CLIENT.indexOf("async function signOut("), CLIENT.indexOf("async function changePassword("));
function buildSignOut(apiImplementation) {
  const shown = [];
  const toasted = [];
  const announced = [];
  // `toast` is stubbed so that a regression shows up as "the sign-in screen was
  // never reached" rather than as an incidental ReferenceError. `announceSession`
  // is stubbed for the same reason, and recorded so the other-tab signal is checked
  // rather than merely tolerated.
  const run = new Function("api", "showSignIn", "toast", "announceSession", signOutSource + ";return signOut;")(
    apiImplementation, (message) => shown.push(message), (message) => toasted.push(message),
    (message) => announced.push(message),
  );
  return { run, shown, toasted, announced };
}
const succeedingSignOut = buildSignOut(async () => ({ ok: true }));
await succeedingSignOut.run();
assert.deepEqual(succeedingSignOut.shown, [""], "a successful sign-out shows the sign-in screen");
assert.deepEqual(succeedingSignOut.announced, [{ type: "signed-out" }],
  "signing out tells the other tabs, so they do not sit on a workspace that can no longer save");
const failingSignOut = buildSignOut(async () => { throw new Error("Your session has expired. Please sign in again."); });
await failingSignOut.run();
assert.equal(failingSignOut.shown.length, 1, "a failed sign-out must still reach the sign-in screen");
assert.match(failingSignOut.shown[0], /signed off on this device/);
assert.deepEqual(failingSignOut.announced, [{ type: "signed-out" }],
  "a failed sign-out still tells the other tabs — the cookie is cleared either way");

// --- Inactivity: what may extend a session, and what the worker reports ---------
// Three faults are guarded here, all of them previously reproducible:
//   1. the browser counted down from its own idea of the deadline, so the warning
//      could be scheduled for minutes after the worker had ended the session;
//   2. a background read refreshed the session, so an untouched desk stayed alive;
//   3. a tab holding a replaced security token was signed out instead of resynced.
const newestSession = () =>
  database.prepare("SELECT id, user_id, last_used_at FROM login_sessions ORDER BY id DESC LIMIT 1").get();
const lastUsed = (id) =>
  database.prepare("SELECT last_used_at FROM login_sessions WHERE id = ?").get(id).last_used_at;
// Ageing the row is the only honest way to simulate an idle desk: it is exactly
// what the worker measures, and it touches nothing else.
const ageSession = (id, seconds) => database.prepare(
  "UPDATE login_sessions SET last_used_at = datetime('now', '-" + Number(seconds) + " seconds') WHERE id = ?",
).run(id);
const sessionState = async (cookie) => {
  const response = await worker.fetch(
    new Request("https://tracker.example/api/session", { headers: { cookie } }), env, {},
  );
  return { status: response.status, body: response.status === 200 ? await response.json() : null };
};

const idleCookie = await loginAs(billDirectory.username, replacementTestPassword);
const idleSession = newestSession();
const idleTotal = (await sessionState(idleCookie)).body.idle_seconds;
assert.ok(idleTotal > 0, "the worker must publish the timeout it enforces");

// A read reports the truth and changes nothing. This is the number the browser
// counts down from, so if it were generous the warning would arrive too late.
ageSession(idleSession.id, 300);
const agedStamp = lastUsed(idleSession.id);
const afterProbe = await sessionState(idleCookie);
assert.equal(afterProbe.status, 200);
assert.equal(lastUsed(idleSession.id), agedStamp, "reading /api/session must not count as activity");
assert.ok(Math.abs(afterProbe.body.idle_remaining - (idleTotal - 300)) <= 2,
  "the worker must report the idle time actually left, not a full period");

// Astra's finding 3: a background bootstrap used to reset remaining idle time from
// about 300 seconds back to the full period. Loading the workspace is a read.
const backgroundBootstrap = await bootstrapWith(idleCookie);
assert.equal(backgroundBootstrap.status, 200);
assert.equal(lastUsed(idleSession.id), agedStamp, "a background bootstrap must not extend the session");
const bootstrapMe = (await backgroundBootstrap.json()).me;
assert.ok(Math.abs(bootstrapMe.idle_remaining - (idleTotal - 300)) <= 2,
  "bootstrap must hand the browser the real remaining time, so it cannot assume a full period");

// The top-level /export.<fmt> route authenticates on its own path rather than
// through handleApi, and was the one authenticated GET still pushing the timeout
// back. Downloading a file is a read.
assert.equal((await worker.fetch(new Request("https://tracker.example/export.csv", {
  headers: { cookie: idleCookie },
}), env, {})).status, 200);
assert.equal(lastUsed(idleSession.id), agedStamp, "a top-level export download must not extend the session");

// The explicit ping is the one request that does extend, and it is only ever sent
// in response to real input.
const staySignedIn = await worker.fetch(new Request("https://tracker.example/api/session", {
  method: "POST", headers: { cookie: idleCookie, "content-type": "application/json", "x-csrf-token": await csrfFor(idleCookie) },
  body: "{}",
}), env, {});
assert.equal(staySignedIn.status, 200);
assert.notEqual(lastUsed(idleSession.id), agedStamp, "a deliberate activity ping must extend the session");
assert.equal((await staySignedIn.json()).idle_remaining, idleTotal, "extending leaves the full period");

// Past the cut-off nothing revives it — including the ping, which must not be a way
// to renew a session the worker has already ended.
ageSession(idleSession.id, idleTotal + 60);
assert.equal((await sessionState(idleCookie)).status, 401, "an idled-out session must stop authenticating");
assert.equal((await bootstrapWith(idleCookie)).status, 401);
assert.equal((await worker.fetch(new Request("https://tracker.example/api/session", {
  method: "POST", headers: { cookie: idleCookie, "content-type": "application/json" }, body: "{}",
}), env, {})).status, 401, "an expired session must not be renewable");

// Idleness is per session row: one browser going quiet never signs the person out
// of another, which is what keeps this safe to enforce at all.
const activeCookie = await loginAs(billDirectory.username, replacementTestPassword);
const activeSession = newestSession();
const quietCookie = await loginAs(billDirectory.username, replacementTestPassword);
ageSession(newestSession().id, idleTotal + 60);
assert.equal((await bootstrapWith(quietCookie)).status, 401, "the idle session ends");
assert.equal((await bootstrapWith(activeCookie)).status, 200, "the other session survives it");
assert.equal(lastUsed(activeSession.id), lastUsed(activeSession.id));

// --- A tab holding a replaced security token resyncs instead of being ejected ---
// Signing in again replaces the shared cookie. The first tab still holds the old
// token; its next write is correctly refused, and it must be able to recover by
// asking for the current one rather than dumping the user at the sign-in screen.
const staleTab = await loginAs(billDirectory.username, replacementTestPassword);
const staleCsrf = await csrfFor(staleTab);
const replacementTab = await loginAs(billDirectory.username, replacementTestPassword);
const replacementCsrf = await csrfFor(replacementTab);
assert.notEqual(staleCsrf, replacementCsrf, "a new sign-in must mint a new security token");
// The gate is untouched: the stale token is still rejected.
assert.equal((await worker.fetch(new Request("https://tracker.example/api/session", {
  method: "POST", headers: { cookie: replacementTab, "content-type": "application/json", "x-csrf-token": staleCsrf },
  body: "{}",
}), env, {})).status, 403, "CSRF must still reject a token that does not match the session");
assert.equal((await worker.fetch(new Request("https://tracker.example/api/session", {
  method: "POST", headers: { cookie: replacementTab, "content-type": "application/json" }, body: "{}",
}), env, {})).status, 403, "CSRF must still reject a missing token");
// And the recovery path exists: a read hands back the token that does match.
const resyncProbe = await sessionState(replacementTab);
assert.equal(resyncProbe.status, 200);
assert.equal(resyncProbe.body.csrf_token, replacementCsrf,
  "the session probe must return the current token so a stale tab can resync");
assert.equal((await worker.fetch(new Request("https://tracker.example/api/session", {
  method: "POST", headers: { cookie: replacementTab, "content-type": "application/json", "x-csrf-token": resyncProbe.body.csrf_token },
  body: "{}",
}), env, {})).status, 200, "the resynced token must be accepted");

// Leave the table as this block found it — the checks below count this user's
// sessions, and the tabs opened above were never signed out.
database.prepare("DELETE FROM login_sessions WHERE user_id = ?").run(billDirectory.id);

// --- The browser half: local input must not grant time by itself ----------------
// Astra's finding 1. The old noteActivity() pushed the local deadline forward on
// every keystroke but only told the worker every 11 minutes at the 45-minute
// setting, so the browser believed the session outlived what the worker would
// honour and the warning could be scheduled for after it had already ended.
const idleBlockSource = CLIENT.slice(
  CLIENT.indexOf("var idleTimers="), CLIENT.indexOf("function onSessionMessage("),
);
function buildIdleBlock(sessionReply) {
  const dialog = { open: false, close() { this.open = false; }, showModal() { this.open = true; }, textContent: "" };
  const calls = [];
  const api = async (path, options) => {
    calls.push({ path, method: (options && options.method) || "GET" });
    return sessionReply;
  };
  const state = { me: { auth_source: "local", idle_seconds: 2700, idle_warning_seconds: 60, idle_remaining: 2700 }, csrf: "old-token" };
  const built = new Function(
    "state", "byId", "api", "showSignIn", "BroadcastChannel",
    idleBlockSource + ";return {noteActivity:noteActivity,startIdleWatch:startIdleWatch," +
      "clearIdleTimers:clearIdleTimers,deadline:function(){return idleDeadline}};",
  ).call(null, state, () => dialog, api, () => {}, undefined);
  return { ...built, calls, state };
}
{
  const idle = buildIdleBlock({ idle_remaining: 2700, csrf_token: "fresh-token" });
  // Pretend the worker said only 100 seconds are left.
  idle.startIdleWatch(100);
  const beforeInput = idle.deadline();
  assert.ok(Math.abs(beforeInput - (Date.now() + 100000)) < 2000, "the countdown starts from the worker's figure");

  // Typing. The deadline must NOT move until the worker has answered.
  idle.noteActivity();
  assert.equal(idle.deadline(), beforeInput,
    "local input must not extend the deadline on its own — this is the drift Astra reproduced");
  assert.deepEqual(idle.calls, [{ path: "/api/session", method: "POST" }],
    "input sends one activity ping");

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(idle.deadline() > beforeInput + 2_000_000,
    "once the worker confirms, the deadline moves to what the worker granted");

  // The ping is throttled, so a burst of input is not a request per keystroke.
  idle.noteActivity(); idle.noteActivity(); idle.noteActivity();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(idle.calls.length, 1, "further input inside the throttle window sends nothing further");
  idle.clearIdleTimers();
}
{
  // A tab holding a replaced token adopts the current one from the worker's reply,
  // so its next write is signed correctly instead of being refused as a 403.
  const idle = buildIdleBlock({ idle_remaining: 2700, csrf_token: "fresh-token" });
  idle.startIdleWatch(100);
  assert.equal(idle.state.csrf, "old-token");
  idle.noteActivity();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(idle.state.csrf, "fresh-token",
    "a tab must adopt the current security token rather than keep a replaced one");
  idle.clearIdleTimers();
}

// --- The browser half: what a tab does when a sibling tab changes the session ---
// Tabs share one cookie. Without this a tab kept a workspace on screen after the
// session it belonged to had been signed out somewhere else.
const tabMessageSource = CLIENT.slice(
  CLIENT.indexOf("function onSessionMessage("), CLIENT.indexOf("async function signOut("),
);
function buildTabHandler(signedIn = true) {
  const calls = { shown: [], loaded: [], resynced: [], stopped: 0 };
  const run = new Function(
    "state", "showSignIn", "stopIdleWatch", "load", "resyncIdleWatch",
    tabMessageSource + ";return onSessionMessage;",
  )(
    { me: signedIn ? { auth_source: "local" } : null },
    (message) => calls.shown.push(message),
    () => { calls.stopped += 1; },
    (reset) => { calls.loaded.push(reset); return Promise.resolve(); },
    () => { calls.resynced.push(true); },
  );
  return { run, calls };
}
const signedOutTab = buildTabHandler();
signedOutTab.run({ type: "signed-out" });
assert.equal(signedOutTab.calls.shown.length, 1, "a sign-out elsewhere must move this tab to the sign-in screen");
assert.match(signedOutTab.calls.shown[0], /signed out in another tab/);
assert.equal(signedOutTab.calls.stopped, 1, "and must stop its idle countdown");

const replacedTab = buildTabHandler();
replacedTab.run({ type: "signed-in" });
assert.deepEqual(replacedTab.calls.loaded, [false],
  "a sign-in elsewhere must reload, since the cookie may now belong to a different account");

const extendedTab = buildTabHandler();
extendedTab.run({ type: "extended" });
assert.equal(extendedTab.calls.resynced.length, 1,
  "an extension elsewhere must be re-checked against the worker, never trusted as a figure");
assert.equal(extendedTab.calls.shown.length, 0, "and must not disturb the tab otherwise");

// A tab that is already signed out stays put, and junk on the channel is ignored.
const idleTab = buildTabHandler(false);
idleTab.run({ type: "signed-out" });
assert.equal(idleTab.calls.shown.length, 0, "a tab already signed out needs no further handling");
const noisyTab = buildTabHandler();
[null, undefined, "signed-out", 42, {}, { type: "nonsense" }].forEach((junk) => noisyTab.run(junk));
assert.equal(noisyTab.calls.shown.length + noisyTab.calls.loaded.length + noisyTab.calls.resynced.length, 0,
  "only recognised messages may act; the channel is not a command surface");

// --- An administrator's password reset ends that user's sessions ---------------
// A reset that leaves the old sessions alive does not take the account back:
// whoever was signed in under the previous password stays signed in.
const resetTestPassword = "Dd4!" + crypto.randomUUID();
const adminSaveUser = (person, temporary) => call("/api/admin/users", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: person.id,
    first_name: person.first_name,
    last_name: person.last_name,
    username: person.username,
    user_email: person.user_email,
    role: person.role,
    account_status: "active",
    site_access_status: "authorized",
    ...(temporary ? { temporary_password: temporary, confirm_password: temporary } : {}),
  }),
});

// One account signs in and stays signed in throughout as the control.
const billBeforeReset = await loginAs(billDirectory.username, replacementTestPassword);
assert.equal((await bootstrapWith(billBeforeReset)).status, 200);
assert.equal(sessionCount(billDirectory.id), 1);
assert.equal(sessionCount(otherDirectory.id), 1);

// Editing a directory record without setting a password must not sign anyone out.
assert.equal((await adminSaveUser(billDirectory, null)).status, 200);
assert.equal(sessionCount(billDirectory.id), 1, "an edit without a password must not end sessions");
assert.equal((await bootstrapWith(billBeforeReset)).status, 200);

// The reset itself.
assert.equal((await adminSaveUser(billDirectory, resetTestPassword)).status, 200, "the reset must still succeed");
assert.equal(sessionCount(billDirectory.id), 0, "a password reset must end that user's sessions");
assert.equal((await bootstrapWith(billBeforeReset)).status, 401, "the session held before the reset must stop working");
assert.equal((await worker.fetch(new Request("https://tracker.example/api/export.csv", {
  headers: { cookie: billBeforeReset },
}), env, {})).status, 401);

// Nobody else is disturbed.
assert.equal(sessionCount(otherDirectory.id), 1, "another user's session must survive the reset");
assert.equal((await bootstrapWith(otherCookie)).status, 200);

// The reset still behaves as before: new password works, old one does not, and the
// forced password change is still applied.
const billAfterReset = await loginAs(billDirectory.username, resetTestPassword);
// The forced change is now proven by the gate itself: bootstrap refuses with 428
// rather than returning a payload that merely reports the flag.
assert.equal(database.prepare("SELECT must_change_password FROM user_directory WHERE id = ?")
  .get(billDirectory.id).must_change_password, 1, "a reset must still force a password change");
assert.equal((await bootstrapWith(billAfterReset)).status, 428,
  "and that forced change must block the workspace payload");
assert.equal((await worker.fetch(new Request("https://tracker.example/api/projects", {
  headers: { cookie: billAfterReset },
}), env, {})).status, 428);
assert.equal((await worker.fetch(new Request("https://tracker.example/api/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: billDirectory.username, password: replacementTestPassword }),
}), env, {})).status, 401, "the password replaced by the reset must no longer work");

// --- Admin login history ------------------------------------------------------
// The events were already being written by recordLoginEvent(); nothing read them.
// Everything asserted here is produced by the sign-ins and failures performed above.
await worker.fetch(new Request("https://tracker.example/api/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "nobody@example.invalid", password: "not-a-real-password" }),
}), env, {});
const adminWithHistory = await (await call("/api/admin")).json();
assert.ok(Array.isArray(adminWithHistory.login_events), "the admin payload must carry login history");
assert.ok(adminWithHistory.login_events.length > 0);
for (const expected of ["success", "failed", "logout"]) {
  assert.ok(adminWithHistory.login_events.some((event) => event.event_type === expected),
    `login history must include ${expected} events`);
}
// Newest first, and every column the view renders is present.
const historyIds = adminWithHistory.login_events.map((event) => event.id);
assert.deepEqual(historyIds, [...historyIds].sort((left, right) => right - left), "login history must be newest first");
for (const column of ["id", "created_at", "event_type", "username_attempted", "ip_address", "user_agent"]) {
  assert.ok(column in adminWithHistory.login_events[0], `a login history row must expose ${column}`);
}
// A failed attempt on a real User ID resolves to that account...
const failedForBill = adminWithHistory.login_events.find((event) =>
  event.event_type === "failed" && event.username_attempted === billDirectory.username.toLowerCase());
assert.ok(failedForBill, "the failed sign-in performed above must be recorded");
assert.equal(failedForBill.user_email.toLowerCase(), billDirectory.user_email.toLowerCase());
// ...and one on a User ID that matches nothing is still kept, claiming no account.
const unmatchedAttempt = adminWithHistory.login_events.find((event) =>
  event.username_attempted === "nobody@example.invalid");
assert.ok(unmatchedAttempt, "an attempt on an unknown User ID must still be recorded");
assert.equal(unmatchedAttempt.event_type, "failed");
assert.equal(unmatchedAttempt.user_email, null, "an unmatched attempt must not claim an account");

// A viewer must not reach the history at all.
const viewerDirectory = admin.roles.find((person) =>
  person.id !== billDirectory.id && person.id !== otherDirectory.id && person.username && person.user_email);
assert.ok(viewerDirectory, "a third directory account is required for the permission check");
const viewerTestPassword = "Ee5!" + crypto.randomUUID();
assert.equal((await call("/api/admin/users", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: viewerDirectory.id,
    first_name: viewerDirectory.first_name,
    last_name: viewerDirectory.last_name,
    username: viewerDirectory.username,
    user_email: viewerDirectory.user_email,
    role: "viewer",
    account_status: "active",
    site_access_status: "authorized",
    temporary_password: viewerTestPassword,
    confirm_password: viewerTestPassword,
  }),
})).status, 200);
// Cleared so the request reaches the admin route rather than stopping at the 428 gate.
database.prepare("UPDATE user_directory SET must_change_password = 0 WHERE id = ?").run(viewerDirectory.id);
const viewerCookie = await loginAs(viewerDirectory.username, viewerTestPassword);
const viewerAdminResponse = await worker.fetch(
  new Request("https://tracker.example/api/admin", { headers: { cookie: viewerCookie } }), env, {});
assert.equal(viewerAdminResponse.status, 403, "a viewer must not reach the admin payload");
assert.doesNotMatch(await viewerAdminResponse.text(), /login_events/, "a refusal must not leak the history");

// The view that renders it.
assert.match(pageSource, /<tbody id="loginEventList"><\/tbody>/);
assert.match(pageSource, /id="loginOutcomeFilter"/);
assert.match(pageSource, /id="loginSearch"/);
const historyHelpers = new Function(CLIENT.slice(
  CLIENT.indexOf("var loginOutcomes="), CLIENT.indexOf("function filteredLoginEvents("),
) + ";return {loginOutcome,browserLabel};")();
assert.equal(historyHelpers.loginOutcome("success").label, "Successful sign-in");
assert.equal(historyHelpers.loginOutcome("success").kind, "ok");
assert.equal(historyHelpers.loginOutcome("failed").kind, "bad");
assert.equal(historyHelpers.loginOutcome("locked_attempt").kind, "bad");
// An event type this view does not know about is shown, never dropped.
assert.equal(historyHelpers.loginOutcome("password_reset").label, "password reset");
assert.equal(historyHelpers.browserLabel(
  "Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
), "Chrome on Windows");
assert.equal(historyHelpers.browserLabel(
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
), "Safari on macOS");
assert.equal(historyHelpers.browserLabel(null), "—");

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


// --- QA regression suite (DNC-001, -002, -004, -005) -------------------------
// Each block reproduces a defect Mina reported and asserts the corrected
// behaviour. DNC-003 is covered above, at the temporary-password gate.

{
  const capitalProject = (await (await call("/api/projects")).json())
    .projects.find((project) => project.project_type === "Capital");

  // --- DNC-001: monetary decimal precision ---------------------------------
  // The details dialog seeded its currency inputs with moneyText(), which
  // formats to whole dollars. Opening the dialog and saving without touching a
  // field therefore rounded the cents away. setMoneyValue() now writes the raw
  // value, so a dialog round trip is lossless.
  const centsValue = 143336.8;
  assert.equal((await call(`/api/projects/${capitalProject.id}/fields`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ construction_capp: centsValue }),
  })).status, 200);
  assert.equal(
    database.prepare("SELECT construction_capp FROM projects WHERE id = ?").get(capitalProject.id).construction_capp,
    centsValue, "fractional costs must survive a PATCH unrounded");

  // The client-side guarantee: the seeded input value must parse back to the
  // identical number. These are the real implementations lifted from CLIENT.
  const moneyHelpers = new Function(`
    ${CLIENT.match(/var money=new Intl\.NumberFormat\([^;]*\);/)[0]}
    ${CLIENT.match(/function num\(v\)\{[^}]*\}/)[0]}
    ${CLIENT.match(/function moneyText\(v\)\{[^}]*\}/)[0]}
    ${CLIENT.match(/function moneyNumber\(v\)\{[\s\S]*?\n?.*?return Number\.isFinite\(n\)\?n:null\}/)[0]}
    var store={};
    function byId(id){return store[id]||(store[id]={value:"",dataset:{}})}
    ${CLIENT.match(/function setMoneyValue\(id,value\)\{[^}]*\}/)[0]}
    return {setMoneyValue:setMoneyValue,moneyNumber:moneyNumber,moneyText:moneyText,byId:byId};
  `)();
  for (const value of [143336.8, 2499096.55, 637960.25, 0.99, 0, 1000000]) {
    moneyHelpers.setMoneyValue("fConstruction", value);
    const readBack = moneyHelpers.moneyNumber(moneyHelpers.byId("fConstruction").value);
    assert.equal(readBack, value,
      `opening and saving the details dialog must not alter ${value} (read back ${readBack})`);
  }
  // Display formatting is unchanged — whole dollars in the table.
  assert.equal(moneyHelpers.moneyText(143336.8), "$143,337");

  // --- DNC-002: invalid values are rejected, nothing partially written ------
  const beforeInvalid = database.prepare("SELECT * FROM projects WHERE id = ?").get(capitalProject.id);
  const auditBeforeInvalid = database.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n;
  const invalidPayloads = [
    [{ status: "Banana" }, "unsupported status"],
    [{ budget_risk: "extreme" }, "unsupported risk"],
    [{ schedule_risk: "" }, "blank risk"],
    [{ original_start_date: "2026-13-45" }, "impossible date"],
    [{ current_turnover_date: "not a date" }, "unparseable date"],
    [{ current_start_date: "2026-02-30" }, "day that does not exist in that month"],
    [{ precon_capp: "12abc" }, "non-numeric cost"],
    [{ anticipated_final_cost: "N/A" }, "cost placeholder text"],
    [{ name: "   " }, "blank project name"],
    // Mixed valid + invalid must be rejected whole, not partially applied.
    [{ project_manager: "A Real Person", status: "Banana" }, "valid field alongside an invalid one"],
  ];
  for (const [payload, label] of invalidPayloads) {
    const response = await call(`/api/projects/${capitalProject.id}/fields`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 400, `${label} must be rejected with 400`);
    assert.ok((await response.json()).error, `${label} must explain why`);
  }
  assert.deepEqual(
    database.prepare("SELECT * FROM projects WHERE id = ?").get(capitalProject.id), beforeInvalid,
    "a rejected payload must not change a single column");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n, auditBeforeInvalid,
    "a rejected payload must not write an audit row");

  // Valid values on the same fields still save.
  assert.equal((await call(`/api/projects/${capitalProject.id}/fields`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "On Hold", budget_risk: "High", current_start_date: "2026-02-28" }),
  })).status, 200, "valid values must still be accepted");
  const afterValid = database.prepare("SELECT status, budget_risk, current_start_date FROM projects WHERE id = ?").get(capitalProject.id);
  assert.equal(afterValid.status, "On Hold");
  assert.equal(afterValid.budget_risk, "High");
  assert.equal(afterValid.current_start_date, "2026-02-28");
  // Blanking a date is legitimate — it clears the field.
  assert.equal((await call(`/api/projects/${capitalProject.id}/fields`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ current_start_date: "" }),
  })).status, 200, "a blank date clears the field rather than failing");

  // Status vocabulary is per project type.
  const developmentProject = (await (await call("/api/projects")).json())
    .projects.find((project) => project.project_type === "Development");
  assert.equal((await call(`/api/projects/${developmentProject.id}/fields`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "Needs Status" }),
  })).status, 200, "Needs Status is valid for a Development project");
  assert.equal((await call(`/api/projects/${capitalProject.id}/fields`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "Needs Status" }),
  })).status, 400, "Needs Status is not valid for a Capital project");

  // --- DNC-004: a double-clicked save leaves one history row ----------------
  const activityText = "DNC-004 duplicate guard: one row expected.";
  const historyBefore = database.prepare("SELECT COUNT(*) AS n FROM project_updates WHERE project_id = ?")
    .get(capitalProject.id).n;
  const auditBeforeActivity = database.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'activity_update'").get().n;
  const previousSummary = database.prepare("SELECT current_update FROM projects WHERE id = ?").get(capitalProject.id).current_update;

  const firstSubmit = await call(`/api/projects/${capitalProject.id}/activity`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ current_update: activityText, reporting_period: "2026-09-21" }),
  });
  assert.equal(firstSubmit.status, 200);

  // The key must be derived from the project, period and text — not random. A
  // random key is what let a second insert through, because the UNIQUE index on
  // source_key had nothing to collide with.
  const storedKey = database.prepare(
    "SELECT source_key FROM project_updates WHERE project_id = ? ORDER BY id DESC LIMIT 1")
    .get(capitalProject.id).source_key;
  const expectedDigest = createHash("sha256").update(activityText).digest("hex");
  assert.equal(storedKey, `update:${capitalProject.id}:2026-09-21:${expectedDigest}`,
    "the activity source_key must be deterministic, so an identical resubmission collides");

  // Now the second half of a double click. The two requests overlap in
  // production, so the later one reads the project row BEFORE the earlier one
  // has written it — it sees the old text and sails past the "same as current"
  // check. Rewinding current_update reproduces exactly that stale read, and does
  // so deterministically; Promise.all cannot, because this harness runs each
  // batch() inside a real SQLite transaction and serialises them.
  database.prepare("UPDATE projects SET current_update = ? WHERE id = ?")
    .run(previousSummary, capitalProject.id);
  const secondSubmit = await call(`/api/projects/${capitalProject.id}/activity`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ current_update: activityText, reporting_period: "2026-09-21" }),
  });
  assert.equal(secondSubmit.status, 200, "the duplicate submission is absorbed, not rejected noisily");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM project_updates WHERE project_id = ?").get(capitalProject.id).n,
    historyBefore + 1, "two identical submissions must leave exactly one history row");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'activity_update'").get().n,
    auditBeforeActivity + 1, "and exactly one audit row");
  assert.equal(
    database.prepare("SELECT current_update FROM projects WHERE id = ?").get(capitalProject.id).current_update,
    activityText, "the update still lands on the project");

  // Genuinely different text still records its own row.
  assert.equal((await call(`/api/projects/${capitalProject.id}/activity`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ current_update: "DNC-004: a different update.", reporting_period: "2026-09-21" }),
  })).status, 200);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM project_updates WHERE project_id = ?").get(capitalProject.id).n,
    historyBefore + 2, "different text must still create a second row");

  // Re-saving text that is already current remains a no-op.
  const beforeUnchanged = database.prepare("SELECT COUNT(*) AS n FROM project_updates WHERE project_id = ?").get(capitalProject.id).n;
  const unchangedResponse = await call(`/api/projects/${capitalProject.id}/activity`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ current_update: "DNC-004: a different update." }),
  });
  assert.equal(unchangedResponse.status, 200);
  assert.equal((await unchangedResponse.json()).unchanged, true);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM project_updates WHERE project_id = ?").get(capitalProject.id).n,
    beforeUnchanged, "an unchanged resave must write nothing");

  // The dialog button must refuse a second click while the first is in flight.
  assert.match(CLIENT, /async function saveModalActivity\(\)\{var button=byId\("saveActivityBtn"\);if\(button\.disabled\)return;/,
    "saveModalActivity must guard against a double click");

  // --- DNC-005: Development save with no development_details row ------------
  // A Development project created outside POST /api/projects has no row in
  // development_details. The PATCH was an UPDATE only, so it matched nothing,
  // wrote nothing, and still answered ok — the dialog reported success and the
  // values were gone after a refresh.
  const orphan = database.prepare(`
    INSERT INTO projects (source_key, business_unit_id, venue, project_type, name,
      initiative_number, development_lead, status, phase, scope_description,
      current_update, reporting_period, section_name, source_sheet, updated_at)
    SELECT 'test:orphan-development', business_unit_id, 'Orphan Venue', 'Development',
      'Orphan Development Fixture', 'ORPHAN-001', 'Test Development Lead', 'Active',
      'Development', 'Development project with no development_details row.',
      'Synthetic update.', '2026-09-04', 'Orphan Section', 'TEST', datetime('now')
    FROM projects WHERE id = ? RETURNING id
  `).get(developmentProject.id);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM development_details WHERE project_id = ?").get(orphan.id).n, 0,
    "the fixture starts with no development_details row");

  const orphanSave = await call(`/api/projects/${orphan.id}/development`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestor: "Mina QA", current_estimate: 12345.67, deliverable_due_date: "2026-10-15" }),
  });
  assert.equal(orphanSave.status, 200, "the save reports success");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM development_details WHERE project_id = ?").get(orphan.id).n, 1,
    "and the row it needed is created");

  // The real test: the values survive the read the UI performs after a refresh.
  const afterRefresh = (await (await call("/api/projects")).json())
    .projects.find((project) => project.id === orphan.id);
  assert.equal(afterRefresh.development_requestor, "Mina QA", "requestor survives a refresh");
  assert.equal(afterRefresh.development_current_estimate, 12345.67, "estimate survives a refresh, cents intact");
  assert.equal(afterRefresh.development_deliverable_due_date, "2026-10-15", "due date survives a refresh");

  // Saving again updates in place rather than duplicating the row.
  assert.equal((await call(`/api/projects/${orphan.id}/development`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestor: "Mina QA second pass" }),
  })).status, 200);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS n FROM development_details WHERE project_id = ?").get(orphan.id).n, 1,
    "a second save must not create a second row");
  assert.equal(
    database.prepare("SELECT requestor FROM development_details WHERE project_id = ?").get(orphan.id).requestor,
    "Mina QA second pass");

  // The audit trail still records the change.
  const orphanAudit = JSON.parse(database.prepare(
    "SELECT details FROM audit_log WHERE action = 'development_update' ORDER BY id DESC LIMIT 1").get().details);
  assert.ok(orphanAudit.changes.some((change) => change.field === "requestor"),
    "the development save is audited");

  // Invalid development input is rejected by the same rules (DNC-002).
  assert.equal((await call(`/api/projects/${orphan.id}/development`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ current_estimate: "not a number" }),
  })).status, 400, "development costs are validated too");
  assert.equal((await call(`/api/projects/${orphan.id}/development`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ deliverable_due_date: "2026-13-01" }),
  })).status, 400, "development dates are validated too");

  // A non-Development project still cannot use this route.
  assert.equal((await call(`/api/projects/${capitalProject.id}/development`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestor: "nobody" }),
  })).status, 404, "the development route stays closed to Capital projects");

  console.log("QA regressions: DNC-001, DNC-002, DNC-004 and DNC-005 covered.");
}

console.log("Smoke test passed: source data, KPIs, development workflow, history, formulas, export, secure roles, directory, and PDF guide.");
