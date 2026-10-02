// Stage 2 of the Central City photo migration: apply the manifest from
// scripts/central-city-manifest.mjs to a remote environment.
//
//   # classify only — reads the tracker, writes nothing (the default)
//   node scripts/migrate-central-city-photos.mjs --target prod
//
//   # apply — both flags are required, and --target is never defaulted
//   node scripts/migrate-central-city-photos.mjs --target prod --execute
//
// WHY THIS EXISTS ALONGSIDE import-central-city.mjs: that script imports the
// five hand-prepared example photos and dedupes with
// `WHERE id=? OR photo_number=?`, so it reports the four already-imported
// progress photos as "already present" and skips them. Those four are exactly
// the ones that must be REPLACED with their full-resolution counterparts.
//
// Replacing them cannot be done by deleting and re-inserting: `idx_photo_number`
// is UNIQUE over `photo_number WHERE photo_number IS NOT NULL` and takes no
// notice of `deleted_at`, so a soft-deleted row keeps its number reserved and
// the re-insert fails. This script therefore UPDATES those four in place —
// same row, same id, same photo number, new bytes at the existing object key.
//
// Idempotent: each photo's bytes are digested and recorded on its audit row, so
// a re-run skips anything already migrated with identical content. A run that
// dies part-way can simply be repeated.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sqlLiteral } from "./apply-workbook-import.mjs";
import { DATABASES } from "./workbook/tracker.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = join(projectRoot, "node_modules/.bin/wrangler");
const BUCKETS = { prod: "dnc-tracker-assets", test: "dnc-tracker-assets-dev" };
const ACTOR = "central-city-migration";
const MIGRATION = "central_city_photo_migration";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const target = arg("target");
const apply = process.argv.includes("--execute");
const manifestPath = arg("manifest", ".central-city-import/manifest.json");

if (!target || !DATABASES[target] || !BUCKETS[target]) {
  console.error("Usage: migrate-central-city-photos.mjs --target <prod|test> [--execute] [--manifest path]");
  console.error("--target is never defaulted.");
  process.exit(2);
}
const database = DATABASES[target];
const bucket = BUCKETS[target];
const manifest = JSON.parse(readFileSync(resolve(projectRoot, manifestPath), "utf8"));

if (manifest.problems?.length) {
  console.error("ERROR: the manifest reports " + manifest.problems.length + " unresolved problem(s). Fix them and regenerate.");
  for (const p of manifest.problems) console.error("  ! " + p);
  process.exit(1);
}



// `fetch failed` from wrangler against the Cloudflare API is common here and is
// not a real failure — docs/WORKBOOK_IMPORT.md records the same thing for
// `d1 export`. Retrying in-process keeps a 200-call run from needing several
// manual passes. Anything that is not a transport error is raised immediately:
// a UNIQUE violation must not be retried.
const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|502|503|504|Too many requests|429/i;
function wrangler(args, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync(WRANGLER, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    } catch (error) {
      const text = [error.message, error.stdout, error.stderr].join("\n");
      if (attempt >= attempts || !TRANSIENT.test(text)) throw error;
      execFileSync(process.execPath, ["-e", "setTimeout(()=>{}," + attempt * 2000 + ")"]);
    }
  }
}

function query(sql) {
  const out = wrangler(["d1", "execute", database.id, "--remote", "--yes", "--json", "--command", sql]);
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  const result = parsed[0];
  // The read path must never write. A response claiming otherwise means a
  // statement did something this script does not intend; stopping is safer
  // than carrying on against an unknown state.
  if (result.meta?.rows_written) throw new Error("A read query reported rows_written=" + result.meta.rows_written + ": " + sql);
  return result.results || [];
}

// `--command` rather than `--file`: the file path routes through D1's bulk
// import, which takes the database briefly offline ("your D1 database will be
// unavailable to serve queries") and fails transiently far more often. These
// batches are two statements, so the command path is both safer and quicker.
function runStatements(statements, label) {
  wrangler(["d1", "execute", database.id, "--remote", "--yes", "--command", statements.join("\n")]);
  return label;
}

function putObject(key, path, mime) {
  wrangler(["r2", "object", "put", bucket + "/" + key, "--file", path, "--remote", "--content-type", mime]);
}

const digestOf = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);

// --- Resolve the project -----------------------------------------------------
// Pinned by exact venue and name, exactly as import-central-city.mjs does. More
// or fewer than one match means the mapping is not what this script assumes.
const projects = query(
  "SELECT id,name,venue FROM projects WHERE upper(venue)='CENTRAL CITY' AND name='New Construction Complex'",
);
if (projects.length !== 1) {
  console.error("ERROR: expected exactly one Central City / New Construction Complex project, found " + projects.length + ".");
  process.exit(1);
}
const pid = projects[0].id;

// --- Read current state ------------------------------------------------------
const existing = query(
  "SELECT id,project_id,kind,photo_number,object_key,caption,notes,area,category,taken_by," +
  "date_taken,reporting_period,include_in_report,revision,deleted_at FROM project_photos",
);
const byNumber = new Map(existing.filter((r) => r.photo_number).map((r) => [r.photo_number, r]));
const coverBefore = existing.filter((r) => r.project_id === pid && r.kind === "cover" && !r.deleted_at);

// Photos already migrated with identical bytes, from the audit trail. Matching
// on the digest rather than the photo number is what makes a second run a
// no-op while still re-applying a photo whose file has changed.
const done = new Set(
  query(
    "SELECT details FROM audit_log WHERE action='" + MIGRATION + "' AND entity_key=" + sqlLiteral(String(pid)),
  ).flatMap((row) => {
    try {
      const d = JSON.parse(row.details);
      return d.photo_number && d.digest ? [d.photo_number + ":" + d.digest] : [];
    } catch { return []; }
  }),
);

// --- Classify ----------------------------------------------------------------
const plan = { insert: [], update: [], skip: [], conflict: [] };

for (const photo of manifest.photos) {
  const path = resolve(projectRoot, photo.absolute_path);
  const digest = digestOf(path);
  const entry = { ...photo, path, digest };
  const current = byNumber.get(photo.photo_number);

  if (done.has(photo.photo_number + ":" + digest)) { plan.skip.push({ ...entry, reason: "already migrated with identical bytes" }); continue; }

  if (!current) { plan.insert.push(entry); continue; }

  if (current.project_id !== pid) {
    plan.conflict.push({ ...entry, reason: `photo number is already used by project ${current.project_id}, not Central City (${pid})` });
    continue;
  }
  if (current.deleted_at) {
    // The unique index still reserves this number, so neither an insert nor an
    // update of a deleted row is right. A human has to decide.
    plan.conflict.push({ ...entry, reason: "existing row is soft-deleted; its photo number is still reserved by idx_photo_number" });
    continue;
  }
  if (current.kind !== "progress") {
    plan.conflict.push({ ...entry, reason: `existing row is kind='${current.kind}', not 'progress'` });
    continue;
  }
  plan.update.push({ ...entry, current });
}

const orphanNumbers = [...byNumber.values()]
  .filter((r) => r.project_id === pid && !r.deleted_at && !manifest.photos.some((p) => p.photo_number === r.photo_number))
  .map((r) => r.photo_number);

// --- Report ------------------------------------------------------------------
console.log((apply ? "APPLYING" : "DRY RUN") + " against " + database.name + " / " + bucket);
console.log("Project      : " + pid + "  " + projects[0].venue + " / " + projects[0].name);
console.log("Manifest     : " + manifestPath + "  (" + manifest.photos.length + " photos, " +
  (manifest.totals.bytes / 1048576).toFixed(1) + " MiB)");
console.log("");
console.log("  EXPECTED RESULT");
console.log("    new photos to insert        " + String(plan.insert.length).padStart(3));
console.log("    existing photos to update   " + String(plan.update.length).padStart(3) +
  (plan.update.length ? "   (" + plan.update.map((p) => p.photo_number).join(", ") + ")" : ""));
console.log("    already migrated, skipped   " + String(plan.skip.length).padStart(3));
console.log("    conflicts                   " + String(plan.conflict.length).padStart(3));
console.log("");
console.log("    cover photos (untouched)    " + String(coverBefore.length).padStart(3) +
  coverBefore.map((c) => "   " + c.object_key).join(""));
console.log("    progress rows before        " + String(existing.filter((r) => r.project_id === pid && r.kind === "progress" && !r.deleted_at).length).padStart(3));
console.log("    progress rows after         " + String(
  existing.filter((r) => r.project_id === pid && r.kind === "progress" && !r.deleted_at).length + plan.insert.length,
).padStart(3));

if (orphanNumbers.length) {
  console.log("\n  IN THE TRACKER BUT NOT IN THE EXPORT (left untouched):");
  for (const n of orphanNumbers) console.log("    · " + n);
}
if (plan.conflict.length) {
  console.log("\n  CONFLICTS — nothing will be written until these are resolved:");
  for (const c of plan.conflict) console.log("    ! " + c.photo_number + " — " + c.reason);
}

if (plan.conflict.length) {
  console.error("\nRefusing to continue: " + plan.conflict.length + " conflict(s).");
  // nothing to clean up: no temporary files are written any more.
  process.exit(1);
}

if (!apply) {
  console.log("\nDRY RUN — nothing was written. Add --execute to apply.");
  // nothing to clean up: no temporary files are written any more.
  process.exit(0);
}

// --- Apply -------------------------------------------------------------------
// One R2 put then one D1 batch per photo. Per-photo rather than one big batch so
// a failure leaves a consistent database: every row that exists has its bytes in
// the bucket, and the audit digest marks it done for the next run.
const auditDetails = (photo) => JSON.stringify({
  photo_number: photo.photo_number,
  digest: photo.digest,
  bytes: photo.bytes,
  source: photo.source,
  manifest: manifestPath,
});

let inserted = 0, updated = 0, failed = 0;
const total = plan.insert.length + plan.update.length;
let n = 0;

for (const photo of plan.insert) {
  n++;
  const key = "projects/" + pid + "/" + photo.proposed_id;
  process.stdout.write("  [" + String(n).padStart(2) + "/" + total + "] insert " + photo.photo_number + " … ");
  try {
    putObject(key, photo.path, photo.mime);
    runStatements([
      "INSERT INTO project_photos (id,project_id,kind,reporting_period,caption,object_key,mime," +
      "actor_email,date_taken,taken_by,area,category,include_in_report,notes,photo_number) VALUES (" +
      [photo.proposed_id, pid, photo.kind, photo.reporting_period, photo.caption, key, photo.mime,
        ACTOR, photo.date_taken, photo.taken_by, photo.area, photo.category, photo.include_in_report,
        photo.notes, photo.photo_number].map(sqlLiteral).join(",") + ");",
      "INSERT INTO audit_log (action,entity_type,entity_key,actor_email,details) VALUES (" +
      [MIGRATION, "project", String(pid), ACTOR, auditDetails(photo)].map(sqlLiteral).join(",") + ");",
    ], photo.photo_number);
    inserted++;
    console.log("ok");
  } catch (error) {
    // Roll the object back so a failed insert does not leave an unreferenced
    // object in a bucket that D1 is the only index of.
    try { wrangler(["r2", "object", "delete", bucket + "/" + key, "--remote"]); } catch {}
    failed++;
    console.log("FAILED: " + String(error.message).split("\n")[0]);
  }
}

for (const photo of plan.update) {
  n++;
  const key = photo.current.object_key;
  // An empty notes value in the manifest must not erase the narrative already
  // on the row; the export simply has no column for it.
  const notes = photo.notes || photo.current.notes || "";
  process.stdout.write("  [" + String(n).padStart(2) + "/" + total + "] update " + photo.photo_number + " … ");
  try {
    putObject(key, photo.path, photo.mime);
    runStatements([
      "UPDATE project_photos SET " + [
        ["caption", photo.caption], ["notes", notes], ["area", photo.area],
        ["category", photo.category], ["taken_by", photo.taken_by],
        ["date_taken", photo.date_taken], ["reporting_period", photo.reporting_period],
        ["include_in_report", photo.include_in_report], ["mime", photo.mime],
      ].map(([c, v]) => c + "=" + sqlLiteral(v)).join(",") +
      ",revision=revision+1 WHERE id=" + sqlLiteral(photo.current.id) +
      " AND project_id=" + sqlLiteral(pid) + " AND deleted_at IS NULL;",
      "INSERT INTO audit_log (action,entity_type,entity_key,actor_email,details) VALUES (" +
      [MIGRATION, "project", String(pid), ACTOR, auditDetails(photo)].map(sqlLiteral).join(",") + ");",
    ], photo.photo_number);
    updated++;
    console.log("ok");
  } catch (error) {
    failed++;
    console.log("FAILED: " + String(error.message).split("\n")[0]);
  }
}

// A run marker, in the same spirit as the workbook import's app_meta entry.
if (!failed) {
  try {
    runStatements([
      "INSERT INTO app_meta (key,value) VALUES (" +
      [MIGRATION, new Date().toISOString().slice(0, 10) + ":" + manifest.photos.length].map(sqlLiteral).join(",") +
      ") ON CONFLICT(key) DO UPDATE SET value=excluded.value;",
    ], "run marker");
  } catch (error) {
    console.log("  (run marker not written: " + String(error.message).split("\n")[0] + ")");
  }
}


console.log("");
console.log("  inserted " + inserted + "   updated " + updated + "   skipped " + plan.skip.length + "   failed " + failed);
if (failed) {
  console.error("\n" + failed + " photo(s) failed. Re-run the same command: migrated photos are skipped by digest.");
  process.exit(1);
}
console.log("\nDone. Verify with the queries in the migration report.");
