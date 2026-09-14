// Generates the SQL to provision a sign-in for the tracker.
// Mirrors passwordRecord() in worker/index.js: PBKDF2-SHA256, 100k iterations, 18-byte salt.
//
// The delivered package ships with no working credentials (PILOT_CREDENTIALS is
// empty and every seeded directory entry is 'pending' with no password hash), so
// the first administrator must be provisioned directly against D1.
//
//   Activate an EXISTING seeded person:
//     node pages-test/make-login.mjs 'tlagos@delawarenorth.com' 'TempPass123!'
//
//   CREATE a new administrator not present in the seeded directory:
//     node pages-test/make-login.mjs 'you@example.com' 'TempPass123!' --create Faheem Malik
//
//   Force a password change at first sign-in (recommended for real accounts):
//     ... --force-change
//
// To keep the password out of shell history, omit it and set PILOT_ADMIN_PASSWORD:
//     PILOT_ADMIN_PASSWORD='...' node pages-test/make-login.mjs 'you@example.com' --create Faheem Malik
//
// Pipe the printed statement to:
//   npx wrangler d1 execute DB --remote --yes --command "<statement>"

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith("--")));
const positional = argv.filter(a => !a.startsWith("--"));

const createIndex = argv.indexOf("--create");
const create = createIndex !== -1;
const forceChange = flags.has("--force-change");

const email = positional[0];
// The password is positional[1] unless it was supplied via the environment.
const envPassword = process.env.PILOT_ADMIN_PASSWORD;
const password = envPassword || positional[1];

// With --create, the two names follow the flag.
const firstName = create ? (argv[createIndex + 1] || "Pilot") : null;
const lastName = create ? (argv[createIndex + 2] || "Administrator") : null;

if (!email || !password) {
  console.error("Usage: node pages-test/make-login.mjs <email> <password> [--create First Last] [--force-change]");
  console.error("       (or set PILOT_ADMIN_PASSWORD and omit the password argument)");
  process.exit(1);
}

// validatePassword() in worker/index.js enforces this whenever the password is
// changed through the UI. Warn rather than block: seeding the hash directly
// bypasses the check, which is legitimate for a throwaway local database but a
// bad idea for anything reachable.
const weak = password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password)
  || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password);
if (weak) {
  console.error("WARNING: this password does not satisfy validatePassword() "
    + "(10+ chars, upper, lower, digit, special). The account will work, but the "
    + "user cannot re-set this value through the UI.");
}

const b64 = bytes => Buffer.from(bytes).toString("base64");
const salt = new Uint8Array(18);
crypto.getRandomValues(salt);
const saltB64 = b64(salt);
const key = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits(
  { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
const hash = b64(new Uint8Array(bits));

const q = value => String(value).replace(/'/g, "''");
const e = q(email.toLowerCase());
const mustChange = forceChange ? 1 : 0;

if (create) {
  console.log(
    `INSERT INTO user_directory (` +
    `user_email, username, first_name, last_name, role, title, department, company, ` +
    `business_unit_scope, account_status, site_access_status, notes, created_by, ` +
    `password_hash, password_salt, password_iterations, password_algorithm, ` +
    `password_changed_at, must_change_password, failed_login_count` +
    `) VALUES (` +
    `'${e}', '${e}', '${q(firstName)}', '${q(lastName)}', 'admin', ` +
    `'Pilot administrator', 'Design & Construction', 'Delaware North', 'All', ` +
    `'active', 'authorized', 'Provisioned for pilot deployment verification.', 'pilot-bootstrap', ` +
    `'${hash}', '${saltB64}', 100000, 'pbkdf2-sha256', datetime('now'), ${mustChange}, 0);`
  );
} else {
  console.log(
    `UPDATE user_directory SET password_hash='${hash}', password_salt='${saltB64}', ` +
    `password_iterations=100000, password_algorithm='pbkdf2-sha256', ` +
    `password_changed_at=datetime('now'), must_change_password=${mustChange}, ` +
    `account_status='active', site_access_status='authorized', ` +
    `failed_login_count=0, locked_until=NULL ` +
    `WHERE lower(user_email)='${e}';`
  );
}
