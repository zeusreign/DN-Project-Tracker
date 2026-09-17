# Importing a bi-weekly workbook

How a D&C bi-weekly workbook gets into the tracker. Runs every fortnight.

**This is the answer to [DATABASE.md](DATABASE.md) §3's warning that seeding must never be used to
import updated data.** `ensureSeed()` loads a baseline once and is gated by a version marker. This
is the separate, backed-up, reviewable procedure for everything after that.

Three stages, and **the first two never write to the database**. Stage 3 writes only when you pass
two flags together.

---

## 1. The pipeline, in execution order

| # | File | What it does |
|---|---|---|
| 1 | `scripts/workbook/import-<date>.json` | **Config, read first.** The two report dates, the rows approved for creation, and decisions about projects missing from the workbook. Nothing here is inferred. |
| 2 | `scripts/parse-workbook.mjs` | Stage 1 entry point. Walks each sheet, rejects heading and TOTAL rows, writes normalised JSON. |
| 3 | `scripts/workbook/xlsx.mjs` | Reads the `.xlsx`: zip central directory, `zlib.inflateRawSync`, shared strings, cells. No library. |
| 4 | `scripts/workbook/layout.mjs` | Classifies each sheet and finds fields **by header text, never column letter** — CORP has no `Count` column, so its fields sit one letter left of every other tab. |
| 5 | `scripts/workbook/normalise.mjs` | Cleans values for comparison only: CAPP numbers, Excel date serials, risk vocabulary, money. Original wording is always kept alongside. |
| 6 | `scripts/workbook/io.mjs` | Writes output, creating missing directories. |
| 7 | `scripts/reconcile-workbook.mjs` | Stage 2 entry point. Classifies every row as `matched`, `proposed_new`, `unresolved` or `excluded`, and plans which history rows would be written. |
| 8 | `scripts/workbook/tracker.mjs` | Reads the tracker. Hard-coded `SELECT`s only; **aborts if any response reports `rows_written != 0`**. |
| 9 | `scripts/workbook/match.mjs` | The matcher: exact identifier → name + business unit → name + unit + scope. Scores confidence 100/90/85/80/70. |
| 10 | `scripts/apply-workbook-import.mjs` | Stage 3. Refuses if anything is unresolved, generates the SQL, and executes only with `--execute` **and** an explicit `--target`. |
| 11 | `scripts/workbook-parse-test.mjs` | Locks the parser to 73 rows across 6 sheets and to CORP's shifted layout. |
| 12 | `scripts/reconcile-test.mjs` | Locks the matcher: placeholders never match, ambiguity is never guessed, confidence tiers. |
| 13 | `scripts/apply-test.mjs` | Runs the generated SQL against a real SQLite built from `drizzle/`, twice, asserting nothing changes the second time. |

Output lands in `.workbook-import/`, which is gitignored — it reproduces live project names and the
full text of their activity updates.

---

## 2. Running it

### Back up first — not optional

```sh
BK=~/dn-tracker-backups/pre-workbook-import-$(date +%Y-%m-%d)
mkdir -p "$BK"
npx wrangler d1 export 94241844-c709-445f-a71c-49f8b65a7cfd --remote --output "$BK/d1-full.sql"
sha256sum "$BK/d1-full.sql" > "$BK/CHECKSUMS.sha256"
```

**Verify it restores** rather than trusting that a file appeared — an export that fails halfway still
leaves a plausible-looking file:

```sh
python3 -c "
import sqlite3; db = sqlite3.connect(':memory:')
db.executescript(open('$BK/d1-full.sql').read())
for t in ['projects','project_updates','user_directory','audit_log']:
    print(t, db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])"
```

Those counts must match production. Expect `wrangler d1 export` to need a few attempts — transient
`fetch failed` is common here and is not a real failure.

### Then the three stages

```sh
# 1. Parse — no database contact
node scripts/parse-workbook.mjs \
  --config scripts/workbook/import-2026-09-11.json \
  --out .workbook-import/workbook-2026-09-11.json

# 2. Reconcile — READ ONLY
node scripts/reconcile-workbook.mjs \
  --workbook-json .workbook-import/workbook-2026-09-11.json \
  --source prod \
  --snapshot-out .workbook-import/tracker-snapshot.json \
  --out .workbook-import/reconciliation-report.json

# 3. Dry run — no database contact
node scripts/apply-workbook-import.mjs \
  --report .workbook-import/reconciliation-report.json \
  --sql-out .workbook-import/import-2026-09-11.sql
```

**Review the report. Then, and only then:**

```sh
node scripts/apply-workbook-import.mjs \
  --report .workbook-import/reconciliation-report.json \
  --sql-out .workbook-import/import-2026-09-11.sql \
  --execute --target prod
```

`--target` is never defaulted. `--execute` without it is refused.

---

## 3. Reading the report

| Classification | Meaning | Action |
|---|---|---|
| `matched` | Resolved to one tracker project | None. History is added; no other project field is touched. |
| `proposed_new` | On the config's `approved_new` list | Confirm it really is new before applying. |
| `unresolved` | Could not be resolved safely | **Blocks the apply.** Decide, then record the decision in the config. |
| `excluded` | Sheet deliberately out of scope | None. Reported so the skip is visible. |
| `tracker_only` | In the tracker, absent from the workbook | Left unchanged unless the config says otherwise. |

`blocking_contradictions` is the one to read first. It means a row approved as new matches an
existing project by identifier — creating it would duplicate. Resolve it before anything else.

**A project missing from the workbook is not evidence that it is finished.** Marking one complete
requires an explicit `tracker_only_decisions` entry.

---

## 4. Rules that must not be relaxed

**Dates are stated, never derived.** The config carries both, and a run without them fails rather
than guessing. This matters because the workbook's *Previous Week Update* column is not a reliable
roll-forward: measured across 42 rows, 13 matched the tracker's current text, **22 matched the
tracker's previous text** — the column had been left stale a full cycle — and 7 matched nothing it
had ever held.

**Ambiguity is never resolved automatically.** Two plausible candidates is an answer, not a tie to
break. Four projects share the name *Via Napoli* and differ only by scope description; a matcher
that picked a favourite would be wrong three times in four and look confident doing it.

**The import writes activity only.** It never updates a project's name, PM, budget or dates. That is
what makes "preserve user edits" structural rather than a promise.

**Re-running is safe.** Deterministic keys on the `UNIQUE` `project_updates.source_key` column,
guarded `UPDATE`s, hash-guarded audit rows, and an `app_meta` run marker per report date. Verified
against production: a second `--execute` wrote 0 rows and left the database byte-size unchanged.

---

## 5. Two failures worth remembering

Both were found by running against real data, not by reading the code. Both are covered by tests
that were confirmed to fail when the fix is reverted.

**A float identifier nearly duplicated a live project.** The tracker stores Lincoln Ristorante's
initiative as `8608.0`; the workbook says `8608`. Compared as strings they did not match, so an
existing project was classified as new. `normaliseCapp` now collapses numeric identifiers through
`Number`.

**A quoted project name silently grew the audit trail.** One project is named
`3 office build out "Transformation Dept"`. `JSON.stringify` escapes those quotes inside
`audit_log.details`, so a guard matching the raw key never matched what was stored and re-inserted
on every run. History rows were correctly idempotent, so only the audit trail grew. The guard now
matches a hex digest.

The lesson both times: **verify against real data, and check row counts after a second run**, not
just after the first.

---

## 6. Next fortnight

1. Copy `scripts/workbook/import-2026-09-11.json` to the new report date.
2. Set both dates. Empty `approved_new` and `tracker_only_decisions` — last time's decisions do not
   carry over.
3. Run the three stages, review, apply.

Matching is derived fresh each time from CAPP and name. There is no crosswalk table, so **a project
renamed in the UI between reports will be proposed as new**. The reconciliation report is what makes
that visible; do not skip reading it.
