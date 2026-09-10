# Cloudflare cost and usage limits

Written on Sept 10, 2026 at the time of going live on cloudflare pages as custom domain.

What could generate a charge, what the current usage actually is, and what to check each month.

Other topics have their own guide — see [../README.md](../README.md).

> **Verify the numbers before relying on them.** Cloudflare changes free-tier allowances from time to
> time. The figures below were correct when measured, but always confirm current limits at
> `developers.cloudflare.com/workers/platform/limits/`, `/d1/platform/limits/` and `/r2/pricing/`.

---

## 1. Short answer

**Nothing in normal operation is close to generating a charge.** Measured usage sits at a small
fraction of every free allowance, and the largest single number — database rows read — is at roughly
**1–2% of the daily limit**.

The one resource that *bills* rather than simply stopping is **R2**, and it currently holds 1.7 MB
against a 10 GB allowance.

---

## 2. What is actually in use

Measured from the live account:

| Resource | Current usage | Free allowance (verify) |
|---|---|---|
| **D1 storage** | 352 kB | 5 GB |
| **D1 rows read** | ~68,300 / 24h | 5,000,000 / day |
| **D1 rows written** | ~700 / 24h | 100,000 / day |
| **D1 queries** | ~1,700 read, ~460 write / 24h | — |
| **R2 storage** | 1.7 MB, 9 objects | 10 GB-month |
| **R2 operations** | negligible | 1M Class A, 10M Class B / month |
| **Pages deployments** | 4 retained | 500 builds / month |
| **Custom domain + TLS** | 1 | Free |

That 24-hour sample covers a period of active testing by several people, so it is a realistic upper
bound for light use rather than an idle baseline.

---

## 3. Which services bill, and which just stop

This distinction matters more than the numbers.

| Service | Behaviour when the free allowance runs out |
|---|---|
| **Workers / Pages Functions** | Requests are **refused** with an error. No automatic charge |
| **D1** | Queries **fail**. No automatic charge |
| **R2** | **Billed** beyond the free allowance. This is why enabling R2 requires a payment method |
| **Pages bandwidth** | Unmetered |
| **Custom domain / TLS certificate** | Free, renews automatically |

So on the free plan the realistic failure mode is **the application stopping**, not a surprise
invoice. R2 is the exception — it accrues cost quietly rather than refusing.

Charges can also begin if someone **upgrades a plan in the dashboard** (for example Workers Paid at a
monthly fee). That is a deliberate click, not something the application can trigger.

---

## 4. Realistic risks, ranked

### 4.1 Database rows read — the number to watch

`68,300` rows read in 24 hours is the highest usage figure, and it grows with the number of people
using the application rather than with the amount of data stored.

The reason is structural: opening the application loads the **entire portfolio** in one request —
all 74 projects, their development details and around 120 activity rows. Every page load, refresh
and export repeats that. A single user working actively can therefore account for a few thousand
rows read per session.

At the measured rate this is roughly 1–2% of the daily allowance. It would take a large increase in
users — or something repeatedly polling the API — to approach the limit. Worth watching as more
people are given accounts.

### 4.2 R2 growth

Only profile photographs are stored, capped at 256 KB each after browser resizing. Even a photograph
for every person in the directory would be a few tens of megabytes against a 10 GB allowance.

R2 would only become a cost if the application were changed to store something larger — file
attachments, document uploads, exported reports. That would be a deliberate change.

### 4.3 Accidental load

Anything that calls the API in a loop — a monitoring check on `/api/bootstrap` rather than
`/health`, a broken script, or an automated backup running far too often — multiplies rows read
quickly. Use `/health` for uptime checks; it touches no data.

### 4.4 Not a cost, but worth knowing

The deployed bundle is around **2.57 MB gzipped against a 3 MB limit** (~85%). Exceeding it blocks
the deploy rather than costing money. See [DEPLOY.md](DEPLOY.md).

---

## 5. Usage and billing alerts

Cloudflare supports **notifications for billing and usage** in the dashboard under
**Manage Account → Notifications**, which can email when spending or usage crosses a threshold.
This can be set up whenever you want it — it is a dashboard configuration, not a code change.

---

## 6. Monthly check

Five minutes in the Cloudflare dashboard.

1. **Billing → confirm the plan is still Free** and there are no unexpected line items.
2. **Check whether a payment method is attached.** One is required for R2. Knowing it is there is the
   point — it means an R2 overage would be charged rather than blocked.
3. **Workers & Pages → your project → Metrics.** Look at request volume and error rate. A sudden
   jump usually means something is polling the API.
4. **D1 → `dnc-tracker-pilot` → Metrics.** Check rows read per day against the allowance, and
   database size. Rows read is the figure most likely to grow.
5. **R2 → `dnc-tracker-assets` → Metrics.** Check stored bytes and Class A/B operations.
6. **Confirm the R2 bucket is still private** — no public `r2.dev` domain enabled. This is a security
   check as much as a cost one. See [STORAGE.md](STORAGE.md).
7. **Review the active account list.** More active users means more requests; it is also good
   hygiene to remove accounts that are no longer needed.
   See [USER_ADMINISTRATION.md](USER_ADMINISTRATION.md).

From the command line, the same headline figures:

```sh
npx wrangler d1 info dnc-tracker-pilot        # size, queries and rows read/written in 24h
npx wrangler r2 bucket info dnc-tracker-assets # object count and stored bytes
```

---

## 7. If usage starts climbing

Options, roughly in order of effort:

1. **Find the cause first.** Check whether the increase tracks real users or an automated caller.
2. **Point uptime monitoring at `/health`**, which reads no data.
3. **Reduce what a page load fetches** — the application currently loads the whole portfolio on every
   open. Narrowing that would cut rows read substantially, but it is an application change.
4. **Move the embedded PDF and photographs out of the bundle into R2**, which also recovers bundle
   headroom.
5. **Upgrade the plan.** Workers Paid is a modest monthly fee and raises the request and D1
   allowances considerably. A deliberate decision, not an emergency measure.
