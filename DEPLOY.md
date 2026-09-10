# Deployment and rollback — DN D&C Project Tracker

Operational runbook for the **live** pilot. Backup and restoration are documented separately in
[`BACKUP_AND_RESTORE.md`](BACKUP_AND_RESTORE.md).

No credentials appear in this repository. Every secret-bearing step is performed interactively by
the operator.

---

## 1. Current production state

**Live and serving** as of 2026-09-09.

| | |
|---|---|
| Cloudflare account | `tom@lagospm.com` — **client-owned** |
| Account ID | `4c42138a510f1750c0d3ee6445795185` |
| Pages project | `dnc-tracker-pilot` |
| Custom domain | **https://dnc.lagospm.com** |
| Cloudflare URL | https://dnc-tracker-pilot.pages.dev |
| Pages mode | Advanced — single `_worker.js`, direct upload (no Git integration) |
| Wrangler | 4.129.1 |

### Bindings (live)

| Binding | Type | Resource | Notes |
|---|---|---|---|
| `DB` | D1 | `dnc-tracker-pilot` — `94241844-c709-445f-a71c-49f8b65a7cfd` | Migrations `0000`–`0005` **applied**; seeded |
| `BUCKET` | R2 | `dnc-tracker-assets` | Standard class, `ENAM`, **private** |
| `ALLOW_PLATFORM_AUTH` | var | `"false"` | **Must never change** — see §8 |
| `ADMIN_EMAILS` | var | empty | Optional; does not create login accounts |

### Data currently in production

```
74 projects      76 users      128 project_updates      5 business units
9 R2 objects (7 imported staff photographs + 2 uploaded avatars)
```

> Only ever deploy this from the client account. It holds real Delaware North staff names, corporate
> email addresses, identifiable photographs, and real capital-project budgets.

---

## 2. Deploying a code change

`wrangler.toml` must stay in the project root — Pages rejects `--config` with a custom path, and a
config it cannot find **fails silently**: the site boots with no bindings and returns
`503 "The project database is not available."` on every request.

```sh
# 1. Confirm the account FIRST. This must print tom@lagospm.com / 4c42138a…
npx wrangler whoami          # npx wrangler login if not authenticated

# 2. Confirm the code you intend to ship is committed
git status --short && git log --oneline -1

# 3. Local checks (no Cloudflare access needed)
npm test                     # build + artifact validation + smoke tests

# 4. Build and deploy
npm run deploy               # = npm run build:pages && wrangler pages deploy
```

`npm run build:pages` writes `pages-dist/_worker.js` and prints the bundle size. It **fails the
build** above the 3 MB gzip limit.

**Deploy code only.** `npm run deploy` never touches D1 data or R2 objects — it replaces the Worker
script and nothing else.

### Bundle headroom

```
pages-dist/_worker.js   3.68 MB raw   /   2.57 MB gzip   (~85% of the 3 MB free-plan limit)
```

The Help PDF and seven staff photographs are base64-embedded by `scripts/bundle.mjs`. Adding further
embedded assets will break the deploy; the fix is to serve them from R2 rather than embedding them.

### Database changes are a separate, manual step

Migrations `0000`–`0005` are **already applied**. They use `ALTER TABLE … ADD COLUMN` and are **not
idempotent** — re-running any of them fails with `duplicate column name`. Do not re-run them.

A future schema change means a **new** migration file, applied deliberately:

```sh
# ALWAYS back up first — see §5
npx wrangler d1 execute DB --remote --yes --file=drizzle/0006_your_change.sql
```

`--local` and `--remote` are one word apart and hit completely different databases. Always
`--remote` for production.

---

## 3. Verifying production after a deploy

```sh
# reachable on both hostnames
curl -s -o /dev/null -w "%{http_code}\n" https://dnc.lagospm.com/health
curl -s -o /dev/null -w "%{http_code}\n" https://dnc-tracker-pilot.pages.dev/health

# data intact
npx wrangler d1 execute DB --remote --yes --command "SELECT COUNT(*) AS n FROM projects"          # 74
npx wrangler d1 execute DB --remote --yes --command "SELECT COUNT(*) AS n FROM user_directory"    # 76
npx wrangler d1 execute DB --remote --yes --command "SELECT COUNT(*) AS n FROM project_updates"   # 128

# photographs still linked
npx wrangler d1 execute DB --remote --yes \
  --command "SELECT COUNT(*) AS n FROM user_directory WHERE avatar_key IS NOT NULL"               # 9
```

Then in the browser, signed in as an administrator:

1. Sign in — the session cookie is `Secure`, so use HTTPS.
2. Open a project, change several fields at once, save. **This is the regression check for §7.**
3. Hard-refresh and confirm the change persisted.
4. Admin → Recent audit activity shows the project name, field, before/after, your name, timestamp.
5. Save the same values again — confirm **no duplicate** audit entry appears.
6. A profile photograph renders (confirms the R2 binding is live).
7. Export CSV.

> **Always test on `https://dnc.lagospm.com` or the bare `pages.dev` URL.** Every past deployment
> stays reachable at its own hashed URL (e.g. `43c09d79.dnc-tracker-pilot.pages.dev`) and
> **permanently keeps the bindings it was deployed with** — an old URL can still be missing the R2
> binding and will return `503 "Photo storage is temporarily unavailable."` while production is fine.
> Never demo from a hashed URL.

---

## 4. Rolling back

Pages retains previous deployments. Roll back from the dashboard:

**Workers & Pages → `dnc-tracker-pilot` → Deployments → ⋯ → Rollback**

or redeploy a known-good commit:

```sh
git checkout <good-commit>
npm run deploy
git checkout handoff
```

### ⚠ A rollback reverts CODE ONLY — never data

This is the single most important thing to understand about recovery here.

**Cloudflare Pages rollback restores the Worker script. It does not touch D1 or R2.** Any row
inserted, updated or deleted, and any file written to R2, stays exactly as it is. Rolling back does
not undo a bad data migration, a mistaken bulk edit, or a deletion.

The two are recovered by completely different mechanisms:

| Problem | Recovery |
|---|---|
| Bad code deployed | Pages rollback (seconds) |
| Bad data / bad migration | D1 Time Travel, or restore from backup — see `BACKUP_AND_RESTORE.md` |
| Lost R2 objects | Restore from backup (D1 first — it holds the object keys) |

Rolling back code while leaving migrated data in place can also produce a **version mismatch**: older
code against a newer schema. If a rollback follows a schema change, restore the database to a
matching point too.

---

## 5. When to take a D1 backup first

Take one **before**:

- applying any migration or schema change
- any bulk update, delete, or data-reconciliation import
- re-running or bumping seed logic
- any `wrangler d1 execute` that writes, when you are not certain of its effect
- handing the system over, or any milestone sign-off

You do **not** need one before an ordinary code deploy, because a deploy cannot alter data.

```sh
npx wrangler d1 export DB --remote \
  --output ~/dn-tracker-backups/pre-change-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Backups live **outside the repository** (`~/dn-tracker-backups/`, `chmod 700`) and must never be
committed — an export contains password hashes, live session tokens, and every staff email address.
`.gitignore` carries defensive rules. Full procedure, verified restore steps, and Time Travel usage
are in [`BACKUP_AND_RESTORE.md`](BACKUP_AND_RESTORE.md).

---

## 6. Administrator accounts

The application sends no email. Accounts are created in **Admin → + Add user**, and the temporary
password is delivered out of band. Admin-created users are always forced to change it at first
sign-in.

Passwords must satisfy `validatePassword()`: **10+ characters with upper, lower, digit and a special
character.**

To provision an administrator directly against D1 (only needed to bootstrap the first one):

```sh
PILOT_ADMIN_PASSWORD='…' node pages-test/make-login.mjs 'person@example.com' --create First Last
# prints an INSERT; pass it to:
npx wrangler d1 execute DB --remote --yes --command "<paste>"
```

---

## 7. Cloudflare D1 compatibility fix — project editing

**`worker/index.js` intentionally differs from the vendor's `CHECKSUMS.sha256`.** Every other
delivered file still verifies byte-for-byte. Recorded here so the mismatch is never mistaken for
tampering.

**The defect.** `fieldAuditStatement()` built the descriptive-audit query by emitting one `SELECT`
per edited field joined with `UNION ALL`. D1 rejects compound `SELECT` above **5 terms** (`too many
terms in compound SELECT`, `SQLITE_ERROR 7500`). The edit form submits every field at once, so any
save touching 6+ fields returned HTTP 500 / Cloudflare Error 1101. Project editing was broken in
production.

It was invisible before deployment because the package was validated only against local SQLite
(`node:sqlite`), whose limit is 500. `AUDIT_CHANGE_HANDOFF.md` and `VALIDATION_REPORT.md` both record
that testing in a live Cloudflare account was never performed.

**The fix.** Field/value pairs now travel as a single bound JSON parameter expanded by `json_each()`,
with before-values read from a `json_object()` snapshot of the same row. No term limit, so it scales
to any field count.

- One function body, ~15 lines. **No schema change, no migration.**
- Signature unchanged, so both call sites (`/api/projects/:id/fields`,
  `/api/projects/:id/development`) are untouched.
- Permissions, business-unit behaviour and `ALLOW_PLATFORM_AUTH` unchanged.
- Audit behaviour preserved exactly: before/after values, actor, project name, timestamps, one row
  per save, and no entry when nothing changed. Before-values are still read inside the same
  statement, in the same `batch()` as the `UPDATE`, so atomicity is unchanged.

**Verified against real Cloudflare D1** (temporary database restored from the production backup) at
1, 6 and all 19 editable fields, plus unchanged-field exclusion and forced-failure rollback — then
confirmed by a successful multi-field edit on production.

If the vendor issues a corrected package, re-apply this fix or confirm their version resolves the
same D1 limit before overwriting the file.

---

## 8. Security constraints

- **`ALLOW_PLATFORM_AUTH` must stay `"false"`.** When true, `platformUserFrom()` trusts
  `oai-authenticated-user-*` request headers. On ChatGPT Sites a trusted proxy injected those; on a
  public deployment nothing strips them, so **any caller could send one and arrive as an
  administrator.** Verified returning 401 in production.
- **Keep the R2 bucket private.** `handleAvatar()` enforces authentication, CSRF and ownership, then
  serves bytes with `private, no-store`. Enabling public access would bypass all of it and expose
  identifiable staff photographs.
- **`business_unit_scope` is stored but never enforced.** It appears in no `WHERE` clause anywhere,
  so a reviewer scoped to one business unit still sees and can export the entire portfolio. Known,
  vendor-documented gap (`IMPLEMENTATION_NOTES.md` §1). **Do not grant access to a
  business-unit-restricted reviewer until it is resolved.**
- No credentials are stored in this repository. `.env` (local preview only), build output and
  backups are gitignored.
