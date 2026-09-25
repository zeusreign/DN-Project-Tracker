# What it takes to make the enhanced tracker real

**Engineering gap analysis · Audit only · No application files modified**

Tom's enhanced prototype against the current DN Project Tracker at `7b4eb5a` — what is
genuinely new, what only works because it is a standalone HTML file, and how much
engineering stands between the two.

| | |
| --- | --- |
| **Baseline** | `7b4eb5a627c502cc470b114a7c64c3ef9631b10e` · branch `dev` |
| **Prototype** | `DN_Tracker_Enhanced_Interactive_Demo (3).html` · 1,714,525 bytes |
| **Verdict** | Large |
| **Realistic effort** | ~160 engineering hours (~27 working days) |

---

## Bottom line

This is a **Large** project, not a small enhancement and not a rebuild. The prototype is a
genuine fork of our own served page with a well-built additive UI layer on top — nothing is
replaced, every integration anchor it needs already exists. But it forked **three commits
before HEAD**, so it carries none of the DNC-001 → 008 fixes, and every workflow it
demonstrates beyond the current app is answered by a fake `window.fetch` rather than a
server.

| Figure | Meaning |
| --- | --- |
| **46.7 KB** | New client JS (+54% on ours) |
| **33.8 KB** | New CSS (+87% on ours) |
| **0** | Existing IDs or selectors removed |
| **3 + 1** | New endpoints, plus one to extend |
| **2** | New D1 tables, 0 columns on existing |
| **~160 h** | Realistic effort ≈ 27 working days |

### Evidence marks used throughout

| Mark | Meaning |
| --- | --- |
| **[Verified]** | Read directly from the code or the file |
| **[Inferred]** | Reasoned from evidence, stated as such |
| **[Risk]** | Needs a decision before building |

---

## Contents

1. [Current application baseline](#part-1--current-application-baseline)
2. [What the prototype actually is](#part-2--what-the-prototype-actually-is)
3. [Feature matrix](#part-3--feature-matrix)
4. [Everything genuinely new](#part-4--everything-genuinely-new)
5. [Removed, hidden or changed](#part-5--removed-hidden-or-changed)
6. [What only works because it is a demo](#part-6--what-only-works-because-it-is-a-demo)
7. [Backend gap](#part-7--backend-gap)
8. [Database gap](#part-8--database-gap)
9. [R2 / file storage gap](#part-9--r2--file-storage-gap)
10. [Permissions and security gap](#part-10--permissions-and-security-gap)
11. [Data migration and existing records](#part-11--data-migration-and-existing-records)
12. [Development effort](#part-12--development-effort)
13. [Complexity classification](#part-13--complexity-classification)
14. [Phasing](#part-14--phasing)
15. [Executive summary](#part-15--executive-summary)

---

## PART 1 — Current application baseline

Everything below was read from the repository, not assumed.

### Commit and working tree

**[Verified]** HEAD is `7b4eb5a627c502cc470b114a7c64c3ef9631b10e` on branch `dev`, committed
2026-09-25. The working tree is clean apart from the untracked prototype file itself.

### Architecture

A single Cloudflare Worker serving both API and HTML, deployed to Pages in advanced mode.
There is no framework and **no runtime dependency at all** — `package.json` lists only
`vite` and `wrangler` as devDependencies.

- **Frontend** — `worker/page.js` (31 KB markup template) interpolates `worker/styles.js`
  (38.8 KB CSS) and `worker/client.js` (96.3 KB, a single ``export const CLIENT = `…` ``
  template literal). No build step for the client beyond bundling.
- **Backend** — `worker/index.js` (106.5 KB) holds routing, auth, permissions and all
  handlers. Helpers: `worker/exports.js` (CSV/TSV/XLSX), `worker/profile-photos.js`,
  `worker/seed.js`, `worker/social.js`.
- **Build** — `scripts/bundle.mjs` reads `worker/*.js` and `assets/*` into
  `dist/server/index.js`; `scripts/build-pages.sh` produces `pages-dist/_worker.js`.

### API endpoints that exist today

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/login` | Sign in |
| `POST` | `/api/logout` | Sign out |
| `GET POST` | `/api/session` | Session read / idle ping |
| `POST` | `/api/account/password` | Change password |
| `GET PATCH` | `/api/account/profile` | Own profile |
| `GET` | `/api/bootstrap` | Workspace payload: summary, projects, updates, me |
| `GET` | `/api/projects` | Project rows |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/updates` | Recent activity updates |
| `GET` | `/api/projects/:id/history` | Per-project activity history |
| `POST` | `/api/projects/:id/activity` (or `/update`) | Add dated activity update |
| `PATCH` | `/api/projects/:id/fields` | Edit project fields |
| `PATCH` | `/api/projects/:id/development` | Edit development detail |
| `POST` | `/api/projects/:id/promote` | Promote development → capital |
| `GET PUT DELETE` | `/api/users/:id/avatar` | Profile photo |
| `GET` | `/api/admin` | Admin console data |
| `POST` | `/api/admin/users` | User administration |
| `GET` | `/api/admin/backup` | D1 backup download |
| `GET` | `/api/export.{csv,tsv,xlsx}` | Export (also at `/export.*`) |
| `GET` | `/health`, `/og.png`, `/logo.png`, `/user-guide.pdf`, … | Static + health |

### D1 schema

**[Verified]** Ten tables across six migrations, `drizzle/0000` → `drizzle/0005`:

`business_units` · `projects` (31 columns) · `project_updates` · `development_details` ·
`audit_log` · `app_meta` · `user_roles` · `user_directory` · `login_sessions` ·
`login_events`

There is **no photo, image, attachment, caption or media column anywhere** outside the three
avatar columns added by `0005_profile_photos.sql`.

### R2 usage

**[Verified]** One bucket bound as `BUCKET` → `dnc-tracker-assets` (`wrangler.toml:44`). It
is used for exactly one thing: **user profile photos**. Seven call sites in
`worker/index.js`, all inside `handleAvatar()` or the seed importer.

### Activity and history today

`project_updates` is **append-only by design**. `POST /api/projects/:id/activity` writes
three statements in one batch (`worker/index.js:1503–1535`): it updates
`projects.current_update`/`previous_update`, inserts one `audit_log` row, and does an
`INSERT OR IGNORE` into `project_updates` keyed by a `source_key` derived as
`update:<projectId>:<period>:<sha256(text)>`. That UNIQUE content-derived key is the
mechanism that fixed DNC-004. **There is no endpoint that edits or deletes a history entry.**

### Authentication and permissions

- Local accounts, PBKDF2-SHA256, 100,000 iterations, 18-byte salt; cookie sessions in
  `login_sessions`; CSRF token issued per session.
- Three roles. `canWrite(role)` (`worker/index.js:474`) returns true for `admin` and
  `editor` only.
- Business-unit scope via `user_directory.business_unit_scope`, applied by `scopeFilter()`
  (`:507`) and `projectInScope()` (`:521`). Out-of-scope project ids return **404, not 403**,
  deliberately, so they cannot be probed.
- HTTP **428** gates any account still on a temporary password, before any project payload.
- Ten `INSERT INTO audit_log` sites — every mutating path is audited.

### Testing

- `npm test` = build → `scripts/validate-artifact.mjs` → `scripts/smoke-test.mjs` (94.7 KB,
  **408 assertions**), running in-process against `node:sqlite` built from `drizzle/*.sql`.
- `scripts/browser-harness.mjs` (25.7 KB) is a hand-built minimal DOM that executes the real
  served page. Its own header states it implements "the DOM surface `worker/client.js` uses
  and nothing else."
- `scripts/remote-check.mjs` — `npm run check:remote`, 32 checks against a deployed origin.

### DNC-001 → DNC-008

**[Verified]** All eight are fixed at HEAD and covered by `npm test` (24 `DNC-00x` references
in `smoke-test.mjs`, 12 in `remote-check.mjs`). They landed in three commits:

| Commit | Findings | Key client symbols introduced |
| --- | --- | --- |
| `de7ee74` | QA findings for test environment | — |
| `3a1abdb` | DNC-001, DNC-002, DNC-003, DNC-006 | `collectMoney`, `moneyFieldLabel`, `showPasswordChangeOnly`, fixed `setMoneyValue` |
| `354fb4b` | DNC-007, DNC-008 | `clearAccountData`, `applyCapabilities`, `canDownload`, `canChooseColumns` |

---

## PART 2 — What the prototype actually is

A single 1.71 MB HTML file, 1,089 lines. It is **a fork of our own served page**, not an
independent design. Structure of the file:

| Region | Size | Contents |
| --- | --- | --- |
| Lines 1–269 | ~100 KB | Our markup and CSS, plus 232 new `.en-*` selectors |
| Line 270 | 403 KB | `demoBoot` seed payload + the `window.fetch` shim |
| Lines 299–901 | 86.7 KB | Our client script, at fork point |
| Line 901 | 773 KB | `enhancedImages` — four base64 JPEGs |
| Lines 902–1089 | 46.7 KB | The enhancement layer |

### The fork point

**[Verified]** I diffed the prototype's base client against every historical version of
`worker/client.js`, counting how many of our lines are missing from it:

| Commit | Our lines | Missing from prototype | Reading |
| --- | ---: | ---: | --- |
| `e199045` Fix session timeout | 602 | 8 | **The fork point** |
| `de7ee74` Fix QA findings | 614 | 22 | after the fork |
| `3a1abdb` Cost + password form | 660 | 72 | after the fork |
| `354fb4b` DNC-007 / DNC-008 | 737 | 146 | after the fork |

Function-inventory comparison agrees exactly: the prototype's base contains **113 of our
functions and not one extra**, matching `e199045`. Absent: `clearAccountData`,
`applyCapabilities`, `canDownload`, `canChooseColumns`, `showPasswordChangeOnly`,
`collectMoney`, `moneyFieldLabel`. And `setMoneyValue` is the pre-DNC-001 version that
rounded cents away on save.

### A. UI changes

Purely additive. All **422** of our CSS selectors and all **207** of our element IDs are
present unchanged. The layer adds 232 `.en-*` selectors and 7 IDs — five of which
(`enMetal`, `enPaper`, `enPlastic`, `enCardShadow`, `enRingShadow`) are SVG filter and
gradient definitions for the rolodex skeuomorphism.

### B–C. New screens and panels

All injected at runtime into anchors that **already exist in `worker/page.js`** — I checked
each one:

| Injected element | Anchor | Anchor exists today |
| --- | --- | --- |
| `#enExperience` (mode toggle) | `.sidebar` append | **[Verified] Yes** |
| `#enRolodex` | after `[data-view="portfolio"]` | **[Verified] Yes** |
| `#enBottomNav` | `body` append | **[Verified] Yes** |
| `#enToolbar-{module}` | `[data-pane]` prepend | **[Verified] Yes** |
| `#enPanel-{module}` | `[data-pane]` append | **[Verified] Yes** |
| `.en-nav-picker`, `.en-font-controls` | before `.search` | **[Verified] Yes** |

This is the single most important structural finding: **the enhancement attaches to our DOM,
it does not restructure it.**

### D–E. New controls and workflows

- **Enhanced / Classic toggle** — `enhanced.mode`; Classic is the default and is always one
  click away.
- **Four layouts** per module: `list` (our existing table), `record`, `cards`, `collage`.
- **Three navigators**: `rolodex` (animated flip-card binder), `strip` (top pagination),
  `slider` (bottom pagination).
- **Cover photo** per project — upload, or double-click the photo to change it.
- **Weekly progress photos** — multi-file upload, drag-and-drop, per reporting week, with
  captions.
- **Activity history editing** — Edit button per entry, revision disclosure, a 10-day lock.
- **Compare** — two reporting dates side by side.
- **Text size control**, **meeting mode**, **read-only preview mode**.

### F–G. New data displayed and entered

**Displayed:** photo `caption`, `label`, `source`, `kind`; history `edit_deadline`,
`editable`, `revisions[]` with `previous_text` / `revised_text` / `actor_email` /
`created_at`. **None of these exist in D1 today.**

**Entered:** image files (≤5 MB, JPEG/PNG/WebP), caption (≤500 chars), reporting week,
edited activity text (≤20,000 chars).

### H. New client state

```js
var enhanced = {mode, module, layout:{projects,development},
                selected:{projects,development}, navigator,
                meeting, user, historyVersion, pending};
var enHistoryData={}, enPhotos={}, enWeek={},
    enUploadMode={}, enSession, enFontStep;
```

`enhanced.pending` is a genuine improvement: it wraps `saveInline` and `patchFields` and
blocks navigation while a save is in flight.

### I. API calls — real versus simulated

The prototype makes **no network requests at all**. `window.fetch` is replaced wholesale at
line 272. But the shim is unusually valuable, because it is a precise executable
specification of the contract Astra expects. See Part 7.

### J. Storage behaviour

`localStorage`, key `dn-tracker-enhanced-v1:<user email>`, storing
`{mode, layout, navigator}`. Client-only and per-browser. **[Inferred]** this is acceptable
as-is for production — no server work implied — but preferences will not follow a user
between machines.

### K. Permissions behaviour

The layer reuses our `canWrite()`. `enControls()` returns
`canWrite() || window.enReadOnlyPreview`; `enDisabled()` emits a `disabled` attribute with
the title "Available in the connected application with Editor access". So Viewers see the
controls, disabled. **It never touches `exportBtn` or `columnsBtn`** — zero occurrences —
which is why DNC-008 survives a merge intact.

### L–M. Navigation and responsive behaviour

New: keyboard Escape handling for nav menus, click-to-select synchronising the classic table
row with the enhanced record, focus retention across re-render (`CSS.escape` on data
attributes), `enhancedBringIntoView()`, and a `prefers-reduced-motion` guard around the
rolodex flip animation.

Responsive: ours has **2 breakpoint groups**; the prototype has **8** — adding 1250px, 760px,
700px, a 741–1180px range, a min-1181px rule, and the reduced-motion query.

### N. Changes to existing functionality

See Part 5 — there are four, and they are real.

---

## PART 3 — Feature matrix

Classification uses the ten categories requested. "Backend", "DB", "R2" and "Perm" answer
yes/no to *new work required*.

Classification key: 1 Already exists · 2 UI-only enhancement · 3 Existing backend can support
it · 4 New frontend development required · 5 New backend/API development required · 6 New
database/schema work required · 7 New R2/storage work required · 8 Major feature requiring
significant development · 9 Prototype/demo only · 10 Unclear — needs clarification

| Feature | Current tracker | Enhanced prototype | Difference / class | Backend? | DB? | R2? | Perm? | Complexity | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Enhanced/Classic toggle** | Absent | Sidebar button, localStorage | 2 · UI-only | No | No | No | No | Low | Anchor `.sidebar` exists |
| **Record layout** | Details dialog | Inline full-record panel | 4 · New frontend | No | No | No | No | Medium | Reads existing project fields only |
| **Cards / collage layouts** | Absent | Grid of project cards | 4 · New frontend | No | No | No | No | Medium | Collage depends on photos |
| **Rolodex navigator** | Absent | Flip-card binder, SVG filters | 4 · New frontend | No | No | No | No | Medium | Most CSS-heavy single feature |
| **Top / bottom pagination** | Absent | Two navigator modes | 4 · New frontend | No | No | No | No | Low | — |
| **Text size control** | Absent | A/A buttons, CSS var | 2 · UI-only | No | No | No | No | Low | Not persisted in prototype |
| **Meeting mode** | Absent | Body class | 2 · UI-only | No | No | No | No | Low | — |
| **Layout preferences** | Absent | localStorage per email | 2 · UI-only | No | No | No | No | Low | Per-browser only |
| **Responsive breakpoints** | 2 groups | 8 groups | 2 · UI-only | No | No | No | No | Medium | Needs device testing |
| **Dated activity update** | **Exists** | Same call | 1 · Already exists | No | No | No | No | None | `POST …/activity` already takes `reporting_period` |
| **Activity history read** | **Exists** | + 3 fields | 5 · Extend endpoint | Yes | Yes | No | No | Low–Med | Add `editable`, `edit_deadline`, `revisions` |
| **Edit a history entry** | Impossible | `PATCH …/history/:id` | 8 · Major | Yes | Yes | No | Yes | **High** | Collides with append-only `source_key` |
| **10-day edit window** | Absent | 423 after deadline | 5 · New backend | Yes | Maybe | No | Yes | Medium | Deadline can be derived, not stored |
| **Revision history** | Absent | `revisions[]` per entry | 6 · New schema | Yes | Yes | No | Yes | Medium | New table |
| **Compare two reports** | Absent | Two selects side by side | 3 · Existing backend | No | No | No | No | Low | Pure client on history payload |
| **Project cover photo** | Absent | Upload / double-click | 7 · New storage | Yes | Yes | Yes | Yes | High | `handleAvatar` is a close template |
| **Weekly progress photos** | Absent | Multi-upload per week | 8 · Major | Yes | Yes | Yes | Yes | High | Unbounded volume; needs a cap |
| **Drag-and-drop upload** | Absent | Dropzone on weekly panel | 4 · New frontend | No | No | No | No | Low | Rides the photo endpoint |
| **Photo delete / replace** | Avatars only | **[Risk] Not present** | 10 · Unclear | Yes | Yes | Yes | Yes | Unknown | No DELETE anywhere in the prototype |
| **Read-only preview mode** | Absent | `window.enReadOnlyPreview` | 9 · Demo only | No | No | No | No | Low | Demo scaffolding; drop it |
| **Save-in-flight guard** | Absent | `enhanced.pending` | 4 · New frontend | No | No | No | No | Low | Worth keeping regardless |
| **Explicit inline Save button** | Blur-to-save | Injected Save button | 4 · Changes existing | No | No | No | No | Low | Behaviour change — confirm intent |
| **Seeded project data** | Live D1 | 76 embedded projects | 9 · Demo only | — | — | — | — | — | Delete on integration |
| **Reference photographs** | Absent | 4 base64 JPEGs by CAPP no. | 9 · Demo only | — | — | — | — | — | 773 KB; hardcoded to 4 projects |

---

## PART 4 — Everything genuinely new

Estimates are engineering hours for one developer already familiar with this codebase. They
exclude review time.

### 1 · Enhanced workspace shell — toggle, toolbars, panels, preferences

- **User can now** switch between the current table and an enhanced workspace, pick one of
  four layouts per module, and have that remembered.
- **Today** there is one view: the table, plus a details dialog.
- **Real or simulated?** Real — it drives our own `groupedRows()`, `filteredCapital()`,
  `developmentRows()`, `compare()`.
- **To make it real** port ~15 KB of JS and ~12 KB of CSS into `worker/client.js` and
  `worker/styles.js`, and unwind the monkey-patching (below).
- **Depends on** nothing.
- **Estimate 12–18 hours.** Driven by the template-literal hazard: `worker/client.js` is one
  backtick string, so every backslash must be doubled and a stray backtick silently breaks
  the build — a failure mode `smoke-test.mjs` documents at line 74.

### 2 · Rolodex, pagination navigators, responsive work

- **User can now** flip through projects like a card binder, or use top/bottom paginators.
- **Today** scrolling a table.
- **Real or simulated?** Real, including a `prefers-reduced-motion` guard.
- **To make it real** port the CSS (SVG filters, 3D transforms, Web Animations API) and
  validate 6 new breakpoint groups on real devices.
- **Estimate 10–16 hours**, of which roughly half is cross-device verification rather than
  coding.

### 3 · Project cover photos

- **User can now** attach a reference photo to a project and see it in record/card/collage
  layouts.
- **Today** no project imagery of any kind exists.
- **Real or simulated?** **Simulated.** Four base64 JPEGs hardcoded to CAPP numbers `08649`,
  `08688`, `08312`, `08661`; "uploads" become `URL.createObjectURL()` blobs held in
  `window.enDemoPhotoUrls` and lost on reload.
- **To make it real** a `project_photos` table, an R2 key scheme, and three endpoints (list,
  upload, serve).
- **Depends on** the database and storage decisions in Parts 8 and 9.
- **Estimate 14–22 hours.** Lowered considerably by `handleAvatar()`
  (`worker/index.js:1023–1080`), which already does streaming upload with a hard size cap, a
  MIME allowlist, R2 put/delete, and private `no-store` + CSP-sandbox response headers. That
  is most of the pattern; the new work is scope-based access instead of identity-based, plus
  the query parameters.

### 4 · Weekly progress photos

- **User can now** drop several photos onto a project for a given reporting week, each
  captioned, and browse them week by week.
- **Today** nothing comparable.
- **Real or simulated?** Simulated, same mechanism as above.
- **To make it real** the same endpoints with `kind=progress`, plus grouping by
  `reporting_period` and a volume policy.
- **Estimate 8–14 hours** on top of cover photos. The driver is not code but **volume**:
  5 MB per file, multiple files, per week, per project, across 76 projects.
  `docs/COST_AND_LIMITS.md` would need revising and a cap agreed.

### 5 · Activity history editing with revisions and a 10-day lock

- **User can now** correct the wording of a past activity entry within 10 days; previous
  wording is retained and shown under "Edited · N revisions".
- **Today** impossible. History is append-only; a correction means adding a new entry.
- **Real or simulated?** Simulated. The shim fabricates `edit_deadline` as
  `created_at + 10 days` and keeps revisions in a JS array.
- **To make it real** a `PATCH` endpoint with optimistic concurrency, a revisions table, and
  a resolution of the `source_key` collision described in Part 8.
- **Depends on** a policy decision from Tom on who may edit.
- **Estimate 16–26 hours** — **the single largest and riskiest item.** The code is small; the
  correctness is not. Editing entry *N* silently falsifies entry *N+1*'s `previous_summary`
  and can desynchronise `projects.current_update`. Getting it wrong either reopens DNC-004 or
  corrupts the audit trail.

### 6 · Compare two reporting dates

- **Real or simulated?** Real — pure client rendering over the history payload.
- **Estimate 3–5 hours.**

### 7 · Save-in-flight guard, focus retention, explicit inline Save

- **Real or simulated?** Real. Worth keeping on their own merits.
- **Estimate 4–7 hours**, including confirming the blur-to-save behaviour change is intended.

### Cannot be estimated reliably

**Photo deletion and replacement.** The prototype contains no `DELETE` path of any kind, and
the cover-photo dialog is labelled "Upload / Change project photo" without defining what
"change" does to the previous object. Until Tom says whether replacing a cover deletes the
old R2 object, whether Editors may delete progress photos, and whether deletion is audited,
any number would be invented.

---

## PART 5 — Removed, hidden or changed

### Nothing is removed

All **207** element IDs and all **422** CSS selectors from our current page are present in
the prototype. The set difference in the "only in ours" direction is **empty** in both cases.
In enhanced mode the classic table is hidden when the layout is not `list` — but that is a
toggle, not a removal, and Classic remains the default.

### Four genuine behaviour changes

1. **The activity dialog's history list is replaced.** `openActivity` is wrapped so
   `#historyList` is filled by `enHistoryHtml()` with Edit buttons, lock indicators and a
   revisions disclosure. This applies **in Classic mode too**, not only in Enhanced.
2. **Inline activity editing gains an explicit Save button.** A `.en-inline-save` button is
   created on focus, replacing implicit blur-to-save. **[Inferred]** deliberate — it pairs
   with the pending-guard — but worth confirming.
3. **Navigation is blocked during a save.** `saveInline` and `patchFields` increment
   `enhanced.pending`; navigating shows "Please wait for the current edit to finish saving."
   New, and an improvement.
4. **`setMoneyValue` is the old buggy version.** This is fork staleness, not a design
   decision — it would reintroduce DNC-001.

### Not present, but explicitly not removed

The shim answers every non-photo, non-history, non-activity request with a 403 whose own
message names the reason: *"This offline demo supports activity and photo changes. Other
changes require the connected application."* That is direct evidence of scope, not omission.
The following are untouched and fully intact in the prototype's markup:

Project field editing · Development detail editing · Promote to capital · Admin console ·
User administration · D1 backup download · Export (CSV/TSV/XLSX) · Choose Columns · Profile
photo · Login history

---

## PART 6 — What only works because it is a demo

| Mechanism | Current prototype behaviour | Real implementation required |
| --- | --- | --- |
| **API shim** | `window.fetch` replaced wholesale at line 272; zero network requests leave the page | Remove entirely. Every call must hit the Worker with cookie + CSRF. |
| **Embedded project data** | `demoBoot`: 76 projects (49 fields each), 120 updates, a computed summary — ~196 KB of real DN data from an 18 September backup | Delete. Data comes from `GET /api/bootstrap`. |
| **Fake authentication** | `demoBoot.me.role='editor'` forced; no login, no session, no CSRF, no 428 gate | Nothing to build — our auth already exists. But every capability assumption in the layer must be re-tested against a real Viewer. |
| **Fake photo storage** | Uploads become `URL.createObjectURL()` blobs in `window.enDemoPhotoUrls`; gone on reload | R2 objects + `project_photos` rows + a serving route. |
| **Hardcoded reference images** | 773 KB of base64 keyed to four CAPP numbers | Delete. Photos come from the store. |
| **Fake history editing** | In-memory `demoHistory`; 423 / 409 / 400 responses synthesised client-side | A real `PATCH` with database-level concurrency control. |
| **Fabricated `edit_deadline`** | Computed as `created_at + 864000000 ms` in the shim | Derived server-side, and enforced server-side. |
| **Fake persistence** | All writes mutate the in-memory `demoBoot`; the banner says "Uploads/edits reset on reload" | D1 transactions. |
| **Preseeded preferences** | `localStorage` written for `demo@example.invalid` so the page opens in Enhanced mode | Remove — real users start in Classic. |
| **Preview banner** | Static yellow bar naming the backup date and record counts | Remove. |
| **Read-only preview mode** | `window.enReadOnlyPreview` renders controls with "Available in the connected application" | Remove — real role checks replace it. |
| **Link interception** | Every `a[href^="/"]` click raises `alert()` | Remove. |

---

## PART 7 — Backend gap

The shim is an executable spec. Everything below is read from it, not invented.

### A · `GET /api/projects/:id/history` — exists, needs extending

- **Exists?** Yes, `worker/index.js:1210`. Returns `{project, history:[…]}` with `id`,
  `reporting_period`, `current_summary`, `previous_summary`, `author_name`, `author_email`,
  `created_at`.
- **Needs** three added fields per row: `edit_deadline`, `editable` (boolean), `revisions[]`.
- **Permissions** unchanged — already scope-filtered, already 404s out-of-scope ids.
- **D1** read only · **R2** no · **Audit** no · **Concurrency** no.

### B · `POST /api/projects/:id/activity` — exists, no change

Already accepts `{current_update, reporting_period}` and already dedupes by content hash.
**[Verified]** the prototype calls it with exactly that body.

### C · `PATCH /api/projects/:pid/history/:entryId` — **new**

- **Request** `{summary, expected_summary}`.
- **Responses** `200 {ok:true}` · `400` empty summary · `404` entry not found or out of scope
  · `409` when `current_summary !== expected_summary` · `423` past the 10-day deadline.
- **Permissions** `canWrite(role)` + `projectInScope()`; plus an unresolved question of
  whether only the original author may edit.
- **D1** yes — updates `project_updates`, inserts a revision row, and conditionally updates
  `projects.current_update`.
- **R2** no · **Audit** **yes**, mandatory · **Concurrency** **yes** — `expected_summary` is a
  compare-and-set.

### D · `GET /api/projects/:id/photos` — **new**

- **Response** `{photos:[{id, kind, reporting_period, caption, created_at, actor_email}]}`.
- **Permissions** any signed-in role, scope-filtered. **D1** read · **R2** no (metadata only)
  · **Audit** no.

### E · `POST /api/projects/:id/photos?kind=&period=&caption=` — **new**

- **Request** raw image body; `content-type` one of `image/jpeg|png|webp`; ≤5 MB. `kind` is
  `cover` or `progress`; `period` required and `YYYY-MM-DD` when `kind=progress`; `caption`
  ≤500 chars.
- **Response** `201 {ok:true, id}`.
- **Permissions** `canWrite(role)` + scope. **D1** insert · **R2** put · **Audit** yes ·
  **Concurrency** only for cover replacement.
- **[Risk]** the caption travels in the **query string**, and captions are free text. Move it
  to a header or a two-step upload — query strings land in logs.

### F · `GET /api/projects/:pid/photos/:photoId` — **new**

- Serves the binary. Mirror `handleAvatar`'s GET exactly: `cache-control: private, no-store`,
  `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox`.
- **Permissions** signed-in + scope. **R2** get · **Audit** no.

### G · Photo delete / replace — **[Risk] undefined**

No such call exists anywhere in the prototype. Do not build it on a guess.

---

## PART 8 — Database gap

### What already supports the enhancement

- `projects` — every field the record, card and collage layouts display already exists.
  **No new columns.**
- `project_updates` — `reporting_period`, `current_summary`, `author_name`, `author_email`,
  `created_at` all cover the history panel as drawn.
- `audit_log` — generic enough to record photo and revision actions without modification.
- `business_units` + `user_directory.business_unit_scope` — scope for photos comes free.

### New tables required

**`project_photos`** — because no table in the schema can hold an image reference. Needs:
`id`, `project_id` (FK, `ON DELETE CASCADE`), `kind` (`CHECK IN ('cover','progress')`),
`reporting_period` (nullable — cover photos have none), `caption`, `r2_key` (UNIQUE), `mime`,
`byte_size`, `actor_email`, `actor_id`, `created_at`. Indexes on
`(project_id, kind, reporting_period)` for the weekly grid and a partial unique index on
`(project_id)` where `kind='cover'` if one cover per project is the rule.

**`project_update_revisions`** — because `revisions[]` has no home. Needs: `id`, `update_id`
(FK `project_updates.id`, cascade), `previous_text`, `revised_text`, `actor_email`,
`actor_id`, `created_at`. Index on `update_id`.

### Columns on existing tables

**[Inferred] Recommendation: none.** `edit_deadline` should be *derived* from
`created_at + 10 days` rather than stored — it is a policy constant, not a fact about the
row. Deriving it means zero migration on `project_updates`, zero backfill, and a policy that
can be changed by editing one number instead of rewriting 120 rows.

### [Risk] The `source_key` collision

`project_updates.source_key` is `NOT NULL UNIQUE` and computed as
`update:<projectId>:<period>:<sha256(current_summary)>` (`worker/index.js:1500`). It is
**the exact mechanism that fixed DNC-004** — two in-flight saves of identical text produce
identical keys, and `INSERT OR IGNORE` settles it.

Editing `current_summary` breaks that invariant. The key no longer describes its content, so
a later re-submission of the *original* text would compute the original key, find it present,
and be silently ignored — the entry could never be restored. Worse, each row's
`previous_summary` is a snapshot of the prior row's text, so editing entry *N* leaves entry
*N+1* asserting a "previous wording" that was never saved.

**This needs a designed answer, not a patch.** The cleanest option is to leave `source_key`
permanently as the immutable identity of the *insertion event*, stop treating it as a content
hash, and move de-duplication to a separate content column — but that changes DNC-004's
guarantee and must be re-tested against its existing assertions.

### Migration files

One: `drizzle/0006_project_photos_and_revisions.sql`. Both statements are `CREATE TABLE` +
`CREATE INDEX`. No `ALTER`, no data movement. *No migration has been created — this is a
description only.*

---

## PART 9 — R2 / file storage gap

| Dimension | Existing — profile photos | Required — project photos |
| --- | --- | --- |
| Bucket | `BUCKET` → `dnc-tracker-assets` | Same bucket, new key prefix |
| Key storage | `user_directory.avatar_key` | New `project_photos.r2_key` |
| Key scheme | Per-user, versioned | **[Inferred] Proposed** `projects/<projectId>/<uuid>` |
| Size cap | 256 KB, enforced twice — header and streamed count | **5 MB** — 20× larger |
| MIME allowlist | `image/jpeg`, `image/png`, `image/webp` | Identical |
| Count per owner | Exactly one | One cover + **unbounded** progress photos |
| Captions / labels | None | Caption ≤500 chars, in D1 not R2 metadata |
| Access control | Identity — admin or self | **Scope** — business unit via `projectInScope()` |
| Response headers | `private, no-store` + `nosniff` + CSP sandbox | Copy exactly |
| Replacement | Old object deleted on PUT | **[Risk] Undefined** |
| Deletion | `DELETE` removes object and clears columns | **[Risk] No endpoint in prototype** |
| Orphan cleanup | N/A — one key per row | Needed: project deletion cascades D1 but **not R2** |

### The volume question

Profile photos are bounded: one per user, 256 KB, a handful of users. Weekly progress photos
are bounded by nothing in the prototype — 5 MB × several files × every week × 76 projects. At
even three photos a week this is roughly 45 GB a year. `docs/COST_AND_LIMITS.md` and
`docs/STORAGE.md` both exist and would need revising, and a retention or count cap should be
agreed before the endpoint ships.

---

## PART 10 — Permissions and security gap

| Capability | Current rule | Prototype behaviour | New rule needed? |
| --- | --- | --- | --- |
| Admin console | `role === 'admin'` | Untouched | No |
| Editor writes | `canWrite()` | Reuses `canWrite()` | No |
| Viewer read | Read-only | Controls shown but `disabled` | No |
| Business-unit scope | `scopeFilter` / `projectInScope`; 404 not 403 | Not exercised — demo has no server | No, but photos must adopt it |
| Download | Every signed-in role, once the temporary password is replaced | Never touched by the layer | No |
| Choose Columns | Same as Download | Never touched by the layer | No |
| Photo read | — | Implicit | **Yes** — signed-in + scope |
| Photo upload | — | `canWrite()` client-side only | **Yes** — server-side `canWrite` + scope |
| History editing | Impossible | Any Editor, within 10 days | **Yes** — and the author question is open |
| Revision visibility | — | Shown to whoever can see the history | **Yes** — confirm Viewers should see prior wording |
| Enhanced/Classic switch | — | Free to all, localStorage | No |

### [Risk] Confirmed regression — DNC-007 will come back if the layer is merged as-is

This is not speculation — I traced the DOM positions.

`showPasswordChangeOnly()` (`worker/client.js:166`) defends DNC-007 in two ways: it calls
`clearAccountData()`, which empties the 22 containers listed in `ACCOUNT_HTML`, and it sets
`#workspace.hidden = true`.

The enhancement layer *does* clear its own DOM — but only inside its two `showSignIn`
wrappers. **`showPasswordChangeOnly` never calls `showSignIn`**, so on the exact path DNC-007
describes — a second account signing in in the same tab — those wrappers never fire.

And hiding the workspace does not cover the layer, because three of its containers are
injected **outside** `#workspace`. I verified the character offsets in the served page:
`#workspace` begins at 43,742, while `[data-view="portfolio"]` — the anchor `#enRolodex` is
inserted after — sits at 39,741, in the sidebar. `#enBottomNav` is appended to
`document.body`. `#enExperience` is appended to `.sidebar`.

**Result:** the previous user's rolodex cards and bottom-pagination project names would remain
on screen behind the temporary-password form. Exactly the defect DNC-007 names.

**Fix:** add `enRolodex`, `enBottomNav`, `enPanel-projects`, `enPanel-development`,
`enToolbar-projects`, `enToolbar-development` to `ACCOUNT_HTML`, and reset the `enhanced`
object in `clearAccountData()`. Small — 2–4 hours including a new assertion — but it must be
deliberate.

### DNC-008 survives intact

Verified by exhaustive search: the enhancement layer contains **zero** references to
`exportBtn` or `columnsBtn`. `applyCapabilities()` remains the only thing that sets them.
Download and Choose Columns will still return immediately after a password change. The one
follow-up is to confirm the layer's own new controls — the mode toggle, navigator picker and
font buttons — behave correctly for an account still behind the 428 gate.

---

## PART 11 — Data migration and existing records

No database was modified in producing this audit.

| Question | Answer | Why |
| --- | --- | --- |
| Can existing projects work unchanged? | **Yes** | Every field the new layouts render already exists. A project with no photo renders the "Project photo needed" placeholder. |
| Can existing `project_updates` work unchanged? | **Yes**, if the deadline is derived | Deriving `edit_deadline` from `created_at` needs no column and no write. |
| New columns on existing records? | **None required** | Both additions are new tables. |
| Backfill needed? | **No** | Absence of a photo or a revision is a valid, meaningful state. |
| Can features arrive with NULL/defaults? | **Yes** | Purely additive schema. |
| Reversible? | **Yes** for D1 | `DROP TABLE` restores the previous schema exactly. **R2 objects are not covered** by a D1 rollback and need separate cleanup. |

### One consequence to confirm

All 120 existing activity updates were created on or before 2026-09-11. Under a 10-day window
derived from `created_at`, every one of them is **already locked** the moment the feature
ships — no historical entry would ever be editable. **[Inferred]** that this is intended,
since the whole point is a short correction window. But if Tom expects a grace period for
existing records, that changes the design.

---

## PART 12 — Development effort

One developer already fluent in this codebase. **Excludes all Tom and Mina review time.**

| # | Workstream | Optimistic | Realistic | High | What drives it |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | UI integration | 16 h | 28 h | 44 h | 34 KB of CSS and the chrome injection, ported into a single template literal where a stray backtick breaks the build; 6 new breakpoint groups to verify on devices |
| 2 | Frontend state and workflows | 14 h | 24 h | 40 h | **Unwinding the monkey-patching.** The layer is two stacked passes that patch their own output with `html.replace()` and regex. Shippable code must fold this into the render functions. |
| 3 | Backend and API | 20 h | 34 h | 56 h | Three new endpoints plus one extended. `handleAvatar` halves the photo work; the history `PATCH` carries almost all the difficulty. |
| 4 | Database | 5 h | 9 h | 16 h | Two tables are quick. Resolving the `source_key` collision without reopening DNC-004 is not. |
| 5 | R2 / storage | 5 h | 10 h | 18 h | Bucket and patterns exist. New work is the key scheme, orphan cleanup and a volume policy. |
| 6 | Permissions and security | 8 h | 14 h | 22 h | Scope checks on photo routes, the DNC-007 extension, moving captions out of the query string |
| 7 | Migration and data | 2 h | 4 h | 8 h | Genuinely small — additive, no backfill |
| 8 | Testing | 16 h | 30 h | 52 h | **The harness gap.** See below. |
| 9 | Deployment and handoff | 4 h | 7 h | 12 h | Test deploy, remote checks, and revisions to 4–5 files in `docs/` |
| | **Total** | **90 h** | **160 h** | **268 h** | |
| | **Working days @ 6 productive h** | **15 d** | **27 d** | **45 d** | |

### Why testing is the second-largest line

`scripts/browser-harness.mjs` was written deliberately narrow — its header says it implements
"the DOM surface `worker/client.js` uses and nothing else." I checked it against what the
enhancement needs:

| API the enhancement uses | In the harness today |
| --- | --- |
| `Blob`, `File`, `FileList`, `DataTransfer` | **[Risk] Absent** |
| `dragover` / `dragleave` / `drop` events | **[Risk] Absent** |
| `matchMedia`, `CSS.escape`, `Element.animate` | **[Risk] Absent** |
| `offsetParent`, `replaceChildren`, `insertAdjacentHTML` | **[Risk] Absent** |
| `URLSearchParams` | **[Risk] Absent** |
| `localStorage`, `dialog`/`showModal`, `closest`, `classList`, `dataset` | **[Verified] Present** |

So the choice is to extend the harness — the low end of the estimate — or adopt a real
headless browser. The latter is a project-level decision: this repository currently has
**zero runtime dependencies** and only `vite` and `wrangler` in dev. Adding Playwright would
be the first departure from that, and pushes the testing line toward 52 hours before it pays
back.

---

## PART 13 — Complexity classification

# Large

Not Medium, and not Major. The classification follows from the counts, not from impression.

### Why not Small or Medium

- Client JavaScript grows by **54%** (46.7 KB on 86.7 KB); CSS by **87%** (33.8 KB on
  38.8 KB).
- **Three new endpoints plus one extended**, one of which handles binary upload.
- **Two new D1 tables** and a new R2 usage pattern.
- A genuine data-integrity problem — mutable history against a content-derived UNIQUE key —
  that cannot be resolved by writing more code.
- The regression harness **cannot currently exercise a single one of the new workflows.**
- The prototype code is not shippable in its present form: it patches its own rendered HTML
  with regex `.replace()` across two stacked passes.

### Why not Major

- **Nothing is replaced.** Zero existing IDs or selectors removed; every injection anchor
  already exists in `worker/page.js`.
- Authentication, sessions, CSRF, roles, business-unit scope and audit logging are **reused
  unchanged**.
- No schema change to any existing table; no backfill; fully reversible.
- `handleAvatar()` is a working template for most of the photo pipeline.
- The enhancement is **opt-in** — Classic remains the default, so it can ship dark and be
  enabled per user.

---

## PART 14 — Phasing

Six phases, ordered so that something demonstrable exists after Phase 2 and nothing
irreversible happens before Phase 4.

| Phase | Deliverable | Depends on | Hours | Risk |
| --- | --- | --- | ---: | --- |
| **0 · Rebase** | The `en-*` layer lifted off `e199045` and reapplied on `354fb4b`; demo scaffolding stripped; `npm test` green with all 408 assertions | — | 10–16 | **High if skipped.** Merging in the other direction silently deletes three commits of DNC fixes. Do this first or not at all. |
| **1 · UI, no new data** | Toggle, four layouts, three navigators, text size, meeting mode, responsive work. Everything reads data we already serve. Photos show placeholders. | Phase 0 | 34–48 | Low. Reversible, opt-in, no backend change. **This is the demo Tom can put in front of the team.** |
| **2 · Frontend hardening** | Monkey-patching unwound into real render functions; pending-guard, focus retention, DNC-007 extension to the new containers | Phase 1 | 18–28 | Medium. Where the regression risk to DNC-007 is retired. |
| **3 · Photos** | `project_photos`, R2 key scheme, three endpoints, upload and weekly panels made real | Phase 2; storage policy from Tom | 28–42 | Medium. Volume cap must be agreed *before* the endpoint ships. |
| **4 · History editing** | `PATCH …/history/:id`, revisions table, 10-day lock, concurrency, audit | Phase 2; `source_key` decision; author policy | 24–38 | **High.** The only phase that can corrupt existing data. Keep it last and behind its own flag. |
| **5 · Regression coverage** | Harness extended for files, drag-drop and media queries; new assertions; DNC-001→008 re-verified; remote checks extended | Phases 3 and 4 | 30–52 | Medium. Runs alongside 3 and 4 rather than strictly after. |
| **6 · Deploy and handoff** | Test deployment, remote suite, `docs/` revised, handoff package rebuilt | All | 7–12 | Low. Process already exists and works. |

**Phases 0 + 1 alone — roughly 44 to 64 hours — deliver a genuinely enhanced tracker** running
on real data with no schema change, no storage cost and no new permission surface. If the
enhancement has to justify itself before the rest is funded, that is the natural stopping
point.

---

## PART 15 — Executive summary

**1 · How different is it?**
Structurally, barely — it is our own page with a layer on top, attaching to anchors that
already exist. Functionally, substantially: it introduces two capabilities the application
has never had, project imagery and mutable history, and both need a real backend.

**2 · How much is genuinely new?**
Justified from the inventory: **35% of the merged client JavaScript** would be new code
(46,747 of 133,480 chars) and **47% of the merged CSS** (33,804 of 72,613). The backend grows
by **about 20%** — 3 new routes plus 1 extended against 20 existing. The data model grows by
**2 tables on 10**. **0% of existing functionality is replaced.**

**3 · What is removed or changed?**
Nothing removed — verified by set difference on both element IDs and CSS selectors. Four
behaviour changes: the activity dialog's history list is re-rendered with edit controls (in
Classic mode too), inline editing gains an explicit Save button, navigation is blocked during
a save, and `setMoneyValue` has reverted to its pre-DNC-001 form — the last of these being
fork staleness, not intent.

**4 · What is prototype-only?**
Every write. `window.fetch` is replaced wholesale; there is no server, no session, no CSRF.
Uploads are object URLs lost on reload; history edits are a JS array; `edit_deadline` is
fabricated client-side; 76 projects and four photographs are embedded in the file.

**5 · New backend work?**
`POST` and `GET /api/projects/:id/photos`, `GET /api/projects/:id/photos/:photoId`,
`PATCH /api/projects/:id/history/:entryId`, and three added fields on the existing history
response. ≈34 hours realistic.

**6 · New database work?**
One migration, two tables — `project_photos` and `project_update_revisions`. No columns on
existing tables, no backfill, fully reversible. ≈9 hours, plus the `source_key` decision.

**7 · New storage work?**
Same bucket, new key prefix, 5 MB cap instead of 256 KB, scope-based rather than
identity-based access, plus orphan cleanup and a volume policy. ≈10 hours.

**8 · New permission work?**
Scope checks on three photo routes, an edit-authority rule for history, and extending the
DNC-007 clearing set to the six new containers. ≈14 hours. No new role and no change to
Download or Choose Columns.

**9 · What can be reused directly?**
Auth, sessions, CSRF, roles, `canWrite()`, `scopeFilter()`, `projectInScope()`, the audit
log, the R2 bucket, `handleAvatar()` as an upload template, the export pipeline, the entire
admin console, every DOM anchor the layer needs, and the deployment and handoff process.

**10 · Realistic effort**
**160 engineering hours — about 27 working days**, in a range of 90 to 268. Excludes review
time.

**11 · Biggest technical risk**
**Mutable activity history against an append-only design.** `project_updates.source_key` is a
UNIQUE content hash and is the mechanism that fixed DNC-004. Editing an entry's text breaks
that invariant, and each row's `previous_summary` is a snapshot of the row before it — so
editing entry *N* falsifies entry *N+1*. This is a design decision, not a bug to code around.
Second is the DNC-007 regression in Part 10, which is confirmed but cheap to fix once it is
known about.

**12 · What not to build until Tom clarifies**

1. **Photo deletion and replacement** — no `DELETE` exists anywhere in the prototype, and
   "Upload / Change photo" does not define what happens to the old object.
2. **Who may edit a history entry** — any Editor in scope, or only the original author? The
   prototype records `actor_email` but enforces nothing.
3. **Whether 10 days is policy or placeholder**, and whether all 120 existing updates being
   locked on day one is the intent.
4. **Whether Viewers should see prior wording** in the revision disclosure.
5. **A storage cap** for weekly photos — unbounded at 5 MB is not a shippable default.
6. **Whether Enhanced mode is opt-in, default-on, or admin-controlled.**
7. **Whether editing an entry should correct the following entry's `previous_summary`** and
   `projects.previous_update`, or leave the chain as written.

### One handling note

The prototype file embeds **76 real projects, 120 real activity updates with author names and
email addresses, and $174,956,038 of capital figures**, drawn from an 18 September backup. It
sits untracked in the repository root. It was not covered by `.gitignore` when this audit was
written; a root-anchored `/DN_Tracker_*.html` rule has since been added, so the file and any
later prototype drop are now ignored. Treat it as a database extract: do not commit it.

---

Audit performed against commit `7b4eb5a627c502cc470b114a7c64c3ef9631b10e` (branch `dev`) and
`DN_Tracker_Enhanced_Interactive_Demo (3).html` (1,714,525 bytes). No application files were
modified, nothing was committed, nothing was deployed, and no database was read or written.
Every figure marked **[Verified]** was taken directly from the repository or the prototype
file; items marked **[Inferred]** are reasoned conclusions and are labelled as such
throughout.
