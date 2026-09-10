# Testing and production verification

Two separate things: tests you run **before** shipping, and checks you run **after** shipping.

---

## 1. Local tests — run these before every deploy

Needs **Node.js 22.5+**. No Cloudflare access, no network, touches nothing real.

```sh
npm test
```

That runs three steps:

| Step | What it proves |
|---|---|
| `npm run build` | The Worker bundle compiles |
| `npm run validate` | The bundle is a valid ES module exporting `default.fetch`, which is what Pages requires |
| `scripts/smoke-test.mjs` | Seed data, KPI calculations, development workflow, history, formulas, exports, role checks, the directory, the PDF guide, and audit behaviour including transaction rollback |

It uses an in-memory SQLite database created from the real migration files, so schema changes are
exercised too.

**A passing `npm test` is necessary but not sufficient** — see §3.

---

## 2. The local preview

```sh
cp .env.example .env      # set PREVIEW_ADMIN_EMAIL / PREVIEW_ADMIN_PASSWORD
npm run dev               # http://localhost:5173
```

The application ships with no built-in credentials, so the preview creates one administrator in its
throwaway in-memory database from those two variables. Leave them unset and you
get the sign-in screen with no way past it. The database resets on every restart.

Good for: screens, layout, data, roles, editing, exports.

---

## 3. ⚠ What local testing cannot prove

Local SQLite and Cloudflare D1 are not the same. **A change can pass every local test and still fail
in production.** See [DATABASE.md](DATABASE.md) §6 for a case where exactly that happened.

| Difference | Consequence |
|---|---|
| Local SQLite allows 500-term compound `SELECT`; **D1 allows 5** | Once broke project editing in production while all local tests passed |
| The Vite preview implements `batch()` as `Promise.all` — **not atomic** | The preview cannot prove transaction rollback. The `npm test` suite can — it uses real `BEGIN`/`COMMIT` |
| The preview has **no R2 binding** | Photograph endpoints return 503 locally |

**So: for anything touching SQL, verify against real D1 before deploying.** The safe way is a
temporary database, never production:

```sh
npx wrangler d1 create dnc-scratch-test
npx wrangler d1 execute dnc-scratch-test --remote --yes \
  --file ~/dn-tracker-backups/<timestamp>/d1-...sql        # restore a real backup into it
# ... run your queries against dnc-scratch-test ...
npx wrangler d1 delete dnc-scratch-test --skip-confirmation
```

Read-only `SELECT`s can safely be run against production to check SQL compatibility — confirm
`rows_written: 0` in the output.

---

## 4. Permission tests

Business-unit enforcement protects client data, so verify it rather than assuming. A repeatable
harness exists covering:

- Admin sees all 5 units and all 74 projects; can edit any unit; export contains every unit
- Gaming Viewer sees only Gaming; cannot edit anything (403); export excludes other units
- Gaming Editor can edit Gaming, but another unit returns 404 — including activity, development
  edits and promotion
- Creating a project in another unit returns 403
- An other-unit Editor behaves as the mirror image
- A multi-unit (`"Gaming, Corporate"`) user sees exactly those two
- Portfolio, cost and risk views derive from the scoped list
- Denied writes leave **no** audit rows

Use synthetic users on `example.invalid` addresses, never real staff. See [PERMISSIONS.md](PERMISSIONS.md) for the
rules being tested.

---

## 5. Verifying production after a deploy

### Quick automated pass

```sh
# reachable on both hostnames
curl -s -o /dev/null -w "%{http_code}\n" https://dnc.lagospm.com/health
curl -s -o /dev/null -w "%{http_code}\n" https://dnc-tracker-pilot.pages.dev/health

# data intact
npx wrangler d1 execute DB --remote --yes --command "SELECT COUNT(*) AS n FROM projects"          # 74
npx wrangler d1 execute DB --remote --yes --command "SELECT COUNT(*) AS n FROM user_directory"    # varies
npx wrangler d1 execute DB --remote --yes --command "SELECT COUNT(*) AS n FROM project_updates"   # 128

# security posture — all three must be 401
curl -s -o /dev/null -w "%{http_code}\n" https://dnc.lagospm.com/api/bootstrap
curl -s -o /dev/null -w "%{http_code}\n" https://dnc.lagospm.com/export.csv
curl -s -o /dev/null -w "%{http_code}\n" https://dnc.lagospm.com/api/bootstrap \
  -H "oai-authenticated-user-id: x" -H "oai-authenticated-user-email: x@y.z"
```

That last one is important: it proves `ALLOW_PLATFORM_AUTH` is off. If it returns 200, **stop** —
anyone can become an administrator by sending a header. See [DEPLOY.md](DEPLOY.md) §5.

### Manual pass, signed in as an administrator

1. Sign in.
2. Open a project, change **several fields at once**, save. *(Multi-field saves are the regression
   check for the D1 fix in DATABASE.md §6.)*
3. Hard-refresh — the change persisted.
4. **Admin → Recent audit activity** shows project name, field, before → after, your name, timestamp.
5. Save the same values again — **no duplicate** audit entry appears.
6. Double-click an Activity Update cell — dated history opens, workbook entries attributed to
   *Workbook Import*.
7. A profile photograph renders (proves the R2 binding is live).
8. Export CSV, TSV and XLSX.
9. Open Help and the PDF guide.

### Always test on the real URL

Every past deployment stays reachable at its own `<hash>.dnc-tracker-pilot.pages.dev` address and
**permanently keeps the bindings it was deployed with**. Testing on one of those can show missing R2
or old behaviour while production is perfectly fine. Use `https://dnc.lagospm.com`.

---

## 6. Verifying data against source

Record counts, activity history and financial totals are checked against `worker/seed.js`. Commands
and the expected totals are in **DATABASE.md §4**.

---

## 7. Verifying a restore

Covered in **BACKUP_AND_RESTORE.md** — including the content fingerprints that catch silent
corruption, which row counts alone would miss.

---

## 8. A habit worth keeping

**`wrangler d1 execute` can time out and print nothing.** After any write, re-read the row and
confirm the change. Never treat "no error" as "it worked".
