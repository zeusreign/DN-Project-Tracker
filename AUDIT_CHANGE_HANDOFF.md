# Descriptive audit entries for the D&C pilot

Prepared September 8, 2026, following Mina Ramzy's suggested audit presentation.

## Behavior

New project-field and development-field edits record the project name, changed
field, previous value, new value, authenticated actor name/email, and database
timestamp. The Admin audit panel displays those details in its existing cards.
Multiple changes from one save stay together. Longer descriptions can be expanded.
Currency includes cents when present; timestamps show the reader's timezone.

Unchanged submitted values do not generate change entries. Unknown fields and
password fields cannot enter this field audit. Existing generic audit entries are
preserved and identified as lacking before-and-after values. Dated project activity
history is unchanged. This enhancement concerns edits, not behavioral surveillance.

## Integration

- Base source: 9b938c9469b31747dcec1026008d319196934505 in the existing Sites project.
- Changed files: worker/index.js, worker/client.js, worker/styles.js, and the
  existing scripts/smoke-test.mjs.
- No database migration, reseeding, new service, dependency, or account is needed.
- The existing audit_log.details JSON column stores the new information.
- The server reads previous values and records the event immediately before the
  update within one D1 batch transaction. Failed updates roll back their audit.
- Preserve that transaction behavior if adapting the code to another runtime.
- For an older or independently modified export, integrate the affected functions
  into that source rather than overwriting the developer's other changes.
- This source update is saved for review and handoff. It has not been deployed to
  the current live Sites pilot or any externally hosted environment.

## Validation completed

The existing artifact validation and smoke test pass, including targeted checks
for Low-to-Medium budget-risk changes, numeric values and cents, actor identity,
UTC timestamp interpretation, safe HTML rendering, historical-entry fallback,
unchanged saves, unknown fields, nonexistent projects, denied Viewer edits,
development estimates, unchanged activity history, and transaction rollback.

Validation used an isolated local SQLite database and the built Worker. No live
data was edited. Browser testing and testing in the developer's external
Cloudflare account have not been performed for this change.

## Deployment acceptance example

Using an authorized Editor or Administrator on an approved test project, change
Budget risk from Low to Medium. In Admin, verify the project name, Budget risk,
Low to Medium, actual editor identity, and date/time. Save Medium again and confirm
there is no duplicate change event. Confirm older activity/history remains intact.
Repeat with a development estimate and a value containing cents.

## Documentation reference

Cloudflare D1 batch transactions:
https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
