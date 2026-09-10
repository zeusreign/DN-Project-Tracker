# Delaware North D&C Project Management Tracker

A web application for tracking Delaware North Design & Construction projects. It covers capital
projects, a development pipeline, costs, schedule and risk, with per-project activity history and an
audit trail. It replaces a spreadsheet-based reporting workbook.

**Live application:** https://dnc.lagospm.com

---

## What it is

A **single Cloudflare Worker**, deployed as a Cloudflare Pages Function. There is no separate
frontend build, no framework and no server to maintain.

| Part | Role |
|---|---|
| `worker/index.js` | API routes, authentication, permissions, calculations, audit logging |
| `worker/client.js`, `page.js`, `styles.js` | The browser interface, served as one HTML page |
| `worker/seed.js` | The 74 project records loaded into an empty database on first run |
| `drizzle/*.sql` | Database migrations |
| `scripts/` | Build, bundle and test scripts |

### Cloudflare resources

| Resource | Name | Purpose |
|---|---|---|
| Pages project | `dnc-tracker-pilot` | Hosts the application |
| D1 database | `dnc-tracker-pilot` | Projects, activity history, users, audit log |
| R2 bucket | `dnc-tracker-assets` | Profile photograph files (private) |

Deployment uses **Wrangler 4.129.1**. Configuration lives in `wrangler.toml` in the repository root.

### Screens

Portfolio · Projects · Development Pipeline · Cost Control · Risk Register · Admin ·
Help (with an embedded PDF guide)

---

## Running it locally

Requires **Node.js 22.5 or newer** (the test database uses the built-in `node:sqlite` module).

### Tests

```sh
npm install
npm test
```

`npm test` builds the Worker, validates the bundle and runs the test suite against an in-memory
database. It needs no Cloudflare access and touches nothing real. Start here.

### Preview in a browser

```sh
cp .env.example .env      # set PREVIEW_ADMIN_EMAIL and PREVIEW_ADMIN_PASSWORD
npm run dev               # http://localhost:5173
```

The preview uses a throwaway in-memory database that resets on every restart. The application ships
with no built-in credentials, so those two variables create a single administrator for the preview
only. See [docs/TESTING.md](docs/TESTING.md) for what the preview can and cannot prove.

---

## Documentation

Operational guides live in `docs/`. Each topic is documented in one place.

| Guide | Use it to |
|---|---|
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deploy a code change, or roll a release back |
| [docs/BACKUP_AND_RESTORE.md](docs/BACKUP_AND_RESTORE.md) | Back up and restore the database and files, and verify a restore |
| [docs/DATABASE.md](docs/DATABASE.md) | Understand the schema, migrations, seed data and known data behaviours |
| [docs/USER_ADMINISTRATION.md](docs/USER_ADMINISTRATION.md) | Create, activate, suspend or remove a user |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Understand roles and business-unit access |
| [docs/STORAGE.md](docs/STORAGE.md) | Understand how profile photographs are stored in R2 |
| [docs/TESTING.md](docs/TESTING.md) | Run tests, and verify production after a change |
| [docs/COST_AND_LIMITS.md](docs/COST_AND_LIMITS.md) | Understand Cloudflare usage limits, cost risk, and the monthly check |

`IMPLEMENTATION_NOTES.md`, `AUDIT_CHANGE_HANDOFF.md`, `VALIDATION_REPORT.md` and
`START_HERE_FAHEEM.md` in the repository root are retained as historical reference. **The guides in
`docs/` are the current source of instructions.** Where the two disagree, `docs/` is correct.

---

## Things not to do

1. **Do not re-run the database migrations.** They have been applied and are not repeatable — several
   use `ALTER TABLE … ADD COLUMN` and fail on a second run.
   See [docs/DATABASE.md](docs/DATABASE.md).
2. **Do not set `ALLOW_PLATFORM_AUTH` to `"true"` in production.** It makes the application trust
   request headers for identity, which would let any caller act as an administrator.
   See [docs/DEPLOY.md](docs/DEPLOY.md).
3. **Do not make the R2 bucket public.** Photograph access is authorised by the application; a public
   bucket bypasses those checks. See [docs/STORAGE.md](docs/STORAGE.md).
4. **Do not commit a database export.** Exports contain password hashes, session tokens and staff
   email addresses. Keep them outside the repository.
5. **Do not rely on a deployment URL other than the live domain.** Every past deployment stays
   reachable at its own `<hash>.dnc-tracker-pilot.pages.dev` address and permanently keeps the
   bindings it was deployed with, so it can behave differently from production. Use
   `https://dnc.lagospm.com`.
6. **Do not assume a database write succeeded because no error appeared.** `wrangler d1 execute` can
   time out and print nothing. Always re-read the row afterwards.

---

## Security notes

- No passwords, API tokens or secrets are stored in this repository. None are required at runtime.
- A deployment replaces code only. It never reads, writes or migrates the database.
- The database holds real staff details and real project budgets. Keep the repository private and
  treat exports as confidential.

---

## Running costs

The application runs within Cloudflare's free allowances, and current usage is a small fraction of
every limit. Most services simply stop serving if an allowance is exceeded rather than generating a
charge; R2 storage is the exception, which is why it is worth a brief monthly look.

[docs/COST_AND_LIMITS.md](docs/COST_AND_LIMITS.md) has the measured figures, what could realistically
cost money, and a five-minute monthly checklist.
