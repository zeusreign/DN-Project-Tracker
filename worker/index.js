import { PAGE } from "./page.js";
import { SEED_PROJECTS } from "./seed.js";
import { OG_IMAGE_BASE64 } from "./social.js";
import { PROFILE_PHOTOS, PROFILE_PHOTO_BATCH } from "./profile-photos.js";
import { EXPORT_FORMATS, projectExportData, delimitedExport, xlsxExport } from "./exports.js";

const REPORTING_PERIOD = "2026-08-28";
const PREVIOUS_REPORTING_PERIOD = "2026-08-21";
const SEED_VERSION = "sanitized-review-synthetic-projects-v1";
const DIRECTORY_SEED_VERSION = "sanitized-review-synthetic-users-v1";
const PASSWORD_ITERATIONS = 100000;
const PASSWORD_MIN_LENGTH = 10;
const SESSION_SECONDS = 60 * 60 * 8;
const USER_DIRECTORY_SEED = [
  { first_name: "Sample", last_name: "Administrator", user_email: "administrator@example.invalid", role: "admin", company: "Example Organization" },
  { first_name: "Sample", last_name: "Editor", user_email: "editor@example.invalid", role: "editor", company: "Example Organization" },
  { first_name: "Sample", last_name: "Viewer", user_email: "viewer@example.invalid", role: "viewer", company: "Example Organization" },
];
// Password hashes, salts and real pilot credentials are excluded from this review copy.
const PILOT_CREDENTIALS = Object.freeze({});

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function base64Bytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asText(value, max = 12000) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function platformUserFrom(request) {
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  let name = null;
  if (encodedName && encoding === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(encodedName); } catch { name = null; }
  }
  return {
    id: request.headers.get("oai-authenticated-user-id"),
    email: request.headers.get("oai-authenticated-user-email"),
    name,
    auth_source: "openai",
  };
}

function cookieValue(request, name) {
  const cookies = String(request.headers.get("cookie") || "").split(";");
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function derivePassword(password, saltBase64, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(saltBase64), iterations,
  }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function passwordRecord(password) {
  const saltBytes = new Uint8Array(18);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToBase64(saltBytes);
  return {
    hash: await derivePassword(password, salt, PASSWORD_ITERATIONS),
    salt,
    iterations: PASSWORD_ITERATIONS,
    algorithm: "pbkdf2-sha256",
  };
}

async function passwordMatches(password, directory) {
  if (!directory?.password_hash || !directory?.password_salt) return false;
  if (directory.password_algorithm !== "pbkdf2-sha256") return false;
  const calculated = await derivePassword(password, directory.password_salt, directory.password_iterations || PASSWORD_ITERATIONS);
  if (calculated.length !== directory.password_hash.length) return false;
  let difference = 0;
  for (let index = 0; index < calculated.length; index += 1) {
    difference |= calculated.charCodeAt(index) ^ directory.password_hash.charCodeAt(index);
  }
  return difference === 0;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must include a special character.";
  return null;
}

async function localUserFrom(db, request) {
  const token = cookieValue(request, "dnc_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  const session = await db.prepare(`
    SELECT s.id AS session_id, s.csrf_token, d.id AS directory_id, d.user_email,
           d.first_name, d.last_name, d.role, d.account_status, d.site_access_status,
           d.must_change_password, s.created_at AS session_created_at
    FROM login_sessions s
    JOIN user_directory d ON d.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')
      AND s.created_at > datetime('now', '-24 hours')
      AND d.account_status = 'active' AND d.site_access_status = 'authorized'
  `).bind(tokenHash).first();
  if (!session) return null;
  await db.prepare("UPDATE login_sessions SET last_used_at = datetime('now') WHERE id = ?")
    .bind(session.session_id).run();
  return {
    id: `directory:${session.directory_id}`,
    directory_id: session.directory_id,
    email: session.user_email,
    name: `${session.first_name} ${session.last_name}`,
    directory_role: session.role,
    csrf_token: session.csrf_token,
    must_change_password: Boolean(session.must_change_password),
    session_id: session.session_id,
    session_created_at: session.session_created_at,
    auth_source: "local",
  };
}

async function authenticatedUser(db, request, env) {
  const local = await localUserFrom(db, request);
  if (local) return local;
  if (String(env?.ALLOW_PLATFORM_AUTH || "").toLowerCase() === "true") {
    const platform = platformUserFrom(request);
    if (platform.id && platform.email) return platform;
  }
  return null;
}

function envList(value) {
  return String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

async function roleFor(db, env, user) {
  if (!user?.email) return null;
  if (user.directory_role) return user.directory_role;
  const email = user.email.toLowerCase();
  if (envList(env.ADMIN_EMAILS).includes(email)) return "admin";
  const directory = await db.prepare("SELECT role, account_status FROM user_directory WHERE lower(user_email) = ?").bind(email).first();
  if (directory?.account_status === "suspended") return null;
  if (directory?.role) return directory.role;
  const saved = await db.prepare("SELECT role FROM user_roles WHERE lower(user_email) = ?").bind(email).first();
  return saved?.role || null;
}

function canWrite(role) {
  return role === "admin" || role === "editor";
}

function seedSheet(project) {
  if (project.project_type === "Development") return "Design & Development";
  return ({ Corporate: "CORP", Patina: "PATINA", Gaming: "GAMING", "Parks & Resorts": "PARKS", Sportservice: "SS" })[project.business_unit] || project.business_unit;
}

function normalizedSeedProjects() {
  const seen = new Map();
  return SEED_PROJECTS.map((project, index) => {
    const occurrence = (seen.get(project.source_key) || 0) + 1;
    seen.set(project.source_key, occurrence);
    return {
      ...project,
      source_key: occurrence === 1 ? project.source_key : project.source_key + ":source-row:" + (index + 1),
      source_sort_order: index + 1,
      section_name: project.project_type === "Development" ? project.business_unit : project.venue,
      source_sheet: seedSheet(project),
    };
  });
}

async function batchInChunks(db, statements, size = 35) {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

async function ensureSeed(db) {
  const marker = await db.prepare("SELECT value FROM app_meta WHERE key = 'seed_version'").first();
  if (marker?.value === SEED_VERSION) return;

  const seedProjects = normalizedSeedProjects();
  const units = [...new Set(seedProjects.map((project) => project.business_unit))];
  await db.batch(units.map((name, index) =>
    db.prepare("INSERT OR IGNORE INTO business_units (name, sort_order) VALUES (?, ?)")
      .bind(name, index + 1)
  ));

  const inserts = seedProjects.map((project) =>
    db.prepare(`
      INSERT OR IGNORE INTO projects (
        source_key, business_unit_id, venue, project_type, name, capp_number,
        initiative_number, project_manager, development_lead, status, phase,
        scope_description, current_update, previous_update, budget_risk,
        schedule_risk, precon_capp, construction_capp, add_capp, approved_budget,
        anticipated_final_cost, original_start_date, current_start_date,
        original_turnover_date, current_turnover_date, duration_change_days,
        reporting_period, source_sort_order, section_name, source_sheet, updated_at
      ) VALUES (
        ?, (SELECT id FROM business_units WHERE name = ?), ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).bind(
      project.source_key, project.business_unit, project.venue, project.project_type,
      project.name, project.capp_number, project.initiative_number,
      project.project_manager, project.development_lead, project.status, project.phase,
      project.scope_description, project.current_update, project.previous_update,
      project.budget_risk, project.schedule_risk, project.precon_capp,
      project.construction_capp, project.add_capp, project.approved_budget,
      project.anticipated_final_cost, project.original_start_date,
      project.current_start_date, project.original_turnover_date,
      project.current_turnover_date, project.duration_change_days,
      project.reporting_period, project.source_sort_order, project.section_name,
      project.source_sheet, project.reporting_period + "T12:00:00Z"
    )
  );
  await batchInChunks(db, inserts);

  const metadataUpdates = seedProjects.map((project) => db.prepare(`
    UPDATE projects
    SET source_sort_order = ?, section_name = ?, source_sheet = ?,
        status = CASE
          WHEN project_type = 'Development' AND ? = 'Needs Status' AND status = 'Planning'
          THEN 'Needs Status'
          ELSE status
        END
    WHERE source_key = ?
  `).bind(project.source_sort_order, project.section_name, project.source_sheet, project.status, project.source_key));
  await batchInChunks(db, metadataUpdates);

  const parksRepairs = seedProjects.filter((project) => project.business_unit === "Parks & Resorts" && project.project_type === "Capital").flatMap((project) => [
    db.prepare(`
      UPDATE projects
      SET current_update = CASE
            WHEN current_update IS NULL OR (length(current_update) <= 80 AND substr(current_update, -3) = '...') THEN ?
            ELSE current_update
          END,
          previous_update = CASE
            WHEN previous_update IS NULL OR (length(previous_update) <= 80 AND substr(previous_update, -3) = '...') THEN ?
            ELSE previous_update
          END
      WHERE source_key = ?
    `).bind(project.current_update, project.previous_update, project.source_key),
    db.prepare(`
      UPDATE project_updates
      SET current_summary = ?, previous_summary = ?
      WHERE source_key = ? AND author_name = 'Workbook Import'
    `).bind(project.current_update, project.previous_update, "initial:" + project.source_key),
    db.prepare(`
      UPDATE project_updates
      SET current_summary = ?
      WHERE source_key = ? AND author_name = 'Workbook Import'
    `).bind(project.previous_update, "previous:" + project.source_key),
  ]);
  await batchInChunks(db, parksRepairs);

  const updateInserts = seedProjects.filter((p) => p.current_update).map((project) =>
    db.prepare(`
      INSERT OR IGNORE INTO project_updates (
        source_key, project_id, reporting_period, current_summary, previous_summary,
        author_name, author_email, created_at
      ) VALUES (
        ?, (SELECT id FROM projects WHERE source_key = ?), ?, ?, ?, ?, ?, ?
      )
    `).bind(
      "initial:" + project.source_key,
      project.source_key,
      project.reporting_period,
      project.current_update,
      project.previous_update,
      "Workbook Import",
      null,
      project.reporting_period + "T12:00:00Z"
    )
  );
  await batchInChunks(db, updateInserts);

  const previousInserts = seedProjects.filter((p) => p.previous_update).map((project) =>
    db.prepare(`
      INSERT OR IGNORE INTO project_updates (
        source_key, project_id, reporting_period, current_summary,
        author_name, author_email, created_at
      ) VALUES (
        ?, (SELECT id FROM projects WHERE source_key = ?), ?, ?, ?, ?, ?
      )
    `).bind(
      "previous:" + project.source_key,
      project.source_key,
      PREVIOUS_REPORTING_PERIOD,
      project.previous_update,
      "Workbook Import",
      null,
      PREVIOUS_REPORTING_PERIOD + "T12:00:00Z"
    )
  );
  await batchInChunks(db, previousInserts);

  const developmentUpserts = seedProjects.filter((project) => project.project_type === "Development").map((project) => db.prepare(`
    INSERT INTO development_details (
      project_id, source_row, request_date, requestor, deliverable_due_date,
      consultants, food_service_design, design_capp, subsidiary_expense_total,
      original_estimate, original_estimate_date, current_estimate, current_estimate_date,
      updated_at
    ) SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
      FROM projects WHERE source_key = ?
    ON CONFLICT(project_id) DO UPDATE SET
      source_row = excluded.source_row,
      request_date = excluded.request_date,
      requestor = excluded.requestor,
      deliverable_due_date = excluded.deliverable_due_date,
      consultants = excluded.consultants,
      food_service_design = excluded.food_service_design,
      design_capp = excluded.design_capp,
      subsidiary_expense_total = excluded.subsidiary_expense_total,
      original_estimate = excluded.original_estimate,
      original_estimate_date = excluded.original_estimate_date,
      current_estimate = excluded.current_estimate,
      current_estimate_date = excluded.current_estimate_date,
      updated_at = datetime('now')
  `).bind(
    project.source_row, project.request_date, project.requestor, project.deliverable_due_date,
    project.consultants, project.food_service_design, project.design_capp,
    asNumber(project.subsidiary_expense_total), asNumber(project.original_estimate),
    project.original_estimate_date, asNumber(project.current_estimate), project.current_estimate_date,
    project.source_key
  ));
  await batchInChunks(db, developmentUpserts);
  await db.prepare(`
    INSERT INTO app_meta (key, value, updated_at) VALUES ('seed_version', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).bind(SEED_VERSION).run();
}

async function ensureDirectorySeed(db) {
  const marker = await db.prepare("SELECT value FROM app_meta WHERE key = 'directory_seed_version'").first();
  if (marker?.value === DIRECTORY_SEED_VERSION) return;
  const statements = USER_DIRECTORY_SEED.flatMap((person) => {
    const company = person.company || "Delaware North";
    const note = "Imported from the source project-reporting workbook.";
    const credential = PILOT_CREDENTIALS[person.user_email.toLowerCase()] || null;
    const accountStatus = credential ? "active" : "pending";
    const accessStatus = credential ? "authorized" : "pending";
    return [
      db.prepare(`
        UPDATE user_directory
        SET user_email = ?, username = ?, role = ?, title = COALESCE(?, title),
            department = 'Design & Construction', company = ?, business_unit_scope = 'All',
            account_status = CASE WHEN account_status = 'suspended' THEN account_status ELSE ? END,
            site_access_status = CASE WHEN site_access_status = 'revoked' THEN site_access_status ELSE ? END,
            password_hash = COALESCE(?, password_hash), password_salt = COALESCE(?, password_salt),
            password_iterations = COALESCE(?, password_iterations), password_algorithm = COALESCE(?, password_algorithm),
            password_changed_at = CASE WHEN ? IS NULL THEN password_changed_at ELSE datetime('now') END,
            must_change_password = CASE WHEN ? IS NULL THEN must_change_password ELSE 1 END,
            notes = ?, updated_at = datetime('now')
        WHERE lower(first_name) = lower(?) AND lower(last_name) = lower(?)
      `).bind(
        person.user_email, person.user_email, person.role, person.title || null,
        company, accountStatus, accessStatus, credential?.hash || null, credential?.salt || null,
        credential?.iterations || null, credential?.algorithm || null, credential?.hash || null,
        credential?.hash || null, note, person.first_name, person.last_name
      ),
      db.prepare(`
        INSERT INTO user_directory (
          user_email, username, first_name, last_name, role, title, department, company,
          business_unit_scope, account_status, site_access_status, notes, created_by,
          password_hash, password_salt, password_iterations, password_algorithm,
          password_changed_at, must_change_password
        )
        SELECT ?, ?, ?, ?, ?, ?, 'Design & Construction', ?,
          'All', ?, ?, ?, 'Source workbook import', ?, ?, ?, ?,
          CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, 1
        WHERE NOT EXISTS (
          SELECT 1 FROM user_directory
          WHERE lower(first_name) = lower(?) AND lower(last_name) = lower(?)
        )
      `).bind(
        person.user_email, person.user_email, person.first_name, person.last_name,
        person.role, person.title || null, company, accountStatus, accessStatus, note,
        credential?.hash || null, credential?.salt || null, credential?.iterations || null,
        credential?.algorithm || null, credential?.hash || null, person.first_name, person.last_name
      ),
    ];
  });
  await batchInChunks(db, statements);
  await db.prepare(`
    INSERT INTO app_meta (key, value, updated_at) VALUES ('directory_seed_version', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).bind(DIRECTORY_SEED_VERSION).run();
}

async function projectRows(db) {
  const result = await db.prepare(`
    SELECT
      p.*, b.name AS business_unit,
      d.source_row AS development_source_row,
      d.request_date AS development_request_date,
      d.requestor AS development_requestor,
      d.deliverable_due_date AS development_deliverable_due_date,
      d.consultants AS development_consultants,
      d.food_service_design AS development_food_service_design,
      d.design_capp AS development_design_capp,
      d.subsidiary_expense_total AS development_subsidiary_expense_total,
      d.original_estimate AS development_original_estimate,
      d.original_estimate_date AS development_original_estimate_date,
      d.current_estimate AS development_current_estimate,
      d.current_estimate_date AS development_current_estimate_date,
      d.promoted_at AS development_promoted_at,
      d.promoted_by AS development_promoted_by,
      CASE
        WHEN p.approved_budget IS NOT NULL AND p.anticipated_final_cost IS NOT NULL
        THEN p.anticipated_final_cost - p.approved_budget
        ELSE NULL
      END AS forecast_variance
    FROM projects p
    JOIN business_units b ON b.id = p.business_unit_id
    LEFT JOIN development_details d ON d.project_id = p.id
    WHERE p.archived_at IS NULL
    ORDER BY p.source_sort_order, p.id
  `).all();
  return result.results || [];
}

function summarize(projects) {
  const currentStatuses = new Set(["Active", "On Hold", "Closeout"]);
  const current = projects.filter((p) => currentStatuses.has(p.status));
  const units = {};
  for (const project of current) {
    const unit = units[project.business_unit] ||= {
      name: project.business_unit, projects: 0, capital: 0, highRisk: 0,
    };
    unit.projects += 1;
    unit.capital += Number(project.approved_budget) || 0;
    if (project.budget_risk === "High" || project.schedule_risk === "High") unit.highRisk += 1;
  }
  return {
    activeProjects: current.length,
    approvedCapital: current.reduce((sum, p) => sum + (Number(p.approved_budget) || 0), 0),
    atRisk: current.filter((p) => p.budget_risk === "High" || p.schedule_risk === "High").length,
    developmentProjects: current.filter((p) => p.project_type === "Development").length,
    needsStatus: projects.filter((p) => p.status === "Needs Status").length,
    units: Object.values(units),
    reportingPeriod: REPORTING_PERIOD,
  };
}

async function recentUpdates(db, limit = 40) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 40, 200));
  const result = await db.prepare(`
    SELECT u.id, u.reporting_period, u.current_summary, u.author_name, u.author_email,
           u.created_at, p.id AS project_id, p.name AS project_name, b.name AS business_unit
    FROM project_updates u
    JOIN projects p ON p.id = u.project_id
    JOIN business_units b ON b.id = p.business_unit_id
    ORDER BY u.reporting_period DESC, u.created_at DESC, u.id DESC
    LIMIT ?
  `).bind(boundedLimit).all();
  return result.results || [];
}

function requestAddress(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || null;
}

async function recordLoginEvent(db, directoryId, username, eventType, request) {
  await db.prepare(`
    INSERT INTO login_events (user_directory_id, username_attempted, event_type, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    directoryId || null, username || null, eventType, requestAddress(request),
    asText(request.headers.get("user-agent"), 500)
  ).run();
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  const username = asText(body?.username, 240)?.toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password) return error("Enter your User ID and temporary password.");
  const directory = await env.DB.prepare(`
    SELECT id, username, user_email, first_name, last_name, role, account_status,
           site_access_status, password_hash, password_salt, password_iterations,
           password_algorithm, must_change_password, failed_login_count, locked_until
    FROM user_directory
    WHERE lower(username) = ? OR lower(user_email) = ?
    LIMIT 1
  `).bind(username, username).first();
  if (directory?.locked_until && new Date(directory.locked_until + "Z") > new Date()) {
    await recordLoginEvent(env.DB, directory.id, username, "locked_attempt", request);
    return error("This account is temporarily locked. Contact an administrator or try again later.", 423);
  }
  const eligible = directory?.account_status === "active" && directory?.site_access_status === "authorized";
  const valid = eligible && await passwordMatches(password, directory);
  if (!valid) {
    if (directory) {
      const failures = Number(directory.failed_login_count || 0) + 1;
      await env.DB.prepare(`
        UPDATE user_directory
        SET failed_login_count = ?,
            locked_until = CASE WHEN ? >= 5 THEN datetime('now', '+15 minutes') ELSE locked_until END,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(failures, failures, directory.id).run();
    }
    await recordLoginEvent(env.DB, directory?.id, username, "failed", request);
    return error("The User ID or password is incorrect.", 401);
  }
  const token = randomToken(36);
  const csrfToken = randomToken(24);
  const tokenHash = await sha256(token);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_sessions WHERE expires_at <= datetime('now')"),
    env.DB.prepare(`
      INSERT INTO login_sessions (token_hash, user_id, csrf_token, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, datetime('now', '+8 hours'), ?, ?)
    `).bind(tokenHash, directory.id, csrfToken, requestAddress(request), asText(request.headers.get("user-agent"), 500)),
    env.DB.prepare(`
      UPDATE user_directory
      SET failed_login_count = 0, locked_until = NULL, last_login_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).bind(directory.id),
  ]);
  await recordLoginEvent(env.DB, directory.id, username, "success", request);
  return json({
    ok: true,
    name: `${directory.first_name} ${directory.last_name}`,
    role: directory.role,
    must_change_password: Boolean(directory.must_change_password),
  }, 200, {
    "set-cookie": `dnc_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`,
  });
}

async function handleLogout(request, env, user) {
  if (user?.auth_source === "local" && user.session_id) {
    await env.DB.prepare("DELETE FROM login_sessions WHERE id = ?").bind(user.session_id).run();
    await recordLoginEvent(env.DB, user.directory_id, user.email, "logout", request);
  }
  return json({ ok: true }, 200, {
    "set-cookie": "dnc_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
  });
}

async function handlePasswordChange(request, env, user) {
  if (user?.auth_source !== "local" || !user.directory_id) return error("Password changes are available for directory accounts.", 400);
  const body = await request.json().catch(() => null);
  const currentPassword = typeof body?.current_password === "string" ? body.current_password : "";
  const newPassword = typeof body?.new_password === "string" ? body.new_password : "";
  const confirmation = typeof body?.confirm_password === "string" ? body.confirm_password : "";
  if (newPassword !== confirmation) return error("The new passwords do not match.");
  const passwordError = validatePassword(newPassword);
  if (passwordError) return error(passwordError);
  const directory = await env.DB.prepare(`
    SELECT password_hash, password_salt, password_iterations, password_algorithm
    FROM user_directory WHERE id = ?
  `).bind(user.directory_id).first();
  if (!await passwordMatches(currentPassword, directory)) return error("The current password is incorrect.", 401);
  const record = await passwordRecord(newPassword);
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE user_directory
      SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?,
          password_changed_at = datetime('now'), must_change_password = 0, updated_at = datetime('now')
      WHERE id = ?
    `).bind(record.hash, record.salt, record.iterations, record.algorithm, user.directory_id),
    env.DB.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)
      VALUES ('password_change', 'user', ?, ?, ?, ?)
    `).bind(user.email, user.id, user.email, JSON.stringify({ selfService: true })),
  ]);
  return json({ ok: true });
}

async function importRequestedProfilePhotos(env, user) {
  if (!env.BUCKET) return;
  for (const photo of PROFILE_PHOTOS) {
    const version = PROFILE_PHOTO_BATCH + "-" + photo.key;
    const marker = "profile_photo_import:" + version;
    if (await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?").bind(marker).first()) continue;
    const row = await env.DB.prepare("SELECT id, avatar_key FROM user_directory WHERE lower(user_email) = ? AND first_name = ? AND last_name = ?")
      .bind(photo.email, photo.first_name, photo.last_name).first();
    if (!row) continue;
    const key = "avatars/" + row.id + "/" + version;
    try {
      // Do not replace photos uploaded since this batch was prepared.
      if (!row.avatar_key) await env.BUCKET.put(key, base64Bytes(photo.base64), { httpMetadata: { contentType: "image/png" } });
      await env.DB.batch([
        env.DB.prepare("UPDATE user_directory SET avatar_key = ?, avatar_mime = 'image/png', avatar_version = ?, updated_at = datetime('now') WHERE id = ? AND avatar_key IS NULL AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = ?)")
          .bind(key, version, row.id, marker),
        env.DB.prepare("INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details) SELECT 'profile_photo_import', 'user', ?, ?, ?, ? WHERE changes() = 1")
          .bind(String(row.id), user.id, user.email, JSON.stringify({ source: "Owner-supplied portrait", batch: PROFILE_PHOTO_BATCH })),
        env.DB.prepare("INSERT OR IGNORE INTO app_meta (key, value, updated_at) VALUES (?, 'applied', datetime('now'))").bind(marker),
      ]);
    } catch {
      console.error("Requested profile photo import unavailable", photo.key);
      // No completion marker on failure: retry next authorized admin visit.
    }
  }
}

function withAvatar(row) {
  const photo = PROFILE_PHOTOS.find(photo => row.avatar_version === PROFILE_PHOTO_BATCH + "-" + photo.key);
  return { ...row,
    avatar_url: row.avatar_version ? "/api/users/" + row.id + "/avatar?v=" + encodeURIComponent(row.avatar_version) : null,
    avatar_frame: photo ? { width: photo.width, height: photo.height, crop: photo.crop } : null,
  };
}

async function readProfile(db, id) {
  const row = await db.prepare("SELECT id, first_name, last_name, username, user_email, title, location, mobile_phone, role, avatar_version FROM user_directory WHERE id = ?").bind(id).first();
  return row ? withAvatar(row) : null;
}

async function handleAvatar(request, env, user, role, id) {
  if (!["GET", "PUT", "DELETE"].includes(request.method)) return error("Method not allowed.", 405);
  if (request.method !== "GET" && role !== "admin" && user.directory_id !== id) return error("You may only change your own profile photo.", 403);
  const row = await env.DB.prepare("SELECT avatar_key, avatar_mime FROM user_directory WHERE id = ?").bind(id).first();
  if (!row) return error("User not found.", 404);
  if (!env.BUCKET) return error("Photo storage is temporarily unavailable.", 503);
  if (request.method === "GET") {
    if (!row.avatar_key) return error("No photo uploaded.", 404);
    let photo;
    try { photo = await env.BUCKET.get(row.avatar_key); }
    catch { console.error("Profile photo read failed"); return error("Photo storage is temporarily unavailable.", 503); }
    if (!photo) return error("Photo not found.", 404);
    return new Response(photo.body, { headers: {
      "content-type": row.avatar_mime, "cache-control": "private, no-store",
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
    } });
  }
  let key = null, mime = null, version = null;
  if (request.method === "PUT") {
    mime = request.headers.get("content-type");
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) return error("Use a JPG, PNG or WebP photo.", 415);
    const maxBytes = 256 * 1024;
    if (Number(request.headers.get("content-length")) > maxBytes) return error("Photo must be smaller than 256 KB after resizing.", 413);
    const reader = request.body?.getReader();
    if (!reader) return error("A photo is required.");
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return error("Photo must be smaller than 256 KB after resizing.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    const valid = size > 12 && (
      (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[size - 2] === 255 && bytes[size - 1] === 217) ||
      (mime === "image/png" && [137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte)) ||
      (mime === "image/webp" && text(0,4) === "RIFF" && text(8,12) === "WEBP")
    );
    if (!valid) return error("That file is not a supported image.", 415);
    version = crypto.randomUUID(); key = "avatars/" + id + "/" + version;
    try { await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } }); }
    catch { return error("Your photo could not be stored. The previous photo is unchanged.", 503); }
  }
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE user_directory SET avatar_key = ?, avatar_mime = ?, avatar_version = ?, updated_at = datetime('now') WHERE id = ?").bind(key, mime, version, id),
      env.DB.prepare("INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details) VALUES ('profile_photo', 'user', ?, ?, ?, ?)").bind(String(id), user.id, user.email, JSON.stringify({ removed: !key })),
    ]);
  } catch (failure) {
    if (key) await env.BUCKET.delete(key).catch(() => {});
    console.error("Profile photo metadata save failed");
    return error("Your photo could not be saved. Please try again.", 503);
  }
  if (row.avatar_key) await env.BUCKET.delete(row.avatar_key).catch(() => {});
  return json({ profile: await readProfile(env.DB, id) });
}

async function handleApi(request, env, url) {
  if (!env.DB) return error("The project database is not available.", 503);
  await ensureSeed(env.DB);
  await ensureDirectorySeed(env.DB);
  if (request.method === "POST" && url.pathname === "/api/login") return handleLogin(request, env);
  const user = await authenticatedUser(env.DB, request, env);
  if (!user?.id || !user?.email) return error("Sign in with an authorized account to continue.", 401);
  const role = await roleFor(env.DB, env, user);
  if (!role) return error("This account is suspended or not authorized.", 403);
  if (user.auth_source === "local" && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (request.headers.get("x-csrf-token") !== user.csrf_token) return error("Your secure session could not be verified. Refresh and try again.", 403);
  }
  if (request.method === "POST" && url.pathname === "/api/logout") return handleLogout(request, env, user);
  if (request.method === "POST" && url.pathname === "/api/account/password") return handlePasswordChange(request, env, user);

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    if (role === "admin" && !user.must_change_password) await importRequestedProfilePhotos(env, user);
    const projects = await projectRows(env.DB);
    const profile = user.directory_id ? await readProfile(env.DB, user.directory_id) : null;
    // Renew an active session, never an expired one. Keep an absolute 24-hour cap.
    const sessionHeaders = {};
    if (user.auth_source === "local") {
      const remaining = Math.min(SESSION_SECONDS, Math.floor((Date.parse(user.session_created_at.replace(' ', 'T') + 'Z') + 86400000 - Date.now()) / 1000));
      if (remaining <= 0) return error("Your session has expired. Please sign in again.", 401);
      await env.DB.prepare("UPDATE login_sessions SET expires_at = datetime('now', ? || ' seconds') WHERE id = ?").bind(remaining, user.session_id).run();
      sessionHeaders["set-cookie"] = `dnc_session=${encodeURIComponent(cookieValue(request, "dnc_session"))}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${remaining}`;
    }
    return json({
      summary: summarize(projects),
      projects,
      updates: await recentUpdates(env.DB, 120),
      me: {
        email: user.email, name: user.name || user.email, role,
        auth_source: user.auth_source,
        must_change_password: Boolean(user.must_change_password),
        csrf_token: user.csrf_token || null,
        profile,
      },
    }, 200, sessionHeaders);
  }
  if (user.auth_source === "local" && user.must_change_password) {
    return error("Replace the temporary password before using the tracker.", 428);
  }
  const exportMatch = url.pathname.match(/^\/api\/export\.(csv|tsv|xlsx)$/);
  if (request.method === "GET" && exportMatch) return exportProjects(request, env, exportMatch[1], user);
  if (url.pathname === "/api/account/profile") {
    if (!user.directory_id) return error("Profile settings require an individual account.", 400);
    if (request.method === "GET") return json({ profile: await readProfile(env.DB, user.directory_id) });
    if (request.method === "PATCH") {
      const body = await request.json().catch(() => null);
      const allowed = new Set(["title", "location", "mobile_phone"]);
      if (!body || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key => !allowed.has(key) || (body[key] !== null && typeof body[key] !== "string"))) return error("Only job title, location and mobile phone can be changed here.");
      const fields = Object.keys(body);
      await env.DB.batch([
        env.DB.prepare("UPDATE user_directory SET " + fields.map(key => key + " = ?").join(", ") + ", updated_at = datetime('now') WHERE id = ?").bind(...fields.map(key => asText(body[key], key === "mobile_phone" ? 60 : 180)), user.directory_id),
        env.DB.prepare("INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details) VALUES ('profile_update', 'user', ?, ?, ?, ?)").bind(String(user.directory_id), user.id, user.email, JSON.stringify({ fields })),
      ]);
      return json({ profile: await readProfile(env.DB, user.directory_id) });
    }
    return error("Method not allowed.", 405);
  }
  const avatarMatch = url.pathname.match(/^\/api\/users\/(\d+)\/avatar$/);
  if (avatarMatch) return handleAvatar(request, env, user, role, Number(avatarMatch[1]));
  if (request.method === "GET" && url.pathname === "/api/projects") {
    return json({ projects: await projectRows(env.DB) });
  }
  if (request.method === "GET" && url.pathname === "/api/updates") {
    return json({ updates: await recentUpdates(env.DB, url.searchParams.get("limit") || 100) });
  }
  const historyMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/history$/);
  if (request.method === "GET" && historyMatch) {
    const projectId = Number(historyMatch[1]);
    const project = await env.DB.prepare(`
      SELECT p.*, b.name AS business_unit
      FROM projects p
      JOIN business_units b ON b.id = p.business_unit_id
      WHERE p.id = ?
    `).bind(projectId).first();
    if (!project) return error("Project not found.", 404);
    const history = await env.DB.prepare(`
      SELECT id, reporting_period, current_summary, previous_summary,
             author_name, author_email, created_at
      FROM project_updates
      WHERE project_id = ?
      ORDER BY reporting_period DESC, created_at DESC, id DESC
    `).bind(projectId).all();
    return json({ project, history: history.results || [] });
  }
  if (request.method === "GET" && url.pathname === "/api/admin") {
    if (role !== "admin") return error("Administrator access is required.", 403);
    const [roles, audit, counts] = await Promise.all([
      env.DB.prepare(`
        SELECT id, username, user_email, first_name, last_name, role, title, department, company,
               business_unit_scope, location, mobile_phone, account_status,
               site_access_status, notes, last_login_at, failed_login_count, locked_until, updated_at,
               CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS password_configured,
               must_change_password, password_changed_at, avatar_version
        FROM user_directory
        ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
                 last_name, first_name
      `).all(),
      env.DB.prepare(`SELECT action, entity_type, entity_key, actor_email, details, created_at FROM audit_log ORDER BY id DESC LIMIT 80`).all(),
      env.DB.prepare(`SELECT COUNT(*) AS projects, SUM(CASE WHEN source_sort_order = 9999 THEN 1 ELSE 0 END) AS added_projects FROM projects WHERE archived_at IS NULL`).first(),
    ]);
    return json({ roles: (roles.results || []).map(withAvatar), audit: audit.results || [], counts, configured_admin_count: envList(env.ADMIN_EMAILS).length });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/users") {
    if (role !== "admin") return error("Administrator access is required.", 403);
    const body = await request.json().catch(() => null);
    if (!body) return error("Invalid user data.");
    const directoryId = asNumber(body.id);
    const firstName = asText(body.first_name, 100);
    const lastName = asText(body.last_name, 100);
    const email = asText(body.user_email, 240)?.toLowerCase() || null;
    const username = asText(body.username, 240)?.toLowerCase() || email;
    const savedRole = asText(body.role, 20) || "viewer";
    const accountStatus = asText(body.account_status, 20) || "pending";
    const siteAccessStatus = email ? (asText(body.site_access_status, 30) || "pending") : "email_required";
    const temporaryPassword = typeof body.temporary_password === "string" ? body.temporary_password : "";
    const confirmation = typeof body.confirm_password === "string" ? body.confirm_password : "";
    if (!firstName || !lastName) return error("First and last name are required.");
    if (email && !email.includes("@")) return error("Enter a valid email address or leave it blank until verified.");
    if (username && !username.includes("@")) return error("User ID must be an email address.");
    if (!["admin", "editor", "viewer"].includes(savedRole)) return error("Choose admin, editor, or viewer.");
    if (!["pending", "active", "suspended"].includes(accountStatus)) return error("Choose pending, active, or suspended.");
    if (!["pending", "authorized", "email_required", "revoked"].includes(siteAccessStatus)) return error("Choose a valid site-access status.");
    if (temporaryPassword || confirmation) {
      if (temporaryPassword !== confirmation) return error("The temporary passwords do not match.");
      const passwordError = validatePassword(temporaryPassword);
      if (passwordError) return error(passwordError);
    }
    if (!directoryId && accountStatus === "active" && siteAccessStatus === "authorized" && !temporaryPassword) {
      return error("An active user requires a temporary password.");
    }
    if (email) {
      const duplicate = await env.DB.prepare("SELECT id FROM user_directory WHERE lower(user_email) = ? AND id != COALESCE(?, -1)")
        .bind(email, directoryId).first();
      if (duplicate) return error("That DN email is already assigned to another directory record.");
    }
    if (username) {
      const duplicate = await env.DB.prepare("SELECT id FROM user_directory WHERE lower(username) = ? AND id != COALESCE(?, -1)")
        .bind(username, directoryId).first();
      if (duplicate) return error("That User ID is already assigned to another directory record.");
    }
    const password = temporaryPassword ? await passwordRecord(temporaryPassword) : null;
    if (directoryId && !await env.DB.prepare("SELECT id FROM user_directory WHERE id = ?").bind(directoryId).first()) return error("User not found.", 404);
    const statements = [];
    if (directoryId) {
      statements.push(env.DB.prepare(`
        UPDATE user_directory SET user_email = ?, username = ?, first_name = ?, last_name = ?, role = ?,
          title = ?, department = ?, company = ?, business_unit_scope = ?, location = ?,
          mobile_phone = ?, account_status = ?, site_access_status = ?, notes = ?,
          password_hash = COALESCE(?, password_hash), password_salt = COALESCE(?, password_salt),
          password_iterations = COALESCE(?, password_iterations), password_algorithm = COALESCE(?, password_algorithm),
          password_changed_at = CASE WHEN ? IS NULL THEN password_changed_at ELSE datetime('now') END,
          must_change_password = CASE WHEN ? IS NULL THEN must_change_password ELSE 1 END,
          failed_login_count = CASE WHEN ? IS NULL THEN failed_login_count ELSE 0 END,
          locked_until = CASE WHEN ? IS NULL THEN locked_until ELSE NULL END,
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        email, username, firstName, lastName, savedRole, asText(body.title, 180),
        asText(body.department, 180) || "Design & Construction", asText(body.company, 180) || "Delaware North",
        asText(body.business_unit_scope, 240) || "All", asText(body.location, 180),
        asText(body.mobile_phone, 60), accountStatus, siteAccessStatus, asText(body.notes, 2000),
        password?.hash || null, password?.salt || null, password?.iterations || null, password?.algorithm || null,
        password?.hash || null, password?.hash || null, password?.hash || null, password?.hash || null, directoryId
      ));
    } else {
      statements.push(env.DB.prepare(`
        INSERT INTO user_directory (
          user_email, username, first_name, last_name, role, title, department, company,
          business_unit_scope, location, mobile_phone, account_status,
          site_access_status, notes, created_by, password_hash, password_salt,
          password_iterations, password_algorithm, password_changed_at,
          must_change_password, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END,
          CASE WHEN ? IS NULL THEN 1 ELSE 1 END, datetime('now'))
      `).bind(
        email, username, firstName, lastName, savedRole, asText(body.title, 180),
        asText(body.department, 180) || "Design & Construction", asText(body.company, 180) || "Delaware North",
        asText(body.business_unit_scope, 240) || "All", asText(body.location, 180),
        asText(body.mobile_phone, 60), accountStatus, siteAccessStatus, asText(body.notes, 2000), user.email,
        password?.hash || null, password?.salt || null, password?.iterations || null, password?.algorithm || null,
        password?.hash || null, password?.hash || null
      ));
    }
    if (email) statements.push(env.DB.prepare(`
      INSERT INTO user_roles (user_email, display_name, role, created_by, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_email) DO UPDATE SET display_name = excluded.display_name,
        role = excluded.role, updated_at = datetime('now')
    `).bind(email, firstName + " " + lastName, savedRole, user.email));
    statements.push(env.DB.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)
      VALUES ('directory_update', 'user', ?, ?, ?, ?)
    `).bind(email || firstName + " " + lastName, user.id, user.email, JSON.stringify({
      role: savedRole, accountStatus, siteAccessStatus, temporaryPasswordSet: Boolean(password),
    })));
    const savedResults = await env.DB.batch(statements);
    const savedId = directoryId || Number(savedResults[0].meta?.last_row_id ?? savedResults[0].lastInsertRowid);
    return json({ ok: true, id: savedId });
  }
  if (request.method === "POST" && url.pathname === "/api/projects") {
    if (!canWrite(role)) return error("Editor access is required.", 403);
    const body = await request.json().catch(() => null);
    if (!body) return error("Invalid project data.");
    const name = asText(body.name, 240);
    const businessUnit = asText(body.business_unit, 120);
    if (!name || !businessUnit) return error("Project name and business unit are required.");
    const projectType = asText(body.project_type, 40) === "Development" ? "Development" : "Capital";
    const sourceKey = "web:" + crypto.randomUUID();
    const initialUpdate = asText(body.current_update);
    const reportingPeriod = new Date().toISOString().slice(0, 10);
    const precon = asNumber(body.precon_capp);
    const construction = asNumber(body.construction_capp);
    const addCapp = asNumber(body.add_capp);
    const approved = [precon, construction, addCapp].some((value) => value !== null)
      ? (precon || 0) + (construction || 0) + (addCapp || 0)
      : asNumber(body.approved_budget);
    const statements = [
      env.DB.prepare("INSERT OR IGNORE INTO business_units (name, sort_order) VALUES (?, 99)").bind(businessUnit),
      env.DB.prepare(`
        INSERT INTO projects (
          source_key, business_unit_id, venue, project_type, name, capp_number, initiative_number,
          project_manager, development_lead, status, phase, scope_description,
          current_update, budget_risk, schedule_risk, precon_capp, construction_capp,
          add_capp, approved_budget, anticipated_final_cost, original_start_date,
          current_start_date, original_turnover_date, current_turnover_date,
          reporting_period, source_sort_order, section_name, source_sheet, updated_at
        ) VALUES (
          ?, (SELECT id FROM business_units WHERE name = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          (SELECT COALESCE(MAX(source_sort_order), 9998) + 1 FROM projects), ?, 'Web', datetime('now')
        )
      `).bind(
        sourceKey, businessUnit, asText(body.venue, 180) || "Portfolio",
        projectType, name, projectType === "Capital" ? asText(body.capp_number, 80) : null,
        projectType === "Development" ? asText(body.initiative_number, 80) : null,
        asText(body.project_manager, 180), asText(body.development_lead, 180),
        asText(body.status, 40) || "Active", asText(body.phase, 80) || "Planning",
        asText(body.scope_description), initialUpdate,
        asText(body.budget_risk, 20) || "Not Rated",
        asText(body.schedule_risk, 20) || "Not Rated", precon, construction, addCapp,
        approved, asNumber(body.anticipated_final_cost), asText(body.original_start_date, 20),
        asText(body.current_start_date, 20), asText(body.original_turnover_date, 20),
        asText(body.current_turnover_date, 20), reportingPeriod,
        asText(body.section_name, 180) || asText(body.venue, 180) || "Portfolio"
      ),
      env.DB.prepare(`
        INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)
        VALUES ('create', 'project', ?, ?, ?, ?)
      `).bind(sourceKey, user.id, user.email, JSON.stringify({ name, businessUnit })),
    ];
    if (initialUpdate) {
      statements.push(env.DB.prepare(`
        INSERT INTO project_updates (
          source_key, project_id, reporting_period, current_summary,
          author_name, author_email, author_id, created_at
        ) VALUES (
          ?, (SELECT id FROM projects WHERE source_key = ?), ?, ?, ?, ?, ?, datetime('now')
        )
      `).bind(
        "initial-web:" + sourceKey, sourceKey, reportingPeriod, initialUpdate,
        user.name || user.email || "Signed-in user", user.email, user.id
      ));
    }
    if (projectType === "Development") {
      statements.push(env.DB.prepare(`
        INSERT INTO development_details (project_id, updated_at)
        SELECT id, datetime('now') FROM projects WHERE source_key = ?
      `).bind(sourceKey));
    }
    await env.DB.batch(statements);
    return json({ ok: true }, 201);
  }

  const activityMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/(?:activity|update)$/);
  if (request.method === "POST" && activityMatch) {
    if (!canWrite(role)) return error("Editor access is required.", 403);
    const projectId = Number(activityMatch[1]);
    const body = await request.json().catch(() => null);
    if (!body) return error("Invalid activity update.");
    const existing = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
    if (!existing) return error("Project not found.", 404);
    const reportingPeriod = asText(body.reporting_period, 20) || new Date().toISOString().slice(0, 10);
    const currentSummary = asText(body.current_update);
    if (!currentSummary) return error("An activity update is required.");
    if (currentSummary === existing.current_update) return json({ ok: true, unchanged: true });
    const sourceKey = "update:" + projectId + ":" + crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE projects
        SET previous_update = current_update, current_update = ?,
            reporting_period = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(currentSummary, reportingPeriod, projectId),
      env.DB.prepare(`
        INSERT INTO project_updates (
          source_key, project_id, reporting_period, current_summary, previous_summary,
          author_name, author_email, author_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        sourceKey, projectId, reportingPeriod, currentSummary, existing.current_update,
        user.name || user.email || "Signed-in user", user.email, user.id
      ),
      env.DB.prepare(`
        INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)
        VALUES ('activity_update', 'project', ?, ?, ?, ?)
      `).bind(
        String(projectId), user.id, user.email,
        JSON.stringify({ reportingPeriod })
      ),
    ]);
    return json({ ok: true, reporting_period: reportingPeriod });
  }

  const developmentMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/development$/);
  if (request.method === "PATCH" && developmentMatch) {
    if (!canWrite(role)) return error("Editor access is required.", 403);
    const projectId = Number(developmentMatch[1]);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return error("Invalid development fields.");
    const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND project_type = 'Development'").bind(projectId).first();
    if (!project) return error("Development project not found.", 404);
    const textFields = new Set([
      "request_date", "requestor", "deliverable_due_date", "consultants",
      "food_service_design", "design_capp", "original_estimate_date", "current_estimate_date",
    ]);
    const numberFields = new Set(["subsidiary_expense_total", "original_estimate", "current_estimate"]);
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(body)) {
      if (textFields.has(key)) {
        sets.push(key + " = ?");
        values.push(asText(value));
      } else if (numberFields.has(key)) {
        sets.push(key + " = ?");
        values.push(asNumber(value));
      }
    }
    if (!sets.length) return error("No editable development fields were supplied.");
    sets.push("updated_at = datetime('now')");
    await env.DB.prepare("UPDATE development_details SET " + sets.join(", ") + " WHERE project_id = ?")
      .bind(...values, projectId).run();
    await env.DB.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)
      VALUES ('development_update', 'project', ?, ?, ?, ?)
    `).bind(String(projectId), user.id, user.email, JSON.stringify({ fields: Object.keys(body) })).run();
    return json({ ok: true });
  }

  const promoteMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/promote$/);
  if (request.method === "POST" && promoteMatch) {
    if (!canWrite(role)) return error("Editor access is required.", 403);
    const projectId = Number(promoteMatch[1]);
    const body = await request.json().catch(() => null);
    if (!body) return error("Invalid promotion data.");
    const businessUnit = asText(body.business_unit, 120);
    const cappNumber = asText(body.capp_number, 80);
    const sectionName = asText(body.section_name, 180);
    if (!businessUnit || !sectionName) return error("Business unit and major-project heading are required.");
    const project = await env.DB.prepare("SELECT id, name FROM projects WHERE id = ? AND project_type = 'Development'").bind(projectId).first();
    if (!project) return error("Development project not found or already promoted.", 404);
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO business_units (name, sort_order) VALUES (?, 99)").bind(businessUnit),
      env.DB.prepare(`
        UPDATE projects
        SET project_type = 'Capital', business_unit_id = (SELECT id FROM business_units WHERE name = ?),
            capp_number = ?, project_manager = COALESCE(?, development_lead), status = 'Active',
            phase = 'Planning', section_name = ?, source_sheet = 'Promoted from Design & Development',
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(businessUnit, cappNumber, asText(body.project_manager, 180), sectionName, projectId),
      env.DB.prepare(`
        UPDATE development_details
        SET promoted_at = datetime('now'), promoted_by = ?, updated_at = datetime('now')
        WHERE project_id = ?
      `).bind(user.email, projectId),
      env.DB.prepare(`
        INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)
        VALUES ('promote_to_capital', 'project', ?, ?, ?, ?)
      `).bind(String(projectId), user.id, user.email, JSON.stringify({ businessUnit, cappNumber, sectionName })),
    ]);
    return json({ ok: true });
  }

  const fieldsMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/fields$/);
  if (request.method === "PATCH" && fieldsMatch) {
    if (!canWrite(role)) return error("Editor access is required.", 403);
    const projectId = Number(fieldsMatch[1]);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return error("Invalid project fields.");
    const textFields = new Set([
      "name", "capp_number", "initiative_number", "project_manager", "development_lead",
      "status", "phase", "budget_risk", "schedule_risk", "original_start_date",
      "current_start_date", "original_turnover_date", "current_turnover_date",
      "scope_description", "section_name",
    ]);
    const numberFields = new Set(["precon_capp", "construction_capp", "add_capp", "anticipated_final_cost"]);
    const sets = [];
    const values = [];
    let costChanged = false;
    for (const [key, value] of Object.entries(body)) {
      if (textFields.has(key)) {
        sets.push(key + " = ?");
        values.push(asText(value));
      } else if (numberFields.has(key)) {
        sets.push(key + " = ?");
        values.push(asNumber(value));
        if (key !== "anticipated_final_cost") costChanged = true;
      }
    }
    if (!sets.length) return error("No editable fields were supplied.");
    sets.push("updated_at = datetime('now')");
    await env.DB.prepare("UPDATE projects SET " + sets.join(", ") + " WHERE id = ?")
      .bind(...values, projectId).run();
    const statements = [];
    if (costChanged) statements.push(env.DB.prepare(`
      UPDATE projects SET approved_budget = COALESCE(precon_capp, 0) + COALESCE(construction_capp, 0) + COALESCE(add_capp, 0)
      WHERE id = ?
    `).bind(projectId));
    statements.push(env.DB.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)
      VALUES ('field_update', 'project', ?, ?, ?, ?)
    `).bind(String(projectId), user.id, user.email, JSON.stringify({ fields: Object.keys(body) })));
    await env.DB.batch(statements);
    return json({ ok: true });
  }
  return error("Not found.", 404);
}

async function exportProjects(request, env, format, authenticated = null) {
  if (!Object.hasOwn(EXPORT_FORMATS, format)) return error("Unsupported export format.", 400);
  if (!env.DB) return error("Database unavailable", 503);
  await ensureSeed(env.DB);
  await ensureDirectorySeed(env.DB);
  const user = authenticated || await authenticatedUser(env.DB, request, env);
  if (!user?.id || !user?.email) return error("Sign in is required", 401);
  const role = await roleFor(env.DB, env, user);
  if (!role) return error("This account is not authorized", 403);
  if (user.auth_source === "local" && user.must_change_password) {
    return error("Replace the temporary password before exporting data", 428);
  }
  let body;
  try {
    const data = projectExportData(await projectRows(env.DB));
    body = format === "xlsx" ? xlsxExport(data) : delimitedExport(data, format === "tsv" ? "\t" : ",");
  } catch (failure) {
    console.error("Project export failed", format);
    return error(format === "xlsx" ? "Excel export could not be completed. Try CSV or tab-delimited, or contact an Administrator." : "Export could not be completed. Please try again.", 503);
  }
  return new Response(body, {
    headers: {
      "content-type": EXPORT_FORMATS[format],
      "content-disposition": 'attachment; filename="dn-dc-project-status.' + format + '"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    void ctx;
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/og.png") {
      return new Response(base64Bytes(OG_IMAGE_BASE64), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    }
    if (request.method === "GET" && url.pathname === "/logo.png") {
      return new Response(base64Bytes(DN_LOGO_BASE64), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    }
    if (request.method === "GET" && url.pathname === "/logout-icon.png") {
      return new Response(base64Bytes(LOGOUT_ICON_BASE64), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
    }
    if (request.method === "GET" && url.pathname === "/refresh-icon.png") {
      return new Response(base64Bytes(REFRESH_ICON_BASE64), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
    }
    if (request.method === "GET" && url.pathname === "/download-icon.jpg") {
      return new Response(base64Bytes(DOWNLOAD_ICON_BASE64), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
    }
    if (request.method === "GET" && url.pathname === "/user-guide.pdf") {
      return new Response(base64Bytes(USER_GUIDE_BASE64), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'inline; filename="DN_DC_Project_Tracker_User_Guide.pdf"',
          "cache-control": "private, no-cache",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    const exportMatch = url.pathname.match(/^\/export\.(csv|tsv|xlsx)$/);
    if (request.method === "GET" && exportMatch) return exportProjects(request, env, exportMatch[1]);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      });
    }
    if (url.pathname === "/health") return json({ ok: true });
    return new Response("Not found", { status: 404 });
  },
};
