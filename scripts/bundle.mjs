import { Script } from "node:vm";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILE_PHOTOS, PROFILE_PHOTO_BATCH } from "../worker/profile-photos.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerRoot = resolve(projectRoot, "worker");
const production = process.argv.includes('--production');
const outputRoot = resolve(projectRoot, production ? 'production-dist' : 'dist/server');
function deploymentText(text){return production?text
 .replaceAll('Current private Enhanced Tracker database','Current authorized DNC Tracker database')
 .replaceAll('Only photos stored in this private Tracker are included. Live DNC photo files have not been transferred.','Only photos stored for your authorized projects are included.')
 .replaceAll('This is the private preview database.','Data follows your current Tracker permissions.')
 .replaceAll('This preview is separate from the live DNC site.','')
 .replaceAll('this preview is separate from the live DNC site.','')
 .replaceAll('the private Tracker database','your authorized Tracker database')
 .replaceAll('current private Tracker records','current authorized Tracker records')
 .replaceAll('About this preview','About Ask the Tracker')
 .replaceAll('Private Review | ','')
 .replace(/<div class="preview-notice" role="note">[\s\S]*?<\/div>/,''):text;}


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
const photoModule = await readFile(resolve(workerRoot, "enhanced-photos.js"), "utf8");
const photoDrop = await readFile(resolve(workerRoot, "enhanced-drop.js"), "utf8");
const reporting = await readFile(resolve(workerRoot, 'reporting.js'),'utf8');
const reportingClient = await readFile(resolve(workerRoot, 'reporting-client.js'),'utf8');
const workbookLayout = await readFile(resolve(workerRoot, 'workbook-layout.js'),'utf8');
const workbookColors = await readFile(resolve(workerRoot, 'workbook-colors.js'),'utf8');
const workbookHistoryData = await readFile(resolve(workerRoot, 'workbook-history-data.js'),'utf8');
const workbookHistory = await readFile(resolve(workerRoot, 'workbook-history.js'),'utf8');
const signatureFont = await readFile(resolve(projectRoot,'assets/fonts/Z003-MediumItalic.otf'));
const signatureLicense = await readFile(resolve(projectRoot,'assets/fonts/LICENSE-Z003.txt'),'utf8');
const askAssets={};
for(const key of ['conversation-time.js','assistant-core.js','assistant-ui.js','hosted-connection.js','table-exports.js','realtime-voice.js','conversation-history.js','shell.html','tracker.css','vendor/exceljs.min.js','vendor/pdf-lib.min.js','vendor/exceljs-LICENSE','vendor/pdf-lib-LICENSE.md'])askAssets[key]=deploymentText(await readFile(resolve(workerRoot,'ask',key),'utf8'));
// Browser assets are embedded as text; the Worker parser cannot validate them.
for(const [name,source] of Object.entries(askAssets))if(name.endsWith('.js'))new Script(source.replace(/^export /gm,''),{filename:'ask/'+name});
const askServer=await readFile(resolve(workerRoot,'ask-tracker.js'),'utf8');
const bundled = [
  'const ASK_ASSETS = '+JSON.stringify(askAssets)+';',
  'const ASK_STYLE_VERSION = '+JSON.stringify(createHash('sha256').update(askAssets['tracker.css']).digest('hex').slice(0,12))+';',
  deploymentText(askServer),
  workbookColors.replace(/^export /gm,''),
  production ? 'const WORKBOOK_HISTORY = {version:"production-no-auto-import",updates:[],review:[],summary:[]};' : workbookHistoryData.replace(/^export /gm,''),
  workbookHistory.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),
  workbookLayout.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),
  reporting.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),
  reportingClient.replace('export const REPORTING_CLIENT','const REPORTING_CLIENT'),
  photoDrop.replace("export const PHOTO_DROP", "const PHOTO_DROP"),
  photoModule.replace("export const PHOTO_MODULE", "const PHOTO_MODULE"),
  workflows.replace("export const ENHANCED_WORKFLOWS", "const ENHANCED_WORKFLOWS"),
  enhancedApi.replace(/^export /gm, ""),
  projectImages.replace("export const PROJECT_IMAGES", "const PROJECT_IMAGES"),
  enhanced.replace(/^import .*;\n/gm, "").replace("export const ENHANCED_CLIENT", "const ENHANCED_CLIENT"),
  enhancedStyles.replace("export const ENHANCED_STYLES", "const ENHANCED_STYLES"),
  `const PROFILE_PHOTO_BATCH = ${JSON.stringify(PROFILE_PHOTO_BATCH)};`,
  `const PROFILE_PHOTOS = ${JSON.stringify(profilePhotos)};`,
  production ? 'const SEED_PROJECTS = [];' : seed.replace("export const SEED_PROJECTS", "const SEED_PROJECTS"),
  styles.replace(/^import .*;\n/gm, "").replace("export const STYLES", "const STYLES"),
  client.replace(/^import .*;\n/gm, "").replace("export const CLIENT", "const CLIENT"),
  deploymentText(page).replace("export const PAGE", "const PAGE"),
  `const OG_IMAGE_BASE64 = "${social.toString("base64")}";`,
  `const DN_LOGO_BASE64 = "${logo.toString("base64")}";`,
  `const LOGOUT_ICON_BASE64 = "${logoutIcon.toString("base64")}";`,
  `const REFRESH_ICON_BASE64 = "${refreshIcon.toString("base64")}";`,
  `const DOWNLOAD_ICON_BASE64 = "${downloadIcon.toString("base64")}";`,
  `const USER_GUIDE_BASE64 = "${userGuide.toString("base64")}";`,
  `const SIGNATURE_FONT_BASE64 = "${signatureFont.toString("base64")}";`,
  `const SIGNATURE_FONT_LICENSE = ${JSON.stringify(signatureLicense)};`,
  exports.replace(/^export /gm, ""),
  index.replace(/^import .*;\n/gm, "").replace("const DNC_REVIEW_BUILD = true;", "const DNC_REVIEW_BUILD = "+(!production)+";"),
].join("\n");

await mkdir(outputRoot, { recursive: true });
await writeFile(resolve(outputRoot, production ? "_worker.js" : "index.js"), bundled);
console.log(production ? "Production bundle: preview seeds and platform identity disabled." : "Review bundle created.");
