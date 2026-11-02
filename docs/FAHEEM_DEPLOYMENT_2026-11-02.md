# D&C Enhanced Tracker deployment handoff

Prepared for TJ Lagos and Faheem — 2 November 2026.

**Status: ready for staging installation and acceptance testing. This is not a claim that the live site has been upgraded.** Target recorded in the existing handoff: https://dnc.lagospm.com (confirm its current Cloudflare project and bindings before installation). This guide supersedes older deployment instructions bundled for historical reference.

## 1. What is included

| Folder / file | Purpose |
|---|---|
| `tracker-source/` | Complete Enhanced/Classic Tracker source, styles, assets, schema migrations, import utilities and tests |
| `tracker-source/production-dist/_worker.js` | Prebuilt Cloudflare Pages advanced-mode production Worker |
| `ai-service-source/` | Complete existing Ask the Tracker project and new standalone production service entry |
| `ai-service-source/production-dist/worker.js` | Prebuilt standalone AI Worker: authenticated `/api/tracker-service` only |
| `source-workbooks/` | Five supplied biweekly Excel workbooks, August 28 through October 23 |
| `data-reference/` | Parsed October 23 projects, historical import matches/review rows and provenance; comparison inputs, not a production database restore |
| `DN_DC_Project_Tracker_User_Guide.pdf` | Updated 10-page guide, also installed in Help |
| `RELEASE_MANIFEST.json` / `CHECKSUMS.sha256` | Exact source commits, bundle and file hashes |

The main code descends from Faheem’s supplied `b62e462` handoff. Compare it with **his current production branch**; changes made subsequently on the live system have not been inspected here. Keep Keann Loman’s current Admin role and all other live account changes.

The source archives include both existing applications in full. Production uses the standalone AI entry; do not publish the pilot’s old snapshot UI or its platform-header identity endpoints on a public host. No OpenAI API key, service secret, session-signing secret, Cloudflare token, current user password, or live database backup is included.

## 2. Changes ready to review

- Activity double-click: two weekly narratives side by side, the preceding pair underneath. Show more history expands a scrollable region sized for about three more paired rows; long notes remain complete and small screens may show fewer rows at once.
- Paginator: Catawba yellow left fill and thumb, grey right track; compact width retained.
- Ask the Tracker in the first sidebar position, typed/voice query tools, timestamped transcripts, explicit History selection, preserved column changes, grouped browsing and globally sorted lists, PDF/Excel from the same computed result.
- Explicit “start from the beginning for all the projects” clears the earlier risk/manager restriction while retaining the current financial threshold. “Clear all filters” resets the authorized project set. Account/business-unit permissions remain enforced.
- Goodbye/good night stops voice; 20-minute silence check-in and five-minute follow-up end, with a 60-minute connection cap. Tracker inactivity warning after 30 minutes and logout after another ten remain in place.
- Workbook colors/headers/column order, module Info, Archive/Restore, paired activity history, and other already-reviewed enhancements are retained.

## 3. Data supplied by Bill Nielsen

TJ supplied Bill Nielsen’s biweekly Excel reports. The review register was updated using **`2026_1023 D&C Bi-Weekly Report Data.xlsx`**, the latest supplied report used in this build: **72 projects (50 capital, 22 development)**. Earlier reports added activity history:

| Source report | Source rows | Exact verified identities | Historical entries included | Rows held for review |
|---|---:|---:|---:|---:|
| August 28, 2026 | 74 | 62 | 62 | 12 |
| September 11, 2026 | 73 | 64 | 63 | 9 |
| September 25, 2026 | 73 | 67 | 66 | 6 |
| October 9, 2026 | 71 | 69 | 68 | 2 |
| Total historical | 291 | 262 | 259 | 29 |

Three matched rows had no activity to add. The 29 held rows represent 14 identities; they were not guessed into current projects. The reference JSON retains their text and reasons. Source workbook previous-week notes do not supply reliable independent dates; preserve their source-report label and do not invent calendar dates. Capital statuses were defaulted to Active in the preview because the source lacks a capital status field; do not overwrite known live statuses with that default. Development statuses came from the workbook. Blank financial values remain missing, not zero.

**The preview is not a production backup.** Never replace the live DB with the copied 72-row seed. Production numeric project IDs may differ. The production build disables automatic project, directory, workbook-history and portrait imports, even if preview environment flags are mistakenly set. `SEED_PROJECTS` and preview history import arrays are empty in the production bundle. Existing accounts, history, photos, archive flags and live edits must remain intact.

Use the supplied original workbooks and `data-reference/` to reconcile against a current live export. The existing `scripts/parse-workbook.mjs`, `reconcile-workbook.mjs`, and `apply-workbook-import.mjs` support reviewed activity imports. **They do not update current financial fields automatically.** Reconcile current amounts, schedules and statuses separately, with a reviewed field-level change report and the live record as authority for newer edits. Do not run the old September config against October inputs. Set up per-report configs with the actual filenames and stated dates. The current source files are retained so this does not depend on screenshots or copied table text.

Before importing, back up D1, record table counts, and preserve the R2 photo manifest/objects. Resolve the 29 historical rows explicitly; unresolved rows may remain held. No live photo transfer is claimed; preserve the existing production R2 bucket.

## 4. Production architecture and access

Browser → authenticated Tracker Worker → service-key-protected AI Worker → OpenAI.

The Tracker loads authorized current DB records on every AI query. It ignores client-supplied owner/scope/dataset values, applies CSRF and same-origin checks, and excludes archived projects. The AI proposes a structured query; deterministic code selects rows and computes values. No AI SQL is executed. Voice calls the same tool. Rendered tables and exports share the same result.

The service uses its own D1 database for conversation metadata, results and transcript text. Audio is not stored by the Tracker. Conversation ownership is tied to the authenticated account, role, unit scope and available record IDs. Use a separate AI service/database/secret for staging and production so test histories cannot mix with live histories. Keep that service URL server-configured; never accept it from browser requests.

Production compile-time protection disables `ALLOW_PLATFORM_AUTH` and `SITES_OWNER_PREVIEW`, regardless of environment settings. Password-based accounts remain in the live `user_directory`; neither their roles nor credentials are reseeded.

## 5. Build/install on staging first

Use Node 22.13+ (the tests use Node’s SQLite module), Python 3 for the password utility, and Bash for existing build scripts. This package does not include `node_modules`; the AI source includes its npm lockfile. ReportLab/DejaVu fonts are only needed to regenerate the PDF; the completed guide is supplied.

1. Make a staging copy of the current production Tracker D1 database and photo storage. Identify the current production Pages project, DB ID and R2 bucket from Faheem’s deployment configuration. Do not substitute preview resource IDs.
2. Inspect the live schema against `tracker-source/drizzle/`. Apply only missing migrations to the staging clone. Most `ALTER TABLE` migrations are not repeatable. In particular check `archived_at`, media/revision tables and `user_directory.time_zone` (`0008_user_time_zone.sql`). Record exactly which changes production will require.
3. Configure a dedicated AI conversation D1 database. For a new empty AI DB, apply `ai-service-source/drizzle/0000_slim_storm.sql` once. It creates the two conversation tables and indexes; it is not the Tracker DB schema.
4. In `ai-service-source`, run:

```sh
npm ci
node scripts/build-production-service.mjs
node --test tests/production-service.test.mjs tests/conversation-corrections.test.mjs tests/realtime-voice.test.mjs
cp deployment/wrangler.example.toml deployment/wrangler.toml
```

Fill the AI Worker name and D1 binding in that config. Put server secrets through the hosting secret mechanism, never source code:

```sh
npx wrangler secret put OPENAI_API_KEY --config deployment/wrangler.toml
npx wrangler secret put DNC_SESSION_SECRET --config deployment/wrangler.toml
npx wrangler secret put DNC_TRACKER_SERVICE_TOKEN --config deployment/wrangler.toml
npx wrangler deploy --config deployment/wrangler.toml
```

Use independent random secrets of at least 32 characters for session signing and service authentication. `OPENAI_API_KEY` is an owner-approved key with access and available billing for the configured models. The running preview key has not been exported; TJ/Faheem must configure an approved key securely. The existing configured model names are `gpt-5-mini` (query planner), `gpt-realtime-2` (voice), and `gpt-4o-mini-transcribe` (transcription); the voice is `marin`. These are configuration values, not a guarantee that another OpenAI project has access. Check access during staging. The service creates `/v1/realtime/calls` sessions and supports hangup; the long-lived key stays on the server. `DNC_DEPLOYMENT_MODE=production` ensures voice describes the authorized live data, not the private preview.

5. In `tracker-source`, build the **production** artifact:

```sh
node scripts/bundle.mjs --production
node scripts/production-build-test.mjs
cp deployment/wrangler.pages.example.toml wrangler.toml
```

Fill `wrangler.toml` with the selected staging Pages project, its DB and R2 resources, and the deployed AI Worker’s HTTPS `/api/tracker-service` URL. Keep `ALLOW_PLATFORM_AUTH=false` and `SITES_OWNER_PREVIEW=false`. Use the same service secret as the AI Worker:

```sh
npx wrangler pages secret put DNC_AI_SERVICE_TOKEN --project-name YOUR_STAGING_PAGES_PROJECT
npx wrangler pages deploy production-dist --project-name YOUR_STAGING_PAGES_PROJECT
```

Replace `YOUR_STAGING_PAGES_PROJECT` with the actual project name; it is not a supplied identifier. `npm run build` builds the private review profile, so it must **not** be used as the live deployment artifact. No `.openai/hosting.json` or ChatGPT identity setup is needed for these external production Workers. No live deployment was performed by Codex.

## 6. Required checks before production cutover

- Authorized Editor login succeeds; forced first-password change works; Viewer cannot write; restricted-unit accounts cannot retrieve another unit through direct URLs, Ask, history or exports.
- Anonymous `/api/bootstrap` and `/export.csv` return 401, including requests that forge `oai-authenticated-user-*` headers.
- Existing Greg, Madeline, Tim, Maxwell and **Keann Loman** credentials are untouched. Keann remains Admin. Check other roles against the current live directory rather than the older source roster.
- Known project IDs, CAPPs, budgets, forecast/variance, previous-week notes and totals agree with the reviewed live data. Preview ID numbers must not be used as import keys.
- Activity shows 2×2 recent notes and expandable paired older history. Test long notes, small screens, Save and edit lock.
- Run schedule-risk High/Medium → cost ≥ $1m → “start from the beginning for all the projects”; verify the risk restriction disappears. The supplied October 23 fixture returns 1 before reset and 20 after; **live counts depend on live data**.
- Move PM first/second, remove ID columns, sort globally, then download PDF and Excel; compare project set and column order.
- Test real microphone/speaker start, interruption, mute, goodbye and reconnect on TJ’s and at least one Editor’s browser/network. Automated signaling tests do not prove audio works through DN’s browser/firewall policies.
- Confirm server OpenAI billing/model access, allowed HTTPS/WebRTC connections and microphone permission policy. Verify error states and the distinct Guided fallback.
- Confirm transcript local timezone, History reopen, date/time export, 20+5 voice idle and 30+10 Tracker idle using existing accelerated local tests, then normal production settings.
- Verify Archive/Restore keeps history and photos; existing photos/profile portraits still resolve from the original bucket.

After staging acceptance: take a fresh backup, install only required schema changes, configure distinct production AI secrets/resources, deploy the same production builds to the confirmed live target, and run the checks again. A code rollback does not reverse DB imports or schema changes; keep a matching backup and a reviewed recovery plan.

## 7. First-time Editor credentials

TJ has already issued passwords that were changed by Greg, Madi, Tim, Maxwell and Keann Loman. **Do not reset them.** Keann’s Admin role was confirmed by TJ on 2 November. Source-directory Editors still to check: Joe Quagliana, David Ruede, Kevin Keens, Chynna Barron, John Kolkowski and Matthew Nowakowski. The source roster is not proof of their current live access.

The separate private credentials ZIP contains six newly prepared passwords plus individual handover notes. **Prepared passwords are not usable until installed.** Keep that ZIP out of source control, project deployment and team-wide emails. TJ can send each person only their own note after Faheem confirms installation. Do not send the full credential list to testers.

Run the included utility using an existing Administrator account; its password is requested without echo:

```sh
python3 deployment/issue-editor-passwords.py \
  --url https://dnc.lagospm.com --admin YOUR_ADMIN_EMAIL \
  --credentials /PRIVATE/PATH/prepared-credentials.json
```

The first run only reads and lists the six candidate accounts. It stops if a username is missing and skips any account that already has a password, is no longer an Editor, or is suspended/revoked. After confirming the list, run the same command with `--apply --activate-pending --out /PRIVATE/PATH/activated-editor-credentials.json`. This activates only the explicitly listed eligible pending Editors, preserves business-unit scope and other saved fields, and requires a password change at first sign-in. The new `/api/admin/users/:id/initial-password` route enforces the no-existing-password rule atomically, so a concurrent password change or role change cannot be overwritten. It writes per-account activation status to a mode-0600 private file and never prints the passwords. Failed/uncertain entries must not be sent as active. These temporary passwords have mandatory first-use replacement but no automatic expiry; use Admin to revoke unused test access when appropriate.

## 8. Verification completed / remaining

Completed locally: main preview build, production build, production identity/no-seed tests, Tracker API/scope tests, voice-client initialization, query regression tests, standalone service authentication/conversation storage/Realtime signaling with mocked upstream, browser Activity layout inspection, and PDF render inspection. The reset regression reproduced the supplied transcript’s 1-versus-20 discrepancy and now returns the full authorized set correctly. Earlier live column/voice-query acceptance checks are recorded in the included repair notes.

Remaining with Faheem: latest live source/schema/role comparison; real hosting configuration and API secrets; data reconciliation/import; staging and production audio/browser/network acceptance; activation of the six first-time Editor credentials. No API key or live password reset has been performed in this handoff.
