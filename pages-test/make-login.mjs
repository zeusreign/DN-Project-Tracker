// Generates a local sign-in for the Pages dev database.
// Mirrors passwordRecord() in worker/index.js: PBKDF2-SHA256, 100k iterations, 18-byte salt.
const [email = "administrator@example.invalid", password = "PilotAdmin1!"] = process.argv.slice(2);
const b64 = bytes => Buffer.from(bytes).toString("base64");
const salt = new Uint8Array(18);
crypto.getRandomValues(salt);
const saltB64 = b64(salt);
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits(
  { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
const hash = b64(new Uint8Array(bits));
const e = email.replace(/'/g, "''");
console.log(
  `UPDATE user_directory SET password_hash='${hash}', password_salt='${saltB64}', ` +
  `password_iterations=100000, password_algorithm='pbkdf2-sha256', ` +
  `password_changed_at=datetime('now'), must_change_password=0, ` +
  `account_status='active', site_access_status='authorized', ` +
  `failed_login_count=0, locked_until=NULL ` +
  `WHERE lower(user_email)='${e.toLowerCase()}';`
);
