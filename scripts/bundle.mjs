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

const bundled = [
  `const PROFILE_PHOTO_BATCH = ${JSON.stringify(PROFILE_PHOTO_BATCH)};`,
  `const PROFILE_PHOTOS = ${JSON.stringify(profilePhotos)};`,
  seed.replace("export const SEED_PROJECTS", "const SEED_PROJECTS"),
  styles.replace("export const STYLES", "const STYLES"),
  client.replace("export const CLIENT", "const CLIENT"),
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
