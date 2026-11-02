# DNC Enhanced Tracker - private review

**Current external deployment handoff:** [Faheem deployment guide, 2 November 2026](docs/FAHEEM_DEPLOYMENT_2026-11-02.md). Use `node scripts/bundle.mjs --production` for external hosting; `npm run build` remains the private review build. Older entries below are chronological notes and may describe superseded integration states.

Private ChatGPT Sites workspace for TJ's weekend testing. This is separate from dnc.lagospm.com and the Ask the Tracker pilot.

## Source and data

Derived from the complete 30 October Info / Workbook / Archive review release, based on Faheem's shared b62e462 handoff. The core modules are retained, with isolated preview adaptations:

- Enhanced is the default view.
- New Site-owned D1 and R2 bindings; no live database, account credentials, resource IDs or photo bucket are connected.
- 72 copied records from the supplied `2026_1023 D&C Bi-Weekly Report Data.xlsx`: 50 capital and 22 development.
- Source narratives and available amounts/dates retained. Blank source financial cells stay blank; capital statuses default to Active because that workbook has no capital status column. Development statuses come from the workbook. Flags and excluded tabs are documented in `docs/PREVIEW_DATA_NOTES.json`.
- Workbook and Excel share the reference column labels/order and colored section subheadings. Capital sheets have 19 columns; Design & Development has 17. Activity is ten Excel character units wider than each original sheet; other columns are tightened. Hidden Count and unused Column1 are omitted.
- Historical source reports: Aug 28, Sep 11, Sep 25 and Oct 9, 2026. 291 source rows reconciled: 262 exact identities (3 without notes), yielding 259 historical entries. Matching requires project type, business unit and exact normalized name, plus unique CAPP/initiative or corroborated scope/venue. No fuzzy joins or project creation. 29 rows across 14 identities remain in each period's Import review tab, including original notes. Archived/closed source tabs are excluded as in the existing parser, not imported as active projects.
- The append-only `ensureWorkbookHistory` backfill runs after authentication; each import entry has a stable source key. It is resumable and duplicate-safe, including same-project/date/text checks. Completion is marked in `app_meta`; project rows, user edits, current costs/status and archive flags are never updated. Existing seed version stays unchanged. Publication installs the backfill; the first authorized API request applies it.
- Previous Week Update gives the selected source report's supplied previous note precedence (e.g. Oct 23's previous week can differ from the Oct 9 fortnight). Its own date is unknown. Otherwise prior-fortnight dated notes appear. Undated notes stay with their source report. Repeated text across DIFFERENT source report dates remains as evidence of each report; repeat import of the same entry does not add history.
- Source colors are extracted by `scripts/extract-workbook-colors.py` into `worker/workbook-colors.js`: exact RGB/theme tints, per-row fills and section colors. Browser and Excel consume the same style metadata. Risk labels override source shading with green/yellow/red and readable black text. Blank source risk cells retain their shading and remain Not Rated. Variances/delays are recalculated from current values and colored red if positive, dark green otherwise; duplicated/conflicting source conditional rules and broken #REF! expressions are intentionally not copied. CSV/TSV cannot contain colors.
- Current project membership/financials/schedule remain current even when historical activity is selected. Historical reports are not financial snapshots. No missing live records/photos or undated previous notes are claimed as restored.
- Original live photo files are not copied. Supplied bundled reference images remain; new test uploads are stored in this Site's R2.
- Edits and uploads persist in this Site. Rebuilds do not reseed over existing rows. Do not change the seed version to reset data without an explicit reset request.

## Sign-in

Sites enforces owner-private access. Runtime `ALLOW_PLATFORM_AUTH=true` and `SITES_OWNER_PREVIEW=true` enable the inherited platform identity support. The first admitted owner identity is bound in D1; later different identities are denied even if the Site audience is accidentally widened. No shared preview password or credential is embedded. Anonymous callers cannot read or write the API.

Do not deploy this preview-specific identity configuration to the public live Tracker. Production retains its own account and deployment process. The private review is not a test of production password login, current live permissions or data reconciliation.

## Work and checks

- `npm test`: in-memory API + served-client checks for this copy, owner access, saved edits, Archive/Restore, exports and Enhanced default.
- `node scripts/reporting-archive-test.mjs`: additional reporting/permissions/photo preservation checks.
- `node scripts/workbook-reference-test.mjs [reference.xlsx]`: checks all sheet values, matching columns, subheadings, widths, 49 previous notes, and date boundaries; optional input compares headings and Activity +10 directly against the reference.
- `node scripts/workbook-history-test.mjs`: validates every historical entry, counts, current-row preservation, retry behavior and scoped review.
- `node scripts/export-integrity-test.mjs`: independent Excel/CSV format validation (Python openpyxl, read-only).
- `npm run build` and `npm run validate`: bundle the Worker with embedded assets and SQL migrations.
- `scripts/sites-local-preview.mjs`: local QA only, uses synthetic identity and an in-memory database. It is never bundled or deployed.

OpenAI Sites is the publication path for this review. The native Sites source repository is the durable development copy. Use the same Site for further changes; preserve owner-private audience, D1/R2 bindings, project ID and existing review data.

Desktop browser review verified Projects, module Info and the loaded Workbook layout through the managed preview. Application tests also verified download and archive behavior. iPad/device acceptance and user-side hosted sign-in remain to be checked.

## Review refinements - 30 October 2026

- The top Workbook shortcut appears only in Portfolio (opens all projects). Projects/Development retain the lower shortcut in both Classic and Enhanced. Info is an icon with an Info tooltip.
- PM/development lead, both risks and both variance columns are centered in the shared browser/Excel style metadata. Browser section labels span the three frozen identity columns and remain fixed during horizontal scrolling.
- Activity History uses one request and one renderer per dialog open. Current and supplied previous-week narratives are both visible; no artificial reporting date is assigned. Compare Past Activities includes source previous notes. Stale responses cannot populate a closed dialog or another account/project.
- The already-authorized owner in this private Site can use the copied Tom Lagos profile: `tom@lagospm.com` maps to `tlagos@delawarenorth.com` only under `SITES_OWNER_PREVIEW` after the existing owner identity check. This restores his existing portrait and profile controls; it creates no account, changes no credentials or permissions, and does not affect the live Tracker.
- Verified browser: portrait loaded; first identity column and section label both remain at x=259 after 2,084px horizontal scrolling; requested alignments center; both weekly notes visible in History at 13px. API/served-client tests verify one history request, source notes, shortcut visibility, owner-only profile mapping and portrait retrieval.

## Interaction refinements - 31 October 2026

- Inline Activity Save appears only while the field is focused (or the button has keyboard focus). Existing save-on-blur remains; a per-field in-flight guard prevents a simultaneous button/blur from posting twice.
- Activity dialog uses a scrollable body and fixed-height header/footer so Save update remains visible. Edit permissions still govern the control.
- Double-clicking a Card's body opens its Record view; buttons keep their normal single-click action. Search uses a larger accessible magnifier button that focuses the existing live-filter input. Sort Order is centered above its select.
- A 6 pt, grey italic/cursive developer signature appears only over a 13 px band at the bottom-right of the sidebar (also available by keyboard focus).
- Ask the Tracker remains a separate pilot using its October 2 snapshot. Recommended next work: connect its validated query/export pipeline to this Tracker's current authorized records and history, then integrate voice. This release does not add an AI connection or change credentials.

## Activity layout follow-up - 31 October 2026

- Activity dialog Save update sits on the far right of the Complete project history heading, directly below the editor. This heading remains sticky while history scrolls.
- Project Update and Previous Week Update have identical widths on every capital worksheet and in the shared browser layout. The existing current-update width remains unchanged.
- A small dot to the left reveals the signature, keeping the pointer clear of the lettering. The 6 pt grey signature uses bundled Z003 calligraphic italic with a heavier synthesized weight. The original font and license are included under assets/fonts and served at /signature-font.otf and /signature-font-license.txt.
- Ask the Tracker integration requested: the existing pilot has a protected API key that cannot be retrieved. No key is configured on this preview; secure credential setup is needed before integration work proceeds.

## Narrower names and fixed financial/risk headers - 31 October 2026

- Project Name is reduced by exactly 10 Excel character units in every Capital and Development sheet, through the shared browser/export widths. Narrative widths remain equal.
- Cost Control and Risk Register now use the same fixed-height workspace and sticky column headings as Projects. The record table scrolls beneath the headings in Classic and Enhanced. Risk summary cards remain above the table.
- Browser QA: Cost Control header stayed at y=403 after 1,872 px vertical scroll; Risk Register header stayed at y=402 after 1,872 px.
- User authorized a new OpenAI API key for Ask the Tracker. Key creation is blocked in this session: the Codex secure setup tool and the OpenAI Developers local key helper are unavailable, although the plugin is installed/enabled. No key was created and AI integration remains pending; do not repeat the creation-permission question.
