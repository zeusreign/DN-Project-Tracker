# Validation report — Faheem contractor export

Prepared September 8, 2026 from canonical source commit `514f5f0cb1cf6b4f4c08ed0e7f30da77fbb6ee71`.

## Executed on the credential-cleaned export

Runtime: Node v24.19.0. All commands returned exit code 0.

| Command | Result |
| --- | --- |
| `bash scripts/build.sh` | PASS — built Worker and bundled assets/migrations |
| `node scripts/validate-artifact.mjs` | PASS — valid ES module with `default.fetch` |
| `node scripts/smoke-test.mjs` | PASS — project seed, calculations, workflows, role checks, account/password flow, photos, PDF and new audit regressions |
| `node scripts/export-integrity-test.mjs` | PASS — independent Excel reader, ZIP/XML structure, types, formatting, CSV/TSV escaping and formula safety |

The smoke test verifies 74 unique normalized project source keys, no legacy password-configured or active seeded roster accounts, subsequent fresh-password login, Viewer write denial, and descriptive audit events. Audit cases include before/after values, actor identity, unchanged saves, unknown fields, money values, development edits, legacy display fallback and transaction rollback.

## Integrity and credential checks

- All 39 tracked source files from the recorded commit are included. Exactly three have documented export adjustments; the remaining 36 match the source commit byte for byte.
- All project seed text, six SQL migrations, Help PDF and seven profile-photo files match the source commit exactly.
- Twelve legacy credential records were removed. Their original hash/salt bytes were checked against the export and rebuilt output; none remain.
- Pattern checks found no private-key blocks, recognizable GitHub/AWS credential tokens or literal Cloudflare/OpenAI API keys. This is a bounded source/export check, not a guarantee against every possible secret format.
- Git history, local environment files, database files, old archives, dependencies and generated build output are excluded from the delivered source ZIP.
- Each included payload file is listed in `CHECKSUMS.sha256`. The final archive is checked for unsafe paths, duplicate members, CRC integrity and payload checksum equality before delivery.

## Limits and required external verification

This is a local source validation, using an isolated test database/storage adapter. It did not read or modify the live Sites database, deploy an external site, verify DNS, or perform browser acceptance in Faheem's Cloudflare environment.

The known business-unit authorization gap and the first-administrator/preview setup work remain as described in `IMPLEMENTATION_NOTES.md`. Passing role tests does not establish business-unit isolation. The package contains the embedded workbook baseline, not a current runtime database or R2 export.
