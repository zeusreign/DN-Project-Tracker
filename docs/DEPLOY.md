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
npm run deploy               # = npm run build:pages && wrangler pages deploy
```

`npm run build:pages` writes `pages-dist/_worker.js` and prints the bundle size. It **fails the
build** if the bundle exceeds the 3 MB gzip limit.

> **A deploy replaces code only.** It never reads, writes or migrates D1, and never touches R2
> objects. Live data is unaffected by shipping — that is why no backup is required for an ordinary
> deploy (see §6).

### Bundle headroom

```
pages-dist/_worker.js   ≈3.69 MB raw   /   ≈2.57 MB gzip   (~85% of the 3 MB free-plan limit)
```

The Help PDF and seven staff photographs are compiled into the bundle by `scripts/bundle.mjs`.
Adding further embedded assets will break the deploy; the fix would be to serve them from R2
instead.

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

## 7. Related known behaviour

- `worker/index.js` intentionally differs from the `CHECKSUMS.sha256` manifest in the repository root,
  because of a required Cloudflare D1 compatibility fix — **[DATABASE.md](DATABASE.md) §6**.
- Editing a cost field can overwrite workbook figures — **[DATABASE.md](DATABASE.md) §5**.
- Business-unit permissions are enforced server-side — **[PERMISSIONS.md](PERMISSIONS.md)**.
