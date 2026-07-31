// 会员快照：/crm/datamanage/card/page ∪ /crm/datamanage/customer/page（只读分页）
// -> output/member/snapshot.json -> pos_member（由 sync-to-db.js 写库，本脚本不碰数据库）。
//
// 为什么要取两个接口的并集（实机）：
//   customer/page total=3713（POS 后台首页显示的会员数），card/page 上有 4821 个不同的 customerId，
//   其中 1111 个只在卡上、不在会员列表里（这些卡 shopId='0'，像是线上/小程序注册），
//   另有 3 个会员没有卡。只跑 customer/page 会丢掉 1111 个持卡人的余额与手机号。
//   -> 并集 4824 人，档案端缺失的置 has_profile=false。
//
// 【金额单位】/crm/* 私有接口返回的是**整数分**（balance="12000" 即 RM 120.00），
//   而报表引擎返回的是带小数点的元。这里一律除以 100 转成 MYR 元再落盘。
//   points / growth 是计数不是金额，不除。
//
// 【PII】落盘前必过 lib/pii-guard.js 的白名单投影。手机号按用户决定入库，
//   姓名/邮箱/生日/性别/证件/地址一律不落。日志里任何号码只能以 maskPhone 形态出现。
//
// 【只读纪律】本脚本只调 /crm/datamanage/*/page 两个查询接口。
//   同域下的写接口 /crm/memberCard/web/trade/* 与 /crm/memberCard/web/card/* 严禁触碰。
//
// 退出码：0 成功 / 2 会话失效（wrapper 重登录）/ 3 接口查询失败 / 1 其它（含数据自检不过）。

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CORPORATION_ID,
  PosQueryError,
  exitCodeFor,
  fetchCrmList,
  openAuthedPage,
} from './lib/report-client.js';
import {
  CARD_FIELD_ALLOWLIST,
  CUSTOMER_FIELD_ALLOWLIST,
  normalizePhone,
  project,
} from './lib/pii-guard.js';
import { refreshBusinessDate } from './lib/business-date.js';

const CORP = process.env.CRM_CORPORATION_ID || DEFAULT_CORPORATION_ID;
const ORG_PATH = process.env.CRM_ORG_PATH || '/1000833/1000835/900846';
const OUT_DIR = process.env.MEMBER_OUT_DIR || 'output/member';
const OUT_FILE = path.join(OUT_DIR, 'snapshot.json');
const PAGE_SIZE = Number(process.env.MEMBER_PAGE_SIZE || 500);
// 实机 4848 张卡 / 3713 档案。低于这个数说明分页被门店权限或过滤条件截断了，不是正常波动。
const MIN_CARDS = Number(process.env.MEMBER_MIN_CARDS || 4000);
const MIN_MEMBERS = Number(process.env.MEMBER_MIN_MEMBERS || 4000);

const BUSINESS_DATE = refreshBusinessDate();

/** 整数分 -> MYR 元（保留 2 位）。空/null -> null。 */
const cents = (v) => (v == null || v === '' ? null : Math.round(Number(v)) / 100);
const int = (v) => (v == null || v === '' ? null : Number(v));
const str = (v) => (v == null || v === '' ? null : String(v));

async function main() {
  const started = Date.now();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[member-snapshot] business date=${BUSINESS_DATE} corp=${CORP}`);

  const session = await openAuthedPage({ warmupPath: '/card-management' });
  let cards;
  let customers;
  try {
    const cardRes = await fetchCrmList(
      session.call,
      '/crm/datamanage/card/page',
      { corporationId: CORP, orgPath: ORG_PATH },
      { pageSize: PAGE_SIZE, maxPages: 60, label: 'card/page' }
    );
    cards = cardRes.items.map((row) => project(row, CARD_FIELD_ALLOWLIST));

    const custRes = await fetchCrmList(
      session.call,
      '/crm/datamanage/customer/page',
      { corporationId: CORP },
      { pageSize: PAGE_SIZE, maxPages: 60, label: 'customer/page' }
    );
    customers = custRes.items.map((row) => project(row, CUSTOMER_FIELD_ALLOWLIST));
  } finally {
    await session.close();
  }

  if (cards.length < MIN_CARDS) {
    throw new PosQueryError(`卡列表只拿到 ${cards.length} 张（下限 ${MIN_CARDS}）—— 多半被过滤条件截断，拒绝写快照`);
  }

  // ---- 按 customerId 聚合卡端 ----
  const byMember = new Map();
  const ensure = (memberId) => {
    let m = byMember.get(memberId);
    if (!m) {
      m = {
        member_id: memberId,
        has_profile: false,
        has_card: false,
        card_count: 0,
        card_nos: [],
        pos_shop_id: null,
        level_name: null,
        growth: null,
        points: 0,
        balance: 0,
        money_balance: 0,
        gift_balance: 0,
        frozen_balance: 0,
        recharge_amount_total: 0,
        recharge_count: 0,
        consumption_amount_total: 0,
        consumption_count: 0,
        last_recharge_time: null,
        last_trans_time: null,
        card_created_at: null,
        card_status: null,
        profile_created_at: null,
        initial_shop_id: null,
        source_type: null,
        subscribed: null,
        phone_country_code: null,
        phone_national: null,
        // 刻意**不输出** phone_e164：库里 pos_member.phone_e164 是
        // GENERATED ALWAYS AS ('+' || country_code || national) STORED 的生成列，
        // 往生成列写值会硬报 428C9 cannot insert a non-DEFAULT value。
        // 由数据库做 e164 的唯一真相源，避免两个仓库对同一条规则各写各的。
        // 注意 normalizePhone 在「号内已含国家码」时算的是 '+' + national（不再拼国家码），
        // 与生成列的无条件拼接不一致 —— 实机 4,823 个号命中该分支 0 条，
        // 所以今天两者结果相同；真出现时以 phone_warnings 里的
        // country_code_embedded_in_national 为准，走人工判读（见 060 附录 B）。
        phone_source: null,
        phone_warnings: [],
      };
      byMember.set(memberId, m);
    }
    return m;
  };
  const maxTime = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
  const minTime = (a, b) => (!a ? b : !b ? a : a < b ? a : b);

  const phoneWarningCounts = {};
  const notePhoneWarnings = (warnings) => {
    for (const w of warnings) phoneWarningCounts[w] = (phoneWarningCounts[w] || 0) + 1;
  };

  for (const c of cards) {
    const memberId = str(c.customerId);
    if (!memberId) continue;
    const m = ensure(memberId);
    m.has_card = true;
    m.card_count += 1;
    if (c.cardNo) m.card_nos.push(String(c.cardNo));
    // 单店：shopId 只有 '406994127' 与 '0'（未归店/线上）。取非 0 的那个作为归属。
    if (m.pos_shop_id == null || (m.pos_shop_id === '0' && str(c.shopId) !== '0')) m.pos_shop_id = str(c.shopId);
    if (c.levelName) m.level_name = String(c.levelName);
    const growth = int(c.levelAccount?.growth);
    if (growth != null) m.growth = (m.growth || 0) + growth;
    m.points += int(c.points) || 0;
    m.balance += cents(c.balance) || 0;
    m.money_balance += cents(c.moneyBalance) || 0;
    m.gift_balance += cents(c.giftBalance) || 0;
    m.frozen_balance += cents(c.frozenBalance) || 0;
    const s = c.cardSummary || {};
    m.recharge_amount_total += cents(s.rechargeAmountTotal) || 0;
    m.recharge_count += int(s.rechargeCount) || 0;
    m.consumption_amount_total += cents(s.consumptionAmountTotal) || 0;
    m.consumption_count += int(s.consumptionCount) || 0;
    m.last_recharge_time = maxTime(m.last_recharge_time, str(s.lastRechargeTime));
    m.last_trans_time = maxTime(m.last_trans_time, str(s.lastTransTime));
    m.card_created_at = minTime(m.card_created_at, str(c.createTime));
    if (m.card_status == null) m.card_status = int(c.status);
    // 手机号优先取卡端：覆盖全部 4821 人、0 空值，且与档案端实测 3710/3710 一致。
    if (!m.phone_national) {
      const p = normalizePhone(c.areaCode, c.phone);
      if (p.national) {
        m.phone_country_code = p.countryCode;
        m.phone_national = p.national;
        m.phone_source = 'card';
        m.phone_warnings = p.warnings;
        notePhoneWarnings(p.warnings);
      }
    }
  }

  // ---- 左连档案端（只有 3 个非 PII 列 + 手机号兜底）----
  for (const c of customers) {
    const memberId = str(c.id);
    if (!memberId) continue;
    const m = ensure(memberId);
    m.has_profile = true;
    m.profile_created_at = str(c.createTime);
    m.initial_shop_id = str(c.initialShopId);
    m.source_type = int(c.sourceType);
    m.subscribed = c.subscribed == null ? null : !!c.subscribed;
    m.last_trans_time = maxTime(m.last_trans_time, str(c.lastTransTime));
    if (!m.phone_national) {
      const p = normalizePhone(c.areaCode, c.phone);
      if (p.national) {
        m.phone_country_code = p.countryCode;
        m.phone_national = p.national;
        m.phone_source = 'profile';
        m.phone_warnings = p.warnings;
        notePhoneWarnings(p.warnings);
      }
    }
  }

  const members = [...byMember.values()].map((m) => ({
    ...m,
    // 金额收口到 2 位，避免浮点尾巴写进 numeric(14,2)
    balance: +m.balance.toFixed(2),
    money_balance: +m.money_balance.toFixed(2),
    gift_balance: +m.gift_balance.toFixed(2),
    frozen_balance: +m.frozen_balance.toFixed(2),
    recharge_amount_total: +m.recharge_amount_total.toFixed(2),
    consumption_amount_total: +m.consumption_amount_total.toFixed(2),
  }));

  if (members.length < MIN_MEMBERS) {
    throw new PosQueryError(`并集只有 ${members.length} 个会员（下限 ${MIN_MEMBERS}）—— 拒绝写快照`);
  }

  const withPhone = members.filter((m) => m.phone_national).length;
  const totals = members.reduce(
    (a, m) => {
      a.balance += m.balance;
      a.money += m.money_balance;
      a.gift += m.gift_balance;
      return a;
    },
    { balance: 0, money: 0, gift: 0 }
  );

  const meta = {
    scrapedAt: new Date().toISOString(),
    businessDate: BUSINESS_DATE,
    snapshotDate: BUSINESS_DATE,
    source: { cards: 'crm/datamanage/card/page', profiles: 'crm/datamanage/customer/page' },
    amountUnit: 'MYR',
    amountNote: '/crm 接口返回整数分，本脚本已除以 100',
    cardsScanned: cards.length,
    profilesScanned: customers.length,
    memberCount: members.length,
    membersWithProfile: members.filter((m) => m.has_profile).length,
    membersWithCard: members.filter((m) => m.has_card).length,
    membersWithPhone: withPhone,
    membersWithoutPhone: members.length - withPhone,
    phoneWarningCounts,
    balanceTotals: {
      balance: +totals.balance.toFixed(2),
      moneyBalance: +totals.money.toFixed(2),
      giftBalance: +totals.gift.toFixed(2),
    },
    durationMs: Date.now() - started,
    complete: true,
  };

  // 产物含手机号（用户已决定入库）→ 0600，别让同机其它进程随手读到。
  fs.writeFileSync(OUT_FILE, JSON.stringify({ meta, members }, null, 1), { mode: 0o600 });
  fs.chmodSync(OUT_FILE, 0o600);

  console.log(
    `[member-snapshot] 卡 ${cards.length} 张 / 档案 ${customers.length} 份 -> 会员 ${members.length} 人` +
      `（有档案 ${meta.membersWithProfile}，有卡 ${meta.membersWithCard}，有手机号 ${withPhone}）`
  );
  console.log(
    `[member-snapshot] 余额合计 RM ${meta.balanceTotals.balance}（本金 ${meta.balanceTotals.moneyBalance} / 赠送 ${meta.balanceTotals.giftBalance}）`
  );
  if (Object.keys(phoneWarningCounts).length) {
    console.log(`[member-snapshot] 手机号归一化告警（只报计数，不报号码）: ${JSON.stringify(phoneWarningCounts)}`);
  }
  console.log(`[member-snapshot] 写入 ${OUT_FILE}（${Math.round(meta.durationMs / 1000)}s）`);
}

try {
  await main();
} catch (e) {
  console.error(`[member-snapshot] FAILED: ${e.message}`);
  if (!e.exitCode) console.error(e.stack);
  process.exit(exitCodeFor(e));
}
