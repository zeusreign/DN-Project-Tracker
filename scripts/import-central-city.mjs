// Runs scripts/central-city-examples.mjs against a REMOTE environment through
// wrangler, which is the only way this machine reaches D1 and R2.
//
//   # dry run — reads only (the default)
//   node scripts/import-central-city.mjs --target prod
//
//   # apply — uploads the five images to R2 and inserts their metadata
//   node scripts/import-central-city.mjs --target prod --execute
//
// The importer is written against Worker bindings (env.DB, env.BUCKET). This
// supplies just the slice of that interface it uses: prepare/bind/all/first and
// batch on D1, put/delete on R2. Bound parameters are rendered as SQL literals
// with the workbook import's sqlLiteral(), and a batch runs as one --file
// execution so the photo row and its audit entry land together.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqlLiteral } from "./apply-workbook-import.mjs";
import { DATABASES } from "./workbook/tracker.mjs";
import { importCentralCityExamples } from "./central-city-examples.mjs";

const BUCKETS = { prod: "dnc-tracker-assets", test: "dnc-tracker-assets-dev" };
const arg = (name) => {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 ? process.argv[i + 1] : null;
};
const target = arg("target");
const apply = process.argv.includes("--execute");
if (!DATABASES[target]) {
  console.error("Usage: import-central-city.mjs --target <prod|test> [--execute]");
  process.exit(2);
}
const database = DATABASES[target];
const bucket = BUCKETS[target];
const work = mkdtempSync(join(tmpdir(), "central-city-"));

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function render(sql, params) {
  let i = 0;
  const out = sql.replace(/\?/g, () => sqlLiteral(params[i++]));
  if (i !== params.length) throw new Error("Parameter count mismatch for: " + sql);
  return out;
}

function query(sql) {
  const output = wrangler(["d1", "execute", database.id, "--remote", "--yes", "--json", "--command", sql]);
  return JSON.parse(output)[0].results;
}

const DB = {
  prepare(sql) {
    const statement = {
      params: [],
      bind(...params) { statement.params = params; return statement; },
      sql() { return render(sql, statement.params); },
      async all() { return { results: query(statement.sql()) }; },
      async first() { return query(statement.sql())[0] || null; },
    };
    return statement;
  },
  async batch(statements) {
    const file = join(work, "batch.sql");
    writeFileSync(file, statements.map((s) => s.sql() + ";").join("\n") + "\n");
    wrangler(["d1", "execute", database.id, "--remote", "--yes", "--file", file]);
    return [];
  },
};

const BUCKET = {
  async put(key, bytes, options = {}) {
    const file = join(work, "object");
    writeFileSync(file, bytes);
    const type = options.httpMetadata?.contentType;
    wrangler(["r2", "object", "put", `${bucket}/${key}`, "--file", file, "--remote",
      ...(type ? ["--content-type", type] : [])]);
  },
  async delete(key) {
    wrangler(["r2", "object", "delete", `${bucket}/${key}`, "--remote"]);
  },
};

console.log(`${apply ? "APPLYING" : "DRY RUN"} against ${database.name} / ${bucket}`);
try {
  const result = await importCentralCityExamples({ DB, BUCKET }, { apply });
  console.table(result);
} finally {
  rmSync(work, { recursive: true, force: true });
}
