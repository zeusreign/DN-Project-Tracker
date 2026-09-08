import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vite";

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
  ]) database.exec(readFileSync(new URL(migration, import.meta.url), "utf8"));
  return new D1Database(database);
}

function trackerPreview() {
  let worker;
  const DB = createPreviewDatabase();
  return {
    name: "tracker-preview",
    enforce: "pre",
    async configureServer(server) {
      const workerUrl = pathToFileURL(resolve(process.cwd(), "dist/server/index.js"));
      workerUrl.searchParams.set("preview", String(Date.now()));
      worker = (await import(workerUrl.href)).default;
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
          }), { DB, ADMIN_EMAILS: "preview@example.com", ALLOW_PLATFORM_AUTH: "true" }, {});
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

export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
  plugins: [trackerPreview()],
});
