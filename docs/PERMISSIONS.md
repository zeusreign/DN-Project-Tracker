# Roles and business-unit permissions

Who can see and change what. To create or activate an account, see
[USER_ADMINISTRATION.md](USER_ADMINISTRATION.md).

---

## 1. Two independent controls

Access is decided by **two separate things**, and both apply:

| Control | Question it answers | Where it lives |
|---|---|---|
| **Role** | *What kind of action* may this person take? | `user_directory.role` |
| **Business-unit scope** | *Which projects* may they touch? | `user_directory.business_unit_scope` |

A Gaming Editor may edit — but only Gaming projects. A Viewer scoped to "All" sees everything —
but can change nothing.

---

## 2. Roles

| Role | View | Edit projects | Admin screen (users, audit) |
|---|---|---|---|
| `admin` | Yes | Yes | Yes |
| `editor` | Yes | Yes | No |
| `viewer` | Yes | **No** | No |

- A Viewer's write attempt returns **403**, whatever their scope.
- Only `admin` reaches `/api/admin`. Editors and Viewers get 403.
- **Admins always have full cross-unit access**, regardless of what their scope field says.

---

## 3. Business-unit scope

Stored in `user_directory.business_unit_scope`, a text column:

| Value | Meaning |
|---|---|
| `All` (the default) | No restriction |
| `Gaming` | Only Gaming projects |
| `Gaming, Corporate` | Both units — comma-separated |

Unit names must match `business_units.name` exactly: **Corporate, Patina, Gaming,
Parks & Resorts, Sportservice**.

> The Admin screen's dropdown only offers a **single** unit or "All". Multi-unit scopes work
> correctly in the application but currently have to be set directly in the database:
> ```sh
> npx wrangler d1 execute DB --remote --yes --command \
>   "UPDATE user_directory SET business_unit_scope = 'Gaming, Corporate' WHERE id = <id>"
> ```

---

## 4. What scope actually restricts

Enforcement is **server-side**, so it cannot be bypassed by changing a URL, editing an id, or
calling the API directly.

| Area | Behaviour for a scoped user |
|---|---|
| Portfolio, Projects, Development Pipeline, Cost Control, Risk Register | Only their units' projects appear |
| Portfolio summary and totals | Calculated from their units only |
| Recent activity feed | Only their units |
| Project history (`/api/projects/:id/history`) | Own unit `200`; another unit **`404`** |
| Editing, activity updates, development edits | Another unit **`404`** |
| Creating a project | Another unit **`403`** |
| Promoting a Development record | Source must be in scope; destination unit must be too |
| **CSV / TSV / XLSX export** | Contains **only** their units' rows |

### Why 404 and not 403?

Asking about another unit's project returns **404 "not found"**, not 403 "forbidden". A 403 would
confirm that the id exists, letting someone map another unit's projects by trying ids. 404 reveals
nothing. Role denials still use 403, because those say nothing about the data.

---

## 5. Changing someone's access

Either edit the user in **Admin → Edit**, or:

```sh
npx wrangler d1 execute DB --remote --yes --command \
  "UPDATE user_directory SET role = 'viewer', business_unit_scope = 'Gaming' WHERE id = <id>"
```

Changes take effect on the user's **next request** — scope is re-read from the database every time,
never trusted from the browser. There is no need to make them sign in again.

---

## 6. Checking who has what

```sh
npx wrangler d1 execute DB --remote --yes --command \
  "SELECT id, user_email, role, business_unit_scope, account_status FROM user_directory WHERE account_status = 'active' ORDER BY role, id"
```

---

## 7. Verifying enforcement

Do not take this on trust — it is the control that protects client data. A repeatable test lives in
[TESTING.md](TESTING.md) and covers Admin, Gaming Viewer, Gaming Editor, another-unit Editor and a
multi-unit user, including direct-API bypass attempts and export contents.

Quick manual check with a scoped account signed in:

```sh
# replace <other-unit-project-id> with a project outside their scope
curl -s -o /dev/null -w "%{http_code}\n" -b "dnc_session=<their cookie>" \
  https://dnc.lagospm.com/api/projects/<other-unit-project-id>/history     # expect 404
```

---

## 8. Known limitation

**The Admin screen dropdown is single-select** (§3). Everything else about multi-unit scope works;
only assignment through the UI is limited. Changing that is a client-side change to
`worker/client.js` and has not been made.
