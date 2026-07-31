// PII 边界的单测。全部用**真实形状的假数据**（号码是编的，不是实机值）。
//
// 这个文件要挡住的两类事故：
//   1. 有人往白名单里加了个字段，把姓名/邮箱/生日顺手带进 output/ 或数据库；
//   2. 手机号归一化写错，把实机存在的两个畸形（前导 0、号内含国家码）拼成错号，
//      导致同一个人被算成两个号 / 拼出 +6060… 这种打不通的号。

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CARD_FIELD_ALLOWLIST,
  CUSTOMER_FIELD_ALLOWLIST,
  DENY_FIELDS,
  TXN_FIELD_ALLOWLIST,
  assertNoPii,
  maskPhone,
  normalizePhone,
  project,
  redactForDisk,
  scanForPii,
} from '../lib/pii-guard.js';

// ---- 真实形状的假数据 -------------------------------------------------------

// /crm/datamanage/card/page 一行（字段名与嵌套结构照实机，值全是编的）
const fakeCardRow = {
  id: '2046463535042785281',
  corporationId: '450020844',
  customerId: '2020048499445559296',
  cardNo: '2015446101343285256',
  physicalCardNo: '',
  cardProgramId: '1991044916737863680',
  cardProgramName: 'HOT CRUSH 储值卡',
  type: 1,
  status: 10,
  levelName: 'VIP1',
  levelAccount: { growth: '120', levelId: '1998685858403844100' },
  points: '340',
  balance: '12000',
  moneyBalance: '10000',
  giftBalance: '2000',
  frozenBalance: '0',
  createTime: '2026-04-21T05:38:22.865+00:00',
  shopId: '406994127',
  sourceType: 1001,
  cardSummary: {
    rechargeAmountTotal: '40000',
    rechargeCount: '4',
    consumptionAmountTotal: '28000',
    consumptionCount: '17',
    lastRechargeTime: '2026-07-25T09:47:18.346+00:00',
    lastTransTime: '2026-07-25T20:26:10.900145',
  },
  // ↓ 以下全部必须被剥掉
  firstName: 'Test User',
  middleName: '',
  lastName: 'Tan',
  email: 'nobody@example.com',
  birthday: '1990-01-01',
  sex: 2,
  idCard: '',
  address: '',
  nick: '',
  avatar: '',
  description: '内部备注',
  identities: [{ type: 'wechat', openId: 'ox_fake' }],
  customizedInfo: '{}',
  // ↓ 手机号：用户已决定入库，必须被保留
  areaCode: '60',
  phone: '123456789',
  isoCode: null,
};

// /crm/datamanage/customer/page 一行
const fakeCustomerRow = {
  id: '2020048499445559296',
  createTime: '2026-01-11T03:22:11.000+00:00',
  initialShopId: '406994127',
  initialShopTime: '2026-01-11T03:22:11.000+00:00',
  sourceType: 1001,
  subscribed: true,
  isMember: true,
  lastTransTime: '2026-07-25T20:26:10.900145',
  lastTransShopId: '0',
  areaCode: '60',
  phone: '123456789',
  firstName: 'Test User',
  lastName: 'Tan',
  email: 'nobody@example.com',
  birthday: '1990-01-01',
  sex: 2,
  idCard: '',
  address: '',
  postalCode: '',
  nationality: '',
  licensePlateNumber: '',
  starSign: 0,
  modifyTime: '2026-04-26T02:00:00.000+00:00',
};

// 报表 100150 一行（引擎已 flatten 过）
const fakeTxnRow = {
  D_date: '2026-07-25',
  D_CustomerTrans_transactionTime: '2026-07-25T20:26:10.900145',
  D_transSerialNumber: '2080993008651898889',
  D_orderId: '2080993008509272143',
  D_posOrderId: '20260725202540700559410940',
  D_memberCardNo: '2020048499491696648',
  D_Member_customerId: '2020048499445559296',
  D_memberTransactionType: '20',
  D_tradeType: '20',
  D_shopId: '406994127',
  D_source: '1001',
  D_cardLevel: 'VIP1',
  D_currency: 'MYR',
  M_Trade_Sum_tradeAmount: '32.50',
  M_Trade_Sum_moneyAmount: '26.00',
  M_Trade_Sum_giftAmount: '6.50',
  M_Trade_Sum_countAmount: '32.50',
  M_Trade_Sum_point: '0',
  M_Trade_Sum_beforeMoneyBalance: '126.00',
  M_Trade_Sum_afterMoneyBalance: '100.00',
  M_Trade_Sum_beforeGiftBalance: '26.50',
  M_Trade_Sum_afterGiftBalance: '20.00',
  // ↓ 必须被剥掉
  D_customerName: 'Test User',
  D_customerPhone: '123456789',
  D_customerEmail: 'nobody@example.com',
  D_orderRemark: '客人电话 0123456789 打包',
  D_operator: 'cashier-account-string-25',
  D_shopName: '406994127',
};

const EXCLUDED = [
  'firstName',
  'middleName',
  'lastName',
  'email',
  'birthday',
  'sex',
  'idCard',
  'address',
  'nick',
  'avatar',
  'description',
  'identities',
  'D_customerName',
  'D_customerEmail',
  'D_orderRemark',
  'D_operator',
  'D_customerPhone',
];

const deepKeys = (obj, prefix = '', acc = []) => {
  if (obj == null || typeof obj !== 'object') return acc;
  for (const [k, v] of Object.entries(obj)) {
    acc.push(k);
    deepKeys(v, `${prefix}${k}.`, acc);
  }
  return acc;
};

// ---- 白名单投影 -------------------------------------------------------------

test('卡列表投影后：被排除的字段一个都不出现，手机号与业务字段保留', () => {
  const out = project(fakeCardRow, CARD_FIELD_ALLOWLIST);
  const keys = deepKeys(out);
  for (const f of EXCLUDED) assert.ok(!keys.includes(f), `${f} 不该出现在产物里`);
  // 白名单外的普通字段也一样丢掉（正面白名单，不是黑名单）
  assert.ok(!keys.includes('isoCode'));
  assert.ok(!keys.includes('corporationId'));
  // 该留的
  assert.equal(out.customerId, '2020048499445559296');
  assert.equal(out.levelName, 'VIP1');
  assert.equal(out.levelAccount.growth, '120');
  assert.equal(out.cardSummary.rechargeAmountTotal, '40000');
  assert.equal(out.areaCode, '60');
  assert.equal(out.phone, '123456789');
});

test('档案投影后只剩非 PII 三件套 + 手机号', () => {
  const out = project(fakeCustomerRow, CUSTOMER_FIELD_ALLOWLIST);
  const keys = deepKeys(out);
  for (const f of EXCLUDED) assert.ok(!keys.includes(f), `${f} 不该出现在产物里`);
  assert.deepEqual(
    Object.keys(out).sort(),
    ['areaCode', 'createTime', 'id', 'initialShopId', 'initialShopTime', 'isMember', 'lastTransShopId', 'lastTransTime', 'phone', 'sourceType', 'subscribed'].sort()
  );
});

test('流水行投影后一个 PII 字段都没有 —— 手机号也不从报表进流水表', () => {
  const out = project(fakeTxnRow, TXN_FIELD_ALLOWLIST);
  const keys = deepKeys(out);
  for (const f of EXCLUDED) assert.ok(!keys.includes(f), `${f} 不该出现在流水里`);
  assert.ok(!keys.includes('areaCode') && !keys.includes('phone'));
  assert.equal(out.D_transSerialNumber, '2080993008651898889');
  assert.equal(out.M_Trade_Sum_tradeAmount, '32.50');
  // D_orderRemark 是自由文本旁路：店员可能把客人手机号打在这里，解析阶段就得丢
  assert.ok(!JSON.stringify(out).includes('0123456789'));
});

test('往白名单里手滑加一个硬拒字段 -> 直接抛错，不静默放行', () => {
  assert.throws(() => project(fakeCardRow, ['id', 'email']), /硬拒字段/);
  assert.throws(() => project(fakeTxnRow, ['D_date', 'D_customerPhone']), /硬拒字段/);
});

test('投影不会凭空造字段（源里没有的路径不出现）', () => {
  const out = project({ id: 'x' }, CUSTOMER_FIELD_ALLOWLIST);
  assert.deepEqual(Object.keys(out), ['id']);
});

// ---- 出口断言 ---------------------------------------------------------------

test('assertNoPii：流水/日汇总的行里出现任何 PII 键都要炸', () => {
  const clean = project(fakeTxnRow, TXN_FIELD_ALLOWLIST);
  assert.doesNotThrow(() => assertNoPii(clean, { context: '流水' }));
  assert.throws(() => assertNoPii({ ...clean, D_customerPhone: '123456789' }), /D_customerPhone/);
  assert.throws(() => assertNoPii({ ...clean, phone: '123456789' }), /phone/);
  assert.throws(() => assertNoPii({ business_date: '2026-07-25', note: 'a@b.com' }), /email-in-value/);
});

test('assertNoPii 对会员快照行放行手机号（allowPhoneFields），但姓名邮箱照样炸', () => {
  const row = { member_id: '1', phone_national: '123456789', phone_e164: '+60123456789' };
  assert.doesNotThrow(() => assertNoPii(row, { allowPhoneFields: true }));
  assert.throws(() => assertNoPii({ ...row, firstName: 'X' }, { allowPhoneFields: true }), /firstName/);
});

test('scanForPii 能穿透嵌套与数组', () => {
  const hits = scanForPii({ a: { b: [{ email: 'x@y.com' }] } });
  assert.deepEqual(hits, ['a.b[0].email']);
});

test('DENY_FIELDS 与三张白名单没有交集', () => {
  for (const list of [CARD_FIELD_ALLOWLIST, CUSTOMER_FIELD_ALLOWLIST, TXN_FIELD_ALLOWLIST]) {
    for (const p of list) assert.ok(!DENY_FIELDS.has(p.split('.').pop()), `${p} 同时在白名单与硬拒名单里`);
  }
});

// ---- normalizePhone：实机的两个坑 ------------------------------------------

test('坑一：本地号带前导 0（长途冠码被填进 phone）-> 去掉，否则同一人会被算成两个号', () => {
  const r = normalizePhone('60', '0123456789');
  assert.equal(r.national, '123456789');
  assert.equal(r.e164, '+60123456789');
  assert.ok(r.warnings.includes('leading_zero_stripped'));
  // 去零后必须与「本来就没有前导 0」的同号完全一致
  assert.equal(r.e164, normalizePhone('60', '123456789').e164);
});

test('坑二：本地号自身以国家码 60 开头 -> 不许拼成 +6060…', () => {
  const r = normalizePhone('60', '60123456789');
  assert.equal(r.e164, '+60123456789', '号内已含国家码时直接加 + 即可');
  assert.ok(!r.e164.startsWith('+6060'));
  assert.ok(r.warnings.includes('country_code_embedded_in_national'));
});

test('坑二的误伤边界：真实本地号以 60 开头但剩余位数不足 7 位时照常拼接', () => {
  // '60123456' 去掉 '60' 只剩 6 位，不可能是完整本地号 -> 按普通号处理
  const r = normalizePhone('60', '60123456');
  assert.equal(r.e164, '+6060123456');
  assert.ok(!r.warnings.includes('country_code_embedded_in_national'));
});

test('两个坑叠加：既有前导 0 又以国家码开头', () => {
  const r = normalizePhone('60', '060123456789');
  assert.equal(r.national, '60123456789');
  assert.equal(r.e164, '+60123456789');
  assert.deepEqual(r.warnings.sort(), ['country_code_embedded_in_national', 'leading_zero_stripped']);
});

test('非 60 的国家码原样保留（实机有 17 种，60 只占 95.8%）', () => {
  assert.equal(normalizePhone('65', '91234567').e164, '+6591234567');
  assert.equal(normalizePhone('886', '912345678').e164, '+886912345678');
  assert.equal(normalizePhone('1', '2025550143').e164, '+12025550143');
});

test('空号 / 空国家码 / 畸形值：置 NULL 并记 warning，绝不把原值塞进去', () => {
  const empty = normalizePhone('', '');
  assert.equal(empty.national, null);
  assert.equal(empty.e164, null);

  const noCc = normalizePhone('', '123456789');
  assert.equal(noCc.national, '123456789');
  assert.equal(noCc.e164, null, '不猜国家码');
  assert.ok(noCc.warnings.includes('missing_country_code'));

  const junk = normalizePhone('60', 'abc');
  assert.equal(junk.national, null);
  assert.equal(junk.e164, null);

  const tooShort = normalizePhone('60', '12345');
  assert.equal(tooShort.national, null);
  assert.ok(tooShort.warnings.includes('invalid_national'));
});

test('warning 里不许带号码原值（告警会进明文日志）', () => {
  const r = normalizePhone('60', '0123456789');
  for (const w of r.warnings) {
    assert.ok(!/\d{5,}/.test(w), `warning "${w}" 里带了数字串`);
  }
});

test('分隔符/加号是防御性处理（现网 100% 纯数字，但不能因此炸）', () => {
  assert.equal(normalizePhone('+60', '012-345 6789').e164, '+60123456789');
});

// ---- 日志与调试落盘 ---------------------------------------------------------

test('maskPhone 只留国家码与末两位', () => {
  const masked = maskPhone('+60123456789');
  assert.match(masked, /^\+60•+89$/);
  assert.ok(!masked.includes('1234567'));
  assert.equal(maskPhone(''), '');
});

test('redactForDisk：调试 dump 里字段名与结构保真，PII 值被占位，硬拒字段整个消失', () => {
  const dump = redactForDisk(fakeCardRow);
  const s = JSON.stringify(dump);
  for (const f of EXCLUDED) assert.ok(!Object.keys(dump).includes(f), `${f} 不该出现在 debug dump 里`);
  assert.ok(!s.includes('123456789'), '手机号不能以明文进调试产物');
  assert.ok(!s.includes('nobody@example.com'));
  assert.equal(dump.cardSummary.rechargeAmountTotal, '40000', '非 PII 字段原样保留');
  assert.match(dump.phone, /•/);
});
