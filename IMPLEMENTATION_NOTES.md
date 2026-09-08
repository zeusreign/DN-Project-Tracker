# Implementation notes and findings

These are concrete findings from the supplied source. They distinguish what was locally verified from what must be completed or checked in the external pilot.

## 1. Business-unit permissions need server enforcement

The existing source stores `business_unit_scope` in the user directory, but the project queries and write authorization do not apply that scope. Browser business-unit filtering is a display feature; it does not enforce restricted access. The existing role checks cover Admin/Editor/Viewer behavior, not business-unit isolation.

Before admitting a reviewer who should see only selected units, enforce the approved scope on the server for project reads, details/history, development data, summary totals, exports and writes. Verify that a restricted user cannot access another unit by changing a URL/project ID, calling the API directly, exporting, or editing. Define Admin cross-unit access explicitly with Tom. This ZIP documents the finding; it does not claim the issue is fixed.

## 2. Fresh first administrator and reviewer accounts

The old `PILOT_CREDENTIALS` entries (password hashes/salts and associated credential metadata) have been removed from `worker/index.js` in this export. No existing login password, session token, Cloudflare API key or live database dump is provided.

For a NEW pilot database, apply migrations in order and allow the initial project/directory seed to complete. Its existing directory seed creates pending roster entries with no configured passwords in this export. Then provision the first approved local administrator through a controlled one-time procedure using the application's password hashing format, appropriate account/access status and forced password change. Use the existing Admin flow for the remaining approved pilot accounts. Document that bootstrap procedure for Tom; there is no universal bootstrap password in this package.

Do not assume `ADMIN_EMAILS` creates a local login account. It applies to the platform-auth fallback. Leave `ALLOW_PLATFORM_AUTH` unset or false on the external public deployment; public requests must not be able to authenticate by supplying `oai-authenticated-user-*` headers. The isolated smoke test explicitly enables those headers only in its local test environment.

Directory membership or a suggested role in the seed is not approval to invite or activate that person. Confirm the actual reviewer list, roles and unit permissions with Tom. Do not import old sessions or re-use prior passwords. Removing source fixtures does not revoke credentials in a database that already exists; use a new pilot database as agreed.

## 3. Preserve source data and history

All original `worker/seed.js` bytes and all six migrations are preserved. The 74-project baseline and embedded activity text must remain intact. The bootstrap uses the existing reporting-period constants to create dated source-history entries. They are not evidence that later live activity has been exported.

Keep existing seed version markers when updating an already-initialized database. Do not bump seed markers or rerun initial seeding as a general update/import method: seed logic includes updates/upserts that can replace values. Apply later workbook/live-data reconciliation only through an agreed, backed-up procedure that flags conflicts and preserves tracker-entered history.

## 4. Descriptive audit change

`AUDIT_CHANGE_HANDOFF.md` explains the enhancement and its acceptance example. New ordinary project-field and development-field edits capture before/after values in the existing `audit_log.details` JSON. The insert and update share a D1 transaction; a failed edit must not leave a successful-looking change entry.

Historical generic logs are not backfilled with invented before/after values. This refinement does not add descriptive before/after entries to every other event type (for example every directory or account event).

## 5. Preview and external deployment configuration

The included `vite.config.js` is the original local-preview helper. It has an older migration list that stops at `0004`, omits the R2 binding, uses a simplified non-transactional D1 adapter, and does not enable the platform-auth fallback its injected identity headers assume. Do not use it to certify current authentication, photos or audit rollback behavior. The smoke test has the current migrations, an in-memory storage adapter and transaction checks.

Create/verify the Pages deployment and a suitable local preview using all six migrations, real D1 transaction semantics, the R2 binding and the external local-login flow. Validate the actual Pages entry point/output arrangement; the build's `dist/server/index.js` and `.openai` files are the existing Sites-format output, not a ready-made Pages project configuration.

## 6. Acceptance checks for the deployed pilot

- Compare the principal screens, project order, filters, edits, calculations, downloads, Help PDF and photos against the baseline.
- Check fresh login, required password change, logout/session revocation and Admin/Editor/Viewer permissions with real browser sessions.
- Check business-unit read/write isolation as described above before restricted reviewer access.
- Confirm the 74 source projects and their supplied activity history, plus any separately agreed later data reconciliation.
- Demonstrate a Low-to-Medium budget-risk change with project, before/after values, actual actor and timestamp. An unchanged save should not generate a duplicate change entry.
- Verify persistence, backup/export and documented restoration with the actual external D1/R2 resources.

The local regression tests pass only the cases described in `VALIDATION_REPORT.md`. They are not a completed security assessment or proof of successful external deployment.
