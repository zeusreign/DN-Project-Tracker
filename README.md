# Delaware North D&C Project Management Tracker

A web-based relational tracker for the Delaware North Design & Construction project-reporting workbook.

## Technology

- JavaScript in a Cloudflare Worker provides server-side routes, authorization, calculations, and HTML delivery.
- Browser JavaScript uses Fetch API requests for interactive edits, filtering, sorting, history, and dialogs.
- SQL stores relational project, development, user-directory, history, and audit data in Cloudflare D1 (SQLite-compatible).
- HTML and CSS provide the responsive interface and Delaware North branding.
- Profile photo bytes use the private R2 `BUCKET` binding; photo metadata stays in D1.
- Python is used only during development to verify Excel imports and generate the embedded PDF guide; it is not deployed.

## Modules

- Portfolio
- Projects
- Development Pipeline
- Cost Control
- Risk Register
- Admin
- Help and PDF User Guide

## Build and verification

```sh
bash scripts/build.sh
node scripts/validate-artifact.mjs
node scripts/smoke-test.mjs
```

The build bundles the worker source, branded assets, PDF guide, hosting manifest, and append-only D1 migrations into `dist/`.

## Profile and session behavior

Users open their avatar to update a photo, title, location, phone or password. Names, email addresses,
User IDs, roles and account access remain Admin-managed. Uploads are resized in the browser to a
256-pixel square JPEG; the server accepts only JPEG, PNG or WebP, checks image signatures and
limits uploaded bytes to 256 KB. Photo reads and writes require authentication; writes also
require CSRF verification and ownership or Admin access. The deployment must apply migration
`0005_profile_photos.sql` and bind R2 before enabling photos.

Refresh renews an unexpired local session for up to eight hours, with a 24-hour absolute limit.
Expired or revoked sessions still require sign-in. CSV export uses an authenticated same-origin
request to `/api/export.csv` and a browser download, without navigating away from the tracker.
The register pages use document-level vertical scrolling; horizontal table scrolling remains
available on narrow screens. Saving updates preserves the current page scroll position.
