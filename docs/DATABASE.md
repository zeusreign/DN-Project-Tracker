# Database, schema and migrations

Everything about the D1 database. Backups and recovery are in
[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

---

## 1. What the database is

| | |
|---|---|
| Type | Cloudflare D1 (SQLite-compatible) |
| Name | `dnc-tracker-pilot` |
| Binding in code | `env.DB` |
| Region | `ENAM` |

The `database_id` is in `wrangler.toml`. It is an identifier, not a secret, but it only works for
someone already authenticated to that account.

### Tables (10)

| Table | Holds |
|---|---|
| `projects` | The 74 capital and development projects |
| `business_units` | The 5 units: Corporate, Patina, Gaming, Parks & Resorts, Sportservice |
| `project_updates` | Dated activity history, one row per project per reporting period |
| `development_details` | Extra fields for Development Pipeline records |
| `user_directory` | People, roles, business-unit scope, password hashes |
| `login_sessions` | Active sessions (token hashes only) |
| `login_events` | Sign-in attempts, successes, lockouts |
| `audit_log` | Who changed what, with before/after values |
| `user_roles` | Legacy role mapping kept by the original application |
| `app_meta` | Seed and import markers |

Run this any time to see the live structure:

```sh
npx wrangler d1 execute DB --remote --yes \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

---

## 2. Migrations

Six SQL files in `drizzle/`, numbered `0000`–`0005`. **They have already been applied to
production.**

### ⚠ Do not re-run them

`0001`, `0003`, `0004` and `0005` use `ALTER TABLE … ADD COLUMN`, which is **not repeatable**. A
second run fails with `duplicate column name`. They are not wrapped in any "already applied" check —
nothing stops you, so the safeguard is knowing this.

### Adding a schema change later

1. Write a **new** file, e.g. `drizzle/0006_your_change.sql`. Never edit an existing one.
2. **Take a backup first** — see BACKUP_AND_RESTORE.md. A schema change is one of the few
   operations that can destroy data.
3. Apply it once:

```sh
npx wrangler d1 execute DB --remote --yes --file=drizzle/0006_your_change.sql
```

4. Confirm it landed by checking the columns, not just the absence of an error:

```sh
npx wrangler d1 execute DB --remote --yes \
  --command "SELECT name FROM pragma_table_info('projects')"
```

> `--local` and `--remote` are one word apart and hit completely different databases. Production is
> always `--remote`.

> `wrangler d1 execute` can time out and print nothing at all. **Always re-read the row or column
> afterwards.** An account activation once failed silently this way.

---

## 3. Seed data — how the 74 projects got there

`ensureSeed()` in `worker/index.js` runs on the first API request against an empty database. It
inserts `worker/seed.js` (the workbook baseline) and then writes a marker into `app_meta`:

```js
if (marker?.value === SEED_VERSION) return;   // never runs again
```

**This has already happened in production.** You will not see it run again.

### ⚠ Never use seeding to import updated data

The seed logic contains `UPDATE` and upsert statements. Bumping `SEED_VERSION` to push new workbook
data into an initialised database can overwrite values that users have since edited in the tracker.
Later reconciliation must be a separate, agreed, backed-up procedure.

### What the seed contains

- 74 projects with their workbook financials
- 127 `project_updates` rows: one per project at reporting period **2026-08-28**, plus 53 at the
  previous period **2026-08-21**
- 73 directory entries, all created `pending` with **no password** — see USER_ADMINISTRATION.md

Three seed records share a duplicate `source_key` (all `Development:PATINA:Via Napoli:`). The
application appends `:source-row:N` to the second and later ones so each keeps its own row and
history. If you compare against the workbook and see odd-looking keys, that is why.

---

## 4. Verifying data against the source workbook

The source of truth is `worker/seed.js`. To check production still matches:

```sh
npx wrangler d1 execute DB --remote --yes \
  --command "SELECT COUNT(*) AS projects FROM projects"                    # 74
npx wrangler d1 execute DB --remote --yes \
  --command "SELECT COUNT(*) AS updates FROM project_updates"              # 127 seeded, plus any added since
npx wrangler d1 execute DB --remote --yes \
  --command "SELECT GROUP_CONCAT(DISTINCT reporting_period) FROM project_updates"
```

Financial totals, last verified matching source:

| Field | Source total |
|---|---|
| `precon_capp` | 4,918,524 |
| `construction_capp` | 69,888,884.8 |
| `add_capp` | 15,584,577 |
| `approved_budget` | 175,075,203 |
| `anticipated_final_cost` | 1,056,401,425.21 |

```sh
npx wrangler d1 execute DB --remote --yes --command \
  "SELECT SUM(COALESCE(precon_capp,0)) AS precon, SUM(COALESCE(construction_capp,0)) AS construction, SUM(COALESCE(add_capp,0)) AS addcapp FROM projects WHERE archived_at IS NULL"
```

---

## 5. ⚠ Editing a cost field changes workbook figures

Two behaviours in the application mean **editing a cost field can silently alter values that came
from the source workbook**. They matter whenever financial totals are reconciled against that
workbook.

### 5.1 The edit form rounds decimals

Cost values saved through the browser lose sub-unit precision. Observed in production:
`construction_capp` `143336.8` → `143337`, purely from being saved. Any edit to a project with a
decimal cost will round it.

### 5.2 Editing any cost field overwrites `approved_budget`

Whenever `precon_capp`, `construction_capp` or `add_capp` is submitted, the application recalculates:

```sql
UPDATE projects SET approved_budget =
  COALESCE(precon_capp,0) + COALESCE(construction_capp,0) + COALESCE(add_capp,0)
WHERE id = ?
```

Correct for records the team maintains in the tracker — **destructive** for records where the
workbook's `approved_budget` deliberately differs from the sum of its parts. The workbook figure is
replaced and the original is gone.

**Four projects are in that state:**

| Project | Workbook `approved_budget` | Sum of components |
|---|---|---|
| Corporate — 250 Delaware Ave, 3 office build out | 72,000 | 73,360 |
| Gaming — Gate City / Nashua Resort, Gaming Expansion | 99,343,000 | 19,578,167 |
| Parks & Resorts — Geneva Lodge, Rooms Renovation / FFE | 5,500,000 | 0 |
| Corporate — Highmark Stadium, DN Suite Pantry | NULL | 456,365 |

The last one was edited at one point and has since been restored to its source value.

### 5.3 Recovering a workbook figure

**A UI edit cannot restore it** — resubmitting cost fields just recalculates again, and a NULL
`approved_budget` cannot be typed into the form at all. Restore at the database level, after a
backup:

```sh
npx wrangler d1 execute DB --remote --yes --command \
  "UPDATE projects SET construction_capp = <source>, approved_budget = <source or NULL> WHERE id = <id>"
```

Source values are in `worker/seed.js`, keyed by `source_key`.

> Direct SQL bypasses the application's audit path, so a correction made this way leaves **no audit
> entry**. If the audit trail matters to your client, mention the correction to them.

### 5.4 Guidance

- Treat cost fields as read-only on the four projects above unless a change is intended.
- Re-verify totals (§4) after any bulk editing session.
- Worth asking the client whether `approved_budget` should recalculate at all, or only when it is
  currently NULL. That is an application change, not a configuration one.

---

## 6. D1 is not ordinary SQLite — two limits that have bitten this project

### Compound `SELECT` is capped at 5 terms

D1 rejects `SELECT … UNION ALL SELECT …` beyond **5 terms** with
`too many terms in compound SELECT` (`SQLITE_ERROR 7500`). Local SQLite allows 500, so this only
appears in production.

This broke project editing. The audit function built one `SELECT` per edited field joined with
`UNION ALL`, so any save touching 6+ fields returned HTTP 500. **It is fixed** — the field/value
pairs now travel as a single bound JSON parameter expanded by `json_each()`, which has no term
limit. Audit behaviour is unchanged: before/after values, actor, timestamps, one row per save, and
no entry when nothing changed.

**Because of this fix, `worker/index.js` intentionally differs from the `CHECKSUMS.sha256` manifest
in the repository root.** Every other listed file still verifies byte-for-byte. If `worker/index.js`
is ever replaced from an external source, re-apply this fix or confirm the replacement resolves the
same limit.

### Writes are atomic per `batch()`

The application groups related writes into `env.DB.batch([...])`, which D1 executes atomically. A
failed update therefore leaves no partial data and no orphaned audit row. **Preserve that grouping**
if you modify write paths — the local Vite preview implements `batch()` as `Promise.all`, which is
*not* atomic, so the preview cannot prove this behaviour. The test suite can.
