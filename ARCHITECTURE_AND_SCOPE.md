# Architecture and Migration Scope

## What exists today

The current pilot is hosted through ChatGPT Sites on Cloudflare infrastructure. One Cloudflare Worker serves the interface and API routes. D1 stores relational data. R2 stores protected profile photographs. The browser communicates with the Worker through same-origin requests.

The current code is JavaScript. The database schema is represented by append-only SQL migrations in `drizzle/`. The pilot includes local sign-in, password hashing, sessions, CSRF protection, request throttling, Viewer/Editor/Admin roles, business-unit permissions, activity history and audit history.

## What the migration must preserve

- Current appearance, responsive behavior and module navigation
- Portfolio, Projects, Development Pipeline, Cost Control, Risk, Admin and Help
- Business-unit filtering and source-workbook ordering
- Inline activity editing and dated history
- Cost calculations, sorting, filtering and CSV/TSV/XLSX exports
- Project promotion from Development Pipeline without losing identity or history
- Viewer, Editor and Admin behavior
- Authentication, forced initial password change, sessions, logout, CSRF and throttling
- Audit history and data relationships
- Uploaded-file and profile-photo behavior when the live file export is supplied

## Proposed Ubuntu design

The evaluator should recommend the simplest supportable Node.js structure. A typical design would place Node.js on `127.0.0.1`, expose only Nginx on ports 80 and 443, use systemd for restart and startup, and keep SQLite and uploaded files outside the public web root. SQLite should use WAL mode with a controlled write path and tested backups.

## Migration and acceptance

The production migration must use a separately supplied live export. Reconciliation should include table row counts, key relationship checks, important field totals/checksums, file counts, and read-only replay or comparison of representative audit/history records. Staging acceptance should occur before the final production cutover.

This package does not identify or authorize a particular server. The Ubuntu VPS, domain/DNS control and required access must be confirmed before production work begins.
