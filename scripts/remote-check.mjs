// Automated verification of a DEPLOYED environment.
//
// The repository had no such thing until now, and that was a real gap: the
// "63/63 checks passed" recorded for an earlier test deployment came from an
// ad-hoc run that no longer exists, so it could neither be reproduced nor
// audited. Everything here is reproducible from the package.
//
//   node scripts/remote-check.mjs https://<deployment>.pages.dev
//
// It is READ-ONLY by default: it signs nothing in, creates nothing, and writes
// nothing. That subset needs no credentials and is safe against any environment,
// production included.
//
// The authenticated half only runs when credentials are supplied, and needs two
// accounts that a person has provisioned deliberately:
//
//   DNC_EDITOR_USER / DNC_EDITOR_PASS   an All-scope Editor, password already set
//   DNC_VIEWER_USER / DNC_VIEWER_PASS   a scoped Viewer still on a TEMPORARY password
//   DNC_VIEWER_SCOPE                    that Viewer's business unit (default "Gaming")
//   DNC_VIEWER_NEWPASS                  replacement password it will be given
//
// Those two accounts are what makes DNC-007 and DNC-008 testable at all: both
// defects are about an account CHANGE in one tab, and the second account has to
// arrive in the temporary-password state. Use synthetic example.invalid accounts
// created for the run and deleted after it. NEVER point this half at production,
// and never at an account a person is really using — completing the password
// change consumes the temporary-password state and sets a new password.
//
// The browser half runs the deployed page itself: scripts/browser-harness.mjs
// parses the markup served by GET /, executes the real inline script inside it,
// and routes fetch() over the network to the deployment. Forms are submitted and
// buttons are clicked; no client function is called directly.

import assert from "node:assert/strict";
import { createBrowser } from "./browser-harness.mjs";

const ORIGIN = (process.argv[2] || "").replace(/\/+$/, "");
if (!ORIGIN) {
  console.error("usage: node scripts/remote-check.mjs <origin>   e.g. https://abc123.example.pages.dev");
  process.exit(2);
}

const editor = { user: process.env.DNC_EDITOR_USER, pass: process.env.DNC_EDITOR_PASS };
const viewer = {
  user: process.env.DNC_VIEWER_USER, pass: process.env.DNC_VIEWER_PASS,
  scope: process.env.DNC_VIEWER_SCOPE || "Gaming",
  next: process.env.DNC_VIEWER_NEWPASS,
};
const authenticated = Boolean(editor.user && editor.pass && viewer.user && viewer.pass && viewer.next);

const results = [];
const record = (status, name, detail) => results.push({ status, name, detail });
const check = async (name, fn) => {
  try { await fn(); record("PASS", name); }
  catch (error) { record("FAIL", name, error.message); }
};
const skip = (name, why) => record("SKIP", name, why);

const get = (path, headers = {}) => fetch(ORIGIN + path, { headers, redirect: "manual" });

// --- 1. Reachability and unauthenticated security posture --------------------
await check("GET /health returns 200", async () => assert.equal((await get("/health")).status, 200));
await check("GET / serves the application page", async () => {
  const response = await get("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
});
for (const path of ["/api/bootstrap", "/api/projects", "/api/updates", "/api/admin", "/api/session"]) {
  await check(`anonymous ${path} is refused with 401`, async () =>
    assert.equal((await get(path)).status, 401));
}
for (const path of ["/export.csv", "/export.tsv", "/export.xlsx", "/api/export.csv"]) {
  await check(`anonymous ${path} is refused with 401`, async () =>
    assert.equal((await get(path)).status, 401));
}
// If this one ever passes with a 200, anyone can become an administrator by
// sending a header. It is the single most important check in this file.
await check("ALLOW_PLATFORM_AUTH is off (header bypass returns 401)", async () =>
  assert.equal((await get("/api/bootstrap", {
    "oai-authenticated-user-id": "probe",
    "oai-authenticated-user-email": "probe@example.invalid",
    "oai-authenticated-user-full-name": "Probe",
  })).status, 401));

// --- 2. Which build is actually deployed -------------------------------------
const page = await (await get("/")).text();
const FIX_MARKERS = [
  ["DNC-001/002  setMoneyValue + collectMoney", ["setMoneyValue", "collectMoney"]],
  ["DNC-006      showPasswordChangeOnly", ["showPasswordChangeOnly"]],
  ["DNC-007      clearAccountData", ["clearAccountData"]],
  ["DNC-008      applyCapabilities + canDownload", ["applyCapabilities", "canDownload"]],
];
for (const [label, markers] of FIX_MARKERS) {
  await check(`served client carries ${label}`, async () => {
    for (const marker of markers) assert.ok(page.includes(marker), `${marker} is missing`);
  });
}

// --- 3. The deployed page, executed, signed out ------------------------------
const anonymous = await createBrowser({
  page, origin: ORIGIN, handler: (request) => fetch(request, { redirect: "manual" }),
}).start();
await check("deployed page boots to the sign-in screen", async () => {
  assert.equal(anonymous.byId("signedOut").hidden, false);
  assert.equal(anonymous.byId("workspace").hidden, true);
});
await check("its first call really was a 401 bootstrap over the network", async () => {
  const boot = anonymous.requests.filter((entry) => entry.path === "/api/bootstrap").at(-1);
  assert.ok(boot, "no bootstrap request was made");
  assert.equal(boot.status, 401);
});
await check("signed out, no account control is exposed", async () => {
  for (const id of ["exportBtn", "columnsBtn", "addBtn", "adminNav", "logoutBtn", "changePasswordBtn", "profileBtn"]) {
    assert.equal(anonymous.isVisible(id), false, `${id} is visible while signed out`);
  }
});
await check("signed out, no project data is rendered", async () => {
  for (const id of ["projectsBody", "costBody", "riskBody", "developmentBody", "businessUnitBar", "kpiActive", "userChip"]) {
    assert.equal(anonymous.byId(id).textContent, "", `${id} is not empty`);
  }
});

// --- 4. The account transition, against the deployment -----------------------
const AUTH_NAMES = [
  "Editor signs in and sees project data",
  "Editor has Download and Choose Columns",
  "sign-out clears the previous account's rendered data (DNC-007)",
  "temporary-password Viewer is refused the workspace payload (DNC-003)",
  "the password form is offered (DNC-006)",
  "the previous Editor's data is not on screen behind it (DNC-007)",
  "no control is reachable before the password is replaced",
  "Download returns with no refresh (DNC-008)",
  "Choose Columns returns with no refresh (DNC-008)",
  "a Viewer's download actually succeeds",
  "a Viewer still cannot write or reach Admin",
  "the Viewer sees only its own business unit",
];

if (!authenticated) {
  for (const name of AUTH_NAMES) skip(name, "no credentials supplied");
} else {
  const browser = await createBrowser({
    page, origin: ORIGIN, handler: (request) => fetch(request, { redirect: "manual" }),
  }).start();
  const signInAs = async (username, password) => {
    browser.type("loginUsername", username);
    browser.type("loginPassword", password);
    await browser.fire("loginForm", "submit").results;
    await browser.settle();
  };
  const lastStatus = (path) => browser.requests.filter((entry) => entry.path === path).at(-1)?.status;
  const ACCOUNT_CONTAINERS = [
    "projectsHead", "projectsBody", "costHead", "costBody", "riskHead", "riskBody",
    "developmentHead", "developmentBody", "businessUnitBar", "unitSummary", "attentionList",
    "highRiskCards", "portfolioLegend", "projectCount", "developmentCount", "unitSelectionText",
    "kpiActive", "kpiBudget", "kpiHigh", "kpiDevelopment", "userChip",
  ];

  await signInAs(editor.user, editor.pass);
  let marker = null;
  await check(AUTH_NAMES[0], async () => {
    assert.equal(lastStatus("/api/bootstrap"), 200, "the Editor did not reach the workspace");
    assert.equal(browser.byId("workspace").hidden, false);
    const rows = browser.byId("projectsBody").textContent;
    assert.ok(rows.length > 0, "the Editor sees no projects at all");
    // A project outside the Viewer's scope, named from what the Editor can see.
    const units = browser.byId("businessUnitBar").querySelectorAll("[data-business-unit]")
      .map((button) => button.dataset.businessUnit);
    assert.ok(units.includes(viewer.scope), `the Editor cannot see the ${viewer.scope} unit`);
    assert.ok(units.length > 2, "the Editor is not All-scope: only one business unit is visible");
    marker = browser.byId("projectsBody").querySelectorAll("[data-details]")
      .map((button) => button.textContent).find(Boolean);
    assert.ok(marker, "could not read a project name to use as the marker");
  });
  await check(AUTH_NAMES[1], async () => {
    assert.equal(browser.isVisible("exportBtn"), true);
    assert.equal(browser.isVisible("columnsBtn"), true);
  });

  await browser.fire("logoutBtn", "click").results;
  await browser.settle();
  await check(AUTH_NAMES[2], async () => {
    assert.equal(browser.byId("workspace").hidden, true);
    for (const id of ACCOUNT_CONTAINERS) {
      assert.equal(browser.byId(id).textContent, "", `${id} still holds the previous account's content`);
    }
  });

  await signInAs(viewer.user, viewer.pass);
  const gated = lastStatus("/api/bootstrap") === 428;
  await check(AUTH_NAMES[3], async () => {
    assert.equal(lastStatus("/api/bootstrap"), 428,
      "the Viewer was not in the temporary-password state — provision a fresh one");
  });
  if (!gated) {
    for (const name of AUTH_NAMES.slice(4)) {
      skip(name, "the Viewer account was not on a temporary password");
    }
  } else {
    await check(AUTH_NAMES[4], async () => assert.equal(browser.byId("passwordDialog").open, true));
    await check(AUTH_NAMES[5], async () => {
      assert.equal(browser.byId("workspace").hidden, true, "the workspace was revealed during the forced change");
      if (marker) {
        assert.doesNotMatch(browser.document.body.textContent,
          new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
          "the previous Editor's project is still in the document");
      }
    });
    await check(AUTH_NAMES[6], async () => {
      for (const id of ["addBtn", "exportBtn", "columnsBtn", "adminNav", "saveActivityBtn"]) {
        assert.equal(browser.isVisible(id), false, `${id} is reachable before the password is replaced`);
      }
    });

    browser.type("currentPassword", viewer.pass);
    browser.type("newPassword", viewer.next);
    browser.type("newPasswordConfirm", viewer.next);
    await browser.fire("passwordForm", "submit").results;
    await browser.settle();

    await check(AUTH_NAMES[7], async () => {
      assert.equal(browser.byId("passwordDialog").open, false, "the password change did not complete");
      assert.equal(lastStatus("/api/bootstrap"), 200, "the workspace payload was not released");
      assert.equal(browser.isVisible("exportBtn"), true, "Download is still hidden");
    });
    await check(AUTH_NAMES[8], async () =>
      assert.equal(browser.isVisible("columnsBtn"), true, "Choose Columns is still hidden"));
    await check(AUTH_NAMES[9], async () => {
      const response = await fetch(ORIGIN + "/api/export.csv", {
        headers: { cookie: browser.cookie }, redirect: "manual",
      });
      assert.equal(response.status, 200, "a Viewer was offered Download but refused the file");
    });
    await check(AUTH_NAMES[10], async () => {
      assert.equal(browser.isVisible("addBtn"), false);
      assert.equal(browser.isVisible("saveActivityBtn"), false);
      assert.equal(browser.isVisible("adminNav"), false);
      const admin = await fetch(ORIGIN + "/api/admin", { headers: { cookie: browser.cookie }, redirect: "manual" });
      assert.equal(admin.status, 403, "a Viewer reached the admin payload");
    });
    await check(AUTH_NAMES[11], async () => {
      assert.deepEqual(
        browser.byId("businessUnitBar").querySelectorAll("[data-business-unit]")
          .map((button) => button.dataset.businessUnit),
        ["All", viewer.scope], "the unit switcher shows units outside the Viewer's scope");
      if (marker) {
        assert.doesNotMatch(browser.document.body.textContent,
          new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
          "the Viewer received an out-of-scope project from the previous account");
      }
    });
  }
}

const passed = results.filter((entry) => entry.status === "PASS").length;
const failed = results.filter((entry) => entry.status === "FAIL").length;
const skipped = results.filter((entry) => entry.status === "SKIP").length;
for (const entry of results) {
  console.log(`  ${entry.status}  ${entry.name}${entry.detail ? " — " + entry.detail : ""}`);
}
console.log(`\n${passed}/${passed + failed} checks passed, ${failed} failed, ${skipped} skipped`);
console.log(`origin: ${ORIGIN}`);
console.log(`mode:   ${authenticated ? "credential-free + authenticated" : "credential-free only"}`);
if (skipped) console.log("Skipped checks are NOT passes. They are coverage this run did not have.");
process.exit(failed === 0 ? 0 : 1);
