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
| `scripts/smoke-test.mjs` | Seed data, KPI calculations, development workflow, history, formulas, exports, role checks, the directory, the PDF guide, audit behaviour including transaction rollback, and the browser behaviour of the served page (see below) |

It uses an in-memory SQLite database created from the real migration files, so schema changes are
exercised too.

### The served page is tested too, not only the API

Two QA findings in a row (DNC-007 and DNC-008) were **server-correct and browser-broken**: every
request in the sequence was answered properly while the screen was wrong. An API-only test cannot
see either one, and a test that calls a client helper in isolation cannot see them either — both are
defects of *state carried across a sign-in*.

So part of the smoke suite runs the page the Worker actually serves. `scripts/browser-harness.mjs`
implements the DOM surface `worker/client.js` uses, parses the real markup out of `GET /`, executes
the real inline script inside it, and routes `fetch()` straight back into the Worker with a cookie
jar in between. Tests then drive it the way a person would — fill the sign-in form and submit it,
click **Sign off**, submit the password form — and assert on what is on screen afterwards.

It is deliberately not a general-purpose DOM. It supports the selectors, properties and events this
one client uses and nothing more; anything richer would be untested scaffolding. It needs no
dependency and no browser, so it runs anywhere `npm test` runs.

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

### ⚠ Local test credentials are not credentials

Any user ID or password appearing in this repository — in `.env.example`, in `pages-test/setup.sh`
(`LOCAL_ADMIN` / `LOCAL_PASS`, which default to a fixed local value), or in testing notes — exists
for one purpose: signing in to a throwaway database on a developer's own machine.

- They are **local development accounts only**, created against the local D1 state under
  `.wrangler/` or an in-memory database.
- They are **not production credentials**, and none of them grants access to anything deployed.
- They **must never be included in, copied to, or reused on a production deployment**, and must not
  be treated as a default or starter password for a real account.
- They exist **only for local verification** and are discarded whenever the local database is reset.

Real accounts are provisioned individually by an administrator against D1 — see
[USER_ADMINISTRATION.md](USER_ADMINISTRATION.md). Use `example.invalid` addresses for test accounts
so they can never collide with, or be mistaken for, a real member of staff. Override the local
default with `LOCAL_PASS` whenever convenient:

```sh
LOCAL_ADMIN=you@example.invalid LOCAL_PASS='<your own value>' ./pages-test/setup.sh
```

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

## 5. Verifying a deployment automatically

```sh
npm run check:remote -- https://<deployment>.pages.dev
```

`scripts/remote-check.mjs` checks a **deployed** environment. Until it existed there was no such
suite in this repository at all, which is why an earlier "63/63 checks passed" figure could never be
reproduced — it came from an ad-hoc run that no longer exists. Everything this script reports is
reproducible from the package.

By default it is **read-only and needs no credentials**: it signs nothing in, creates nothing and
writes nothing, so it is safe against any environment. It covers reachability, the unauthenticated
security posture (every API and export route must return 401, and the platform-auth header bypass
must return 401 — see §5.1 below), which build is actually deployed, and the deployed page executed
over the network as far as a signed-out session reaches.

### The authenticated half

DNC-007 and DNC-008 are both about an account *change* in one tab, and the second account has to
arrive holding a **temporary password**. That cannot be faked from outside, so the authenticated
half runs only when you supply two deliberately provisioned synthetic accounts:

```sh
DNC_EDITOR_USER=... DNC_EDITOR_PASS=... \
DNC_VIEWER_USER=... DNC_VIEWER_PASS=... DNC_VIEWER_NEWPASS=... DNC_VIEWER_SCOPE=Gaming \
  npm run check:remote -- https://<deployment>.pages.dev
```

Rules for that half:

- **Never point it at production**, and never at an account a real person uses. Completing the
  password change consumes the temporary-password state and sets a new password.
- Use `example.invalid` accounts created for the run and deleted afterwards. Creating them is a
  write to a shared QA database — agree it with whoever is testing there first.
- A Viewer that is not on a temporary password is reported as **SKIP**, not as a pass. Skipped
  checks are coverage the run did not have; read the summary line, not just the exit code.
- `DNC-001`, `-002`, `-004` and `-005` are deliberately **not** in the remote suite: each writes to
  `projects`, `project_updates` or `development_details`, which is not acceptable against shared
  data. They are covered by `npm test` against the in-memory database.

---

## 5.1 Verifying production after a deploy

### Quick automated pass

```sh
# reachable on both hostnames
curl -s -o /dev/null -w "%{http_code}\n" https://dnc.lagospm.com/health
curl -s -o /dev/null -w "%{http_code}\n" https://dnc-tracker-pilot.pages.dev/health

# data intact. The seeded baseline is 74 projects and 128 update rows; a workbook
# import adds to both, so treat these as floors, not fixed values — see
# WORKBOOK_IMPORT.md. What must never fall is the count.
npx wrangler d1 execute DB --remote --yes --command "SELECT COUNT(*) AS n FROM projects"          # 74 seeded + imports
npx wrangler d1 execute DB --remote --yes --command "SELECT COUNT(*) AS n FROM user_directory"    # varies
npx wrangler d1 execute DB --remote --yes --command "SELECT COUNT(*) AS n FROM project_updates"   # 128 seeded + imports

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

### Inactivity timeout

How it behaves, confirmed during verification:

- The **server** enforces the timeout, using the session activity timestamp.
- The browser warning is only a user notification — the server remains the authority.
- Background refreshes and automatic requests do **not** keep an inactive session alive.
- The timeout applies only to the inactive session. Other active sessions are not invalidated.
- Tabs sharing the same login stay synchronised through server-side session checks.

| Setting | Value |
|---|---|
| Production inactivity timeout | **45 minutes** |
| Warning appears | **1 minute** before expiry |
| Local testing | a shortened timeout was used for verification |

Verified in **Chrome**, **Firefox** and **Microsoft Edge on Windows**:

- The warning appears before the timeout.
- **Stay signed in** keeps the session active.
- **Sign out** ends the session.
- An expired session returns the user to the login screen.
- Multiple browser sessions do not affect each other.

---

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
