# Ask the Tracker integration — 31 October 2026

The Enhanced private Tracker embeds the existing assistant in an authenticated, same-origin dialog. Its current database supplies authorized project records for each AI query. The existing private Ask pilot keeps the OpenAI credential and runs the structured query planner, deterministic record selection, conversation storage and voice signaling.

## Deployment configuration

Enhanced Tracker runtime variables:

- `DNC_AI_SERVICE_URL`: the existing private Ask site's `/api/tracker-service` endpoint. The adapter checks this exact approved URL.
- `DNC_AI_SERVICE_TOKEN`: protected private service credential. Never return it to a browser or commit it.

Ask service runtime variables:

- `DNC_TRACKER_SERVICE_TOKEN`: matching protected service credential, used for explicit service authentication.
- Existing `OPENAI_API_KEY`, `DNC_SESSION_SECRET`, `DNC_TEXT_MODEL`, `DNC_SITE_ORIGIN` remain in place. `DNC_VOICE_MODEL` remains optional with the pilot's existing default.

The existing Sites service-access token is sent only to its own Ask site in `OAI-Sites-Authorization`. An additional service-key header authenticates the application route. The OpenAI key has not been copied or replaced. Both sites remain owner-private. The old standalone pilot’s normal entry points now open the integrated Tracker using `/?ask=1`. Its original snapshot and saved conversations remain stored, but its legacy UI no longer appears at the standard links. The private service API is unchanged.

Deploy the Ask service before the Enhanced Tracker. Environment changes require a new deployment. No database migrations are required for this integration: the existing Ask conversation tables are reused under a separate owner namespace.

## Correctness and access

1. Existing Tracker sign-in, role, scope and forced-password gates run before assistant workspace, assets or query routes.
2. The server loads an explicit allowlist of project fields plus scoped activity history and photo metadata. Archived projects are excluded. There is no fallback to the old pilot dataset.
3. Client-provided owner, scope and dataset fields are ignored. Mutating assistant routes require same-origin JSON requests and existing local-session CSRF protection.
4. Conversation ownership hashes the authenticated account, role, scope and current authorized project IDs. Permission or membership changes require reopening the assistant; previously broader conversation results cannot be restored into a narrower scope.
5. The AI proposes a validated structured query. Deterministic code applies filters, calculations, grouping and selected columns. It never runs AI-generated SQL. Missing values remain missing. PDF and Excel use the same result table.
6. AI queries refresh data; saved conversations are historical. Guided fallback uses only the page's loaded records and supports fewer question patterns. Its connection state is labeled clearly.
7. Voice uses the same query tools. Closing the dialog, signing out or leaving the page ends audio and removes the iframe. Microphone permission must be granted by the user.

`POST /api/ask/service-health` is an operations-only connection check. It requires the protected service key, returns only connection/configuration status and model names, and cannot accept identity or project data. It never returns a conversation token or an API credential.

## Files

- `worker/ask-tracker.js`: current data adapter, service connection, page rendering and operational health check.
- `worker/ask/`: assistant UI, voice, conversation history, exports and licensed PDF/Excel libraries copied from the pilot.
- `scripts/ask-tracker-test.mjs`: anonymous/other-user/cross-origin denial, server-owned scope, fresh records, archive behavior and secret exclusion.
- Ask pilot `app/api/tracker-service/route.ts`: authenticated service route using existing planner and conversation storage.
- Ask pilot `tracker/integration/service-auth.mjs`: service authentication and dataset scope validation.

## Verification

The hosted service accepted its existing key and used `gpt-5-mini`. A live approved-budget OR anticipated-cost threshold query matched all 21 expected projects in the 72-record preview dataset. The PDF/Excel follow-up retained those same 21 projects and the one-page request. All 34 existing planner, correction, voice lifecycle and export tests passed. The Tracker adapter tests passed, including fresh edits and archived-history exclusion.

The Worker uses `redirect: manual` and rejects redirects without forwarding credentials; this runtime does not support `redirect: error`.

The managed browser preview's server reported DNS resolution failure (`EAI_AGAIN`) when calling the service; direct service tests from the executor succeeded. Browser QA covers the embedded layout, explicit connection-failure fallback and launcher. Actual microphone/speaker behavior still needs testing on the user's device. Do not interpret configured voice access as a successful voice call.

## Moving to the live DNC site

This release targets the private preview only. For production, Faheem/DN IT must map the adapter to the live authenticated relational database and existing user permissions, preserve production project IDs, install the UI and backend routes, and configure an approved server-side API connection. Use a staging copy first and verify known questions, permission-limited users, saved conversations, PDF/Excel output and voice. Keep backups and a rollback version. Never copy preview seed records over the production database or put an API key in browser HTML.

Local development may read an ignored `.ask-preview.json` with service `url` and `token`; prefer environment variables. It must never be committed or deployed, and should be removed after testing. The production Worker reads only native runtime variables.

## Navigation and screenshot reconciliation — 31 October 2026

Ask the Tracker is the first left-navigation item. The former standalone links forward to this same workspace. A visible budget note ties Approved budget to Cost Control’s Total Approved. Historical snapshot values were not overwritten or merged into current records. The old Canyon New Dorm record used 500,000 as approved budget; the current record includes 16,372,100 construction approval for a total of 16,872,100. Canyon Adventure uses a current approved total of 2,853,689 and an October 23 anticipated cost of 2,730,164. The supplied screenshot’s 2,852,356 forecast is from a different record state. Current imported totals can differ from their component fields (for example Canyon General Store Improvements); preserve those recorded totals for reconciliation rather than silently rewriting them. Regression checks compare these current records with the assistant data and calculated variance.

### Grouped result presentation — 1 November 2026

Detailed results use a business-unit heading and venue subheading with matching project counts. Project Name and CAPP ID lead the detail columns, and repeated business-unit/venue columns are replaced by their headings. Requested sorting remains within each venue. Grouping changes presentation only; it does not calculate subtotals, merge projects, change saved data, or expand the selected result. Calculated aggregate reports retain their existing shape.

The same presentation function feeds the screen, PDF, and Excel Results sheet. Excel also includes a filterable Source records sheet with the business unit and venue restored on each project row. PDF continuation pages repeat the active headings. Stylesheet URLs are content-versioned so existing browser caches receive the updated layout.

Run `node scripts/ask-result-layout-test.mjs` to verify project preservation, same-name venues across different units, null/zero values, CAPP strings, aggregate totals, and PDF/Excel generation.
