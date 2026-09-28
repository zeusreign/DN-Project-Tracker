# Faheem — Enhanced Beta integration and deployment handoff
Prepared September 25, 2026 • revision 17

## Deliverable and baseline
This ZIP contains the Enhanced source, compiled review build, additive migrations, documentation, tests, original Central City photo assets and import metadata. Start with ENHANCED_START_HERE.md. CHECKSUMS.sha256 covers packaged source files.

IMPORTANT: Enhanced was developed from e678538d6328a37255facb706b81a25f38a1bcac. It is NOT a replacement for corrected Classic commit 7b4eb5a627c502cc470b114a7c64c3ef9631b10e. Merge the Enhanced changes onto that corrected commit (or your newer verified descendant), retaining all DNC-001–008 corrections. Do not directly deploy this package's old-base dist output. Build the merged source anew.

## Current data and account preservation
Use the CURRENT production D1 database as the data authority. Take a fresh D1 export and R2 backup first. Preserve existing IDs, accounts, password hashes, roles, business-unit permissions, history and newer user edits. Do not seed demo users, reset passwords, restore the September 18 snapshot over production, or reimport Bill's workbook blindly.

Review demos reference the supplied September 18 backup (76 projects, 164 history entries; reporting periods through September 11). This is a dated review snapshot, not a current production export. Confirm Bill's latest approved workbook and reconciliation are present in the live database. Preserve later edits if current counts differ; investigate differences rather than force old counts. Keep the open Project Harbor 08731 / Izakaya CAPP 8740 relationship question; no merging is authorized.

## Integration sequence
1. Merge in a separate branch and preview environment; keep Mina's current test environment stable.
2. Review additive migrations 0006 and 0007_photo_details.sql against the current schema/migration ledger. Apply each once, after backup. Retain private R2 bindings and existing authentication configuration.
3. Build and run the corrected baseline tests plus scripts/enhanced-workflows-test.mjs. Verify both Classic and Enhanced against the merged backend. The standalone demo QA does not certify a deployed environment.
4. Import Central City examples using scripts/central-city-examples.mjs with authorized D1/R2 bindings. Call importCentralCityExamples(env) first for a dry run; review the mapping, then importCentralCityExamples(env,{apply:true}). This is a reusable binding-based module, not a standalone remote CLI. Wire it into your existing migration/import runner. No new public import endpoint is needed.
5. The importer requires exactly one project with venue CENTRAL CITY and name New Construction Complex; do not hardcode project ID 37 in production. It adds the original GGGR PNG as cover plus four JPEG progress photos, using stable IDs and preserving original photo numbers, June 2 dates and descriptions. A repeated import skips existing IDs/numbers. Confirm any existing main cover before import and preserve unrelated media. Assets and metadata are in assets/central-city.
6. Verify the integrated preview, then deploy the verified merged build to https://dnc.lagospm.com under Tom's deployment request. Keep Classic available via the switch. Retain the prior release and backups for rollback; avoid rolling back the live database over newer edits.

## Focused acceptance checks
- Existing authorized logins still work, with no password resets. Temporary-password accounts can reach password change but cannot access protected data beforehand; role controls recover without refresh afterward.
- Viewer is read-only and may export accessible data; Editor/Admin may write only within their allowed scope. Check direct API requests and business-unit restrictions.
- DNC-001–008 regression cases pass, including decimals, invalid input, duplicate activity saves, Development persistence and stale browser state.
- Bill's reporting history remains available in both views, including latest approved updates and subsequent edits.
- Central City shows the original GGGR cover and exactly four supplied progress examples; a repeat import creates no duplicates.
- Main-photo drag/drop and multiple progress uploads save and survive refresh. Edit, duplicate, confirmed delete and numbered series work. Check a real iPad/Safari camera/library upload; HEIC is not supported, use JPEG.
- Project Photos List has single-line rows, wide Description, far-right three-dot actions and double-click opens the selected Card. Viewer has no write menu. Full descriptions and remaining metadata remain in Card/Edit.
- Ten-day activity corrections, audit entries, Classic/Enhanced switch, sorting, fixed headers and Rolodex navigation remain functional.

## Return after deployment
Provide the full merged commit, deployment ID and URL, matching complete source ZIP, checksums, migration/import results, D1/R2 backup references and concise acceptance-test results. Confirm production accounts/passwords and data were preserved. Report any blocker before deploying an unverified build.
