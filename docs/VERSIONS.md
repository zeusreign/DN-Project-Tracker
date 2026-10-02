# Live versus test version record

What is deployed where, which commit each deployment serves, and how to verify both without
trusting this page. Written because the two environments are **not** on the same build, and the
served page cannot tell them apart.

Observed 2026-09-29. Re-check with the commands in §4 rather than assuming this is current.

---

## 1. The two environments

| | **Production (live)** | **Isolated test** |
|---|---|---|
| Stable URL | https://dnc.lagospm.com | https://dev.dnc.lagospm.com |
| Pages project | `dnc-tracker-pilot` | `dnc-tracker-pilot-dev` |
| Deployment id | `d172266b-9548-4b84-9381-bfab0a35428a` | `590b03be-c309-4416-834b-f366d2efc3a0` |
| Pages branch | `handoff` | `test` |
| **Source commit** | **`e302b3e`** | **`2334e91`** |
| Deployed | 2026-09-26T10:32:00Z | 2026-09-28 |
| Worker bundle sha256 | `c08e9200…3dcb47e1` | `70ea527c…23f99347` |
| D1 database | `dnc-tracker-pilot` `94241844-…` | `dnc-tracker-pilot-dev` `34dca57e-…` |
| R2 bucket | `dnc-tracker-assets` | `dnc-tracker-assets-dev` |
| `ALLOW_PLATFORM_AUTH` | `"false"` | `"false"` |
| Config file | `wrangler.toml` | `test-env/wrangler.toml` |

Deployment id and source commit are the authoritative identifiers. The deployment ids are listed by
`wrangler pages deployment list` and are not editable after the fact.

### The packaged commit is newer than both, and deployed nowhere

A handoff package names the commit it was built from, which will normally be **newer** than either
deployment. That is expected and is not a third version of the application:

> The commit this package was built from changes **only** documentation, the manifest, `.gitignore`
> and two import scripts under `scripts/`. None of them enter the worker bundle. Building
> `pages-dist/_worker.js` from it yields sha256 `70ea527c…23f99347` — **byte-identical to the bundle
> the test environment serves**. There is no runtime difference between the packaged commit and
> `2334e91`.

Verify it rather than taking this on trust:

```sh
bash scripts/build-pages.sh && sha256sum pages-dist/_worker.js
# 70ea527cc917bb2779231f20b1539722d5a408ec13b90a8c19e3968123f99347
```

So there are two deployed builds, not three: live (`e302b3e`) and test (`2334e91`, which the
packaged commit reproduces exactly).

---

## 2. Test is three commits ahead of live

```
e302b3e   <- PRODUCTION serves this
06edf0d   Record Enhanced integration deployment d172266b in handoff manifest
3ef87a7   Record Enhanced integration release metadata and refresh checksums
2334e91   Recalculate the Days column when a turnover date changes   <- TEST serves this
```

Only two of the four changed files affect runtime behaviour:

| File | Change | Runtime effect |
|---|---|---|
| `worker/index.js` | +27 lines | **The Days fix.** Present in test, absent in live. |
| `scripts/smoke-test.mjs` | +36 lines | Regression tests; not in the deployed bundle. |
| `HANDOFF_MANIFEST.json` | metadata | None — not in the bundle. |
| `CHECKSUMS.sha256` | metadata | None — not in the bundle. |

### ⚠ The Days correction is NOT in production

`duration_change_days` is recomputed from the two turnover dates by `DURATION_CHANGE_DAYS_SQL`
(`worker/index.js:289`), applied after any write that can move a turnover date
(`:1474` on create, `:1708` on field edit).

```sh
git show e302b3e:worker/index.js | grep -c DURATION_CHANGE_DAYS_SQL   # 0  -> live lacks it
git show 2334e91:worker/index.js | grep -c DURATION_CHANGE_DAYS_SQL   # 3  -> test has it
```

In production, Days is still whatever the workbook import wrote into the stored column and does not
move when a turnover date is edited. **Review the fix on the test environment, not on live.**

### ⚠ The served page is identical in both, and proves nothing

Both environments return a byte-identical page:

```
1048646 bytes   sha256 838e1f3c5416d45415ec22337d8d132f8e2ff89fa641de3b7b018e9d1ecf5e90
```

The Days fix is server-side SQL in the API; it changes no client markup. Comparing the rendered page,
its size or its hash will **not** distinguish the two builds. Use the deployment source commit, or
exercise the API.

---

## 3. Data state

Code and data move independently: a deployment or rollback changes code only, never data
(see [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)).

| Table | Production | Isolated test |
|---|---|---|
| `projects` | 76 | 17 |
| `project_updates` | 164 | 74 |
| `user_directory` | 79 | 7 |
| `project_photos` (active / total) | 87 / 88 | 0 / 0 |
| `business_units` | 5 | 4 |
| `audit_log` | 185 | 322 |

Production photos are the Central City set migrated on 2026-09-28 — 87 progress photos plus the GGGR
cover, one of which was soft-deleted by the client afterwards. The test environment holds **no**
photographs and no live record; its D1 and R2 are separate resources throughout.

`scripts/check-deploy-target.sh` is the single definition of each environment and asserts the project
name, D1 name and id, R2 bucket, both binding names and `ALLOW_PLATFORM_AUTH="false"`, refusing the
other environment's resources. Both deploy scripts run it before building or uploading. Production
resource names are strict prefixes of the test ones, so every assertion anchors on the whole
`key = "value"` line.

---

## 4. Verifying this record

```sh
# Which commit each environment actually serves
npx wrangler pages deployment list --project-name dnc-tracker-pilot     | head -5
npx wrangler pages deployment list --project-name dnc-tracker-pilot-dev | head -5

# That a given commit contains the Days fix
git show <commit>:worker/index.js | grep -c DURATION_CHANGE_DAYS_SQL

# Data state, read-only
npx wrangler d1 execute 94241844-c709-445f-a71c-49f8b65a7cfd --remote --yes \
  --command "SELECT COUNT(*) FROM projects"
```

The `Source` column of `deployment list` is the commit hash passed at upload time by
`scripts/deploy-prod.sh` / `scripts/deploy-test.sh` via `--commit-hash`.

---

## 5. Bringing live up to test

Not done as part of this record — it is a production change and needs a decision, not a default.
When it is wanted, `docs/DEPLOY.md` §2 is the procedure. Two things specific to this case:

1. **Deploy from the `handoff` branch.** It is the Pages production branch. A production deploy made
   from any other branch is silently published as a *preview* instead, and the live URL does not
   move. `handoff` currently sits at `b59c847`, behind `2334e91`.
2. **The Days fix changes no data on deploy.** It only recomputes `duration_change_days` on
   subsequent writes. Existing rows keep their imported value until a turnover date is edited; there
   is no backfill. If the 24 projects currently holding a stored value should be corrected
   immediately, that is a separate, explicit migration.
