import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { SEED_PROJECTS } from "../worker/seed.js";
import { PROFILE_PHOTOS } from "../worker/profile-photos.js";

assert.ok(SEED_PROJECTS.length >= 5, "Synthetic review records are required");
assert.ok(SEED_PROJECTS.every(project => project.source_key.startsWith("Sample:")));
assert.equal(PROFILE_PHOTOS.length, 0, "Employee photographs must not be included");

const database = new DatabaseSync(":memory:");
for (const name of [
  "0000_dnc_project_hub.sql",
  "0001_workbook_structure_and_roles.sql",
  "0002_user_directory.sql",
  "0003_development_pipeline_and_directory.sql",
  "0004_pilot_authentication.sql",
  "0005_profile_photos.sql",
]) {
  database.exec(await readFile(new URL("../drizzle/" + name, import.meta.url), "utf8"));
}

assert.ok(database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'").get().count >= 8);
console.log("Sanitized review package smoke test passed");
