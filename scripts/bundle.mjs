import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILE_PHOTOS, PROFILE_PHOTO_BATCH } from "../worker/profile-photos.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerRoot = resolve(projectRoot, "worker");
const outputRoot = resolve(projectRoot, "dist/server");

const [seed, styles, client, page, social, logo, logoutIcon, refreshIcon, downloadIcon, userGuide, exports, index] = await Promise.all([
  readFile(resolve(workerRoot, "seed.js"), "utf8"),
  readFile(resolve(workerRoot, "styles.js"), "utf8"),
  readFile(resolve(workerRoot, "client.js"), "utf8"),
  readFile(resolve(workerRoot, "page.js"), "utf8"),
  readFile(resolve(projectRoot, "assets/social-preview.png")),
  readFile(resolve(projectRoot, "assets/delaware-north-logo.png")),
  readFile(resolve(projectRoot, "assets/logout-icon.png")),
  readFile(resolve(projectRoot, "assets/refresh-icon.png")),
  readFile(resolve(projectRoot, "assets/download-icon.jpg")),
  readFile(resolve(projectRoot, "assets/DN_DC_Project_Tracker_User_Guide.pdf")),
  readFile(resolve(workerRoot, "exports.js"), "utf8"),
  readFile(resolve(workerRoot, "index.js"), "utf8"),
]);

const profilePhotos = await Promise.all(PROFILE_PHOTOS.map(async photo => ({
  ...photo,
  base64: (await readFile(resolve(projectRoot, "assets/profile-photos", photo.file))).toString("base64"),
})));

const [enhanced, enhancedStyles, projectImages] = await Promise.all(["enhanced.js", "enhanced-styles.js", "project-images.js"].map(name => readFile(resolve(workerRoot, name), "utf8")));

const workflows = await readFile(resolve(workerRoot, "enhanced-workflows.js"), "utf8");
const enhancedApi = await readFile(resolve(workerRoot, "enhanced-api.js"), "utf8");
// The assistant, in dependency order. Everything here is concatenated into one
// scope with its imports and exports stripped, so a file that reads a const
// from another must come after it. The legacy planner is included because
// ASSISTANT_LEGACY_PLANNER can switch it on for development; the route guard,
// not the bundle, is what keeps it out of production.
const assistantFiles = [
  "assistant-schema.js",
  "assistant-prompt.js",
  "assistant-sql.js",
  "assistant-model.js",
  "legacy/assistant-plan.js",
  "legacy/assistant-plan-prompt.js",
  "legacy/assistant-plan-model.js",
  "legacy/assistant-plan-route.js",
  "assistant-api.js",
];
// Single-line and braced multi-line imports both have to go, and a re-export
// (export { x } or export … from) is a module boundary that does not survive
// concatenation either.
const flatten = (source) => source
  .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];\n/gm, "")
  .replace(/^export\s*\{[^}]*\}\s*(from\s+["'][^"']+["'])?;\n/gm, "")
  .replace(/^export /gm, "");
const assistant = await Promise.all(
  assistantFiles.map(async (name) => flatten(await readFile(resolve(workerRoot, name), "utf8"))),
);
const photoModule = await readFile(resolve(workerRoot, "enhanced-photos.js"), "utf8");
const photoDrop = await readFile(resolve(workerRoot, "enhanced-drop.js"), "utf8");
const bundled = [
  photoDrop.replace("export const PHOTO_DROP", "const PHOTO_DROP"),
  photoModule.replace("export const PHOTO_MODULE", "const PHOTO_MODULE"),
  workflows.replace("export const ENHANCED_WORKFLOWS", "const ENHANCED_WORKFLOWS"),
  enhancedApi.replace(/^export /gm, ""),
  ...assistant,
  projectImages.replace("export const PROJECT_IMAGES", "const PROJECT_IMAGES"),
  enhanced.replace(/^import .*;\n/gm, "").replace("export const ENHANCED_CLIENT", "const ENHANCED_CLIENT"),
  enhancedStyles.replace("export const ENHANCED_STYLES", "const ENHANCED_STYLES"),
  `const PROFILE_PHOTO_BATCH = ${JSON.stringify(PROFILE_PHOTO_BATCH)};`,
  `const PROFILE_PHOTOS = ${JSON.stringify(profilePhotos)};`,
  seed.replace("export const SEED_PROJECTS", "const SEED_PROJECTS"),
  styles.replace(/^import .*;\n/gm, "").replace("export const STYLES", "const STYLES"),
  client.replace(/^import .*;\n/gm, "").replace("export const CLIENT", "const CLIENT"),
  page.replace("export const PAGE", "const PAGE"),
  `const OG_IMAGE_BASE64 = "${social.toString("base64")}";`,
  `const DN_LOGO_BASE64 = "${logo.toString("base64")}";`,
  `const LOGOUT_ICON_BASE64 = "${logoutIcon.toString("base64")}";`,
  `const REFRESH_ICON_BASE64 = "${refreshIcon.toString("base64")}";`,
  `const DOWNLOAD_ICON_BASE64 = "${downloadIcon.toString("base64")}";`,
  `const USER_GUIDE_BASE64 = "${userGuide.toString("base64")}";`,
  exports.replace(/^export /gm, ""),
  index.replace(/^import .*;\n/gm, ""),
].join("\n");

await mkdir(outputRoot, { recursive: true });
await writeFile(resolve(outputRoot, "index.js"), bundled);
