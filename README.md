# DN D&C Project Management Tracker — Sanitized Review Copy

This package is a read-only technical evaluation copy of the Project Tracker source. It preserves the application structure and representative behavior while replacing live project records and employee identities with synthetic examples.

## Purpose

Use this package to inspect the existing implementation, assess the Cloudflare-to-Ubuntu migration, identify risks and assumptions, and confirm the capped scope before any production access is granted.

Do not deploy this review copy as production. Do not treat its synthetic records as a migration source.

## Current implementation

- JavaScript Cloudflare Worker for server routes and HTML delivery
- Cloudflare D1, which is SQLite-compatible, for relational records
- Cloudflare R2 for protected profile-photo objects
- Browser JavaScript for editing, filtering, sorting, history, dialogs and exports
- HTML/CSS interface with Portfolio, Projects, Development Pipeline, Cost Control, Risk, Admin and Help modules

## Proposed production target

- Node.js application on an agreed Ubuntu VPS
- SQLite database with migration and reconciliation from the live D1 export
- Nginx reverse proxy and HTTPS
- systemd process recovery
- firewall, logs, log rotation and database-connected health check
- tested backup, restore and rollback procedures

## Review materials

- `REVIEW_INSTRUCTIONS.md` — requested review response and restrictions
- `ARCHITECTURE_AND_SCOPE.md` — current and target architecture
- `sanitized-pilot-data.json` — synthetic records showing the expected data shape
- `drizzle/` — complete database schema migrations

## Local build

```sh
npm install
npm test
```

The production user guide, photographs, live D1 export, live files, real user directory, password hashes, salts, session records, audit records, server credentials and hosting identity are intentionally excluded.
