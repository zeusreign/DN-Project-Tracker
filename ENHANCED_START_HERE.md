# DN Project Tracker — Enhanced interface, review build, revision 17

Prepared September 25, 2026. Development package only; not deployed.

Based on Faheem's source handoff e678538d6328a37255facb706b81a25f38a1bcac. This is a modified working copy, not a new Git commit and not a claim about the current live release. The original manifest is retained in docs/baseline for traceability.

## Revision 17 — final photo list and handoff

- Read DEPLOYMENT_HANDOFF.md first for integration, current-data preservation, media import and release acceptance.
- Project Photos List now has one line per record, a wide Description column, alternating row shading and a far-right three-dot Edit/Duplicate/Delete menu. Double-click a row (or press Enter on it) opens its matching Card. Full metadata remains in Card/Edit; project is selected by the existing filter.
- Verified with qa/revision-seventeen.cjs. Existing accounts and live data have not been modified.

## Revision 16 — drag-and-drop and Central City examples

- Drag one JPG/PNG/WebP onto the main Record photo, or into its upload dialog. Drop multiple photos into Project Photos or its upload dialog. Drop zones highlight and support click/keyboard file selection. Progress selections accumulate without duplicate file selections; Save remains explicit.
- Rolodex heading, number, count and name text increased 1 pt, without changing the rest of the application's text.
- Four supplied Central City June 2, 2026 photos are preloaded in both review HTML files. Original IDs PTL26060214, 15, 16 and 24, dates, photographer, area, category, descriptions and report inclusion are retained. Only complete visible conversation-note sentences were transcribed. Reporting date is the source photo date, not a claim that they belong to a September report.
- Original JPEG files and metadata are in assets/central-city. scripts/central-city-examples.mjs exposes a dry-run-first import that matches venue CENTRAL CITY / project New Construction Complex and skips existing IDs/numbers. It writes private R2 objects, photo metadata and audit entries using supplied authorized bindings. It has NOT been executed on production or Mina's environment. Local preview can load them with --examples. Faheem should apply this import after integrating the Enhanced source and migrations; no need to upload each manually.
- Original GGGR color concept rendering supplied by Tom is included as Central City’s main cover (assets/central-city/GGGR-concept.png). Import includes one cover plus four progress photos. The original PNG is preserved and has no invented date taken.
- Verified: qa/revision-sixteen.cjs tests cover and multi-photo drag/drop/save, font size, four imported examples and preserved descriptions/IDs. Enhanced API test also verifies dry run and duplicate-free repeat import.

## Revision 15 — dedicated Project Photos module

- Project Photos is immediately before Admin in the sidebar, available to authorized users in Classic and Enhanced. Main project and Development layouts now offer List, Record and Cards; Collage belongs only to photos.
- Photo module offers one-photo Card view, metadata List and thumbnail Collage, project/reporting-week filters and search. Header controls remain fixed while data scrolls.
- Editable fields: reporting week, date taken, taken by, area, category, description, Include in report, and daily/conversation notes. New progress-photo numbers use user initials–YYMMDD–01 through 99, keyed to Date taken. Database sequence and unique index prevent duplicates across projects. Deleted numbers are not reused; 99 is a hard limit for the same initials/date. Older photos retain their existing fallback number. Include in report is stored metadata; this pass does not add a photo-report export or GPS capture/rotation.
- Save & Take Next keeps the upload form open, duplicates every metadata field except Description, clears the file selection and previews, and advances the numbered series. The next camera/library input is ready. Browser camera reopening still requires a tap. Save & Close ends the series. Add Photo, Duplicate, Edit and confirmed Delete are available to Editors/Admins; Duplicate starts a new upload with metadata retained and image/description empty. Deletion hides the metadata (audit retained) and removes the private R2 object. A failed R2 cleanup is reported for administrator follow-up; the object is already inaccessible through the app.
- Main property/reference photo stays on the project Record's Upload / Change photo control. Weekly progress uploads are in Project Photos → Upload photos. Select an authorized project, choose Photo Library or Take Photo, enter shared batch details, then Save. Individual photos can be edited afterward.
- iPad-friendly file/camera controls use the native browser picker and environment camera hint. Tested at tablet viewport sizes; physical iPad camera and Safari verification still required. JPG/PNG/WebP supported; files above 5 MB are resized to at most 2400 px and encoded JPEG in the browser (30 MB input cap). HEIC is not decoded; choose/export JPEG. Network connection required; no offline sync.
- Rolodex and bottom pagination are the two navigation options. Existing top-pagination preferences migrate to bottom. New gray binder/document icons resemble LagosPM references. Existing flipping animation remains.
- Apply additive migrations 0006 and 0007_photo_details.sql before deploying this package. Photo metadata writes enforce Editor/Admin access and project business-unit scope, validate fields and dates, use revision conflict checks, and write audit records. Original R2 files remain private.
- Validation: npm test; scripts/enhanced-workflows-test.mjs; qa/revision-fifteen.cjs (interactive demo); qa/photos-connected.cjs (actual local SQLite/R2 worker, uploads/edits persist across page reloads, Viewer UI). Historical revision QA scripts document earlier layouts and are not current acceptance scripts.
- No production, Mina environment or user permissions changed. Interactive demo uses in-tab blobs that reset on reload; real connected uploads persist.
- INTEGRATION REQUIRED: this Enhanced source still derives from e678538. Merge its changes into Faheem's corrected Classic handoff 7b4eb5a627c502cc470b114a7c64c3ef9631b10e, preserving DNC-001–008 fixes, then retest the integrated build. Do not replace the corrected live/test release with this older-base review bundle directly.

## Revision 14 — fixed view toolbar and activity comparison

- Classic/Enhanced switcher text increased another 1 pt to 13 px.
- Compare Past Activities uses Last Report on the left (latest reporting date) and Prior Report on the right (previous saved entry). Entries on the same reporting date remain selectable, ordered by creation timestamp and ID.
- List, Record, Cards and Collage now retain their upper controls while only the data region scrolls. Classic list headers remain fixed.
- Sort Order selector raised one additional pixel, now -3 px.
- Browser checks passed for all four fixed-header views, comparison defaults, text size, selector offset and existing demo uploads/activity flows.

## Revision 13 — compact controls and uncropped weekly photos

- A controls are regular weight and closer together, before the navigator. Navigator tooltip is exactly Rolodex/Pagination.
- Sort Order replaces Order; its selection box is raised 2 px.
- Weekly images use contained proportions in a responsive grid rather than stretching a single cropped photo across the page. Existing click-to-open-original links remain.
- Display/Upload controls indicate the active mode. Successful uploads switch back to Display automatically.
- Browser verification: qa/revision-thirteen.cjs tests uploads, contained image display, control placement/weight/tooltip, mode state, activity saves and demo isolation. Read-only preview checks also pass.
- Demo uploads still reset on reload. No production deployment or role changes.

## Revision 12 — text preferences, cycling navigator and interactive demo

- Restored pre-revision-11 text sizes. Only the amber Classic/Enhanced destination label retains the requested +1 pt increase.
- Removed Meeting Mode button. Small/large A controls sit beside the navigator; each click changes text by 1 pt, bounded from -1 to +4 pt. The preference applies to both views and is stored per account in the browser. Tooltips describe each control.
- Navigator cycles Rolodex → top pagination → bottom pagination → Rolodex, with three distinct SVG icons and current/next tooltips. No dropdown. Rolodex is the default for accounts without a saved navigator preference.
- `DN_Tracker_Enhanced_Interactive_Demo.html` adds an isolated in-tab demo of project-photo upload/replacement, weekly photo upload, current activity saves and eligible history edits. Changes and uploaded blobs reset on reload; there is no production connection or persistent storage. Live roles are unchanged. Unsupported write operations return a clear demo-limitation message.
- Interactive demo uses a synthetic Editor identity with the supplied September 18 project-data snapshot. It contains no production credentials/accounts/sessions.
- The existing `DN_Tracker_Enhanced_Preview.html` remains a separate read-only Viewer preview.
- Build the interactive demo with `node scripts/build-enhanced-preview.mjs --snapshot /path/to/backup.zip --interactive`.
- `qa/revision-twelve.cjs` passes actual file-browser uploads/display/activity, reload reset, no remote requests, three distinct cycling icons/default, A controls across views and removal of Meeting Mode. The connected local workflow tests and npm smoke checks also pass.

## Revision 11 — discoverability, readable lists and current preview data

- Fixed activity text painting over subsequent rows: editable content has bounded height and its own scrollbar in both views.
- Current activity has an explicit Save update button and reporting-date input in Record view; authorized list editors also have Save beside activity. Saving creates a dated update; correcting a saved entry uses Edit in history.
- Lock outline is now 45% opacity. The same original-save 10-day window remains server-enforced.
- All risk fills are solid, with white text for red/green and dark text for amber/grey. Text sizes are increased by one point in both experiences.
- Non-Workbook order sorts across property/BU groups; Workbook retains the original grouping. Risk order begins with High. Record order changes select the first item. Property appears beneath the business-unit label in lists.
- Double-click the Record photo to upload/replace it, or use Upload / Change photo. Weekly collage has Display/Upload controls and a drag-and-drop area; dropped files open the date/caption/save dialog.
- Meeting mode explicitly labels its larger text for screen sharing; current activity editor text enlarges too.
- Read-only preview now uses the September 18 post-import backup: 76 projects, 164 history entries, weekly reporting periods August 21, August 28, September 4, September 11, plus a September 9 entry. Unchanged notes were not duplicated in the import. This is a backup snapshot, not a live connection. Only project tables are read; no production accounts, passwords or sessions are copied into the preview.
- Upload/Save locations are visible but disabled in the portable Viewer preview, with a connected-application explanation. Authenticated Editor/Admin workflows work in the local application and are browser-tested.
- To rebuild that review file with an authorized backup: `node scripts/build-enhanced-preview.mjs --snapshot /path/to/dnc-tracker-backup-20260918T064750Z.zip`. Without the argument, the local harness still uses the archived 74-project sample seed.

## Revision 10 — photos, weekly reporting and activity editing

- Record view: photo upload/change for Editors and Administrators, current update action, costs, dates, scope, history and side-by-side reporting-date comparison.
- Collage now shows the selected project's progress photos for a chosen reporting week. Reference photos stay separate from progress photos. Multiple uploads are supported; JPG/PNG/WebP, maximum 5 MB each, optional caption and mandatory reporting date for progress photos.
- Saved history entries have an Edit button while eligible. The grey lock/unlock icon was 30% opacity in revision 10 (45% in revision 11); hover or keyboard focus shows remaining days or locked status.
- Editing closes exactly 10 days after the original `created_at` timestamp (UTC). Corrections do not restart the window or change the reporting date. This applies to Admins too. Imported entries retain their supplied creation timestamp.
- Original/revised text, actor and correction time are retained in `activity_revisions` and the project audit log. Concurrent stale edits are rejected. Correcting an older report does not overwrite the latest project summary.
- Server-side role and business-unit checks protect every new photo/history route. Viewers can view permitted photos/history but cannot upload or edit. Photo access requires a valid authorized session.
- Uploads persist in R2 with metadata in D1. Replaced reference photos remain retained; latest upload becomes the cover. Backup inventory now includes project-photo keys. R2 bytes still require the separate R2 backup procedure.

### Integration boundary

This development copy remains based on the earlier source handoff below. **It does not yet incorporate Faheem's later DNC-001–008 corrections.** Integrate against his final independently retested source before deployment, preserving those fixes. The newest reported source is not present in this workspace. Do not deploy this package directly over production or Mina's test environment.

Apply the additive migration `drizzle/0006_enhanced_media_and_revisions.sql` to a separate development database before running this version. Check migration numbering against the final baseline during integration. There are no live database or deployment changes in this delivery.

### Verification

- `npm test`: existing local smoke checks and generated-script syntax.
- `node scripts/enhanced-workflows-test.mjs`: real local SQLite and in-memory object storage; cutoff, stale edits, revisions, older/latest summary behavior, role/BU denials, file validation, upload/read and backup inventory.
- `qa/enhanced-browser.cjs`: existing layout/navigation/responsive/permission/edit-save regression checks.
- `qa/enhanced-workflows.cjs`: browser edit/revision/compare, lock styling, cover upload/reload, weekly upload/date selection, responsive width and Viewer controls.
- `qa/preview-browser.cjs`: standalone read-only review, no remote requests, writes blocked.

The portable HTML is read-only with the September 18 project-data backup. Upload/edit persistence is available in the connected development application, tested locally via `node scripts/preview-enhanced.mjs` (loopback, synthetic authentication, in-memory DB/R2; reset on restart). Never deploy the preview harness.

## Revision 9 refinements

- Restored the earlier crisp ridge/inset bevels and offset shadows to match the supplied older screenshot.
- Retained current card proportions, blue ball, animation and removed tooltips.

## Revision 8 refinements

- Elevated upper-left morning light: independently shaded raised frame, card stack and rings, with recessed track and number-window shadows.
- Animation and tooltip settings retained.

## Revision 7 refinements

- Higher upper-left illumination with raised ball reflection and shorter cast shadows.
- Removed Rolodex and experience-switch tooltips; accessible button labels retained.

## Revision 6 refinements

- Matched the side-by-side reference with a deep-blue ball and aqua reflection, plus stronger lower-right cast shadows from upper-left illumination.
- Card proportions and directional flip animation retained.

## Revision 5 refinements

- Deeper sapphire-blue slider ball with restrained upper-left reflection and lower-right shading.
- Consistent upper-left illumination across the frame, cards, recessed track and number window.
- Taller desktop cards and a lower number window use the space beside the track. Flip timing and motion are unchanged.

## Revision 4 refinements

- Centered amber experience switch with left/right arrows beside the destination label.
- Reflective aqua slider thumb with layered highlights and three-dimensional shading.
- Directional card flips when moving forward or backward; reduced-motion preferences are respected.
- First record shows a blank upper plastic frame; last record shows a blank lower frame. Navigation remains bounded.

## Revision 3 refinements

- Red and green risk labels use white text; fill opacity remains 70%.
- Rolodex is centered at approximately 70% size with beveled framing, shaded paper, metallic rings and a glossy blue thumb. Top half goes back; bottom half advances.
- The sidebar experience switch is borderless amber destination text, reduced by 2pt: Classic switches to Classic; Enhanced switches to Enhanced.

## Revision 2 refinements

- Enhanced now inherits Classic’s 224px desktop sidebar and the same 86px/narrow-window breakpoints.
- Project and Development list workspaces keep the upper controls and column headings fixed while rows scroll, in both experiences. Small windows retain access through responsive scrolling.
- All existing instant tooltips now have a centered pointer toward their source button, with edge-aware positioning.
- At revision 2, collage used project reference images. Revision 10 supersedes that behavior with weekly project photos.

## Included now

- Single Classic / Enhanced toggle at the bottom of the sidebar, remembered per signed-in user on this browser. Classic remains the application default.
- List, Record, Cards and Collage layouts in Projects and Development Pipeline.
- Shared Classic filtering and ordering, selected record retained across layouts where it remains in the filtered results.
- Navigator icon immediately left of Search offers top pagination, viewport-bottom pagination, or a sidebar Rolodex below Portfolio. The Rolodex book’s top half goes back and bottom half advances one record; arrows, track clicks, draggable blue thumb and record-number entry use the same filtered project set. Pagination includes first/previous/next/last.
- Meeting mode with larger activity text and expanded list updates.
- Readable record details, dated activity history, and the existing protected edit dialogs.
- Budget/Schedule risk fills at 70% opacity with bold, fully opaque text in both Classic and Enhanced (white on red/green; dark on amber/gray).
- Four explicitly labeled reference photos/renderings. All other records display a question mark and “[Project name] Pic.”
- Unsaved-change confirmation for the existing project, development and activity dialogs. Navigation is blocked while an inline/field save is pending.

Revision 10 adds scoped photo and activity-edit APIs and one additive migration. Authentication, role meanings, seed and workbook-import logic remain as in the working baseline. Both experiences share the same activity-edit enforcement. No production database or remote test resources were accessed or modified.

## Review and run

The separately supplied DN_Tracker_Enhanced_Preview.html is a portable read-only visual preview. Open in a browser. It uses the supplied September 18 backup, including 76 projects and 164 history entries through September 11. It is not synchronized with subsequent live edits. Its requests are intercepted locally, writes are blocked, and it has no live connection. The four reference images are embedded. It starts in Enhanced Record with Gaming selected and the Rolodex visible. Use the bottom-left experience toggle, layout buttons, business-unit filters and navigator icon to explore.

For a functional local preview, use Node 24 (node:sqlite required):

```
npm run build
node scripts/preview-enhanced.mjs
```

Open http://127.0.0.1:4173. This loopback-only harness uses an in-memory database, source migrations/seed, and an in-memory file store. Data resets on restart. Its synthetic platform identity is ONLY for this local harness; deployed configurations continue to disable platform authentication. Never deploy this harness or enable its development authentication in Cloudflare.

Build Cloudflare output with `npm run build:pages`. No deployment command was run. Existing deploy scripts still target the inherited Classic production and Mina test resources; do not use them for an Enhanced preview until Faheem has assigned a separate target.

## Integration with Faheem

1. Create a separate feature branch from the matching source baseline; merge any subsequent Classic/Mina fixes before release.
2. Review worker/enhanced.js, worker/enhanced-workflows.js, worker/enhanced-api.js, worker/enhanced-styles.js, worker/index.js and scripts/bundle.mjs, plus the new 0006 migration.
3. Set up a separate Enhanced preview with isolated demonstration data and storage. Preserve Mina's current test baseline and production.
4. Exercise Classic and Enhanced with all five review accounts. Confirm authorized records, backend-denied requests, saves/history, exports and session behavior. Apply Mina's findings to shared behavior in both views.
5. Obtain Tom's review before production integration. Keep a backup and the previous deployment available for rollback; apply the additive migration to the isolated development DB first and validate it against the final baseline.

## Image handling

The image catalog is assets/project-photos/catalog.json; rendered data is embedded in worker/project-images.js. Gate City, Mardi Gras Sports Bar and Two Kings are taken from the user-supplied September 14 roadmap. Two Kings is an architectural rendering credited to Friedmutter Group. Tenaya is an online property reference from Journeyscape, with its source linked in the UI. Capture dates are unknown. These are not current construction progress evidence.

Exact CAPP/business-unit matching prevents a property image being silently assigned to an unrelated project. Replacement approved images can use the same catalog keys. The catalog supplies fallback reference images; user-uploaded covers now override those images. Weekly uploads are separate. Confirm the online reference image is suitable for the intended distribution, or replace it with a DN-supplied photo before wider release.

## Earlier verification (revisions 1–9; current revision checks listed above)

- `npm test`: ESM build validation and application smoke checks passed.
- `npm run workbook:reconcile:test` and `npm run workbook:apply:test`: passed; repeat import and preservation of newer updates checked.
- `qa/enhanced-browser.cjs`: Chromium passed layout switching, selected record preservation, navigation bounds, slider, empty results, Classic fallback, Development records, unsaved-dialog confirmation, per-user preference, desktop/mobile widths, Gaming-only Viewer data, and Editor field save/reload persistence. No page errors.
- `qa/preview-browser.cjs`: standalone preview opens, record/history works, no external network requests, and writes are blocked.
- `qa/revision-two.cjs`: passed shared sidebar widths, frozen headers in both modes, Rolodex card/arrows/track clicks and thumb drag, record-number entry, bottom pagination placement, tooltip pointers, 70% fill alpha and mobile width.
- `qa/rolodex-animation.cjs`: passed centered switch, first/last frame appearance and bounds, forward/reverse animation, and reduced-motion support.
- Browser screenshots reviewed at desktop and mobile widths.

Browser scripts use Playwright installed in the test environment. For reproduction, install Playwright and its Chromium runtime in your QA environment; optionally set CHROMIUM_PATH to an available Chromium executable. Start from this project root; enhanced-browser starts and stops the local harness itself. These are local checks, not production acceptance or Mina's independent review.

## Later roadmap stages

This package implements the Enhanced presentation, project/weekly photo uploads and time-limited history editing. Document management, photo deletion/caption editing, decisions/actions/checkpoints, expanded module permissions, historical workbook backfill, and AI/voice workflows are not implemented here. They require separate requirements, data design and verification. The existing workbook import is retained without alteration. Unresolved business questions such as the relationship between Project Harbor 08731 and Izakaya CAPP 8740 remain data-review items; this interface does not merge them.
