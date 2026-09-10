# File storage (R2)

How profile photographs are stored. Backing them up is covered in
[BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

---

## 1. What R2 holds

| | |
|---|---|
| Bucket | `dnc-tracker-assets` |
| Binding in code | `env.BUCKET` |
| Class / location | Standard, automatic (resolved to `ENAM`) |
| Public access | **Disabled — must stay that way** |
| Contents | Profile photograph files only |

**R2 stores only the image bytes. All metadata stays in D1**, on `user_directory`:

| Column | Meaning |
|---|---|
| `avatar_key` | The object key in R2, e.g. `avatars/69/staff-photos-20260904-v1-tom` |
| `avatar_mime` | `image/png`, `image/jpeg` or `image/webp` |
| `avatar_version` | Cache-busting value used in the photo URL |

The Help PDF is **not** in R2 — it is compiled into the Worker bundle and served from
`/user-guide.pdf`.

---

## 2. ⚠ D1 is the only index of the bucket

`wrangler` (4.129.1) has **no `r2 object list` command** — only `get`, `put` and `delete`, each
needing an exact key. The only inventory of what the bucket should contain is the `avatar_key`
column in D1.

**If D1 were lost, you could not enumerate R2 using wrangler at all.** You would need the
S3-compatible API or the Cloudflare dashboard.

This is why any restore is always **D1 first, then R2**. See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

To list what should be in the bucket:

```sh
npx wrangler d1 execute DB --remote --yes --command \
  "SELECT avatar_key, avatar_mime FROM user_directory WHERE avatar_key IS NOT NULL ORDER BY avatar_key"
```

---

## 3. Keep the bucket private

Photo requests go through the application, not directly to R2. `handleAvatar()` enforces
authentication, CSRF, and ownership-or-admin before returning any bytes, and serves them with
`cache-control: private, no-store` and a restrictive content-security-policy.

**Enabling public access (an `r2.dev` domain) would bypass every one of those checks** and expose
photographs of identifiable staff. There is no reason to enable it.

---

## 4. How photographs got there

Seven staff photographs are compiled into the Worker bundle. On the **first page load by an
authenticated administrator**, `importRequestedProfilePhotos()` copies them into R2 and sets the
`avatar_key` columns. This has already happened.

Three properties are worth knowing, because this import **fails quietly**:

1. It matches on email **and exact first and last name**. A directory row whose name was edited will
   silently not match, and that person gets no photograph.
2. Each photograph has its own completion marker in `app_meta`
   (`profile_photo_import:<batch>-<key>`). Written only on success, so a failure retries on the next
   admin visit — but a success never re-runs.
3. Errors are caught, logged to `console.error`, and ignored. **Nothing appears in the UI.**

So verify by counting, never by looking for errors:

```sh
npx wrangler d1 execute DB --remote --yes --command \
  "SELECT COUNT(*) AS with_photo FROM user_directory WHERE avatar_key IS NOT NULL"
```

To force one photograph to re-import, delete its `app_meta` marker row and have an administrator
load the site again.

---

## 5. Uploads

Users upload their own photograph from the profile dialog.

| Check | Value |
|---|---|
| Accepted types | JPEG, PNG, WebP |
| Server size limit | **256 KB** |
| Validation | Magic-byte signature check, not just the declared MIME type |
| Who may write | The owner, or an administrator |
| Also required | Authentication and a CSRF token |

The browser resizes to a 256×256 JPEG before uploading, so real uploads land well under the limit.

> **Known inconsistency:** the profile dialog says *"up to 5 MB"*, but the server rejects anything
> over **256 KB** with HTTP 413. In normal use the browser resize makes this invisible. It is a
> wording bug in the UI, not a server fault, and has not been changed.

Uploads are atomic in the right order: the file is written to R2 first, then D1 metadata is updated.
If the metadata write fails the new object is deleted again, and the previous photograph is left
untouched.

---

## 6. If R2 is unavailable

Every use of `env.BUCKET` is guarded, so the application degrades rather than breaking:

| Endpoint | Without R2 |
|---|---|
| `GET`/`PUT` `/api/users/:id/avatar` | `503 "Photo storage is temporarily unavailable."` |
| Photograph import | Returns early, retries on the next admin visit |
| Everything else — projects, exports, Help PDF, roles, admin, audit | **Unaffected** |

If you see that 503 while the bucket clearly exists, the most likely cause is that you are on an
**old deployment URL**. Every past deployment stays reachable at its own
`<hash>.dnc-tracker-pilot.pages.dev` address and permanently keeps the bindings it was deployed
with — including having no R2 binding at all. Use `https://dnc.lagospm.com`.

---

## 7. Cost

Seven photographs total roughly 1.7 MB. R2's free allowance is 10 GB of storage with 1M Class-A and
10M Class-B operations per month. This usage is not close to any limit.
