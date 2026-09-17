# Deployment and rollback

How to deploy a change and how to undo one. Other topics have their own guide — see
[../README.md](../README.md).

No credentials are stored in this repository. Every step that needs account access is performed
interactively by the operator.

---

## 1. Production environment

| | |
|---|---|
| Cloudflare account | `tom@lagospm.com` |
| Account ID | `4c42138a510f1750c0d3ee6445795185` |
| Pages project | `dnc-tracker-pilot` |
| Custom domain | **https://dnc.lagospm.com** |
| Cloudflare URL | https://dnc-tracker-pilot.pages.dev |
| Deployment style | Pages "advanced mode" — a single `_worker.js`, uploaded directly (no Git integration) |
| Wrangler | 4.129.1 |

### Bindings

| Binding | Type | Resource |
|---|---|---|
| `DB` | D1 | `dnc-tracker-pilot` — see [DATABASE.md](DATABASE.md) |
| `BUCKET` | R2 | `dnc-tracker-assets` — see [STORAGE.md](STORAGE.md) |

All bindings and variables live in `wrangler.toml`, which **must stay in the project root**. Pages
does not accept `--config` with a custom path, and a config it cannot find **fails silently**: the
site boots with no bindings and returns `503 "The project database is not available."` on every
request — which looks like a database fault and is really a file-location fault.

---

## 2. Deploying a code change

```sh
# 1. Confirm the account FIRST. Must print tom@lagospm.com / 4c42138a…
npx wrangler whoami          # run `npx wrangler login` if not authenticated

# 2. Confirm what you are shipping is committed
git status --short && git log --oneline -1

# 3. Local checks — see TESTING.md
npm test

# 4. Build and deploy
npm run deploy:prod          # production — dnc.lagospm.com
```

> **Pick the target explicitly.** `npm run deploy:prod` deploys production;
> `npm run deploy:test` deploys the isolated review environment
> (`dnc-tracker-pilot-dev`) and handles its own `cd test-env` internally. Both refuse to run
> unless the corresponding `wrangler.toml` still names the resources that environment expects —
> run `npm run check:prod` or `npm run check:test` to see those assertions on their own.
> `npm run deploy` remains an alias for `deploy:prod`.

`npm run build:pages` writes `pages-dist/_worker.js` and prints the bundle size. It **fails the
build** only if the bundle exceeds Cloudflare's 64 MiB uncompressed limit, which it is nowhere
near.

> **A deploy replaces code only.** It never reads, writes or migrates D1, and never touches R2
> objects. Live data is unaffected by shipping — that is why no backup is required for an ordinary
> deploy (see §6).

### Bundle headroom

```
pages-dist/_worker.js   3,907,857 bytes uncompressed = 3.73 MiB   (~6% of the 64 MiB limit)
                        2,705,609 bytes gzip         = 2.58 MiB   (reference only)
```

**Cloudflare enforces 64 MiB measured uncompressed, the same on the Free and Paid plans**
([limits](https://developers.cloudflare.com/workers/platform/limits/)). Compressed size is not
checked. The older 3 MiB (Free) / 10 MiB (Paid) *gzip* limits were removed on
[4 September 2026](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/).

The Help PDF and seven staff photographs are compiled into the bundle by `scripts/bundle.mjs`, so
it grows whenever an embedded asset is added. There is ample headroom; if it ever became a problem
the fix would be to serve those assets from R2 instead. `build-pages.sh` also prints a note past an
**internal** 16 MiB advisory threshold — that one is ours, not Cloudflare's, and does not block a
deploy.

### Schema changes are a separate, deliberate step

Migrations are **not** part of a deploy and have already been applied. They are not repeatable — see
[DATABASE.md](DATABASE.md) §2 before changing anything about the schema.

---

## 3. After deploying

Run the quick automated pass and the manual checklist in **[TESTING.md](TESTING.md) §5**. The one
check never to skip:

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://dnc.lagospm.com/api/bootstrap \
  -H "oai-authenticated-user-id: x" -H "oai-authenticated-user-email: x@y.z"     # must be 401
```

> **Always verify on `https://dnc.lagospm.com`.** Every past deployment stays permanently reachable
> at its own `<hash>.dnc-tracker-pilot.pages.dev` address, keeping the bindings it was deployed
> with. An old URL can be missing the R2 binding entirely and behave differently from production.
> Never demo from a hashed URL.

---

## 4. Rolling back

From the dashboard:

**Workers & Pages → `dnc-tracker-pilot` → Deployments → ⋯ → Rollback**

Or redeploy a known-good commit:

```sh
git checkout <good-commit>
npm run deploy
git checkout <your-branch>
```

### ⚠ A rollback reverts CODE ONLY — never data

This is the most important thing to understand about recovery.

**Pages rollback restores the Worker script. It does not touch D1 or R2.** Any row inserted, updated
or deleted, and any file written to R2, stays exactly as it is. Rolling back does not undo a bad
migration, a mistaken bulk edit, or a deletion.

| Problem | How you actually fix it |
|---|---|
| Bad code deployed | Pages rollback — seconds |
| Bad data or bad migration | Time Travel, or restore a backup — [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) |
| Lost R2 objects | Restore from backup, **D1 first** — it holds the object keys |

**Watch for version mismatch.** Rolling code back after a schema change leaves old code running
against a newer schema. If a rollback follows a migration, restore the database to a matching point
too.

---

## 5. Environment variables and secrets

Set in `wrangler.toml` under `[vars]`. Neither is a secret; both are safe to commit.

| Variable | Value | Purpose |
|---|---|---|
| `ALLOW_PLATFORM_AUTH` | `"false"` | **Must stay false.** See below |
| `ADMIN_EMAILS` | `""` | Optional comma-separated list granting the `admin` role by email. It does **not** create a login account |

### ⚠ `ALLOW_PLATFORM_AUTH` must stay `"false"`

When true, the application trusts `oai-authenticated-user-*` request headers. The original hosting
platform had a trusted proxy that injected them. **On a public deployment nothing strips them, so
any caller could send one and arrive as an administrator.** Verified returning 401 in production;
re-check after every deploy (§3).

### There are no secrets in this project

No API tokens, passwords or keys are needed at runtime. If one is ever required, use
`npx wrangler pages secret put <NAME>` — never `wrangler.toml`, and never a file in the repository.

**Never committed:** `.env` (local preview only), `pages-dist/`, `dist/`, and database backups.
`.gitignore` covers all of these. A database export contains password hashes, live session tokens
and staff email addresses.

---

## 6. Backups

**An ordinary code deploy needs no backup** — it replaces the Worker script and cannot alter data.

Schema changes, bulk data operations and handovers do. When to take one, how, and how to restore:
**[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)**.

---

## 7. The isolated test environment

A second, fully separate environment exists for technical review. It runs **the same application
code** as production — the identical `_worker.js`, byte for byte. Nothing in `worker/` branches on
environment. **Isolation comes entirely from the Cloudflare bindings applied at deploy time**, which
is why the deploy command you choose is the only thing keeping the two apart.

### Environment overview

| | Production | Test |
|---|---|---|
| **Pages project** | `dnc-tracker-pilot` | `dnc-tracker-pilot-dev` |
| **URL** | `dnc.lagospm.com` | `dnc-tracker-pilot-dev.pages.dev` |
| **D1 database** | `dnc-tracker-pilot` | `dnc-tracker-pilot-dev` |
| **D1 id** | `94241844-c709-445f-a71c-49f8b65a7cfd` | `34dca57e-bd32-46cd-b154-8c362efaeb4c` |
| **R2 bucket** | `dnc-tracker-assets` | `dnc-tracker-assets-dev` |
| **Config file** | `wrangler.toml` (repository root) | `test-env/wrangler.toml` |
| **Contents** | Real projects (74 seeded + imports), real staff directory | 5 synthetic projects, 5 demo accounts |

> The production names are strict **prefixes** of the test names (`dnc-tracker-pilot` /
> `dnc-tracker-pilot-dev`). Any check written as a substring search matches both. Always compare
> whole values.

### Deployment workflow

```sh
npm run deploy:prod          # production — dnc.lagospm.com
npm run deploy:test          # isolated test — dnc-tracker-pilot-dev
```

These exist so the command encodes the intent rather than relying on which directory you happen to
be standing in:

- **`wrangler pages deploy` has no `--config` flag.** It finds configuration by searching *upward*
  from the working directory. Before these scripts, deploying test meant remembering
  `cd test-env` first, and forgetting it deployed the client's live site instead.
- **`deploy:test` performs that `cd` itself**, so `test-env/wrangler.toml` is always the config in
  effect.
- **Both refuse to run against a config that does not match.** `scripts/check-deploy-target.sh`
  asserts the Pages project name, D1 name, D1 id, R2 bucket, both binding names and
  `ALLOW_PLATFORM_AUTH = "false"`, and explicitly forbids the *other* environment's database id and
  bucket. A failure aborts before anything is built or uploaded.

Run the assertions on their own, without building or deploying:

```sh
npm run check:prod
npm run check:test
```

`npm run deploy` remains an alias for `deploy:prod`.

### Database workflow

```sh
npm run db:prod -- --command "SELECT COUNT(*) FROM projects"    # production
npm run db:test -- --command "SELECT COUNT(*) FROM projects"    # test
```

These pass the **database id explicitly** and deliberately bypass `wrangler.toml` resolution. The
binding name `DB` resolves differently depending on which config wrangler happens to find, so a
command written against `DB` can silently hit either database. An id cannot.

Everything after `--` is handed to `wrangler d1 execute`, so `--json`, `--file=…` and `--yes` all
work as normal.

> Read-only `SELECT`s are safe to run against production. Confirm `rows_written: 0` in the output.
> Anything that writes deserves a second look at which command you typed.

### How the test environment was built

1. **Create a separate D1 database** — `dnc-tracker-pilot-dev`.
2. **Apply migrations** — the six files in `drizzle/`, in order. They are not idempotent
   (see §2 of [DATABASE.md](DATABASE.md)), so they run exactly once against an empty database.
3. **Verify the schema matches production** — hash the normalised `sqlite_master` of both databases
   and compare. Row counts alone would not catch a column-order difference.
4. **Load synthetic demonstration data** — 5 projects, 9 history rows, 4 business units, taken from
   the `sanitized-review-pilot` branch. No live record is copied.
5. **Create dedicated test accounts** — five demonstration logins, below.
6. **Create a separate R2 bucket** — `dnc-tracker-assets-dev`, private, empty.
7. **Create a separate Pages project** — `dnc-tracker-pilot-dev`, production branch `test`.
8. **Deploy** — `npm run deploy:test`.
9. **Configure a custom domain** when one is available. Not currently attached; the environment is
   reached at `dnc-tracker-pilot-dev.pages.dev`.
10. **Verify isolation** — production D1 row counts unchanged, production Pages deployment list
    unchanged, and the seed markers below still matching.

#### The seed markers are load-bearing

`ensureSeed()` and `ensureDirectorySeed()` populate a database with the 74 seeded real projects and the
real staff directory **unless** `app_meta` already holds the exact version string the running bundle
expects. The test database carries those markers, which is why it stays at 5 projects after real
sign-ins.

```sh
npm run db:test -- --command "SELECT key, value FROM app_meta"
```

They must match `SEED_VERSION` and `DIRECTORY_SEED_VERSION` in `worker/index.js`. **If either
constant is ever changed, update the test database's markers in the same change** — otherwise the
next request to the test site loads real project data into it.

### Test accounts

Five demonstration logins exist, all on `example.invalid`. Passwords are held outside the repository
and are not recorded here.

| Account | Role | Business-unit scope |
|---|---|---|
| Administrator | admin | All |
| Viewer | viewer | All |
| Editor | editor | All |
| Gaming Viewer | viewer | **Gaming only** |
| Gaming Editor | editor | **Gaming only** |

The two restricted accounts see 1 of the 5 projects; the three unrestricted accounts see all 5.
Note that **administrators bypass scope entirely** — `scopeFor()` returns unrestricted for the
`admin` role before it reads `business_unit_scope`, so an admin with a unit scope still sees
everything. That is by design, not a fault.

### Safety notes

- **Production accounts are untouched.** The test directory contains only the five synthetic
  accounts above.
- **The test deployment never uses production D1 or R2.** Enforced by the deploy checks, not by
  convention.
- **`ALLOW_PLATFORM_AUTH` must stay `"false"` in both environments** (see §5). The
  `sanitized-review-pilot` branch sets it `"true"` for local inspection; that value must never reach
  a reachable deployment.
- **Never copy production users into the test environment.** Beyond the obvious, it would arm a
  second path: `importRequestedProfilePhotos()` matches directory rows by real staff email and would
  push seven real staff photographs into the test R2 bucket. Today nothing matches, which is the
  only thing preventing it.
- **Never run a production database command without confirming the target.** Use `db:prod` /
  `db:test` rather than a bare `wrangler d1 execute DB`, and check `rows_written` afterwards.

---

## 8. Related known behaviour

- `worker/index.js` intentionally differs from the `CHECKSUMS.sha256` manifest in the repository root,
  because of a required Cloudflare D1 compatibility fix — **[DATABASE.md](DATABASE.md) §6**.
- Editing a cost field can overwrite workbook figures — **[DATABASE.md](DATABASE.md) §5**.
- Business-unit permissions are enforced server-side — **[PERMISSIONS.md](PERMISSIONS.md)**.
