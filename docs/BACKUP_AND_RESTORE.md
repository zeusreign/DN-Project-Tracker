# Backup and restoration

How to create a downloadable database backup and file backup, restore them, and verify that the
restore worked.

The procedure below has been executed end to end against the live system and the results recorded
in [Verification notes](#verification-notes). Other topics have their own guide — see
[../README.md](../README.md).

---

## What has to be backed up

The tracker keeps its data in two places, and **both are required** for a complete restore:

| Store | Resource | Holds |
|---|---|---|
| **D1** | `dnc-tracker-pilot` | All relational data — projects, activity history, users, audit log, sessions. Also the R2 object keys (`user_directory.avatar_key`). |
| **R2** | `dnc-tracker-assets` | Profile photograph **bytes** only. |

Everything else — the application, the Help PDF, the seven original staff photographs — is compiled
into the deployed Worker bundle and is reproducible from the Git repository. It does not need
backing up separately.

### ⚠ Restore D1 before R2 — this order is mandatory

`wrangler` (4.129.1) provides **no `r2 object list` command**. It offers only `r2 object get`,
`put` and `delete`, all of which require an *exact* object key.

The only inventory of what the bucket should contain is the **`avatar_key` column in D1**. The
application stores photo metadata in D1 and the bytes in R2, so D1 is the index.

**Consequence: if D1 is lost, the contents of R2 cannot be enumerated using wrangler at all.**
Recovering an inventory would require the S3-compatible API or the Cloudflare dashboard.

So the restore order is always:

1. Restore **D1** first.
2. Read the object keys out of the restored D1.
3. Restore **R2** using those keys.

The tested procedure below does exactly this — the R2 restore step reads its key list from the
freshly restored database, not from the backup manifest, which proves the dependency works.

---

## Taking a backup

Requires `wrangler login` as a user with access to the Cloudflare account. Run from the
project root so `wrangler.toml` supplies the `DB` binding.

```sh
TS=$(date -u '+%Y%m%dT%H%M%SZ')
BK=~/dn-tracker-backups/$TS
mkdir -p "$BK/r2" && chmod 700 ~/dn-tracker-backups "$BK"

# 1. Database — full export (schema + data)
npx wrangler d1 export DB --remote --output "$BK/d1-dnc-tracker-pilot-$TS.sql"

# 2. Schema only — useful for structure comparison during verification
npx wrangler d1 export DB --remote --no-data --output "$BK/d1-schema-only-$TS.sql"

# 3. Object inventory — from D1, the only available index
npx wrangler d1 execute DB --remote --yes --json \
  --command "SELECT avatar_key, avatar_mime, id AS directory_id, first_name, last_name
             FROM user_directory WHERE avatar_key IS NOT NULL ORDER BY avatar_key" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const r=JSON.parse(s)[0].results;
      require("fs").writeFileSync(process.argv[1],JSON.stringify(r,null,2));
      r.forEach(o=>console.log(o.avatar_key));})' "$BK/r2-manifest.json" > "$BK/r2-keys.txt"

# 4. Files — one get per key
while read -r key; do
  mkdir -p "$BK/r2/$(dirname "$key")"
  npx wrangler r2 object get "dnc-tracker-assets/$key" --file "$BK/r2/$key" --remote
done < "$BK/r2-keys.txt"

# 5. Checksums
( cd "$BK" && find . -type f ! -name CHECKSUMS.sha256 | sort | xargs sha256sum > CHECKSUMS.sha256 )
```

### When to take one

| Action | Backup first? |
|---|---|
| Ordinary code deploy | **No** — a deploy replaces code only and cannot alter data |
| Migration or schema change | **Yes** |
| Bulk update, delete, or data-reconciliation import | **Yes** |
| Re-running or bumping seed logic | **Yes** |
| Any `wrangler d1 execute` that writes, when you are unsure of its effect | **Yes** |
| Handover, or any formal checkpoint | **Yes** |

### Where backups live, and why not in Git

Backups are written to **`~/dn-tracker-backups/`**, deliberately outside the repository, at
`chmod 700`.

A D1 export of this system contains **password hashes, live session tokens, and the email
addresses of every person in the staff directory**. It must never be committed, pushed to the
client's GitHub repository, or attached to a ticket. `.gitignore` carries a defensive rule in case
a backup is ever copied into the tree, but the primary control is keeping them out of it.

### A backup is a point-in-time snapshot

The export is taken while the system is live. Business tables are stable, but `login_events`,
`login_sessions` and `audit_log` continue to change during and after the export. Small differences
in those tables between a backup and the live database are **expected and are not corruption** —
see the verification notes.

---

## Restoring

### Restoring D1

The export contains plain `INSERT` statements, **not** `INSERT OR REPLACE`. Restoring into a
database that already holds data will therefore **fail on primary-key conflicts** rather than
overwrite silently. That is a safety feature: restore into an **empty** database.

```sh
# Option A — restore into a NEW database (recommended; keeps the damaged one for inspection)
npx wrangler d1 create dnc-tracker-restored
# note the returned database_id

npx wrangler d1 execute dnc-tracker-restored --remote --yes \
  --file ~/dn-tracker-backups/<TIMESTAMP>/d1-dnc-tracker-pilot-<TIMESTAMP>.sql

# Point the application at it, then redeploy:
#   edit wrangler.toml -> [[d1_databases]] database_id = "<new id>"
npm run deploy
```

```sh
# Option B — restore into the existing database
# Only valid if it is EMPTY. Migrations must NOT have been applied: the export
# already contains every CREATE TABLE and CREATE INDEX.
npx wrangler d1 execute dnc-tracker-pilot --remote --yes \
  --file ~/dn-tracker-backups/<TIMESTAMP>/d1-dnc-tracker-pilot-<TIMESTAMP>.sql
```

> Do not run the `drizzle/*.sql` migrations before a restore. The backup is self-contained, and
> migrations `0001`/`0003`/`0004`/`0005` use `ALTER TABLE ... ADD COLUMN`, which is not idempotent.

### Restoring R2

Run **after** D1 is restored, taking the key list from the restored database:

```sh
BUCKET=dnc-tracker-assets     # or a new bucket name
DB_NAME=dnc-tracker-restored  # the database restored above
BK=~/dn-tracker-backups/<TIMESTAMP>

npx wrangler d1 execute "$DB_NAME" --remote --yes --json \
  --command "SELECT avatar_key, avatar_mime FROM user_directory WHERE avatar_key IS NOT NULL" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      JSON.parse(s)[0].results.forEach(o=>console.log(o.avatar_key+"\t"+o.avatar_mime))})' \
  > /tmp/keys.tsv

while IFS=$'\t' read -r key mime; do
  npx wrangler r2 object put "$BUCKET/$key" --file "$BK/r2/$key" --content-type "$mime" --remote
done < /tmp/keys.tsv
```

Passing `--content-type` matters: the application serves the stored MIME type back to the browser
and sets `x-content-type-options: nosniff`, so an object restored with the wrong type will not
render.

### Verifying a restore

```sh
# structure
npx wrangler d1 execute <DB> --remote --yes \
  --command "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%'"

# row counts, per table
npx wrangler d1 execute <DB> --remote --yes --command "SELECT COUNT(*) FROM projects"

# content fingerprint — catches silent corruption that counts alone would miss
npx wrangler d1 execute <DB> --remote --yes \
  --command "SELECT COUNT(*)||':'||SUM(LENGTH(COALESCE(current_update,'')))||':'||SUM(LENGTH(COALESCE(previous_update,''))) FROM projects"

# relational integrity
npx wrangler d1 execute <DB> --remote --yes \
  --command "SELECT COUNT(*) FROM project_updates u LEFT JOIN projects p ON p.id=u.project_id WHERE p.id IS NULL"
```

Compare each R2 object by reading it back and running `cmp` against the backup copy. Do not rely on
`wrangler r2 bucket info` — its `object_count` and `bucket_size` **lag by several minutes** and read
`0` immediately after an upload.

---

## Cloudflare Time Travel — a second line of defence

D1 includes point-in-time recovery for the **last 30 days**, at no cost and with no setup:

```sh
npx wrangler d1 time-travel info dnc-tracker-pilot            # current restorable bookmark
npx wrangler d1 time-travel restore dnc-tracker-pilot --timestamp <ISO-8601>
```

This covers accidental deletion or a bad migration far faster than a file restore, but it does
**not** replace the exports here: it only covers 30 days, it lives in the same Cloudflare account,
and it does not cover R2. Treat it as the first thing to try, and the downloadable backups as the
durable, portable copy.

> `time-travel restore` **overwrites the live database.** It has deliberately never been exercised
> here, because running it would modify production. Treat it as untested in this environment.

---

## Verification notes

A complete restore was performed and verified on **2026-09-09** using temporary Cloudflare resources.
**Production was not modified at any point** — confirmed after the test. These notes are kept as
evidence that the procedure above works, and as a worked example of what to check.

### Method

| | |
|---|---|
| Backup source | `dnc-tracker-pilot` (`94241844-c709-445f-a71c-49f8b65a7cfd`) |
| Backup taken | 2026-09-09 08:52 UTC |
| Temp database | `dnc-tracker-restore-test` (`cfc61cd5-fe01-4981-a25f-97cdf5c5d844`) — created empty, 0 tables |
| Temp bucket | `dnc-tracker-restore-test` |
| Wrangler | 4.129.1 |

The temporary database ID was confirmed different from production before any write, and every
temporary command used the explicit database/bucket **name** rather than the `DB` binding, which
resolves to production via `wrangler.toml`.

### Backup contents

| File | Size |
|---|---|
| `d1-dnc-tracker-pilot-20260909T085235Z.sql` | 291,187 B |
| `d1-schema-only-20260909T085235Z.sql` | 5,936 B |
| `r2-manifest.json` | 1,646 B |
| `r2-keys.txt` | 389 B |
| `r2/` — 9 objects | 1.7 MB |
| **Total** | **2.0 MB** |

```
f07069c6fbd41109b2419af1b49a2839e863875f57aa7ae06d864d1a909f7a0e  d1-dnc-tracker-pilot-20260909T085235Z.sql
2de992b283c780f79798dd290dcfefc16a71bd58a999f89f7e9e82fd6f6d8029  d1-schema-only-20260909T085235Z.sql
```

`sha256sum -c CHECKSUMS.sha256` — 13 files, 0 failures.

### Result: restore succeeded

**Structure** — 10 tables and 15 indexes restored, matching production exactly:
`app_meta`, `audit_log`, `business_units`, `development_details`, `login_events`,
`login_sessions`, `project_updates`, `projects`, `user_directory`, `user_roles`.

**Row counts** — all 10 tables matched the backup source:

| Table | Restored | Backup | |
|---|---|---|---|
| projects | 74 | 74 | ✅ |
| user_directory | 76 | 76 | ✅ |
| project_updates | 128 | 128 | ✅ |
| business_units | 5 | 5 | ✅ |
| development_details | 21 | 21 | ✅ |
| audit_log | 21 | 21 | ✅ |
| login_events | 33 | 33 | ✅ |
| login_sessions | 12 | 12 | ✅ |
| user_roles | 2 | 2 | ✅ |
| app_meta | 9 | 9 | ✅ |

**Content fingerprints** — identical between restored and production, proving the activity text and
financial figures survived intact rather than merely the row counts:

| Check | Restored | Production |
|---|---|---|
| Project text lengths (`count:current:previous`) | `74:14603:12181` | `74:14603:12181` ✅ |
| Budget totals (approved / anticipated) | `175075203.0 / 1056401425.21` | `175075203.0 / 1056401425.21` ✅ |
| Activity reporting periods | `2026-08-21, 2026-08-28, 2026-09-09` | same ✅ |
| `initial:` / `previous:` history rows | 74 / 53 | 74 / 53 ✅ |

**Relational integrity** — all zero, as required:
orphaned `project_updates` 0 · orphaned `development_details` 0 · projects without a business unit 0
· `avatar_key` rows preserved 9.

**R2** — all 9 objects restored and verified **byte-for-byte** (`cmp`) after reading them back out
of the temporary bucket. The key list was taken from the *restored* database, which demonstrates the
D1-before-R2 dependency in practice.

As an additional independent check, the seven original staff photographs in the backup were compared
against `assets/profile-photos/*.png` in the repository and are byte-identical — confirming the R2
round-trip is lossless.

### Production integrity after the test

`projects` 74 · `user_directory` 76 · `project_updates` 128 · `business_units` 5 ·
`development_details` 21 · `user_roles` 2 · `app_meta` 9 — all unchanged. A production R2 object was
read back successfully (439,158 B), and `https://dnc-tracker-pilot.pages.dev/health` returned 200.

### Expected drift, explained

At backup time `login_events` was 33 and `login_sessions` 12; production showed 36 and 13 shortly
afterwards. This is sign-in activity during testing, not data loss — every business table matched
exactly. It is the normal consequence of exporting a live system and should be expected in any
future backup.

### Not verified

- **Time Travel restore** was not exercised — it overwrites the live database.
- **Restoring over a non-empty database** was not attempted. The conflict behaviour above is
  inferred from the export using plain `INSERT`; treat "restore into an empty database" as the
  supported path.
- **Application-level restore** — the restored database was verified by direct query, not by
  pointing a deployed Worker at it and exercising the UI.
- Temporary resources were deleted after verification, so the restored copy no longer exists.
