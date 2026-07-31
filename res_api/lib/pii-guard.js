// 会员数据的 PII 边界。零依赖，纯函数，可单测。
//
// 定位：**正面白名单**，不是「见到已知 PII 才删」。POS 的 /crm 接口一行返回 40+ 个字段，
// 其中大半是姓名/邮箱/生日/证件/地址；黑名单方案的失败模式是 POS 哪天加了个新字段，
// 我们静默地把它抄进 output/ 和数据库。白名单方案的失败模式是新字段被丢掉 —— 可接受得多。
//
// 【手机号：用户已决定入库】areaCode / phone 在白名单里，会真的落到 output/member/snapshot.json
// 与 pos_member 表。姓名/邮箱/生日/性别/证件/地址仍然一律不落。
// 报表 100150 的 D_customerPhone 特意在**拒绝**的一边：它是查询时联当前档案取的值
// （改号后连历史流水行的号码都会被改写），落进流水表只会得到 14,386 份同批过期副本。
// 手机号只从 /crm 的 card/page ∪ customer/page 进 pos_member 一处。
//
// normalizePhone 的两条正则必须与迁移文件里 pos_member 的两条 CHECK 保持一致，改一边要改另一边。

/** 硬拒名单，优先级高于白名单（防止有人手滑把字段加进白名单）。 */
export const DENY_FIELDS = new Set([
  // /crm 档案与卡列表
  'firstName',
  'middleName',
  'lastName',
  'nick',
  'email',
  'birthday',
  'birthdayMd',
  'birthdayType',
  'birthdayModifyTime',
  'starSign',
  'sex',
  'idCard',
  'idCardType',
  'address',
  'postalCode',
  'nationality',
  'licensePlateNumber',
  'avatar',
  'description',
  'identities',
  'customizedInfo',
  'platformInfoList',
  'createdBy',
  'modifiedBy',
  // 报表引擎 100150
  'D_customerName',
  'D_customerPhone', // 见文件头：手机号不从流水进库
  'D_customerEmail',
  'D_orderRemark', // 自由文本，店员可能手打进客人手机号 —— 整个设计的旁路，解析阶段就丢
  'D_operator', // 员工标识，实机 distinct=1，零审计价值
]);

/** 白名单里属于 PII 的子集，驱动日志脱敏与 redactForDisk。 */
export const PII_FIELDS = new Set(['areaCode', 'phone', 'phone_national', 'phone_e164']);

/** /crm/datamanage/card/page 允许存活的字段（支持点号路径）。金额单位是**整数分**。 */
export const CARD_FIELD_ALLOWLIST = [
  'id',
  'customerId',
  'cardNo',
  'physicalCardNo',
  'cardProgramId',
  'cardProgramName',
  'type',
  'status',
  'levelName',
  'levelAccount.growth',
  'points',
  'balance',
  'availableBalance',
  'moneyBalance',
  'giftBalance',
  'frozenBalance',
  'frozenMoneyBalance',
  'frozenGiftBalance',
  'createTime',
  'shopId',
  'sourceType',
  'currency',
  'expirationTime',
  'noExpiration',
  'cardSummary.rechargeAmountTotal',
  'cardSummary.rechargeCount',
  'cardSummary.consumptionAmountTotal',
  'cardSummary.consumptionCount',
  'cardSummary.lastRechargeTime',
  'cardSummary.lastTransTime',
  // 手机号（用户已决定入库）
  'areaCode',
  'phone',
];

/** /crm/datamanage/customer/page 允许存活的字段。其余全是 PII。 */
export const CUSTOMER_FIELD_ALLOWLIST = [
  'id',
  'createTime',
  'initialShopId',
  'initialShopTime',
  'sourceType',
  'subscribed',
  'isMember',
  'lastTransTime',
  'lastTransShopId',
  'areaCode',
  'phone',
];

/** 报表 100150（会员卡流水）允许存活的字段。**不含任何手机号/姓名/邮箱/备注/操作员**。 */
export const TXN_FIELD_ALLOWLIST = [
  'D_date',
  'D_CustomerTrans_transactionTime',
  'D_transSerialNumber',
  'D_orderId',
  'D_posOrderId',
  'D_memberCardNo',
  'D_Member_customerId',
  'D_memberTransactionType',
  'D_tradeType',
  'D_shopId',
  'D_source',
  'D_cardLevel',
  'D_currency',
  'M_Trade_Sum_tradeAmount',
  'M_Trade_Sum_moneyAmount',
  'M_Trade_Sum_giftAmount',
  'M_Trade_Sum_countAmount',
  'M_Trade_Sum_point',
  'M_Trade_Sum_beforeMoneyBalance',
  'M_Trade_Sum_afterMoneyBalance',
  'M_Trade_Sum_beforeGiftBalance',
  'M_Trade_Sum_afterGiftBalance',
];

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * 白名单投影：只保留 allowlist 里的路径，其余一律丢弃。
 * allowlist 里出现 DENY_FIELDS 的成员 = 编程错误，直接抛（不静默放行）。
 */
export function project(row, allowlist) {
  if (row == null || typeof row !== 'object') return {};
  for (const path of allowlist) {
    const leaf = path.split('.').pop();
    if (DENY_FIELDS.has(leaf)) {
      throw new Error(`[pii-guard] 白名单里出现了硬拒字段 "${path}" —— 拒绝执行`);
    }
  }
  const out = {};
  for (const path of allowlist) {
    const v = getPath(row, path);
    if (v !== undefined) setPath(out, path, v);
  }
  return out;
}

const digits = (v) => String(v ?? '').replace(/\D/g, '');

// 与迁移文件里 pos_member 的两条 CHECK 保持一致。
export const COUNTRY_CODE_RE = /^[1-9][0-9]{0,3}$/;
export const NATIONAL_RE = /^[1-9][0-9]{5,14}$/;

/**
 * 手机号归一化。POS 侧永远是 areaCode + phone 两个字段分开存，phone 不含国家码。
 * 实机的两个坑（各自对应一条 warning，warning 里**绝不带原值**）：
 *   1. 11 条号码把长途冠码 0 填进了 phone（'0123456789'）→ 去前导 0，否则同一人会被算成两个号。
 *   2. 1 条号码本身以 '60' 开头且 areaCode 也是 '60' → 直接拼接会变成 +6060...；
 *      判据：本地号以国家码开头 **且** 去掉国家码后仍有 >= 7 位（否则会误伤 '60xxxxx' 这种真实本地号）。
 * 返回 { countryCode, national, e164, warnings[] }；任何一段不合规就置 null 并记 warning，绝不把原值塞进去。
 */
export function normalizePhone(areaCode, phone) {
  const warnings = [];
  const rawCc = digits(areaCode);
  const rawNational = digits(phone);

  if (!rawNational) {
    if (String(phone ?? '').trim() !== '') warnings.push('national_not_numeric');
    return { countryCode: rawCc && COUNTRY_CODE_RE.test(rawCc) ? rawCc : null, national: null, e164: null, warnings };
  }

  let national = rawNational.replace(/^0+/, '');
  if (national !== rawNational) warnings.push('leading_zero_stripped');

  let countryCode = rawCc || null;
  if (!countryCode) warnings.push('missing_country_code');
  else if (!COUNTRY_CODE_RE.test(countryCode)) {
    warnings.push('invalid_country_code');
    countryCode = null;
  }

  if (!NATIONAL_RE.test(national)) {
    warnings.push('invalid_national');
    national = null;
  }

  let e164 = null;
  if (countryCode && national) {
    if (national.startsWith(countryCode) && national.length - countryCode.length >= 7) {
      // 号内已含国家码：拼接会得到 +6060...
      warnings.push('country_code_embedded_in_national');
      e164 = `+${national}`;
    } else {
      e164 = `+${countryCode}${national}`;
    }
  }
  return { countryCode, national, e164, warnings };
}

/** 日志专用：+60•••••••12（保国家码 + 末 2 位）。日志里出现手机号只允许是这个形态。 */
export function maskPhone(value) {
  const s = String(value ?? '');
  if (!s) return '';
  const plus = s.startsWith('+');
  const d = digits(s);
  if (d.length <= 2) return (plus ? '+' : '') + '•'.repeat(d.length);
  const cc = plus ? d.slice(0, Math.min(2, d.length - 2)) : '';
  const tail = d.slice(-2);
  const hidden = d.length - cc.length - tail.length;
  return `${plus ? '+' : ''}${cc}${'•'.repeat(Math.max(hidden, 1))}${tail}`;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * 出口断言：给流水 / 日汇总的行用（这两张表一个 PII 字段都不该有）。
 * 命中硬拒字段名、或在任何字符串值里发现邮箱，立刻抛错 —— 让「哪天有人手滑加回来」
 * 在同步时炸掉，而不是静默泄露。返回命中的键路径列表（供测试断言）。
 */
export function scanForPii(obj, { allowPhoneFields = false, path = '' } = {}) {
  const hits = [];
  const walk = (node, prefix, depth) => {
    if (node == null || depth > 12) return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${prefix}[${i}]`, depth + 1));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (DENY_FIELDS.has(k)) hits.push(p);
        else if (!allowPhoneFields && PII_FIELDS.has(k)) hits.push(p);
        else walk(v, p, depth + 1);
      }
      return;
    }
    if (typeof node === 'string' && EMAIL_RE.test(node)) hits.push(`${prefix}<email-in-value>`);
  };
  walk(obj, path, 0);
  return hits;
}

export function assertNoPii(row, { context = 'row', allowPhoneFields = false } = {}) {
  const hits = scanForPii(row, { allowPhoneFields });
  if (hits.length) {
    throw new Error(`[pii-guard] ${context} 含 PII 字段: ${hits.join(', ')}`);
  }
  return row;
}

/**
 * 调试落盘专用：结构与字段名保真，PII 值换成占位符。
 * output/ 目录没有 REVOKE 也没有 RLS —— 任何 debug dump 只能走这里。
 * （每晚正式产物 output/member/snapshot.json 是**要入库的真数据**，不走这个函数。）
 */
export function redactForDisk(value, depth = 0) {
  if (value == null || depth > 12) return value;
  if (Array.isArray(value)) return value.map((v) => redactForDisk(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (DENY_FIELDS.has(k)) continue; // 直接丢，不留占位符
    if (PII_FIELDS.has(k)) out[k] = v == null || v === '' ? v : maskPhone(v);
    else out[k] = redactForDisk(v, depth + 1);
  }
  return out;
}
