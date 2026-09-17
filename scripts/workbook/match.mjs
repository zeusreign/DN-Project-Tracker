// Matching a workbook row to a tracker project. Pure: no I/O, no database.
//
// The rule that governs everything here: AN UNMATCHED ROW IS FAR MORE OFTEN A
// MATCHING FAILURE THAN A NEW PROJECT. So the engine never picks a "best"
// candidate. Either exactly one candidate survives a tier, or the row goes to a
// human. Two plausible matches is an answer, not a tie to be broken.
import { normaliseCapp, normaliseName, comparableText, cleanText } from "./normalise.mjs";

export const CONFIDENCE = {
  EXACT_IDENTIFIER: 100,   // normalised CAPP / initiative, unique on both sides
  NAME_UNIT_CORROBORATED: 90, // name + unit, and the venue or scope agrees too
  NAME_UNIT_SCOPE: 85,     // development row separated by its scope description
  NAME_UNIT: 80,           // name + unit, unique, nothing else to corroborate
  NAME_UNIT_WEAK: 70,      // unique, but a secondary signal disagrees
  REVIEW_THRESHOLD: 70,    // below this the row is never treated as matched
};

const identifierOf = (project) =>
  normaliseCapp(project.capp_number) || normaliseCapp(project.initiative_number);

function push(map, key, value) {
  if (key === null || key === undefined || key === "") return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// Indexes built once per run. Archived projects are excluded from matching but
// counted, so "why did this not match" can distinguish absent from archived.
export function buildIndex(projects) {
  const active = projects.filter((project) => !project.archived_at);
  const byIdentifier = new Map();
  const byNameUnit = new Map();

  for (const project of active) {
    push(byIdentifier, identifierOf(project), project);
    push(byNameUnit, normaliseName(project.name) + "|" + String(project.business_unit || ""), project);
  }
  return {
    projects: active,
    archivedCount: projects.length - active.length,
    byIdentifier,
    byNameUnit,
  };
}

function venueAgrees(row, project) {
  const a = normaliseName(row.venue);
  if (!a) return false;
  return a === normaliseName(project.venue) || a === normaliseName(project.section_name);
}

function scopeAgrees(row, project) {
  const a = comparableText(row.fields?.scope_description);
  const b = comparableText(project.scope_description);
  return Boolean(a && b && a === b);
}

// Secondary signals never *make* a match. They only raise confidence when they
// agree, or lower it when they disagree.
function leadDisagrees(row, project) {
  const a = comparableText(row.fields?.project_manager || row.fields?.development_lead);
  const b = comparableText(project.project_manager || project.development_lead);
  return Boolean(a && b && a !== b);
}

// Both sides carry a real identifier and they differ. A name that matches across
// a genuine identifier conflict is exactly the case not to resolve automatically.
function identifierConflict(row, project) {
  const a = row.match?.capp;
  const b = identifierOf(project);
  return Boolean(a && b && a !== b);
}

function describe(project) {
  return {
    id: project.id,
    name: project.name,
    business_unit: project.business_unit,
    venue: project.venue,
    section_name: project.section_name,
    source_sheet: project.source_sheet,
    project_type: project.project_type,
    identifier: cleanText(project.capp_number || project.initiative_number),
    status: project.status,
    reporting_period: project.reporting_period,
  };
}

const unresolved = (reason, detail, candidates = []) => ({
  outcome: "unresolved",
  confidence: 0,
  reason,
  detail,
  candidates: candidates.map(describe),
});

export function matchRow(row, index) {
  // --- Tier 1: exact identifier ---------------------------------------------
  const identifier = row.match?.capp || null;
  if (identifier) {
    const candidates = index.byIdentifier.get(identifier) || [];
    if (candidates.length === 1) {
      return {
        outcome: "matched",
        confidence: CONFIDENCE.EXACT_IDENTIFIER,
        tier: "identifier",
        reason: "exact_identifier",
        detail: `Normalised identifier "${identifier}" is unique in both the workbook and the tracker.`,
        project: describe(candidates[0]),
        project_id: candidates[0].id,
        source_key: candidates[0].source_key,
      };
    }
    if (candidates.length > 1) {
      return unresolved(
        "ambiguous_identifier",
        `Identifier "${identifier}" matches ${candidates.length} tracker projects.`,
        candidates,
      );
    }
    // Zero candidates: fall through. A workbook CAPP absent from the tracker is
    // normal for a project added since the last report.
  }

  // --- Tier 2: name + business unit -----------------------------------------
  const unit = String(row.business_unit || "");
  const nameKey = normaliseName(row.name) + "|" + unit;
  const named = index.byNameUnit.get(nameKey) || [];

  if (named.length === 1) {
    const project = named[0];
    if (identifierConflict(row, project)) {
      return unresolved(
        "identifier_conflict",
        `Name and business unit match tracker project ${project.id}, but the identifiers differ ` +
        `(workbook "${row.match.capp}" vs tracker "${identifierOf(project)}").`,
        named,
      );
    }
    let confidence = CONFIDENCE.NAME_UNIT;
    const corroboration = [];
    if (venueAgrees(row, project)) { confidence = CONFIDENCE.NAME_UNIT_CORROBORATED; corroboration.push("venue"); }
    else if (scopeAgrees(row, project)) { confidence = CONFIDENCE.NAME_UNIT_CORROBORATED; corroboration.push("scope description"); }
    if (leadDisagrees(row, project)) { confidence = CONFIDENCE.NAME_UNIT_WEAK; corroboration.push("PM/lead differs"); }

    if (confidence < CONFIDENCE.REVIEW_THRESHOLD) {
      return unresolved("low_confidence", "Name and unit matched but secondary signals disagree.", named);
    }
    return {
      outcome: "matched",
      confidence,
      tier: "name_unit",
      reason: corroboration.length ? "name_unit_with_" + corroboration.join("_") : "name_unit",
      detail: `Unique on name + business unit${corroboration.length ? " (" + corroboration.join(", ") + ")" : ""}. ` +
        "No identifier was available to confirm it.",
      project: describe(project),
      project_id: project.id,
      source_key: project.source_key,
    };
  }

  // --- Tier 3: name + unit + scope (development) ----------------------------
  // Only reached when name + unit is ambiguous. This is the "Via Napoli" case:
  // five workbook rows and four tracker projects share a name, a unit and a
  // lead, and differ only in their scope description.
  if (named.length > 1) {
    const rowScope = comparableText(row.fields?.scope_description);
    if (row.kind === "development" && rowScope) {
      const byScope = named.filter((project) => comparableText(project.scope_description) === rowScope);
      if (byScope.length === 1) {
        return {
          outcome: "matched",
          confidence: CONFIDENCE.NAME_UNIT_SCOPE,
          tier: "name_unit_scope",
          reason: "name_unit_scope",
          detail: `${named.length} tracker projects share this name and unit; the scope description ` +
            "separates them to exactly one.",
          project: describe(byScope[0]),
          project_id: byScope[0].id,
          source_key: byScope[0].source_key,
        };
      }
      return unresolved(
        byScope.length === 0 ? "scope_no_match" : "scope_still_ambiguous",
        byScope.length === 0
          ? `${named.length} tracker projects share this name and unit, and none has a matching scope description.`
          : `${byScope.length} tracker projects share this name, unit and scope description.`,
        named,
      );
    }
    return unresolved(
      "ambiguous_name",
      `${named.length} tracker projects share this name and business unit, and no scope description ` +
      "is available to separate them.",
      named,
    );
  }

  // --- No candidate ---------------------------------------------------------
  return {
    outcome: "no_match",
    confidence: 0,
    reason: identifier ? "identifier_and_name_absent" : "name_absent",
    detail: identifier
      ? `No tracker project carries identifier "${identifier}", and none matches on name + business unit.`
      : "The row carries no usable identifier, and no tracker project matches on name + business unit.",
    candidates: [],
  };
}
