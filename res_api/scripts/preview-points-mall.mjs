#!/usr/bin/env node

import "dotenv/config";

import {
  assertOk,
  exitCodeFor,
  fetchCrmList,
  openAuthedPage,
} from "../lib/report-client.js";
import {
  POINTS_MALL_PRODUCTS,
  catalogReadiness,
  verifyCouponMappings,
} from "../lib/points-mall-catalog.js";

const DEFAULT_CORPORATION_ID = "450020844";

function usage() {
  return [
    "Usage:",
    "  npm run points-mall:preview",
    "",
    "Read-only: verifies the RES mall, live products, and coupon mappings.",
    "It never creates, updates, publishes, archives, or issues anything.",
  ].join("\n");
}

function blockerCounts(blockers) {
  const counts = {};
  for (const blocker of blockers) {
    counts[blocker.code] = (counts[blocker.code] || 0) + 1;
  }
  return counts;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(usage());
    return;
  }
  if (process.argv.length > 2) throw new Error("No arguments are accepted; use --help.");

  const corporationId =
    process.env.CRM_CORPORATION_ID || DEFAULT_CORPORATION_ID;
  const storageState = process.env.RES_STORAGE_STATE || "storageState.json";
  const session = await openAuthedPage({
    storageState,
    warmupPath: "/member-overview",
    log: () => {},
  });

  let mall;
  let liveProducts;
  let couponGroups;
  try {
    mall = assertOk(
      await session.call("/crm/marketing/pointsmall/basicinfo/get", {
        corporationId,
      }),
      "points mall basic info",
    ).data;
    liveProducts = await fetchCrmList(
      session.call,
      "/crm/marketing/pointsmall/item/list",
      { archive: false },
      {
        pageSize: 200,
        maxPages: 10,
        label: "points mall products",
        log: () => {},
      },
    );
    couponGroups = assertOk(
      await session.call("/crm/coupon/template/queryGroupV2", {
        orgId: mall?.owner,
        queryCouponBatch: true,
      }),
      "coupon template groups",
    ).data?.couponTemplateGroupList;
  } finally {
    await session.close();
  }

  if (!mall?.id) throw new Error("RES returned no points mall.");
  const liveCoupons = (couponGroups || []).flatMap(
    (group) => group.couponTemplateList || [],
  );
  const mappingIssues = verifyCouponMappings(
    POINTS_MALL_PRODUCTS,
    liveCoupons,
  );
  const readiness = catalogReadiness(POINTS_MALL_PRODUCTS);
  const liveNames = new Set(liveProducts.items.map((item) => item.name));

  console.log(
    JSON.stringify(
      {
        mode: "read-only",
        mall: {
          exists: true,
          enabled: Boolean(mall.enable),
          name: mall.name,
          linkedCardPrograms: mall.applyCardProgramIds?.length || 0,
        },
        live: {
          productCount: liveProducts.items.length,
          alreadyPresentByExactName: POINTS_MALL_PRODUCTS.filter((item) =>
            liveNames.has(item.name),
          ).map((item) => item.sku),
        },
        catalog: {
          productCount: POINTS_MALL_PRODUCTS.length,
          couponMapped: POINTS_MALL_PRODUCTS.filter((item) => item.coupon)
            .length,
          couponMappingIssues: mappingIssues,
          readyForProductionWrite: readiness.ready,
          blockerCounts: blockerCounts(readiness.blockers),
          blockers: readiness.blockers,
          products: POINTS_MALL_PRODUCTS.map((item) => ({
            sku: item.sku,
            name: item.name,
            points: item.points,
            inventory: item.inventory,
            observedInventory: item.observedInventory ?? null,
            costMyr: item.costMyr,
            retailMyr: item.retailMyr,
            demandSharePct: item.demandSharePct,
            couponAssigned: Boolean(item.coupon),
          })),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = exitCodeFor(error);
});
