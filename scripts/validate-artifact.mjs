import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");
const clientPath = resolve(projectRoot, "worker/client.js");
const pagePath = resolve(projectRoot, "worker/page.js");
const stylesPath = resolve(projectRoot, "worker/styles.js");

const [source, manifest, client, page, styles] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
  readFile(clientPath, "utf8"),
  readFile(pagePath, "utf8"),
  readFile(stylesPath, "utf8"),
]);
JSON.parse(manifest);

assert.match(client, /initiative_number",label:"Initiative #"/);
assert.match(client, /data-activity="'\+p\.id\+'"/);
assert.match(page, /Change password/);
assert.match(page, /click-to-edit, click-out save and double-click history/);
assert.match(styles, /max-width:1920px/);

// A data URL forces ESM parsing even though the generated output has no package.json.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);

console.log("Artifact is valid ESM and exports default.fetch");
