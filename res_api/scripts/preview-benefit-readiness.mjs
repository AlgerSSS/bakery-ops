#!/usr/bin/env node

import "dotenv/config";

import {
  assertOk,
  exitCodeFor,
  openAuthedPage,
} from "../lib/report-client.js";
import {
  assessBenefitReadiness,
  RES_NATIVE_BENEFIT_CAPABILITIES,
  SEE_YOU_OFTEN_BENEFIT_REQUIREMENTS,
} from "../lib/benefit-readiness.js";

const ORG_PATH = process.env.CRM_ORG_PATH || "/1000833/1000835/900846";
const OWNER_ORG_ID = process.env.CRM_OWNER_ORG_ID || "1991027325256417283";
const OWNER_ORG_TYPE = process.env.CRM_OWNER_ORG_TYPE || "7";

function usage() {
  return [
    "Usage:",
    "  npm run benefits:preview",
    "",
    "Read-only: compares live RES benefits, campaigns and top-up programs",
    "with the confirmed See You Often contract. It never saves or sends.",
  ].join("\n");
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(usage());
    return;
  }
  if (process.argv.length > 2) throw new Error("No arguments are accepted; use --help.");

  const storageState = process.env.RES_STORAGE_STATE || "storageState.json";
  const session = await openAuthedPage({
    storageState,
    warmupPath: "/member-rights",
    log: () => {},
  });

  let memberRights;
  let campaigns;
  let topUpPrograms;
  let processManagementAccessible = false;
  try {
    memberRights = assertOk(
      await session.call("/crm/memberRights/pageQuery", {
        page: { pageNo: 1, pageSize: 500 },
        isArchived: false,
        ownerPath: ORG_PATH,
        ownerOrgId: OWNER_ORG_ID,
        ownerOrgType: OWNER_ORG_TYPE,
      }),
      "member rights",
    ).data?.list || [];
    campaigns = assertOk(
      await session.call("/crm/marketing/campaigns/pageQuery", {
        page: { pageNo: 1, pageSize: 500 },
        isArchived: false,
        ownerOrgType: OWNER_ORG_TYPE,
        ownerOrgPath: ORG_PATH,
        ownerOrgId: OWNER_ORG_ID,
      }),
      "marketing campaigns",
    ).data?.list || [];
    topUpPrograms = assertOk(
      await session.call("/crm/memberSystem/web/storedValueProgram/list", {
        page: { pageNo: 1, pageSize: 500 },
        orgPath: ORG_PATH,
        isArchived: false,
      }),
      "top-up programs",
    ).data?.list || [];

    await session.page.goto("https://bo.sea.restosuite.ai/process-management", {
      waitUntil: "domcontentloaded",
    });
    await session.page.waitForTimeout(2_500);
    const permissionPageText = await session.page.locator("body").innerText();
    processManagementAccessible =
      !session.page.url().endsWith("/403") &&
      !permissionPageText.includes("current account does not have permission");
  } finally {
    await session.close();
  }

  const nowDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const assessment = assessBenefitReadiness({
    memberRights,
    campaigns,
    topUpPrograms,
    nowDate,
    processManagementAccessible,
  });

  console.log(JSON.stringify({
    mode: "read-only",
    checkedAt: new Date().toISOString(),
    requirements: SEE_YOU_OFTEN_BENEFIT_REQUIREMENTS,
    auditedNativeCapabilities: RES_NATIVE_BENEFIT_CAPABILITIES,
    liveCounts: {
      memberRights: memberRights.length,
      campaigns: campaigns.length,
      topUpPrograms: topUpPrograms.length,
    },
    ...assessment,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = exitCodeFor(error);
});
