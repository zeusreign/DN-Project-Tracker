import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { defineConfig, loadEnv } from "vite";

class D1Statement {
  constructor(database, sql) {
    this.statement = database.prepare(sql);
    this.values = [];
  }
  bind(...values) { this.values = values; return this; }
  first() { return Promise.resolve(this.statement.get(...this.values) || null); }
  all() { return Promise.resolve({ results: this.statement.all(...this.values) }); }
  run() { return Promise.resolve(this.statement.run(...this.values)); }
}

class D1Database {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

function createPreviewDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const migration of [
    "drizzle/0000_dnc_project_hub.sql",
    "drizzle/0001_workbook_structure_and_roles.sql",
    "drizzle/0002_user_directory.sql",
    "drizzle/0003_development_pipeline_and_directory.sql",
    "drizzle/0004_pilot_authentication.sql",
    "drizzle/0005_profile_photos.sql",
  ]) database.exec(readFileSync(new URL(migration, import.meta.url), "utf8"));
  return new D1Database(database);
}

// LOCAL PREVIEW ONLY. The shipped package contains no credentials by design
// (PILOT_CREDENTIALS is empty), so no seeded account can sign in. This creates one
// administrator in the throwaway in-memory database using the application's own
// PBKDF2-SHA256 format, mirroring passwordRecord() at worker/index.js:210.
//
// No credentials are hardcoded. Both values come from the environment, read out
// of the gitignored `.env` file (see .env.example). If PREVIEW_ADMIN_PASSWORD is
// not set, no account is created and the preview simply shows the sign-in screen
// — which is the shipped behaviour. This never runs in a deployed Worker: it is
// invoked from configureServer(), which only exists in the Vite dev server, and
// the database it writes to is `:memory:`.
function previewAdminFrom(env) {
  const email = env.PREVIEW_ADMIN_EMAIL;
  const password = env.PREVIEW_ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

async function bootstrapPreviewAdmin(db, admin) {
  const saltBytes = new Uint8Array(18);
  crypto.getRandomValues(saltBytes);
  const salt = Buffer.from(saltBytes).toString("base64");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(admin.password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 100000 }, key, 256
  );
  await db.prepare(`
    INSERT INTO user_directory (
      user_email, username, first_name, last_name, role, title, department, company,
      business_unit_scope, account_status, site_access_status, notes, created_by,
      password_hash, password_salt, password_iterations, password_algorithm,
      password_changed_at, must_change_password
    ) VALUES (?, ?, 'Test', 'User', 'admin', 'Local preview administrator',
      'Design & Construction', 'Delaware North', 'All', 'active', 'authorized',
      'Local preview account. Not part of the supplied directory.', 'local-preview',
      ?, ?, 100000, 'pbkdf2-sha256', datetime('now'), 0)
  `).bind(
    admin.email, admin.email,
    Buffer.from(new Uint8Array(bits)).toString("base64"), salt
  ).run();
}

function trackerPreview(previewAdmin) {
  let worker;
  const DB = createPreviewDatabase();
  return {
    name: "tracker-preview",
    enforce: "pre",
    async configureServer(server) {
      const workerUrl = pathToFileURL(resolve(process.cwd(), "dist/server/index.js"));
      workerUrl.searchParams.set("preview", String(Date.now()));
      worker = (await import(workerUrl.href)).default;
      if (previewAdmin) {
        await bootstrapPreviewAdmin(DB, previewAdmin);
        console.log(`\n  Local preview sign-in: ${previewAdmin.email}\n`);
      } else {
        console.log("\n  No preview administrator created. Set PREVIEW_ADMIN_EMAIL and"
          + "\n  PREVIEW_ADMIN_PASSWORD in .env to enable local sign-in (see .env.example).\n");
      }
      server.middlewares.use(async (request, response, next) => {
        try {
          const method = request.method || "GET";
          const chunks = [];
          if (method !== "GET" && method !== "HEAD") {
            for await (const chunk of request) chunks.push(chunk);
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(request.headers)) {
            if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
            else if (value != null) headers.set(name, value);
          }
          headers.set("oai-authenticated-user-id", "responsive-preview");
          headers.set("oai-authenticated-user-email", "preview@example.com");
          headers.set("oai-authenticated-user-full-name", "Responsive Preview");
          const result = await worker.fetch(new Request(`http://terminal.local:4173${request.url || "/"}`, {
            method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          }), { DB, ADMIN_EMAILS: "preview@example.com" }, {});
          response.statusCode = result.status;
          result.headers.forEach((value, name) => response.setHeader(name, value));
          response.end(Buffer.from(await result.arrayBuffer()));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // loadEnv reads .env / .env.local, which are gitignored. The third argument ""
  // lifts the usual VITE_ prefix restriction so the preview can read these
  // server-side-only values. They never reach the browser bundle.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local", "localhost"],
    },
    plugins: [trackerPreview(previewAdminFrom(env))],
  };
});
