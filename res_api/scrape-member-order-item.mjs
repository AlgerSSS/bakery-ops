// 会员订单商品行同步：RES 商品报表(reportId=211) → public.pos_member_order_item
//
// 这是全库唯一把「会员」和「具体商品」连起来的数据源，年度烘焙报告靠它。
// 桥是 order_id：211 的 D_orderId 与 pos_member_card_txn.order_id 同一 ID 空间
// （实测 2026-08-08 全量对账 18/18）。
//
// ⚠ 重复行必须 SUM 不得 DISTINCT。报表对同一 (订单, 商品) 会返回多条完全相同的行，
//   那是同一单里分两行点的同一样东西。去重会让金额与件数少算约 25%。
//   详见 sql/pos_member_order_item.sql 第二节的对账数据。
//
// 用法：
//   node scrape-member-order-item.mjs                    # 默认回补最近 3 天
//   node scrape-member-order-item.mjs --days=7
//   node scrape-member-order-item.mjs --from=2026-01-01 --to=2026-08-08
import 'dotenv/config';
import { chromium } from 'playwright';
import postgres from 'postgres';
import fs from 'node:fs';

const BASE = 'https://bo.sea.restosuite.ai';
const SHOP_ID_FALLBACK = process.env.SHOP_ID || '406994127';
const PAGE_SIZE = 2000;
const TAG = '[member-order-item]';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));

const tz = 'Asia/Kuala_Lumpur';
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

let dates = [];
if (args.from) {
  const to = args.to ? parse(args.to)
    : (() => { const t = new Date(new Date().toLocaleString('en-US', { timeZone: tz })); t.setHours(0,0,0,0); return t; })();
  for (let d = parse(args.from); d <= to; d.setDate(d.getDate() + 1)) dates.push(fmt(new Date(d)));
} else {
  const days = Number(args.days || 3);
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz })); today.setHours(0,0,0,0);
  for (let i = days - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); dates.push(fmt(d)); }
}
console.log(`${TAG} 日期范围 ${dates[0]} ~ ${dates[dates.length - 1]}（${dates.length} 天）`);

if (!fs.existsSync('storageState.json')) {
  console.error(`${TAG} 缺 storageState.json，先跑 \`npm run login\``); process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });
const page = await ctx.newPage();

let authHeaders = null, shopIdFromHeaders = null;
page.on('request', (r) => {
  const h = r.headers();
  if (!authHeaders && h['vulcan-token']) authHeaders = h;
  if (!shopIdFromHeaders && h['shop-id']) shopIdFromHeaders = h['shop-id'];
});
await page.goto(`${BASE}/report/report-items-breakdowm`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(4000);
if (!authHeaders) { console.error(`${TAG} 未捕获鉴权头，登录态可能已过期`); await browser.close(); await sql.end(); process.exit(1); }
if (!authHeaders['shop-id']) authHeaders['shop-id'] = shopIdFromHeaders || SHOP_ID_FALLBACK;
const shopId = authHeaders['shop-id'];
console.log(`${TAG} 鉴权 ok（shop-id=${shopId}）`);

async function callApi(apiPath, payload) {
  return page.evaluate(async ({ url, body, origHeaders }) => {
    const forbidden = new Set(['host', 'connection', 'content-length', 'cookie']);
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/plain, */*' };
    for (const [k, v] of Object.entries(origHeaders || {})) if (!forbidden.has(k.toLowerCase())) headers[k] = v;
    const r = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
    const t = await r.text(); let p; try { p = JSON.parse(t); } catch { p = { raw: t }; }
    return { status: r.status, body: p };
  }, { url: BASE + apiPath, body: payload, origHeaders: authHeaders });
}
const cell = (v) => (v && typeof v === 'object' && 'value' in v) ? v.value : v;

let totalRows = 0, totalDays = 0, ambiguous = 0, failedDays = [];

for (const date of dates) {
  // ---- 1. 拉当日会员订单的商品行（全量翻页）----
  const lines = [];
  let pageNo = 1, ok = true;
  while (true) {
    const body = {
      reportId: '211',
      selectFields: ['D_orderId', 'D_itemName', 'M_Item_SUM_netQty', 'M_Item_SUM_netSales'],
      aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [], metricsByDimQryV2: [],
      filters: [
        { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: [date, date] },
        { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
        { fieldName: 'D_shopId', filterType: 'IN', filterValue: [shopId] },
        { fieldName: 'D_isMemberConsume', filterType: 'IN', filterValue: ['true'] },
      ],
      page: { pageNo, pageSize: PAGE_SIZE },
    };
    const r = await callApi('/api/report/data/queryData', body);
    if (r.status !== 200 || r.body?.code !== '000') {
      console.error(`  ${date} 第 ${pageNo} 页失败: ${r.status} ${r.body?.code} ${r.body?.msg || ''}`);
      ok = false; break;
    }
    const rows = r.body?.data?.rows || [];
    for (const row of rows) {
      const orderId = String(cell(row.D_orderId) ?? '').trim();
      const itemKey = String(cell(row.D_itemName) ?? '').trim();
      const qty = Number(cell(row.M_Item_SUM_netQty)) || 0;
      const net = Number(cell(row.M_Item_SUM_netSales)) || 0;
      if (!orderId || !itemKey || qty <= 0) continue;   // 只认真实成交
      lines.push({ orderId, itemKey, qty, net });
    }
    if (rows.length < PAGE_SIZE) break;
    if (++pageNo > 40) { console.warn(`  ${date} 安全上限 40 页`); break; }
  }
  if (!ok) { failedDays.push(date); continue; }
  if (!lines.length) { console.log(`  ${date}: 无会员订单商品行`); totalDays++; continue; }

  // ---- 2. 同 (订单,商品) 的多行 SUM 合并 —— 绝不去重 ----
  const agg = new Map();
  for (const l of lines) {
    const k = `${l.orderId}|${l.itemKey}`;
    const cur = agg.get(k) || { orderId: l.orderId, itemKey: l.itemKey, qty: 0, net: 0 };
    cur.qty += l.qty; cur.net += l.net;
    agg.set(k, cur);
  }

  // ---- 3. 由 order_id 反查 member_id；一单对多个不同会员则写 NULL 并告警 ----
  const orderIds = [...new Set([...agg.values()].map((x) => x.orderId))];
  const owners = await sql`
    select order_id, array_agg(distinct member_id) members
    from pos_member_card_txn
    where order_id = any(${orderIds}) and member_id is not null
    group by order_id`;
  const memberOf = new Map();
  for (const o of owners) {
    if (o.members.length === 1) memberOf.set(String(o.order_id), o.members[0]);
    else { ambiguous++; console.warn(`  ⚠ ${date} 订单 ${o.order_id} 对应 ${o.members.length} 个不同会员，member_id 写 NULL`); }
  }

  // ---- 4. upsert ----
  const payload = [...agg.values()].map((x) => ({
    order_id: x.orderId,
    item_key: x.itemKey,
    business_date: date,
    member_id: memberOf.get(x.orderId) ?? null,
    qty: x.qty.toFixed(3),
    net_sales: x.net.toFixed(2),
  }));
  await sql`
    insert into pos_member_order_item ${sql(payload, 'order_id','item_key','business_date','member_id','qty','net_sales')}
    on conflict (order_id, item_key) do update set
      business_date = excluded.business_date,
      member_id     = excluded.member_id,
      qty           = excluded.qty,
      net_sales     = excluded.net_sales,
      synced_at     = now()`;

  const named = payload.filter((p) => p.member_id).length;
  console.log(`  ${date}: 原始 ${lines.length} 行 → 合并 ${payload.length} 行，其中 ${named} 行有 member_id`);
  totalRows += payload.length; totalDays++;
}

console.log(`\n${TAG} 完成：${totalDays}/${dates.length} 天，写入/更新 ${totalRows} 行`);
if (ambiguous) console.log(`${TAG} 归属不明的订单 ${ambiguous} 个（member_id=NULL）`);
if (failedDays.length) console.log(`${TAG} 失败日期 ${failedDays.length} 天：${failedDays.join(', ')}`);

await browser.close();
await sql.end();
process.exit(failedDays.length ? 1 : 0);
