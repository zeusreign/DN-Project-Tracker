# Faheem handoff — latest D&C tracker source

Prepared for Tom Lagos and Muhammad Faheem Malik • September 8, 2026

This is the full contractor source handoff for the accepted pilot engagement. It contains workbook-derived project information and directory details; it is not the earlier synthetic-only review package. Use it within the agreed private pilot work.

## Start here

1. Use this package as the new source baseline. It includes the descriptive audit improvement suggested by Mina: new field edits show what changed, before/after values, who changed it and when.
2. Read `IMPLEMENTATION_NOTES.md`, especially fresh account setup, business-unit permissions and the source-data boundary.
3. Build and run the supplied validation commands before adapting deployment configuration.
4. Deploy using client-owned resources and the accepted contract. Resolve the permissions finding before giving access to any reviewer restricted to a business unit.

## Which version is included?

- Canonical source commit: `514f5f0cb1cf6b4f4c08ed0e7f30da77fbb6ee71`.
- Latest saved Sites source version: 25, verified September 8, 2026.
- The audit enhancement is saved source for handoff; it has not been deployed to the current live Sites pilot.
- Three source files have export-specific adjustments: legacy credential fixtures removed, original Sites resource identity removed, and the smoke test updated to verify fresh-account behavior. All other tracked files are preserved byte for byte from that commit. See `HANDOFF_MANIFEST.json`.

## Included

- Worker backend and browser source for Portfolio, Projects, Development Pipeline, Cost Control, Risk Register, Admin and Help.
- Six SQL migrations (`0000`–`0005`), with source seed logic for 74 workbook-derived projects and their embedded current/previous activity descriptions.
- The embedded Help PDF, Delaware North branding, icons and seven profile-photo assets.
- Build scripts, dependency lockfile, regression tests, audit-change notes and validation results.
- Directory metadata retained from the existing source; it is not a list of people authorized to receive new pilot access.

## Data boundary — important

The project seed in `worker/seed.js` is the workbook-derived baseline already embedded in the source, with an August 28, 2026 reporting period. This ZIP is **not a fresh export of the running Sites database or R2 bucket**. Later edits, additional activity-history rows, newly uploaded files/photos, runtime accounts, sessions and audit records are not captured here.

Preserve every activity description and dated history entry supplied in the approved package. If Tom needs later live-tracker updates included, reconcile a separate current data export before pilot acceptance. Do not imply that this source seed is the latest live dataset.

For a new database, start with fresh credentials and no imported old technical audit log. Keep the normal new audit events generated during setup and operation. Historical project activity and the technical audit log are different records.

## Local build and validation

Use Node.js 24 for the checks used to verify this handoff. Run these from the package root:

```sh
bash scripts/build.sh
node scripts/validate-artifact.mjs
node scripts/smoke-test.mjs
```

These commands require no live Cloudflare credentials and use an isolated in-memory SQLite test database. They build `dist/server/index.js` and migration assets. The smoke test uses a local-only platform-auth test harness and temporary passwords generated for that run. Never enable that test authentication shortcut on the public deployment.

Optional independent spreadsheet-format check (Python with `openpyxl` installed):

```sh
node scripts/export-integrity-test.mjs
```

`npm ci` installs the pinned development dependencies when needed; `node_modules` and generated `dist` are intentionally absent from the ZIP. The current `npm run dev` / Vite preview has known gaps described in `IMPLEMENTATION_NOTES.md` and is not the deployment recipe.

## Deployment and handover

The supplied runtime is a Cloudflare Worker using D1 (`DB`) and R2 (`BUCKET`). Node is used for tooling and tests; this is not an already-converted Node.js/SQLite server application.

Configure the accepted Cloudflare Pages/Functions deployment in Tom's account, including all migrations, D1/R2 bindings, fresh authentication, HTTPS and the agreed custom hostname. The existing `.openai/hosting.json` retains logical bindings only. It is not a Pages configuration and grants no access to the original Sites resources. Create the external deployment configuration and commit it with the source to Tom's private repository.

For `dnc.lagospm.com`, carry forward the agreed Pages custom-domain/CNAME approach at the existing DNS provider. Confirm the actual Pages project target before making that record. Keep the parent domain's nameservers and existing Hostek, Sucuri, email and other LagosPM services intact. Do not modify or deploy to the existing Hostek VPS.

Use the accepted contract for price, milestones, delivery, correction support and acceptance. This handoff does not change those commercial terms. Document database/file backup and restoration, ownership and routine deployment operations. No ongoing Excel synchronization is included in this source handoff; the intended working system after transition is the tracker.
