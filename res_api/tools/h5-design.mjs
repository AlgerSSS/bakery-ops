import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  buildSeeYouOftenHome,
  parseJsonField,
  validateComponentTree,
} from "../lib/h5-design-layout.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RES_API_DIR = path.resolve(SCRIPT_DIR, "..");
const BASE_URL = "https://bo.sea.restosuite.ai";
const APP_ID = "1991043406914285569";
const APP_TYPE = 3;
const FORMAL_SOURCE_TYPE = 1;
const DRAFT_SOURCE_TYPE = 3;
const STORAGE_STATE = path.join(RES_API_DIR, "storageState.json");
const OUTPUT_ROOT = path.join(RES_API_DIR, "output", "h5-design");
const RELEASE_ENDPOINT = "/ordering/config/decoration/release";

function assertSafeEndpoint(endpoint) {
  if (endpoint === RELEASE_ENDPOINT || endpoint.endsWith("/release")) {
    throw new Error(`Blocked forbidden endpoint: ${endpoint}`);
  }
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

async function withAuthenticatedPage(callback) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  let capturedHeaders = null;

  page.on("request", (request) => {
    const headers = request.headers();
    if (!capturedHeaders && headers["vulcan-token"]) {
      capturedHeaders = headers;
    }
  });

  try {
    await page.goto(
      `${BASE_URL}/online-designer/designer?appId=${APP_ID}&sourceType=${FORMAL_SOURCE_TYPE}&appType=${APP_TYPE}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1_500);

    if (page.url().includes("/login")) {
      throw new Error("RES login state expired; refresh storageState.json before continuing.");
    }
    if (!capturedHeaders) {
      throw new Error("RES authenticated request headers were not available.");
    }

    const api = async (endpoint, data) => {
      assertSafeEndpoint(endpoint);
      const result = await page.evaluate(
        async ({ endpoint: requestEndpoint, data: requestData, originalHeaders }) => {
          const forbidden = new Set(["host", "connection", "content-length", "cookie"]);
          const headers = {};
          for (const [key, value] of Object.entries(originalHeaders || {})) {
            if (!forbidden.has(key.toLowerCase())) {
              headers[key] = value;
            }
          }
          headers["content-type"] = "application/json";
          headers.accept = "application/json, text/plain, */*";
          headers["language-code"] = localStorage.getItem("language") || "zh_CN";
          const response = await fetch(requestEndpoint, {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify(requestData),
          });
          const text = await response.text();
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            body = { raw: text };
          }
          return { status: response.status, body };
        },
        { endpoint, data, originalHeaders: capturedHeaders },
      );

      if (result.status < 200 || result.status >= 300) {
        throw new Error(`${endpoint} returned HTTP ${result.status}`);
      }
      if (result.body?.code !== "000") {
        throw new Error(`${endpoint} failed: ${stableJson(result.body)}`);
      }
      return result.body;
    };

    return await callback({ page, api });
  } finally {
    await browser.close();
  }
}

function findHomePage(listResponse) {
  const pages = listResponse?.data?.decorationPageCOS;
  if (!Array.isArray(pages)) {
    throw new Error("listPage response did not include data.decorationPageCOS");
  }
  const home = pages.find((page) => page.homePage === true || page.pageType === "homePage");
  if (!home) {
    throw new Error("Could not identify the formal H5 home page");
  }
  return home;
}

async function saveSnapshot() {
  const capturedAt = timestamp();
  const outputDir = path.join(OUTPUT_ROOT, capturedAt);
  await mkdir(outputDir, { recursive: true });

  const result = await withAuthenticatedPage(async ({ api }) => {
    const releaseInfo = await api("/ordering/config/decoration/getReleaseInfo", {
      appId: APP_ID,
      appType: APP_TYPE,
    });
    const releasePlanId =
      releaseInfo?.data?.decorationPlanId || releaseInfo?.data?.id || "1993211773989314560";
    const listPayload = {
      appId: APP_ID,
      appType: APP_TYPE,
      decorationPlanId: String(releasePlanId),
      sourceType: FORMAL_SOURCE_TYPE,
      queryType: 1,
    };
    const pages = await api("/ordering/config/decoration/listPage", listPayload);
    const home = findHomePage(pages);
    return { releaseInfo, pages, home, listPayload };
  });

  const manifest = {
    capturedAt,
    appId: APP_ID,
    appType: APP_TYPE,
    sourceType: FORMAL_SOURCE_TYPE,
    decorationPlanId: String(result.listPayload.decorationPlanId),
    homePageId: String(result.home.decorationPageId),
    hashes: {
      releaseInfo: sha256(result.releaseInfo),
      pages: sha256(result.pages),
      home: sha256(result.home),
    },
  };

  await Promise.all([
    writeFile(path.join(outputDir, "release-info.json"), stableJson(result.releaseInfo)),
    writeFile(path.join(outputDir, "pages.json"), stableJson(result.pages)),
    writeFile(path.join(outputDir, "home-page.json"), stableJson(result.home)),
    writeFile(path.join(outputDir, "manifest.json"), stableJson(manifest)),
  ]);

  return { outputDir, manifest };
}

async function inspectSnapshot(snapshotDir) {
  const [manifest, home] = await Promise.all([
    readFile(path.join(snapshotDir, "manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(snapshotDir, "home-page.json"), "utf8").then(JSON.parse),
  ]);
  const tree = typeof home.componentsTree === "string"
    ? JSON.parse(home.componentsTree)
    : home.componentsTree;
  const map = typeof home.componentsMap === "string"
    ? JSON.parse(home.componentsMap)
    : home.componentsMap;

  return {
    manifest,
    home: {
      decorationPageId: home.decorationPageId,
      pageName: home.pageName,
      pageType: home.pageType,
      homePage: home.homePage,
      thumbnailUrl: home.thumbnailUrl,
      pageDataType: typeof home.pageData,
      componentsTreeType: typeof home.componentsTree,
      componentsMapType: typeof home.componentsMap,
    },
    tree,
    mapKeys: map && typeof map === "object" ? Object.keys(map) : [],
    map,
  };
}

async function readSnapshot(snapshotDir) {
  const [manifest, home] = await Promise.all([
    readFile(path.join(snapshotDir, "manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(snapshotDir, "home-page.json"), "utf8").then(JSON.parse),
  ]);
  if (String(manifest.appId) !== APP_ID || Number(manifest.sourceType) !== FORMAL_SOURCE_TYPE) {
    throw new Error("Snapshot is not the expected formal RES H5 application");
  }
  if (sha256(home) !== manifest.hashes.home) {
    throw new Error("Snapshot home-page.json does not match its manifest hash");
  }
  return { manifest, home };
}

async function buildDesign(snapshotDir) {
  const { manifest, home } = await readSnapshot(snapshotDir);
  const designedHome = buildSeeYouOftenHome(home);
  const tree = parseJsonField(designedHome.componentsTree, "componentsTree");
  validateComponentTree(tree);

  const designManifest = {
    builtAt: timestamp(),
    sourceSnapshot: snapshotDir,
    sourceDecorationPlanId: String(manifest.decorationPlanId),
    sourceHomePageId: String(manifest.homePageId),
    sourceHomeHash: manifest.hashes.home,
    designedHomeHash: sha256(designedHome),
    componentCount: Object.keys(tree).length,
    publishEndpointIncluded: false,
  };

  await Promise.all([
    writeFile(
      path.join(snapshotDir, "designed-home-page.json"),
      stableJson(designedHome),
    ),
    writeFile(
      path.join(snapshotDir, "design-manifest.json"),
      stableJson(designManifest),
    ),
  ]);
  return { designedHome, designManifest };
}

async function saveDesignAsDraft(snapshotDir, planName) {
  if (!planName?.trim()) {
    throw new Error("A non-empty draft plan name is required");
  }
  const { manifest, home: snapshotHome } = await readSnapshot(snapshotDir);
  const { designedHome, designManifest } = await buildDesign(snapshotDir);

  const result = await withAuthenticatedPage(async ({ api }) => {
    const formalPayload = {
      appId: APP_ID,
      appType: APP_TYPE,
      decorationPlanId: String(manifest.decorationPlanId),
      sourceType: FORMAL_SOURCE_TYPE,
      queryType: 1,
    };
    const formalBefore = await api(
      "/ordering/config/decoration/listPage",
      formalPayload,
    );
    const formalHomeBefore = findHomePage(formalBefore);
    if (sha256(formalHomeBefore) !== manifest.hashes.home) {
      throw new Error(
        "Formal H5 changed after the snapshot; refusing to create a draft from stale data.",
      );
    }

    const draftResponse = await api("/ordering/config/decoration/saveDraft", {
      appId: APP_ID,
      decorationPlanId: String(manifest.decorationPlanId),
      planName: planName.trim(),
    });
    const draftPlanId =
      typeof draftResponse.data === "string" || typeof draftResponse.data === "number"
        ? String(draftResponse.data)
        : String(draftResponse.data?.decorationPlanId || draftResponse.data?.id || "");
    if (!draftPlanId || draftPlanId === String(manifest.decorationPlanId)) {
      throw new Error("saveDraft did not return a distinct draft plan id");
    }
    await writeFile(
      path.join(snapshotDir, "draft-in-progress.json"),
      stableJson({
        createdAt: timestamp(),
        planName: planName.trim(),
        draftPlanId,
        sourceFormalPlanId: String(manifest.decorationPlanId),
        releaseCalled: false,
      }),
    );

    const draftPayload = {
      appId: APP_ID,
      appType: APP_TYPE,
      decorationPlanId: draftPlanId,
      sourceType: DRAFT_SOURCE_TYPE,
      queryType: 1,
    };
    const clonedDraft = await api(
      "/ordering/config/decoration/listPage",
      draftPayload,
    );
    const clonedDraftHome = findHomePage(clonedDraft);
    const savePayload = {
      pageName: designedHome.pageName,
      pageNameML: designedHome.pageNameML,
      appId: APP_ID,
      decorationPlanId: draftPlanId,
      decorationPageId: String(clonedDraftHome.decorationPageId),
      operationType: "1",
      sourceType: DRAFT_SOURCE_TYPE,
      pageType: "homePage",
      pageData: designedHome.pageData,
      componentsTree: designedHome.componentsTree,
      componentsMap: designedHome.componentsMap,
      homePage: true,
      thumbnailUrl: "",
    };
    const saveResponse = await api(
      "/ordering/config/decoration/saveDecorate",
      savePayload,
    );

    const draftAfter = await api(
      "/ordering/config/decoration/listPage",
      draftPayload,
    );
    const savedDraftHome = findHomePage(draftAfter);
    const formalAfter = await api(
      "/ordering/config/decoration/listPage",
      formalPayload,
    );
    const formalHomeAfter = findHomePage(formalAfter);

    if (String(savedDraftHome.decorationPlanId) !== draftPlanId) {
      throw new Error("Saved home page was not read back from the new draft plan");
    }
    if (savedDraftHome.componentsTree !== designedHome.componentsTree) {
      throw new Error("Draft home page components did not match the saved design");
    }
    if (sha256(formalHomeAfter) !== sha256(formalHomeBefore)) {
      throw new Error("Formal H5 changed while saving the draft");
    }
    if (sha256(formalHomeAfter) !== manifest.hashes.home) {
      throw new Error("Formal H5 no longer matches the original snapshot");
    }

    return {
      draftPlanId,
      draftHomePageId: String(savedDraftHome.decorationPageId),
      formalHomeBefore,
      formalHomeAfter,
      savedDraftHome,
      saveResponse,
    };
  });

  const savedAt = timestamp();
  const receipt = {
    savedAt,
    planName: planName.trim(),
    appId: APP_ID,
    appType: APP_TYPE,
    draftSourceType: DRAFT_SOURCE_TYPE,
    draftPlanId: result.draftPlanId,
    draftHomePageId: result.draftHomePageId,
    sourceFormalPlanId: String(manifest.decorationPlanId),
    sourceFormalHomePageId: String(snapshotHome.decorationPageId),
    verification: {
      draftMatchesDesignedTree:
        result.savedDraftHome.componentsTree === designedHome.componentsTree,
      formalHomeUnchanged:
        sha256(result.formalHomeAfter) === manifest.hashes.home,
      releaseCalled: false,
    },
    hashes: {
      formalHome: sha256(result.formalHomeAfter),
      draftHome: sha256(result.savedDraftHome),
      designedHome: designManifest.designedHomeHash,
      designedComponentsTree: createHash("sha256")
        .update(designedHome.componentsTree)
        .digest("hex"),
      savedComponentsTree: createHash("sha256")
        .update(result.savedDraftHome.componentsTree)
        .digest("hex"),
    },
  };
  await Promise.all([
    writeFile(
      path.join(snapshotDir, "saved-draft-home-page.json"),
      stableJson(result.savedDraftHome),
    ),
    writeFile(
      path.join(snapshotDir, "draft-receipt.json"),
      stableJson(receipt),
    ),
  ]);
  return receipt;
}

async function updateExistingDraft(snapshotDir) {
  const receiptPath = path.join(snapshotDir, "draft-receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const { manifest } = await readSnapshot(snapshotDir);
  const { designedHome, designManifest } = await buildDesign(snapshotDir);
  const draftPlanId = String(receipt.draftPlanId || "");
  if (
    !draftPlanId
    || draftPlanId === String(manifest.decorationPlanId)
    || Number(receipt.draftSourceType) !== DRAFT_SOURCE_TYPE
  ) {
    throw new Error("Receipt does not identify a safe, separate RES draft");
  }

  const result = await withAuthenticatedPage(async ({ api }) => {
    const formalPayload = {
      appId: APP_ID,
      appType: APP_TYPE,
      decorationPlanId: String(manifest.decorationPlanId),
      sourceType: FORMAL_SOURCE_TYPE,
      queryType: 1,
    };
    const formalBefore = await api(
      "/ordering/config/decoration/listPage",
      formalPayload,
    );
    const formalHomeBefore = findHomePage(formalBefore);
    if (sha256(formalHomeBefore) !== manifest.hashes.home) {
      throw new Error("Formal H5 changed; refusing to update the existing draft");
    }

    const draftPayload = {
      appId: APP_ID,
      appType: APP_TYPE,
      decorationPlanId: draftPlanId,
      sourceType: DRAFT_SOURCE_TYPE,
      queryType: 1,
    };
    const draftBefore = await api(
      "/ordering/config/decoration/listPage",
      draftPayload,
    );
    const draftHomeBefore = findHomePage(draftBefore);
    await api("/ordering/config/decoration/saveDecorate", {
      pageName: designedHome.pageName,
      pageNameML: designedHome.pageNameML,
      appId: APP_ID,
      decorationPlanId: draftPlanId,
      decorationPageId: String(draftHomeBefore.decorationPageId),
      operationType: "1",
      sourceType: DRAFT_SOURCE_TYPE,
      pageType: "homePage",
      pageData: designedHome.pageData,
      componentsTree: designedHome.componentsTree,
      componentsMap: designedHome.componentsMap,
      homePage: true,
      thumbnailUrl: "",
    });
    const draftAfter = await api(
      "/ordering/config/decoration/listPage",
      draftPayload,
    );
    const savedDraftHome = findHomePage(draftAfter);
    const formalAfter = await api(
      "/ordering/config/decoration/listPage",
      formalPayload,
    );
    const formalHomeAfter = findHomePage(formalAfter);

    if (savedDraftHome.componentsTree !== designedHome.componentsTree) {
      throw new Error("Updated draft does not match the designed component tree");
    }
    if (sha256(formalHomeAfter) !== manifest.hashes.home) {
      throw new Error("Formal H5 changed while updating the draft");
    }
    return { savedDraftHome, formalHomeAfter };
  });

  const updatedReceipt = {
    ...receipt,
    updatedAt: timestamp(),
    draftHomePageId: String(result.savedDraftHome.decorationPageId),
    verification: {
      draftMatchesDesignedTree:
        result.savedDraftHome.componentsTree === designedHome.componentsTree,
      formalHomeUnchanged:
        sha256(result.formalHomeAfter) === manifest.hashes.home,
      releaseCalled: false,
    },
    hashes: {
      formalHome: sha256(result.formalHomeAfter),
      draftHome: sha256(result.savedDraftHome),
      designedHome: designManifest.designedHomeHash,
      designedComponentsTree: createHash("sha256")
        .update(designedHome.componentsTree)
        .digest("hex"),
      savedComponentsTree: createHash("sha256")
        .update(result.savedDraftHome.componentsTree)
        .digest("hex"),
    },
  };
  await Promise.all([
    writeFile(
      path.join(snapshotDir, "saved-draft-home-page.json"),
      stableJson(result.savedDraftHome),
    ),
    writeFile(receiptPath, stableJson(updatedReceipt)),
  ]);
  return updatedReceipt;
}

async function discoverLatestDraft() {
  return withAuthenticatedPage(async ({ api }) => {
    const history = await api("/ordering/config/decoration/listPageHistory", {
      appId: APP_ID,
      decorationPlanId: "1993211773989314560",
      decorationPageId: "2032420401715388449",
    });
    return {
      pageHistoryCOS: (history.data?.pageHistoryCOS || []).map((entry) => ({
        keys: Object.keys(entry),
        decorationPlanId: String(entry.decorationPlanId || ""),
        decorationPageId: String(entry.decorationPageId || ""),
        pageName: entry.pageName,
        pageType: entry.pageType,
        createTime: entry.createTime,
        createdBy: entry.createdBy,
      })),
    };
  });
}

async function listLinkConfig() {
  return withAuthenticatedPage(async ({ api }) => api(
    "/ordering/config/decoration/listLinkConfig",
    {
      appId: APP_ID,
      appType: APP_TYPE,
    },
  ));
}

async function inspectCustomLinkSupport() {
  return withAuthenticatedPage(async ({ page }) => page.evaluate(async () => {
    const needles = [
      "customPageUrl",
      "customeLink",
      "isCustomLink",
    ];
    const scriptUrls = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => /\.js(?:\?|$)/.test(url));
    const matches = [];

    for (const url of scriptUrls) {
      const source = await fetch(url, { credentials: "include" })
        .then((response) => response.text())
        .catch(() => "");
      for (const needle of needles) {
        let fromIndex = 0;
        while (matches.length < 30) {
          const index = source.indexOf(needle, fromIndex);
          if (index === -1) {
            break;
          }
          matches.push({
            url,
            needle,
            snippet: source.slice(Math.max(0, index - 600), index + 1_200),
          });
          fromIndex = index + needle.length;
        }
      }
    }

    return {
      scriptCount: scriptUrls.length,
      matches,
    };
  }));
}

async function inspectRuntimeCustomLinkSupport() {
  return withAuthenticatedPage(async ({ page }) => {
    await page.goto(
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/shareIndex?shareUrl=%2Fhome%3F&g=450020844",
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    await page.waitForLoadState("networkidle").catch(() => {});
    const needles = [
      "isCustomLink",
      "customPageUrl",
      "customeLink",
      "window.location.href",
      "location.href=",
      "window.open(",
      "location.assign(",
      "location.replace(",
      "startsWith(\"http",
      "startsWith('http",
      "outLink",
      "actionType",
    ];
    const scriptUrls = await page.evaluate(() => performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => /\.js(?:\?|$)/.test(url)));
    const matches = [];
    let fetchedCount = 0;

    for (const url of scriptUrls) {
      const response = await page.request.get(url).catch(() => null);
      if (!response?.ok()) {
        continue;
      }
      fetchedCount += 1;
      const source = await response.text();
      for (const needle of needles) {
        let fromIndex = 0;
        let needleMatchCount = 0;
        while (needleMatchCount < 8) {
          const index = source.indexOf(needle, fromIndex);
          if (index === -1) {
            break;
          }
          matches.push({
            url,
            needle,
            snippet: source.slice(Math.max(0, index - 800), index + 1_600),
          });
          needleMatchCount += 1;
          fromIndex = index + needle.length;
        }
      }
    }

    return {
      location: page.url(),
      scriptCount: scriptUrls.length,
      fetchedCount,
      scriptUrls,
      matches,
    };
  });
}

async function renderDraftPreview(snapshotDir, outputDir, requestedLanguages = null) {
  const receipt = JSON.parse(
    await readFile(path.join(snapshotDir, "draft-receipt.json"), "utf8"),
  );
  if (
    !receipt.draftPlanId
    || Number(receipt.draftSourceType) !== DRAFT_SOURCE_TYPE
    || receipt.verification?.releaseCalled !== false
  ) {
    throw new Error("Draft receipt is missing or is not safe to preview");
  }

  await mkdir(outputDir, { recursive: true });
  const previewConfigs = [
    {
      language: "zh_CN",
      firstScreenPath: path.join(outputDir, "see-you-often-h5-first-screen.png"),
      fullPagePath: path.join(outputDir, "see-you-often-h5-full-page.png"),
    },
    {
      language: "en_US",
      firstScreenPath: path.join(outputDir, "see-you-often-h5-en-first-screen.png"),
      fullPagePath: path.join(outputDir, "see-you-often-h5-en-full-page.png"),
    },
    {
      language: "ms_MY",
      firstScreenPath: path.join(outputDir, "see-you-often-h5-ms-first-screen.png"),
      fullPagePath: path.join(outputDir, "see-you-often-h5-ms-full-page.png"),
    },
  ];
  const selectedConfigs = requestedLanguages
    ? previewConfigs.filter((config) => requestedLanguages.includes(config.language))
    : previewConfigs;
  if (
    selectedConfigs.length === 0
    || (requestedLanguages && selectedConfigs.length !== requestedLanguages.length)
  ) {
    throw new Error(`Unsupported preview language: ${requestedLanguages?.join(", ")}`);
  }

  const previews = {};
  for (const config of selectedConfigs) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        storageState: STORAGE_STATE,
        viewport: { width: 1600, height: 1800 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      try {
        await page.addInitScript((language) => {
          localStorage.setItem("language", language);
        }, config.language);
        await page.goto(
          `${BASE_URL}/online-designer/designer?appId=${APP_ID}&appType=${APP_TYPE}&decorationPlanId=${receipt.draftPlanId}&sourceType=${DRAFT_SOURCE_TYPE}`,
          { waitUntil: "domcontentloaded", timeout: 60_000 },
        );
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(2_000);
        if (page.url().includes("/login")) {
          throw new Error("RES login state expired while rendering the draft");
        }

        const canvas = page.locator(".craftjs-renderer").first();
        await canvas.waitFor({ state: "visible", timeout: 30_000 });
        await page.evaluate(() => {
          document
            .querySelectorAll(".fc-container-hasBgImage")
            .forEach((element) => element.classList.remove("fc-container-hasBgImage"));
          document
            .querySelectorAll(".jhb-111, .fixed.z-\\[999\\]")
            .forEach((element) => {
              element.style.display = "none";
            });
        });
        const box = await canvas.boundingBox();
        if (!box || Math.round(box.width) !== 375 || box.height < 812) {
          throw new Error(`Unexpected RES H5 canvas bounds: ${stableJson(box)}`);
        }
        await canvas.screenshot({
          path: config.fullPagePath,
          animations: "disabled",
        });
        await page.screenshot({
          path: config.firstScreenPath,
          animations: "disabled",
          clip: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: 812,
          },
        });
        previews[config.language] = {
          firstScreenPath: config.firstScreenPath,
          fullPagePath: config.fullPagePath,
          canvas: {
            width: Math.round(box.width),
            height: Math.round(box.height),
            deviceScaleFactor: 2,
          },
        };
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }

  const primaryPreview = previews.zh_CN || previews[selectedConfigs[0].language];
  return {
    draftPlanId: receipt.draftPlanId,
    draftHomePageId: receipt.draftHomePageId,
    firstScreenPath: primaryPreview.firstScreenPath,
    fullPagePath: primaryPreview.fullPagePath,
    canvas: primaryPreview.canvas,
    previews,
  };
}

function usage() {
  console.error("Usage:");
  console.error("  node tools/h5-design.mjs snapshot");
  console.error("  node tools/h5-design.mjs inspect <snapshot-directory>");
  console.error("  node tools/h5-design.mjs build <snapshot-directory>");
  console.error(
    "  node tools/h5-design.mjs save-draft <snapshot-directory> <draft-plan-name>",
  );
  console.error("  node tools/h5-design.mjs update-draft <snapshot-directory>");
  console.error("  node tools/h5-design.mjs discover-draft");
  console.error("  node tools/h5-design.mjs list-link-config");
  console.error("  node tools/h5-design.mjs inspect-custom-link");
  console.error("  node tools/h5-design.mjs inspect-runtime-custom-link");
  console.error(
    "  node tools/h5-design.mjs preview <snapshot-directory> <output-directory>",
  );
  console.error(
    "  node tools/h5-design.mjs preview-language <snapshot-directory> <output-directory> <zh_CN|en_US|ms_MY>",
  );
}

const [command, argument, ...rest] = process.argv.slice(2);

if (command === "snapshot") {
  const result = await saveSnapshot();
  console.log(stableJson(result));
} else if (command === "inspect" && argument) {
  console.log(stableJson(await inspectSnapshot(path.resolve(argument))));
} else if (command === "build" && argument) {
  const result = await buildDesign(path.resolve(argument));
  console.log(stableJson(result.designManifest));
} else if (command === "save-draft" && argument && rest.length) {
  const result = await saveDesignAsDraft(
    path.resolve(argument),
    rest.join(" "),
  );
  console.log(stableJson(result));
} else if (command === "update-draft" && argument) {
  console.log(stableJson(await updateExistingDraft(path.resolve(argument))));
} else if (command === "discover-draft") {
  console.log(stableJson(await discoverLatestDraft()));
} else if (command === "list-link-config") {
  console.log(stableJson(await listLinkConfig()));
} else if (command === "inspect-custom-link") {
  console.log(stableJson(await inspectCustomLinkSupport()));
} else if (command === "inspect-runtime-custom-link") {
  console.log(stableJson(await inspectRuntimeCustomLinkSupport()));
} else if (command === "preview" && argument && rest.length) {
  console.log(stableJson(await renderDraftPreview(
    path.resolve(argument),
    path.resolve(rest.join(" ")),
  )));
} else if (command === "preview-language" && argument && rest.length === 2) {
  console.log(stableJson(await renderDraftPreview(
    path.resolve(argument),
    path.resolve(rest[0]),
    [rest[1]],
  )));
} else {
  usage();
  process.exitCode = 1;
}

export {
  APP_ID,
  APP_TYPE,
  DRAFT_SOURCE_TYPE,
  FORMAL_SOURCE_TYPE,
  RELEASE_ENDPOINT,
  assertSafeEndpoint,
  buildDesign,
  findHomePage,
  saveDesignAsDraft,
  sha256,
};
