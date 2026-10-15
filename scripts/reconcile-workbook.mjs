// Phase 2 of the workbook import: RECONCILE the parsed workbook against the
// live tracker and emit a report. It decides nothing and writes nothing to the
// database.
//
//   node scripts/reconcile-workbook.mjs \
//     --workbook-json /tmp/workbook-2026-09-11.json \
//     --source prod \
//     --out reconciliation-report.json
//
// READ ONLY, enforced rather than asserted: every statement lives in
// workbook/tracker.mjs as a hard-coded SELECT, and each response is checked for
// rows_written === 0 before it is accepted.
//
// Offline mode, for rehearsing against a restored scratch database or for
// re-running without touching D1:
//   --tracker <snapshot.json>      read a saved snapshot instead of D1
//   --snapshot-out <path>          save the tracker read for later re-use
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson } from "./workbook/io.mjs";
import { DATABASES, readTracker } from "./workbook/tracker.mjs";
import { buildIndex, matchRow, CONFIDENCE } from "./workbook/match.mjs";
import { comparableText, normaliseName, cleanText } from "./workbook/normalise.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const configPath = arg("config", "scripts/workbook/import-2026-09-11.json");
const config = JSON.parse(readFileSync(resolve(projectRoot, configPath), "utf8"));
const workbookPath = arg("workbook-json");
if (!workbookPath) {
  console.error("ERROR: --workbook-json is required (the output of scripts/parse-workbook.mjs).");
  process.exit(1);
}
const workbook = JSON.parse(readFileSync(resolve(projectRoot, workbookPath), "utf8"));

// The parsed workbook must be the one this config describes, or the report would
// pair one workbook's rows with another's dates.
if (workbook.report_date !== config.report_date) {
  console.error(`ERROR: workbook JSON reports ${workbook.report_date} but ${configPath} expects ${config.report_date}.`);
  process.exit(1);
}

// --- Read the tracker --------------------------------------------------------

const snapshotPath = arg("tracker");
let tracker;
if (snapshotPath) {
  tracker = JSON.parse(readFileSync(resolve(projectRoot, snapshotPath), "utf8"));
  console.log("Tracker  : snapshot " + snapshotPath + " (read " + tracker.read_at + ")");
} else {
  const sourceName = arg("source", "prod");
  const database = DATABASES[sourceName] || { id: sourceName, name: sourceName };
  console.log("Tracker  : " + database.name + "  " + database.id + "  (read-only)");
  tracker = readTracker(database.id);
  const snapshotOut = arg("snapshot-out");
  if (snapshotOut) writeJson(projectRoot, snapshotOut, tracker);
}

// --- Identity changes the client has confirmed -------------------------------
//
// A project that is renamed AND renumbered in the same cycle matches nothing:
// the matcher works from CAPP and name, and both moved. Waybound Phase I /
// 08705A became Waybound #08705A / 08742 between 25 September and 9 October.
//
// This is NOT inferred. Each entry is a decision recorded in the config, and
// the pre-applied values below are only what the matcher indexes on — the
// tracker's real values are kept so the audit row can show before -> after.
// Identity is the one thing a bad match corrupts invisibly, so it never moves
// automatically the way a cost or a risk rating does.
const renames = new Map();
for (const rename of config.renames || []) {
  const project = tracker.projects.find((candidate) => candidate.id === rename.tracker_id);
  if (!project) {
    console.error(`ERROR: renames names tracker project ${rename.tracker_id}, which does not exist.`);
    process.exit(1);
  }
  renames.set(`${rename.sheet}:${rename.row}`, {
    ...rename,
    before: { name: project.name, capp_number: project.capp_number },
  });
  if (rename.name) project.name = rename.name;
  if (rename.identifier) project.capp_number = rename.identifier;
}

const index = buildIndex(tracker.projects);

// --- Existing history, for duplicate detection -------------------------------

// Deterministic key for an imported update. Re-running the same workbook can
// then be a no-op enforced by the UNIQUE constraint on project_updates.source_key,
// independently of whatever the matcher decides on the second run.
const importKey = (sourceKey, date) => `workbook:${date}:${sourceKey}`;

const existingKeys = new Set(tracker.updates.map((update) => update.source_key));
const summariesByProject = new Map();
for (const update of tracker.updates) {
  if (!summariesByProject.has(update.project_id)) summariesByProject.set(update.project_id, new Set());
  summariesByProject.get(update.project_id).add(comparableText(update.current_summary));
}

// What would happen to one update if the import ran. Three ways to skip, and
// they are reported separately because they mean different things.
function planUpdate({ text, date, project, sourceKey }) {
  const key = importKey(sourceKey, date);
  if (!cleanText(text)) {
    return { date, action: "skip", reason: "empty_in_workbook", source_key: key };
  }
  if (existingKeys.has(key)) {
    return { date, action: "skip", reason: "already_imported", source_key: key };
  }
  const comparable = comparableText(text);
  if (comparable === comparableText(project.current_update)) {
    return { date, action: "skip", reason: "identical_to_tracker_current", source_key: key };
  }
  if ((summariesByProject.get(project.id) || new Set()).has(comparable)) {
    return { date, action: "skip", reason: "identical_to_existing_history", source_key: key };
  }
  return { date, action: "insert", reason: "new_text", source_key: key };
}

// --- Structured columns the workbook owns ------------------------------------
//
// The workbook is the source of truth for these. Three rules decide what moves,
// and all three came from the client:
//
//   BLANK MEANS NO CHANGE. A cell the workbook leaves empty asserts nothing, so
//   it never clears a tracker value. The parser already drops empty cells, so an
//   absent key IS a blank cell and is skipped here without special handling.
//   This is what protects a risk rating set in the app against a sheet that
//   simply has not filled that column in.
//
//   THE TOTAL IS TAKEN, NEVER DERIVED. Total Approved Budget is =SUM(I:K) on
//   most rows and a typed number on others, and the two disagree: Gaming
//   Expansion states 145,000,000 against CAPP columns totalling 19,578,167.
//   Whatever the sheet shows is what the tracker shows.
//
//   ABSENT FROM THE WORKBOOK IS NOT A CHANGE EITHER. A project with no row this
//   fortnight simply has no update; it is never touched. That is handled by
//   classification, not here.
//
// name and capp_number are deliberately NOT in this list. Those are identity,
// and a wrong match that rewrites a project's name and number is far harder to
// notice and undo than a wrong figure. Identity changes go through the config.
const SYNCED_FIELDS = [
  "project_manager", "budget_risk", "schedule_risk",
  "precon_capp", "construction_capp", "add_capp", "approved_budget",
  "anticipated_final_cost",
  "original_start_date", "current_start_date",
  "original_turnover_date", "current_turnover_date",
];

const MONEY_COLUMNS = new Set([
  "precon_capp", "construction_capp", "add_capp", "approved_budget", "anticipated_final_cost",
]);

// Same value or not, compared the way the column is actually stored: money to
// two decimals, text case- and space-insensitively, dates on the day.
function sameValue(field, before, after) {
  if (before === null || before === undefined) return after === null || after === undefined;
  if (MONEY_COLUMNS.has(field)) return Math.round(Number(before) * 100) === Math.round(Number(after) * 100);
  if (field.endsWith("_date")) return String(before).slice(0, 10) === String(after).slice(0, 10);
  return comparableText(before) === comparableText(after);
}

// The name and number a confirmed rename moves, as before -> after pairs. The
// matcher has already been pointed at the right project; this is what makes the
// change visible in the audit trail instead of silent.
function identityChanges(rename) {
  if (!rename) return [];
  const changes = [];
  if (rename.name && rename.before.name !== rename.name) {
    changes.push({ field: "name", before: rename.before.name, after: rename.name });
  }
  if (rename.identifier && rename.before.capp_number !== rename.identifier) {
    changes.push({ field: "capp_number", before: rename.before.capp_number, after: rename.identifier });
  }
  return changes;
}

function plannedFields(row, project) {
  const changes = [];
  for (const field of SYNCED_FIELDS) {
    if (!Object.hasOwn(row.fields, field)) continue;      // blank cell: no change
    const after = row.fields[field];
    if (after === null || after === undefined) continue;  // unparseable: no change
    // normaliseRisk() answers "Not Rated" for a cell that is blank, "N/A", or a
    // word it does not know — so unlike every other column, a missing risk cell
    // arrives as a VALUE rather than as an absent key, and "blank means no
    // change" would not catch it. Project 40 is the live case: its risk cells
    // are empty in the workbook while the tracker holds Low/Low, set in the app
    // on 2026-09-29. Writing the default over that is exactly the data loss the
    // blank-cell rule exists to prevent, and the workbook has no vocabulary for
    // deliberately rating something "Not Rated".
    if ((field === "budget_risk" || field === "schedule_risk") && after === "Not Rated") continue;
    const before = project[field] ?? null;
    if (sameValue(field, before, after)) continue;
    changes.push({ field, before, after });
  }
  return changes;
}

// --- Classify every workbook row ---------------------------------------------

const approved = new Map(
  (config.approved_new || []).map((entry) => [entry.sheet + ":" + entry.row, entry]),
);
const approvedUsed = new Set();
const contradictions = [];

const matched = [];
const proposedNew = [];
const unresolvedRows = [];
const matchedProjectIds = new Set();
// Projects demonstrably present in this workbook, whether or not the row was
// resolved. Used only to decide what counts as "absent from the workbook", so a
// project blocked by a contradiction is not also reported as missing.
const seenProjectIds = new Set();

const projectsById = new Map(tracker.projects.map((project) => [project.id, project]));

for (const sheet of workbook.sheets) {
  for (const row of sheet.rows) {
    const provenance = {
      sheet: row.source.sheet,
      row: row.source.row,
      name: row.name,
      venue: row.venue,
      section_heading: row.section_heading,
      business_unit: row.business_unit,
      kind: row.kind,
      identifier: row.match.capp_raw,
      identifier_normalised: row.match.capp,
      // Original wording, carried verbatim into the report so a reviewer never
      // has to reopen the spreadsheet to judge a decision.
      current_update: row.current_update,
      previous_update: row.previous_update,
      flags: row.flags,
    };

    const result = matchRow(row, index);
    const approvalKey = row.source.sheet + ":" + row.source.row;
    const approval = approved.get(approvalKey) || null;

    // A client approval settles ambiguity — the row was reviewed by a person who
    // decided it is new. It must NOT override an exact identifier match, though:
    // that means the project demonstrably already exists, and creating it would
    // duplicate. Such a contradiction is reported, never resolved automatically.
    if (approval && result.outcome === "matched" && result.confidence === CONFIDENCE.EXACT_IDENTIFIER) {
      approvedUsed.add(approvalKey);
      seenProjectIds.add(result.project_id);
      contradictions.push(
        `${approvalKey} is on the approved-new list, but identifier "${row.match.capp}" matches ` +
        `existing tracker project ${result.project_id} ("${result.project.name}"). Creating it would ` +
        "duplicate an existing project. Remove it from approved_new, or confirm the identifier is wrong."
      );
      unresolvedRows.push({
        classification: "unresolved",
        confidence: result.confidence,
        reason: "approved_new_but_identifier_matches_existing",
        detail: `Approved for creation, but ${result.detail} Not created.`,
        workbook: provenance,
        candidates: [result.project],
      });
      continue;
    }

    if (result.outcome === "matched") {
      const project = projectsById.get(result.project_id);
      matchedProjectIds.add(result.project_id);
      seenProjectIds.add(result.project_id);
      matched.push({
        classification: "matched",
        confidence: result.confidence,
        tier: result.tier,
        reason: result.reason,
        detail: result.detail,
        workbook: provenance,
        tracker: result.project,
        planned_history: {
          // Current update takes the report date; Previous Week takes the
          // configured earlier date. Neither date is derived from the workbook.
          current: planUpdate({
            text: row.current_update, date: config.report_date,
            project, sourceKey: result.source_key,
          }),
          previous: planUpdate({
            text: row.previous_update, date: config.previous_report_date,
            project, sourceKey: result.source_key,
          }),
        },
        // Whether the Sept 11 text would become the project's current update.
        // A tracker entry newer than the report date keeps its place.
        project_fields: {
          tracker_reporting_period: project.reporting_period,
          // The text the report-date update would displace, needed by the apply
          // step to fill previous_summary exactly as the activity route does.
          tracker_current_update: cleanText(project.current_update),
          would_become_current: !project.reporting_period || project.reporting_period <= config.report_date,
        },
        // The structured columns the workbook is authoritative for. Empty when
        // the workbook agrees with the tracker, which is the common case.
        planned_fields: [
          ...identityChanges(renames.get(`${row.source.sheet}:${row.source.row}`)),
          ...plannedFields(row, project),
        ],
      });
      continue;
    }

    // Approved rows become proposed_new whether the matcher found nothing at all
    // or found candidates it could not separate. The Connex Box row is the
    // second kind: four tracker projects share its name and unit, and none has
    // its scope. The matcher's finding is carried into the report so the
    // reviewer sees exactly what the approval overrode.
    if (approval && result.outcome !== "matched") {
      approvedUsed.add(approvalKey);
      proposedNew.push({
        classification: "proposed_new",
        confidence: CONFIDENCE.EXACT_IDENTIFIER,
        reason: "client_approved_new_project",
        detail: approval.note,
        matcher_finding: {
          outcome: result.outcome,
          reason: result.reason,
          detail: result.detail,
          candidates: result.candidates || [],
        },
        workbook: provenance,
        proposed: {
          name: row.name,
          business_unit: row.business_unit,
          project_type: row.kind === "development" ? "Development" : "Capital",
          venue: row.venue,
          section_name: row.section_heading,
          identifier: row.match.capp_raw,
          lead: cleanText(row.fields.development_lead || row.fields.project_manager),
          scope_description: cleanText(row.fields.scope_description),
          // A new project arrives with its figures, not as an empty shell.
          // Without this the create path wrote name, lead and update text only:
          // CAPP 08740 was created by the September import carrying none of its
          // 82,289, and three of the four rows approved for this cycle hold
          // costs or dates that would have gone the same way.
          risk: {
            budget_risk: row.fields.budget_risk || "Not Rated",
            schedule_risk: row.fields.schedule_risk || "Not Rated",
          },
          costs: Object.fromEntries(["precon_capp", "construction_capp", "add_capp",
            "approved_budget", "anticipated_final_cost"]
            .filter((field) => Object.hasOwn(row.fields, field) && row.fields[field] !== null)
            .map((field) => [field, row.fields[field]])),
          dates: Object.fromEntries(["original_start_date", "current_start_date",
            "original_turnover_date", "current_turnover_date"]
            .filter((field) => Object.hasOwn(row.fields, field) && row.fields[field] !== null)
            .map((field) => [field, row.fields[field]])),
        },
      });
      continue;
    }

    unresolvedRows.push({
      classification: "unresolved",
      confidence: result.confidence,
      reason: result.reason,
      detail: result.detail +
        (result.outcome === "no_match"
          ? " Not on the approved-new list, so it is reported rather than created."
          : ""),
      workbook: provenance,
      candidates: result.candidates || [],
    });
  }
}

// --- Tracker projects with no workbook row -----------------------------------

// Absence from the workbook is NOT evidence of completion. Every one of these is
// reported and left alone, except rows the client explicitly decided on.
const decisions = new Map(
  (config.tracker_only_decisions || []).map((entry) => [normaliseName(entry.match_name), entry]),
);
const decisionsUsed = new Set();

const trackerOnly = index.projects
  .filter((project) => !seenProjectIds.has(project.id))
  .map((project) => {
    const key = normaliseName(project.name);
    const decision = decisions.get(key);
    if (decision) decisionsUsed.add(key);
    return {
      classification: "tracker_only",
      project: {
        id: project.id, name: project.name, business_unit: project.business_unit,
        venue: project.venue, source_sheet: project.source_sheet,
        identifier: cleanText(project.capp_number || project.initiative_number),
        status: project.status, reporting_period: project.reporting_period,
      },
      decision: decision
        ? { action: decision.action, audit_actor: decision.audit_actor, note: decision.note }
        : { action: "leave_unchanged", note: "Absent from this workbook. Not evidence of completion; flagged for review." },
    };
  });

// --- Report ------------------------------------------------------------------

const confidenceBuckets = matched.reduce((buckets, entry) => {
  const key = String(entry.confidence);
  buckets[key] = (buckets[key] || 0) + 1;
  return buckets;
}, {});

const plannedInserts = matched.reduce((count, entry) =>
  count + (entry.planned_history.current.action === "insert" ? 1 : 0)
        + (entry.planned_history.previous.action === "insert" ? 1 : 0), 0);

const skipReasons = {};
for (const entry of matched) {
  for (const plan of [entry.planned_history.current, entry.planned_history.previous]) {
    if (plan.action === "skip") skipReasons[plan.reason] = (skipReasons[plan.reason] || 0) + 1;
  }
}

const report = {
  generated_at: new Date().toISOString(),
  workbook: config.workbook,
  report_date: config.report_date,
  previous_report_date: config.previous_report_date,
  date_provenance:
    "Both dates come from configuration. The workbook's Previous Week column was measured to be an " +
    "unreliable roll-forward, so its date is assigned and confirmed by the client, not observed.",
  tracker: {
    database_id: tracker.database_id,
    read_at: tracker.read_at,
    projects_total: tracker.projects.length,
    projects_active: index.projects.length,
    projects_archived: index.archivedCount,
    updates_total: tracker.updates.length,
    verification: tracker.verification,
  },
  totals: {
    workbook_rows: matched.length + proposedNew.length + unresolvedRows.length,
    matched: matched.length,
    proposed_new: proposedNew.length,
    unresolved: unresolvedRows.length,
    excluded_sheets: workbook.excluded.length,
    tracker_only: trackerOnly.length,
    matched_by_confidence: confidenceBuckets,
    planned_history_inserts: plannedInserts,
    planned_history_skips: skipReasons,
    planned_field_updates: matched.reduce((n, e) => n + e.planned_fields.length, 0),
    planned_field_projects: matched.filter((e) => e.planned_fields.length).length,
    planned_fields_by_column: matched.reduce((acc, e) => {
      for (const change of e.planned_fields) acc[change.field] = (acc[change.field] || 0) + 1;
      return acc;
    }, {}),
  },
  matched,
  proposed_new: proposedNew,
  unresolved: unresolvedRows,
  excluded: workbook.excluded.map((sheet) => ({
    classification: "excluded",
    sheet: sheet.sheet,
    approximate_rows: sheet.approximate_rows,
    reason: sheet.reason,
  })),
  tracker_only: trackerOnly,
  blocking_contradictions: contradictions,
  warnings: [
    ...[...approved.keys()].filter((key) => !approvedUsed.has(key)).map((key) =>
      `Approved-new entry ${key} did not apply: the row either matched an existing project or was not found.`),
    ...[...decisions.keys()].filter((key) => !decisionsUsed.has(key)).map((key) =>
      `tracker_only decision for "${key}" did not apply: no unmatched tracker project has that name.`),
    ...(workbook.unknown_sheets || []).map((sheet) =>
      `Worksheet "${sheet}" is not classified in layout.mjs and was not parsed.`),
  ],
};

const outPath = arg("out", "reconciliation-report.json");
writeJson(projectRoot, outPath, report);

// --- Summary -----------------------------------------------------------------

const pad = (value, width) => String(value).padStart(width);
console.log("Workbook : " + config.workbook);
console.log("Dates    : current " + config.report_date + "  |  previous " + config.previous_report_date);
console.log("");
console.log("  CLASSIFICATION      ROWS");
console.log("  matched          " + pad(report.totals.matched, 7));
for (const [score, count] of Object.entries(confidenceBuckets).sort((a, b) => b[0] - a[0])) {
  console.log("      confidence " + pad(score, 3) + "  " + pad(count, 4));
}
console.log("  proposed_new     " + pad(report.totals.proposed_new, 7));
console.log("  unresolved       " + pad(report.totals.unresolved, 7));
console.log("  excluded sheets  " + pad(report.totals.excluded_sheets, 7));
console.log("  ---");
console.log("  tracker_only     " + pad(report.totals.tracker_only, 7) + "   (in the tracker, absent from this workbook)");
console.log("");
console.log("  planned history inserts " + pad(plannedInserts, 4));
for (const [reason, count] of Object.entries(skipReasons).sort((a, b) => b[1] - a[1])) {
  console.log("      skip: " + reason.padEnd(32) + pad(count, 4));
}
console.log("");
console.log("  planned field updates   " + pad(report.totals.planned_field_updates, 4)
  + "   across " + report.totals.planned_field_projects + " projects");
for (const [field, count] of Object.entries(report.totals.planned_fields_by_column).sort((a, b) => b[1] - a[1])) {
  console.log("      " + field.padEnd(32) + pad(count, 4));
}

if (unresolvedRows.length) {
  console.log("\n  UNRESOLVED — needs a human decision:");
  for (const entry of unresolvedRows) {
    console.log(`    ${entry.workbook.sheet} r${entry.workbook.row}  ${String(entry.workbook.name).slice(0, 38).padEnd(38)} ${entry.reason}`);
  }
}
if (proposedNew.length) {
  console.log("\n  PROPOSED NEW — approved by the client:");
  for (const entry of proposedNew) {
    console.log(`    ${entry.workbook.sheet} r${entry.workbook.row}  ${String(entry.proposed.name).slice(0, 38).padEnd(38)} ${entry.proposed.project_type}`);
  }
}
const decided = trackerOnly.filter((entry) => entry.decision.action !== "leave_unchanged");
if (decided.length) {
  console.log("\n  TRACKER-ONLY with a decision:");
  for (const entry of decided) {
    console.log(`    id=${entry.project.id}  ${entry.project.name.slice(0, 38).padEnd(38)} ${entry.decision.action}`);
  }
}
if (contradictions.length) {
  console.log("\n  *** BLOCKING — must be resolved before any apply step ***");
  for (const item of contradictions) console.log("    " + item);
}
if (report.warnings.length) {
  console.log("\n  WARNINGS:");
  for (const warning of report.warnings) console.log("    " + warning);
}
console.log("\nWrote " + outPath);
console.log("No database changes were made. rows_written=0 on every query.");
