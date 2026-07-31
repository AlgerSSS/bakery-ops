#!/usr/bin/env node
// RES 商品目录 → pos_product（迁移 064）。
//
// 这是全库商品身份的唯一写入口。RES 的 menuItemNameKey 同时出现在销售报表维度 D_itemName
// 和成本卡记录里，所以它是唯一能把「卖了多少」和「成本多少」接起来的键。
//
// 【写入纪律】纯 upsert，永不 DELETE —— 下架商品要留着，历史销售仍然指向它。
//
// 用法：node --env-file=.env sync-catalog.mjs [--dry-run]
import fs from "node:fs";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = "https://bo.sea.restosuite.ai";
const CORP = "450020844";
const BRAND = "1990716608733069315";
const SHOP = "406994127";
// 三个作用域都要抓：实测在售品 92 个挂在品牌级、26 个挂在门店级。
const SCOPES = [
  { label: "集团", orgId: "1990706730765467654", orgType: "0", ep: "group" },
  { label: "品牌", orgId: BRAND, orgType: "1", ep: "group" },
  { label: "门店", orgId: "1991027325256417283", orgType: "7", ep: "store" },
];
const WRITE_ENDPOINT = /\/(save|adjust|release|delete|remove|create|submit|audit|verify)(\/|$)/i;
const dryRun = process.argv.includes("--dry-run");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: "storageState.json" });
const page = await ctx.newPage();
let captured = null;
page.on("request", (r) => {
  const h = r.headers();
  if (!captured && h["vulcan-token"]) captured = { ...h };
});
await page.goto(`${BASE}/supplychain/costed-management`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(6_000);
if (!captured?.["vulcan-token"]) {
  console.error("没抓到 vulcan-token —— BO 会话已过期，先跑 node login.js");
  await browser.close();
  process.exit(2);
}

// 刚登录的会话停在集团级（organization-type=0、无 brand-id），供应链接口会一律回
// UNI-00-0102 invalid request: Shop-Id。令牌本身有效，只需显式指定作用域。
const headersFor = (orgId, orgType) => ({
  ...captured,
  "corporation-id": CORP,
  "organization-id": orgId,
  "organization-type": orgType,
  "brand-id": BRAND,
  "shop-id": SHOP,
});

async function api(path, body, headers) {
  if (WRITE_ENDPOINT.test(path)) throw new Error(`本脚本只读，拒绝调用 ${path}`);
  return page.evaluate(async ({ o, url, body }) => {
    const skip = new Set(["host", "connection", "content-length", "cookie"]);
    const h = {};
    for (const [k, v] of Object.entries(o || {})) if (!skip.has(k.toLowerCase())) h[k] = v;
    h["content-type"] = "application/json";
    h["accept"] = "application/json, text/plain, */*";
    const res = await fetch(url, { method: "POST", credentials: "include", headers: h, body: JSON.stringify(body) });
    try { return await res.json(); } catch { return null; }
  }, { o: headers, url: BASE + path, body });
}

const catalog = new Map();
for (const scope of SCOPES) {
  const headers = headersFor(scope.orgId, scope.orgType);
  const catRes = await api("/sc/masterData/api/cost-card/menu-category",
    { sourceOrgId: scope.orgId, sourceOrgType: scope.orgType }, headers);
  const ids = [];
  const walk = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (n.menuItemCategoryId) ids.push(String(n.menuItemCategoryId));
      walk(n.childCategoryArray);
    }
  };
  walk(catRes?.data?.categoryArray);
  if (ids.length === 0) { console.log(`${scope.label}: 无分类，跳过`); continue; }
  const categories = ["-1", ...new Set(ids)];

  let added = 0;
  for (const cardStatus of [1, 0]) {
    for (let pageNo = 1; pageNo <= 40; pageNo++) {
      const res = await api(`/sc/masterData/api/cost-card/${scope.ep}/page`, {
        pager: { pageNo, pageSize: 200 }, costCardStatus: cardStatus,
        selectedOrgId: scope.orgId, selectedOrgType: scope.orgType,
        menuItemCategoryIdArray: categories, status: "1",
      }, headers);
      if (res?.code && res.code !== "000") {
        if (pageNo === 1) console.warn(`  ${scope.label} status=${cardStatus}: ${res.code} ${res.msg || ""}`);
        break;
      }
      const list = res?.data?.list || [];
      for (const x of list) {
        const key = x.menuItemNameKey;
        // 已建卡的记录信息更全，不要被后来的未建卡记录覆盖
        if (!key || catalog.has(key)) continue;
        catalog.set(key, { ...x, _built: cardStatus === 1 });
        added += 1;
      }
      if (list.length < 200) break;
    }
  }
  console.log(`${scope.label}: 分类 ${ids.length} 个，新增 ${added}，累计 ${catalog.size}`);
}
await browser.close();

if (catalog.size === 0) {
  console.error("目录为空，拒绝写库（多半是作用域或会话问题）");
  process.exit(1);
}

const rows = [...catalog.entries()].map(([key, x]) => {
  const [orgId, orgType] = key.split("-");
  return {
    item_key: key,
    item_id: key.split("-").pop(),
    org_id: orgId,
    org_type: Number(orgType),
    menu_item_code: x.menuItemCode ? String(x.menuItemCode) : null,
    name_en: (x.menuItemNameML?.en_US || x.menuItemName || "").trim(),
    name_zh: (x.menuItemNameML?.zh_CN || "").trim() || null,
    category_id: x.menuItemCategoryId ? String(x.menuItemCategoryId) : null,
    category_en: x.menuItemCategoryNameML?.en_US || x.menuItemCategoryName || null,
    category_zh: x.menuItemCategoryNameML?.zh_CN || null,
    spec: x.spec || null,
    sales_price: x.salesPrice ?? null,
    res_cost_card_id: x.costCardId ? String(x.costCardId) : null,
    res_spec_id: x.menuItemSpecId ? String(x.menuItemSpecId) : null,
    // 约束要求 has_cost_card=true 时必须有卡号
    has_cost_card: Boolean(x._built && x.costCardId),
    res_total_cost: x.totalCost ?? null,
    res_theoretical_cost: x.theoreticalCost ?? null,
    res_status: x.status ?? null,
  };
}).filter((r) => r.name_en);

console.log(`\n准备 upsert ${rows.length} 条（有中文名 ${rows.filter(r => r.name_zh).length}，已建卡 ${rows.filter(r => r.has_cost_card).length}）`);
if (dryRun) {
  console.log("dry-run，未写库。样例:", JSON.stringify(rows[0], null, 1));
  process.exit(0);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
const cols = Object.keys(rows[0]);
const updatable = cols.filter((c) => c !== "item_key");
let written = 0;
for (let i = 0; i < rows.length; i += 200) {
  const batch = rows.slice(i, i + 200);
  const res = await sql`
    insert into pos_product ${sql(batch, cols)}
    on conflict (item_key) do update set
      ${sql(updatable.reduce((a, c) => ({ ...a, [c]: sql`excluded.${sql(c)}` }), {}))},
      synced_at = now()
  `;
  written += res.count ?? batch.length;
}
console.log(`已写入 ${written} 条`);
console.log("目录现状:", (await sql`
  select count(*)::int total, count(*) filter (where has_cost_card)::int carded,
         count(*) filter (where name_zh is not null)::int with_zh from pos_product`)[0]);
await sql.end();
