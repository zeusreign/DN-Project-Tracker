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
          note: "The import writes activity only. No other project field is modified.",
        },
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
