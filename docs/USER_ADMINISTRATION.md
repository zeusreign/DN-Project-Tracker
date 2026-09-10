# User administration

Creating, activating, changing and removing accounts. For what each role and scope *means*, see
[PERMISSIONS.md](PERMISSIONS.md).

---

## 1. The one thing to understand first

**The application never sends email.** There are no invitations and no self-service password reset.
The Admin screen says so plainly: *"Saving a user does not send an invitation email."*

So every account is created by an administrator who sets a temporary password and **passes it to the
person directly**. The user is then forced to change it at first sign-in.

There is also **no bootstrap password** anywhere in the code. The 73 people loaded from the source
workbook exist as directory entries with **no password and `pending` status** — none of them can
sign in until someone activates them.

---

## 2. Two different situations

| Situation | What you do |
|---|---|
| The person is **already in the directory** (came from the workbook) | **Activate** their existing record |
| The person is **new** | **Create** a new record |

Activating in place matters: it keeps their existing photograph and audit history attached to the
same id. Creating a duplicate record for someone who is already listed splits their history.

**Always look them up first:**

```sh
npx wrangler d1 execute DB --remote --yes --command \
  "SELECT id, first_name, last_name, user_email, role, account_status, site_access_status,
          CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_password
   FROM user_directory WHERE lower(last_name) = 'nielsen'"
```

---

## 3. The easy way — the Admin screen

**Admin → + Add user**, or **Edit** on an existing row.

| Field | Set it to |
|---|---|
| First / Last name | Their name |
| User ID and Email | Their email address (the User ID *is* the email) |
| Role | Admin, Editor or Viewer |
| Business Unit | Their unit, or All |
| **Account status** | **Active** |
| **Site access** | **Authorized** |
| Temporary password | 10+ characters, with upper, lower, digit and a special character |

> **Both statuses must be set.** Sign-in requires `account_status = 'active'` **and**
> `site_access_status = 'authorized'`. Setting only one produces *"The User ID or password is
> incorrect"* — which looks like a password problem and is not. This is the single most common
> confusion with this system.

Forced password change is automatic for admin-created users. You do not need to set it.

---

## 4. The scripted way

Useful for the first administrator, or when the UI is not available.
`pages-test/make-login.mjs` generates the SQL using the application's own password format.

**Activate someone who already exists:**

```sh
PILOT_ADMIN_PASSWORD='<a strong password>' \
  node pages-test/make-login.mjs 'BNielsen@delawarenorth.com' --force-change
```

**Create someone new:**

```sh
PILOT_ADMIN_PASSWORD='<a strong password>' \
  node pages-test/make-login.mjs 'newperson@example.com' --create First Last --force-change
```

Either prints one SQL statement. Run it:

```sh
npx wrangler d1 execute DB --remote --yes --command "<paste the statement>"
```

Notes:
- Passing the password via `PILOT_ADMIN_PASSWORD` keeps it **out of your shell history**.
- `--force-change` sets the forced password change. Omit it only for an account you must use
  immediately yourself.
- `--create` always makes an **admin** with scope **All**. Change the role afterwards if that is not
  what you want (see PERMISSIONS.md §5).

---

## 5. Always verify afterwards — this is not optional

**`wrangler d1 execute` can time out and print nothing at all.** One activation failed silently this
way and would have handed out a password for an account that was never activated. Do not trust the
absence of an error; re-read the row:

```sh
npx wrangler d1 execute DB --remote --yes --command \
  "SELECT id, user_email, role, account_status, site_access_status, must_change_password,
          CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS password_configured
   FROM user_directory WHERE id = <id>"
```

Expect `active`, `authorized`, `password_configured = 1`, `must_change_password = 1`.

You can also confirm the password is correct **without signing in as them** — useful because signing
in would consume their forced-change prompt. Recompute the hash from the stored salt and compare:

```sh
npx wrangler d1 execute DB --remote --yes --json --command \
  "SELECT password_hash, password_salt, password_iterations FROM user_directory WHERE id = <id>" \
| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{
  const r=JSON.parse(s.slice(s.indexOf("[")))[0].results[0];
  const pw=process.env.PILOT_ADMIN_PASSWORD;
  const salt=Buffer.from(r.password_salt,"base64");
  const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),{name:"PBKDF2"},false,["deriveBits"]);
  const b=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:r.password_iterations},k,256);
  console.log(Buffer.from(new Uint8Array(b)).toString("base64")===r.password_hash?"MATCH":"MISMATCH");})'
```

---

## 6. Passwords

| Rule | Value |
|---|---|
| Minimum length | 10 characters |
| Must include | upper case, lower case, a digit, a special character |
| Stored as | PBKDF2-SHA256, 100,000 iterations, 18-byte random salt |
| Retrievable? | **No.** One-way hash. The Admin screen shows only "Configured" or "Not set" |
| Expiry | Temporary passwords **do not expire** — issue them close to when the person will sign in |

**Never keep a list of live passwords.** Pass the temporary one to the person, then discard it. They
change it at first sign-in and after that nobody, including you, can recover it.

Tell every new user two things:
1. Their **User ID is their email address**, exactly as you entered it.
2. **Five failed attempts locks the account for 15 minutes.** Otherwise they will assume the site is
   broken.

---

## 7. Sessions

Sessions last **8 hours**, with a hard **24-hour** cap regardless of activity. Only a hash of the
session token is stored. Signing out deletes the session immediately.

Role and scope changes take effect on the user's next request — no need to make them sign in again.

---

## 8. Suspending or removing someone

**Preferred — suspend.** Immediate, reversible, and preserves their history:

```sh
npx wrangler d1 execute DB --remote --yes --command \
  "UPDATE user_directory SET account_status = 'suspended' WHERE id = <id>"
```

**Deleting** is permanent. Take a backup first (see BACKUP_AND_RESTORE.md):

```sh
npx wrangler d1 execute DB --remote --yes --command \
  "DELETE FROM user_directory WHERE id IN (<ids>)"
```

`login_sessions` cascades away automatically. `login_events` rows remain with a NULL user id, which
is deliberate — the sign-in record survives the account.

---

## 9. Before granting access

The directory entries loaded from the source workbook are contact records. **Being listed is not
authorisation to sign in.** Confirm who should be activated, with which role and which business
unit, before enabling an account.

Bear in mind what an account exposes: the system holds real staff names, corporate email addresses,
photographs, and real capital-project budgets. An **Admin** can additionally create users, reset
passwords and edit any project. If someone only needs to look, **Viewer** is the right role.

Keep the directory tidy — suspend or remove test accounts once they are no longer needed.
