# Handoff — DN Project Tracker Pilot

Context dump for continuing this work in a new session. Written 2026-09-08.
Everything below was verified against the code or public DNS, not assumed. Where something
is unverified it says so explicitly.

---

## 1. The situation

**Client:** Tom Lagos (LagosPM), via Upwork. Full conversation is in `Client discussion.md`.
**Developer:** Faheem Malik.

Tom built a Delaware North capital-projects tracker using Codex in ChatGPT. It currently runs on
**ChatGPT Sites**, which is hosted on Cloudflare infrastructure that **Tom does not own or control**.
He wants to show it to Delaware North administrators to win their approval.

There are **two separate jobs**, and confusing them is the single easiest mistake to make here:

| | Original job | Current job |
|---|---|---|
| Scope | Migrate to Node.js + SQLite on an Ubuntu VPS | **Redeploy the existing Cloudflare app into a Cloudflare account Tom owns** |
| Status | **Deferred** by Tom on 2026-09-06 until DN approves | **Active** |
| Stack change | Worker→Node, D1→SQLite, +Nginx/systemd | **None.** Same Worker, same D1, same R2 |
| Price / time | "$3" capped, 6–7 business days | "$1" fixed, 2–3 business days |

Price figures appear redacted in `Client discussion.md` — treat `$1`/`$3` as placeholders.

**The pilot is not a migration.** Because Tom cannot reach the existing ChatGPT Sites account, nothing
is copied out of it. It is a **fresh deployment from the ZIP he already sent**, into empty infrastructure,
with his data loaded in afterwards. That is why it's a 2–3 day job.

Tom is unpaid on this and personally exposed. He is trying to prove to Delaware North that AI tooling
can turn their Excel workbooks into a real application. Cost sensitivity is real; so is his need to look
credible. He is detail-oriented and **fact-checks answers** — he caught an incorrect DNS claim against
Cloudflare's docs.

---

## 2. Security audit — the package is clean

Full review of all 33 original files. **No malicious code.** Key evidence:

- No `preinstall`/`postinstall`/`prepare` hooks in `package.json`
- All 64 transitive deps resolve to `registry.npmjs.org` (vite/rollup/esbuild/postcss only)
- **Zero external URLs** in the codebase except four `schemas.openxmlformats.org` XML namespace strings
  (required for XLSX, never fetched)
- `worker/index.js` makes **no outbound network calls**; client fetches only same-origin `/api/*`
- No `eval`, no `new Function`, no obfuscation
- `worker/social.js` (837 KB, one line) decodes to a valid 1200×630 PNG with **0 trailing bytes** after
  `IEND` — not a payload. All other images checked the same way
- `scripts/export-integrity-test.mjs` spawns `python3`, but it's a genuine openpyxl test of XLSX/CSV
  output — it even asserts CSV formula-injection escaping
- No hardcoded secrets; `PILOT_CREDENTIALS` is an empty frozen object
- Migrations are pure DDL — no `ATTACH`, triggers, or `load_extension`

Caveat: `npm test` dynamically `import()`s the bundled worker (`scripts/validate-artifact.mjs:30`), so it
executes that code. `worker/index.js` top level contains only constant and function declarations — safe.

---

## 3. Codebase facts

Single Cloudflare Worker. **~1,970 lines / 220 KB** of real code (the 837 KB `social.js` is a base64 PNG).

| File | Role |
|---|---|
| `worker/index.js` | 1,237 lines — all API routes, auth, sessions, CSRF, throttling, roles, audit |
| `worker/client.js` | Front-end (dense/minified style, 335 lines but 65 KB) |
| `worker/page.js` / `styles.js` | HTML shell and CSS |
| `worker/exports.js` | CSV / TSV / XLSX generation |
| `worker/seed.js` | 5 synthetic projects, all `source_key` prefixed `Sample:` |
| `worker/profile-photos.js` | Empty array — photos deliberately excluded |
| `drizzle/*.sql` | 6 migrations, 10 tables |

**Fully portable — zero Cloudflare-only APIs.** No KV, Durable Objects, `waitUntil`, `HTMLRewriter`,
`request.cf`, or `caches`. The entire platform surface is three bindings:

```
env.DB            85 uses
env.BUCKET         7 uses
env.ADMIN_EMAILS   2 uses
```

**Build:** `npm test` needs zero dependencies installed and passes. Bundle is
**1,402,254 bytes raw / 900,416 gzipped** — *before* the Help PDF and photographs are added.

**XLSX export uses STORE (uncompressed) ZIP entries** → low CPU, so Cloudflare's free-tier CPU limit is
not a concern. Measured 245 ms wall-clock for the full export path.

### What the sanitized copy is missing

Tom stripped content, not functionality. Absent: the real 74 project records (only 5 `Sample:` rows),
profile photographs, the Help PDF (`bundle.mjs:42` hardcodes `USER_GUIDE_BASE64 = ""`), real users,
password hashes, sessions, audit records. Also **no `wrangler.toml`** ever existed — `.openai/hosting.json`
is ChatGPT Sites' manifest format and means nothing to Cloudflare.

---

## 4. Critical gotchas — read before deploying anything

### 4.1 The app seeds itself and locks the marker  ⚠️ IRREVERSIBLE ON HIS ACCOUNT

`ensureSeed()` (`worker/index.js:234`) runs on the first authenticated request and inserts
`SEED_PROJECTS` into an empty database, then writes `app_meta.seed_version`. On subsequent runs:

```js
if (marker?.value === SEED_VERSION) return;   // exits early, forever
```

Deploy the package as-shipped and **five fictional projects are permanently written into Tom's database.**
Swapping in the real records afterwards does nothing (marker matches). Bumping `SEED_VERSION` doesn't fix
it either — inserts use `INSERT OR IGNORE` keyed on `source_key`, so the fake rows survive and you get 79
projects, 5 of them fake.

**Therefore: replace seed data BEFORE the first deploy.** Required edits:

1. `worker/seed.js` → the real 74 records, each keeping its `source_key`
2. `worker/index.js:14` `USER_DIRECTORY_SEED` → real reviewers and roles
3. `worker/index.js:20` `PILOT_CREDENTIALS` (empty) → generated temp passwords; leave
   `must_change_password = 1`
4. Bump **both** `SEED_VERSION` and `DIRECTORY_SEED_VERSION` (`index.js:9-10`)
5. Move Help PDF + photographs to R2 rather than base64-embedding (size limit)
6. Ensure `ALLOW_PLATFORM_AUTH` is absent or `"false"`

### 4.2 Migrations are not idempotent

`drizzle/0001` and `0003` use `ALTER TABLE ... ADD COLUMN`. Running them twice fails with
`duplicate column name: source_sort_order`. Apply exactly once per database.
`--local` and `--remote` are one word apart and hit completely different databases.

### 4.3 Login needs TWO flags, and fails with a misleading message

`handleLogin` (`worker/index.js:549`):

```js
const eligible = directory?.account_status === "active"
              && directory?.site_access_status === "authorized";
```

Seeded users default to `pending` on both. Set only `account_status` and the user is told
*"The User ID or password is incorrect."* — which looks like a password problem and isn't.
Also: 5 failed attempts locks the account for 15 minutes (`failed_login_count` / `locked_until`).

### 4.4 `ALLOW_PLATFORM_AUTH` is a production security hole

`platformUserFrom()` (`index.js:56`) trusts `oai-authenticated-user-*` headers. On ChatGPT Sites a trusted
proxy injected those. On a public Pages deployment nothing strips them — anyone could send one and arrive
as admin. It is correctly gated behind the env flag (default off). **Must stay off in production.**
It is currently set `"true"` in `wrangler.toml` and `vite.config.js` for local testing only.

### 4.5 `wrangler.toml` must be in the project root

Pages rejects `--config` with a custom path. A config it can't find **fails silently**: the site boots with
no bindings, then returns `503 "The project database is not available."` on every request — which reads
like a database fault and is really a file-location fault.

### 4.6 `business_unit_scope` is stored but NOT enforced  ⚠️ COMMERCIAL RISK

Roles genuinely work — `canWrite(role)` gates all five write endpoints with 403.
But `business_unit_scope` is only persisted and displayed. `projectRows()` selects every project with no
scope condition, and the column appears in **no `WHERE` clause anywhere**. A reviewer scoped to "Gaming"
currently sees all projects.

**Milestone 1 requires "business unit permissions" and asks to demonstrate permissions.** If Tom expects
filtering, that is unbudgeted development. **This must be clarified before accepting Milestone 1.**

### 4.7 Worker size limit

900 KB gzipped before Tom's assets. Adding a real Help PDF and photographs as base64 could exceed
Cloudflare's script size cap. Mitigation (already promised to Tom): serve them from R2.

### 4.8 D1 `batch()` atomicity — deferred phase only

D1's `batch()` is implicitly atomic and the app relies on it at ~12 write paths with no explicit
transactions. The Node/SQLite shim in `vite.config.js` implements it as `Promise.all(...)`, which is not
atomic. **Only relevant to the deferred Ubuntu migration**, not the pilot. Named as a line item if that
phase proceeds.

---

## 5. Infrastructure findings (passive public DNS lookups)

| | |
|---|---|
| Authoritative DNS | **Hostek** — `ns1.hostek.com`, `ns2.hostek.com` |
| `lagospm.com` / `www` | Behind **Sucuri** — `cloudproxy10020.sucuri.net` (192.124.249.170) |
| Email | **Google Workspace** — `ASPMX.L.GOOGLE.com` |
| `dnc.lagospm.com` | **Already exists** → `213.109.159.69` = `linux.lagospm.com` |

**Implications:**

- The DNS record is changed in **Hostek's panel**, not Cloudflare's.
- `dnc` already resolves — so the change is **replace the existing A record with a CNAME**, not "add a
  record." Many panels won't hold both on one name. **Record `213.109.159.69` before changing anything**;
  rollback means restoring that A record, not deleting the new one.
- `dnc` resolves outside Sucuri, so the Sucuri config protecting the main site is untouched.
- Tom's live email runs through this same zone — hence his caution.

`213.109.159.69` is almost certainly the Hostek Ubuntu 18.04.5 VPS he mentioned. **He said not to touch
that server.** Note 18.04 is past standard support — relevant only if the production phase happens.

---

## 6. Verified locally (evidence, not assumption)

The app **runs unmodified as a Cloudflare Pages Function** with real D1 and R2 bindings:

```
✨ Compiled Worker successfully
env.DB (dnc-tracker-pilot)      D1 Database    local
env.BUCKET (dnc-tracker-assets) R2 Bucket      local
Ready on http://localhost:8788
```

- All 6 migrations applied via `wrangler d1 execute --local`
- `/api/bootstrap` returned live data from D1 (seeding ran: 5 projects, 4 business units, 9
  `project_updates`, 3 users, 0 `audit_log`)
- `/export.xlsx` produced a valid `Microsoft Excel 2007+` file; `/export.csv` in 30 ms
- Login succeeded after seeding a password:
  `{"ok":true,"name":"Sample Administrator","role":"admin"}`

Pages advanced mode takes a single `_worker.js` exporting `default { fetch }` — exactly this app's shape.
**No rewrite needed for the Pages route.**

### How to run it

```sh
cd ~/Desktop/DN_Project_Tracker_SANITIZED_DEVELOPER_REVIEW_2026-09-05/sanitized-review

npm run dev              # vite preview, :5173, auto-signed-in as admin (no login screen)
./pages-test/setup.sh    # Pages + real D1/R2, :8788  <-- matches the pilot
RESET=1 ./pages-test/setup.sh   # wipe local DB and start clean
kill $(lsof -ti:8788)
```

Local sign-in on :8788 — **local testing only**: `administrator@example.invalid` / `PilotAdmin1!`

Requires Node 22.5+ for `node:sqlite` (verified on v22.23.2).

---

## 7. Files created or modified in this project

### Modified (originals)

| File | Change |
|---|---|
| `vite.config.js` line 65 | Added `ALLOW_PLATFORM_AUTH: "true"` so the browser preview can sign in |
| `package.json` | Added `"wrangler": "^4.129.0"` devDependency — **keep this**, needed for deployment |
| `package-lock.json` | Corresponding entries |

### Created

- `wrangler.toml` (project root) — Pages config. **Contains local placeholders:**
  `database_id = "local-test-id"` and `ALLOW_PLATFORM_AUTH = "true"`. Both must change before any real deploy.
- `pages-test/setup.sh` — build, migrate (idempotent), seed a login, start Pages dev
- `pages-test/make-login.mjs` — generates a valid password record using the app's own PBKDF2-SHA256
  scheme (100k iterations, 18-byte salt). Mirrors `passwordRecord()` at `worker/index.js:112`.
  For the real deployment, feed its output into `PILOT_CREDENTIALS`.
- `pages-test/pages-dist/_worker.js` — copy of the built worker
- `dist/` — build output (gitignored)
- `.wrangler/` — 22 MB local D1/R2 state. **Add to `.gitignore` before any GitHub handoff.**
- `HANDOFF.md` — this file

### Untouched

`worker/` (all 8 files), `drizzle/` (all 6), `assets/`, `scripts/`, `README.md`,
`ARCHITECTURE_AND_SCOPE.md`, `REVIEW_INSTRUCTIONS.md`, `sanitized-pilot-data.json`,
`.openai/hosting.json`, `.gitignore`. **Application source and schema are exactly as Tom sent them.**

---

## 8. Conversation status

**Sent:** replies to Tom's seven confirmation questions (Cloudflare account ownership, DNS,
GitHub repo, 74-record load, backup/restore, Excel import, Cloudflare charges).

**An earlier DNS answer was wrong and Tom caught it.** Subdomain zones and partial CNAME setup are both
gated above the free plan. He proposed **Cloudflare Pages + Functions via CNAME** instead — his suggestion
is correct and is now the plan.

**Tom's latest message** raised two points and asked to re-confirm price and timeline:

1. Verify a domain approach that preserves his nameservers and fits the budget; confirm plan, recurring
   charges, and exact DNS changes
2. **Correction:** preserve all supplied project activity descriptions and dated activity history.
   Only the *new pilot's technical audit log* starts fresh — earlier wording of "clean audit and activity
   history" was too broad

On point 2, the schema maps cleanly: **`project_updates`** (`reporting_period`, `current_summary`,
`previous_summary`, `author_name`) is his activity history → **preserve**. **`audit_log`**
(`action`, `entity_type`, `actor_email`) is the technical log → **starts empty**, along with
`login_events` / `login_sessions`. The seeder already populates `project_updates` from each record's
`current_update` / `previous_update` (`index.js:313-352`), so preserving history is the natural path.

A reply was drafted covering both points plus confirmation that price and 2–3 days are unchanged.
**Whether it was sent is unknown — check with Faheem.**

**Tom has since shared two milestones** (full text in the chat, summarised):

- **M1** — working preview in the client-owned Cloudflare account; load 74 records + Help PDF + photos;
  preserve activity history, fresh audit log; fresh accounts with roles **and business unit permissions**;
  demonstrate login/permissions/editing/persistence; source + schema + migrations + deploy config in his
  private GitHub repo, no credentials
- **M2** — live at `https://dnc.lagospm.com` with HTTPS + renewal; demonstrate workflows, calculations,
  filtering, exports, history, Help, file access, permissions; verify record count, totals and activity
  history against source; downloadable backups + restoration instructions + **tested restoration** notes;
  GitHub handoff plus instructions for deploying changes, preserving live data, rolling back, and
  administering users

Both are achievable **except** the business-unit permissions ambiguity in §4.6.
M2's rollback requirement is easy — Pages keeps previous deployments and rolls back from the dashboard.
Both milestones are demo-heavy; budget time for live walkthroughs, not just build.

---

## 9. Open items

### Unverified — highest priority

**Can a Pages custom domain be attached by CNAME, on the free plan, for a domain whose nameservers are
elsewhere?** Nothing local can answer this and the whole plan rests on it. Verify by creating a free
Cloudflare account, deploying any Pages project, then **Custom domains → Set up a domain** with a hostname
on a non-Cloudflare domain. Looking for: does Cloudflare offer a **CNAME target**, or demand a nameserver
change? Docs: `developers.cloudflare.com/pages/configuration/custom-domains/`

### Also unconfirmed

- Whether Cloudflare requires a **payment method on file to enable R2**, even within free allowances.
  Tom is unpaid and personally exposed — he must be warned before hitting a billing screen.
- Current free-tier limits vs the 900 KB bundle:
  `/workers/platform/limits/`, `/d1/platform/limits/`, `/r2/pricing/`
- Expected recurring cost stated to Tom: **$0–5/month**, likely $0.

### Needs a decision from Tom

- **Business-unit scope** (§4.6) — restrict which projects a reviewer sees, or just record the setting?
  Ask neutrally: *"The supplied application stores the setting but does not currently filter by it."*
- Whether anything currently uses `dnc.lagospm.com` at `213.109.159.69`
- Format of the 74 records + activity history. Structured export (Excel/CSV/JSON) is a straightforward
  mapping; free-text history spread across workbook columns is where 2–3 days could slip.
  **Keep the data-format condition firm.**

### Access required from Tom

- **Cloudflare** — member with **Administrator** role (deliberately *not* Super Administrator: that
  carries billing and member management)
- **GitHub** — collaborator with **Write** on his private repo, which he creates
- **DNS at Hostek** — the record changed. **Recommend Tom makes the change himself** on a call with exact
  values; he keeps control of the zone carrying his email, and Faheem holds no liability for the rest of
  `lagospm.com`
- **Content** — approved 74 records, Help PDF, photographs, reviewer list with roles and scopes

### Explicitly NOT required (worth telling Tom — answers his ownership worry)

Nothing from the existing ChatGPT Sites deployment · no Hostek VPS access · no Sucuri access ·
no Google Workspace access · no billing access.

---

## 10. Next step

Faheem is doing a **full dress rehearsal on his own throwaway Cloudflare account** — no client materials
yet. Order:

1. Create Cloudflare account → `npx wrangler login` → `npx wrangler whoami` (confirm the account)
2. `npx wrangler d1 create dnc-tracker-pilot` → paste `database_id` into `wrangler.toml`
3. Apply the 6 migrations with `--remote`, **exactly once**
4. `npx wrangler r2 bucket create dnc-tracker-assets` — note whether it demands a payment method
5. `npx wrangler pages project create` → `npx wrangler pages deploy pages-test/pages-dist`
6. Attach D1 + R2 bindings, set `ADMIN_EMAILS`, **remove `ALLOW_PLATFORM_AUTH`**, redeploy
7. Load the page once to seed, then set a password with `--remote` and sign in

**With `ALLOW_PLATFORM_AUTH` off and `PILOT_CREDENTIALS` empty, nobody can log in on a real deploy** —
no account has a password. Expect this; fix it with `make-login.mjs` output run via
`wrangler d1 execute --remote`.

The most valuable outcome of the rehearsal is not step 7 — it is reaching the **custom domain** screen and
settling §9's open question.

---

## Appendix — commercial posture

- Tom's own `REVIEW_INSTRUCTIONS.md` says no chargeable work before an Upwork contract and funded
  milestone. The review response is sales, not delivery.
- The package says do not deploy or redistribute this review copy, and not to contact people referenced
  by the application.
- The pilot scope is **configuration, deployment and data loading** — essentially zero new development.
  The only genuine development task in the original list (a repeatable Excel importer) was **withdrawn by
  Tom on 2026-09-07**; only the one-time initial load remains in scope.
- Watch for scope creep: the seven confirmation questions plus both milestones total materially more than
  "deploy the existing tracker on a neutral URL," which is what 2–3 days was priced against. Holding the
  price is reasonable, but the **data-format condition is the main protection**.
