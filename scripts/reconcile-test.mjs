// Regression tests for the reconciliation matcher. Pure and offline: it builds
// a small synthetic tracker in memory and never opens a database.
//
//   node scripts/reconcile-test.mjs
//
// Several of these lock in defects found by running the engine against real
// data. They are here because each one produced a plausible-looking result.
import assert from "node:assert/strict";
import { buildIndex, matchRow, CONFIDENCE } from "./workbook/match.mjs";
import { normaliseCapp } from "./workbook/normalise.mjs";

const project = (over) => ({
  id: 1, source_key: "k1", business_unit: "Patina", venue: "Somewhere",
  section_name: null, source_sheet: "PATINA", project_type: "Capital",
  name: "A Project", capp_number: null, initiative_number: null,
  project_manager: null, development_lead: null, status: "Active",
  scope_description: null, current_update: null, previous_update: null,
  reporting_period: "2026-08-28", archived_at: null, ...over,
});

const row = (over) => ({
  source: { sheet: "PATINA", row: 3 }, kind: "capital", business_unit: "Patina",
  venue: "Somewhere", section_heading: "Somewhere", name: "A Project",
  fields: {}, flags: [], current_update: null, previous_update: null,
  match: { capp: null, capp_raw: null, name: "a project", venue: "somewhere", scope: null },
  ...over,
});

// --- Float identifiers -------------------------------------------------------
// The tracker stores Lincoln Ristorante's initiative as "8608.0" — a spreadsheet
// float that reached storage intact — while the workbook says "8608". The first
// version of normaliseCapp compared them as strings, so the project did not
// match and was classified as new. Acting on that would have duplicated a real
// project. One row in 74, and the only one that mattered.
assert.equal(normaliseCapp("8608.0"), "8608", "a float identifier must normalise to its integer form");
assert.equal(normaliseCapp("8608"), "8608");
assert.equal(normaliseCapp("08312"), "8312", "leading zeros still collapse");
assert.equal(normaliseCapp("08650A"), "8650A", "identifiers with letters survive Number()");
assert.equal(normaliseCapp("63541"), "63541");

{
  const index = buildIndex([project({ id: 70, initiative_number: "8608.0", name: "Lincoln Ristorante" })]);
  const result = matchRow(row({ name: "Lincoln Ristorante", match: { capp: "8608", capp_raw: "8608", name: "lincoln ristorante" } }), index);
  assert.equal(result.outcome, "matched");
  assert.equal(result.confidence, CONFIDENCE.EXACT_IDENTIFIER);
  assert.equal(result.project_id, 70, "8608 must match the tracker's 8608.0");
}

// --- Exact identifier wins ---------------------------------------------------
{
  const index = buildIndex([
    project({ id: 1, capp_number: "08312", name: "Two Kings Casino", business_unit: "Gaming" }),
    project({ id: 2, capp_number: "08487", name: "Something Else", business_unit: "Gaming" }),
  ]);
  const result = matchRow(row({
    business_unit: "Gaming", name: "Two Kings Casino",
    match: { capp: "8312", capp_raw: "08312", name: "two kings casino" },
  }), index);
  assert.equal(result.confidence, 100);
  assert.equal(result.tier, "identifier");
}

// --- Placeholders must never match -------------------------------------------
// Six tracker projects carry the literal "TBD". Treating it as an identifier
// joins all six to each other and to every "TBD" row in the workbook.
{
  const index = buildIndex([
    project({ id: 1, capp_number: "TBD", name: "Ignite Steak House" }),
    project({ id: 2, capp_number: "TBD", name: "High Limits Refresh" }),
  ]);
  const result = matchRow(row({
    name: "Ignite Steak House",
    match: { capp: normaliseCapp("TBD"), capp_raw: "TBD", name: "ignite steak house" },
  }), index);
  assert.equal(result.outcome, "matched", "falls through to name + unit");
  assert.equal(result.tier, "name_unit", "TBD must not be used as an identifier");
  assert.equal(result.project_id, 1);
}

// --- Ambiguity is never guessed ----------------------------------------------
// Four "Via Napoli" projects share a name, unit and lead; only the scope
// separates them. A matcher that picked a "best" candidate would be wrong 75%
// of the time and would look confident doing it.
{
  const napoli = ["Major Remodel", "Freezer Floor Repair", "Walk-In Refrigerator", "Kitchen Door"]
    .map((scope, i) => project({
      id: 68 + i, name: "Via Napoli", business_unit: "Patina",
      project_type: "Development", scope_description: scope,
    }));
  const index = buildIndex(napoli);

  const dev = (scope) => row({
    kind: "development", name: "Via Napoli", business_unit: "Patina", venue: null,
    fields: { scope_description: scope },
    match: { capp: null, capp_raw: null, name: "via napoli", venue: null, scope },
  });

  const hit = matchRow(dev("Freezer Floor Repair"), index);
  assert.equal(hit.outcome, "matched");
  assert.equal(hit.confidence, CONFIDENCE.NAME_UNIT_SCOPE);
  assert.equal(hit.project_id, 69, "the scope description separates the four");

  // The Connex Box scope exists in no tracker project: genuinely new.
  const miss = matchRow(dev("Adding a 40' Connex Box to replace the old ones"), index);
  assert.equal(miss.outcome, "unresolved");
  assert.equal(miss.reason, "scope_no_match");
  assert.equal(miss.candidates.length, 4, "all four candidates are shown to the reviewer");

  // No scope at all: must not pick one of the four.
  const blind = matchRow(row({
    kind: "capital", name: "Via Napoli", business_unit: "Patina",
    match: { capp: null, capp_raw: null, name: "via napoli", venue: null, scope: null },
  }), index);
  assert.equal(blind.outcome, "unresolved");
  assert.equal(blind.reason, "ambiguous_name");
}

// --- Conflicting identifiers stay unresolved ---------------------------------
// A name that matches across a genuine identifier disagreement is the case not
// to resolve automatically.
{
  const index = buildIndex([project({ id: 5, capp_number: "1111", name: "Shared Name" })]);
  const result = matchRow(row({
    name: "Shared Name",
    match: { capp: "2222", capp_raw: "2222", name: "shared name" },
  }), index);
  assert.equal(result.outcome, "unresolved");
  assert.equal(result.reason, "identifier_conflict");
}

// --- Confidence scoring ------------------------------------------------------
{
  // Venue corroborates -> 90.
  let index = buildIndex([project({ id: 1, name: "Pantry", venue: "Highmark Stadium" })]);
  let result = matchRow(row({ name: "Pantry", venue: "Highmark Stadium", match: { capp: null, capp_raw: null, name: "pantry", venue: "highmark stadium" } }), index);
  assert.equal(result.confidence, CONFIDENCE.NAME_UNIT_CORROBORATED);

  // Nothing corroborates -> 80.
  index = buildIndex([project({ id: 1, name: "Pantry", venue: "Elsewhere" })]);
  result = matchRow(row({ name: "Pantry", venue: "Highmark Stadium", match: { capp: null, capp_raw: null, name: "pantry", venue: "highmark stadium" } }), index);
  assert.equal(result.confidence, CONFIDENCE.NAME_UNIT);

  // A secondary signal disagrees -> 70, still above the review threshold.
  index = buildIndex([project({ id: 1, name: "Pantry", venue: "Elsewhere", project_manager: "Alice" })]);
  result = matchRow(row({
    name: "Pantry", venue: "Highmark Stadium", fields: { project_manager: "Bob" },
    match: { capp: null, capp_raw: null, name: "pantry", venue: "highmark stadium" },
  }), index);
  assert.equal(result.confidence, CONFIDENCE.NAME_UNIT_WEAK);
  assert.ok(result.confidence >= CONFIDENCE.REVIEW_THRESHOLD);
}

// --- Business unit scopes the match ------------------------------------------
// The same project name in a different unit is a different project.
{
  const index = buildIndex([project({ id: 1, name: "Casino Carpet", business_unit: "Gaming" })]);
  const result = matchRow(row({ name: "Casino Carpet", business_unit: "Patina", match: { capp: null, capp_raw: null, name: "casino carpet" } }), index);
  assert.equal(result.outcome, "no_match", "a name in the wrong unit must not match");
}

// --- Archived projects are not match targets ---------------------------------
{
  const index = buildIndex([project({ id: 1, capp_number: "9999", archived_at: "2026-01-01" })]);
  assert.equal(index.projects.length, 0);
  assert.equal(index.archivedCount, 1);
  const result = matchRow(row({ match: { capp: "9999", capp_raw: "9999", name: "a project" } }), index);
  assert.equal(result.outcome, "no_match");
}

console.log("Reconciliation matcher tests passed.");
