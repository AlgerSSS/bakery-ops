import { createHash, createHmac } from "node:crypto";

import {
  effectiveCardLevelId,
  isActiveProgramCard,
  LOYALTY_LEVELS,
} from "./loyalty-levels.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_RE = /{{\s*([a-z][a-z0-9_]*)\s*}}/g;
const URL_VARIABLES = new Set([
  "birthday_card_url",
  "member_center_url",
  "reservation_url",
  "unsubscribe_url",
]);
const UNSAFE_HTML = [
  /<(?:script|iframe|object|embed|form|input|button|link|meta|base|svg|math)\b/i,
  /\son[a-z]+\s*=/i,
  /\bsrcdoc\s*=/i,
  /\bjavascript\s*:/i,
  /\bdata\s*:\s*text\/html/i,
];

export const TEMPLATE_POLICIES = Object.freeze({
  birthday_cake_t5: Object.freeze({
    offsetDays: 5,
    eligibleLevels: Object.freeze(["L3", "L4"]),
    variables: Object.freeze([
      "member_name",
      "birthday_date",
      "reservation_url",
      "unsubscribe_url",
    ]),
  }),
  birthday_basque_t2: Object.freeze({
    offsetDays: 2,
    eligibleLevels: Object.freeze(["L2", "L3", "L4"]),
    variables: Object.freeze([
      "member_name",
      "birthday_date",
      "reservation_url",
      "unsubscribe_url",
    ]),
  }),
  birthday_card_t0: Object.freeze({
    offsetDays: 0,
    eligibleLevels: null,
    variables: Object.freeze([
      "member_name",
      "birthday_date",
      "birthday_card_url",
      "unsubscribe_url",
    ]),
  }),
  tier_upgrade: Object.freeze({
    variables: Object.freeze([
      "member_name",
      "old_level",
      "new_level",
      "effective_date",
      "member_center_url",
      "unsubscribe_url",
    ]),
  }),
  tier_downgrade: Object.freeze({
    variables: Object.freeze([
      "member_name",
      "old_level",
      "new_level",
      "effective_date",
      "member_center_url",
      "unsubscribe_url",
    ]),
  }),
});

const levelById = new Map(
  LOYALTY_LEVELS.map((level) => [level.resLevelId, level]),
);

function textField(value, label, { maxLength = 100_000 } = {}) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a text field.`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new TypeError(`${label} exceeds ${maxLength} characters.`);
  }
  return text;
}

export function normalizeTemplateRecords(records) {
  if (!Array.isArray(records)) {
    throw new TypeError("Lark Base template records must be an array.");
  }
  const templates = new Map();
  for (const record of records) {
    const fields = record?.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new TypeError("A Lark Base template record has no fields object.");
    }
    const code = textField(fields["模板代码"], "模板代码", {
      maxLength: 80,
    });
    if (!Object.hasOwn(TEMPLATE_POLICIES, code)) {
      throw new Error(`Unknown template code: ${code || "<blank>"}.`);
    }
    if (templates.has(code)) {
      throw new Error(`Duplicate template code: ${code}.`);
    }
    const enabled = fields["启用"];
    if (enabled !== undefined && typeof enabled !== "boolean") {
      throw new TypeError(`${code} 启用 must be a checkbox value.`);
    }
    templates.set(code, {
      code,
      recordId: String(record?.record_id ?? record?.recordId ?? ""),
      name: textField(fields["模板名称"], `${code} 模板名称`, {
        maxLength: 120,
      }),
      schedule: textField(fields["发送规则"], `${code} 发送规则`, {
        maxLength: 200,
      }),
      enabled: enabled === true,
      subject: textField(fields["邮件标题"], `${code} 邮件标题`, {
        maxLength: 255,
      }),
      html: textField(fields["HTML内容"], `${code} HTML内容`),
      testRecipient: textField(
        fields["测试收件人"],
        `${code} 测试收件人`,
        { maxLength: 320 },
      ).toLowerCase(),
    });
  }
  return templates;
}

function placeholders(value) {
  return [...String(value).matchAll(PLACEHOLDER_RE)].map((match) => ({
    name: match[1],
    index: match.index,
    raw: match[0],
  }));
}

function assertSafeHtmlTemplate(html) {
  for (const pattern of UNSAFE_HTML) {
    if (pattern.test(html)) {
      throw new Error("Unsafe HTML is not allowed in an email template.");
    }
  }

  for (const placeholder of placeholders(html)) {
    const before = html.slice(0, placeholder.index);
    const insideTag = before.lastIndexOf("<") > before.lastIndexOf(">");
    if (!insideTag) continue;
    const attributeStart = before.slice(before.lastIndexOf("<"));
    const closingQuote = html[placeholder.index + placeholder.raw.length] ?? "";
    const attributeValue = `${attributeStart}${placeholder.raw}${closingQuote}`;
    const escapedName = placeholder.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const permittedUrlAttribute = new RegExp(
      `\\bhref\\s*=\\s*(["'])\\{\\{\\s*${escapedName}\\s*\\}\\}\\1$`,
      "i",
    );
    if (
      !URL_VARIABLES.has(placeholder.name) ||
      !permittedUrlAttribute.test(attributeValue)
    ) {
      throw new Error(
        `Placeholder ${placeholder.name} is not allowed inside an HTML tag.`,
      );
    }
  }
}

function assertAllowedPlaceholders(template, value) {
  const policy = TEMPLATE_POLICIES[template.code];
  if (!policy) throw new Error(`Unknown template code: ${template.code}.`);
  const allowed = new Set(policy.variables);
  for (const { name } of placeholders(value)) {
    if (!allowed.has(name)) {
      throw new Error(
        `Placeholder ${name} is not allowed for ${template.code}.`,
      );
    }
  }
  if (/{{|}}/.test(value.replace(PLACEHOLDER_RE, ""))) {
    throw new Error(`Malformed placeholder in ${template.code}.`);
  }
}

function stringVariable(name, value) {
  if (!["string", "number"].includes(typeof value)) {
    throw new TypeError(`Template variable ${name} must be text or a number.`);
  }
  const text = String(value);
  if (text.length > 4096) {
    throw new TypeError(`Template variable ${name} is too long.`);
  }
  if (URL_VARIABLES.has(name)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new TypeError(`Template variable ${name} must be a valid URL.`);
    }
    if (!["https:", "mailto:"].includes(url.protocol)) {
      throw new TypeError(
        `Template variable ${name} must use HTTPS or mailto.`,
      );
    }
    if (url.protocol === "https:" && (url.username || url.password)) {
      throw new TypeError(`Template variable ${name} must not contain credentials.`);
    }
  }
  return text;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function substitute(value, variables, { html }) {
  return value.replace(PLACEHOLDER_RE, (_raw, name) => {
    if (!Object.hasOwn(variables, name)) {
      throw new Error(`Template variable ${name} is missing.`);
    }
    const text = stringVariable(name, variables[name]);
    return html ? escapeHtml(text) : text.replace(/[\r\n]+/g, " ");
  });
}

export function renderTemplate(template, variables) {
  if (!template?.subject || !template?.html) {
    throw new Error(`${template?.code ?? "Template"} has no title or HTML.`);
  }
  if (/[\r\n]/.test(template.subject)) {
    throw new Error("Email subjects must not contain line breaks.");
  }
  assertAllowedPlaceholders(template, template.subject);
  assertAllowedPlaceholders(template, template.html);
  assertSafeHtmlTemplate(template.html);

  const subject = substitute(template.subject, variables, { html: false });
  const html = substitute(template.html, variables, { html: true });
  if (!subject.trim() || !html.trim() || /{{|}}/.test(`${subject}${html}`)) {
    throw new Error(`${template.code} did not render completely.`);
  }
  return { subject, html, plainText: htmlToPlainText(html) };
}

export function isValidEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  return email.length <= 320 && EMAIL_RE.test(email);
}

function plainDate(value, label) {
  const text = String(value ?? "");
  if (!DATE_RE.test(text)) throw new TypeError(`${label} must use YYYY-MM-DD.`);
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`${label} is not a valid date.`);
  }
  return date;
}

function shiftPlainDate(value, days) {
  const date = plainDate(value, "asOfDate");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function birthdayMonthDay(value) {
  const match = /^(?:\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(
    String(value ?? "").trim(),
  );
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const leapReference = new Date(Date.UTC(2000, month - 1, day));
  if (
    leapReference.getUTCMonth() !== month - 1 ||
    leapReference.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}`;
}

function levelByMember(cards, cardProgramId) {
  const levels = new Map();
  for (const card of cards) {
    if (!isActiveProgramCard(card, cardProgramId)) continue;
    const memberId = String(card?.customerId ?? "").trim();
    const level = levelById.get(effectiveCardLevelId(card));
    if (!memberId || !level) continue;
    const previous = levels.get(memberId);
    if (!previous || level.threshold > previous.threshold) {
      levels.set(memberId, level);
    }
  }
  return levels;
}

function memberName(customer) {
  const name = [customer?.firstName, customer?.middleName, customer?.lastName]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return name.slice(0, 128) || "HOT CRUSH Member";
}

export function buildBirthdayAudience(
  customers,
  cards,
  { asOfDate, cardProgramId },
) {
  plainDate(asOfDate, "asOfDate");
  if (!Array.isArray(customers) || !Array.isArray(cards)) {
    throw new TypeError("Birthday audience sources must be arrays.");
  }
  const levels = levelByMember(cards, cardProgramId);
  const schedule = Object.entries(TEMPLATE_POLICIES)
    .filter(([, policy]) => Number.isInteger(policy.offsetDays))
    .map(([templateCode, policy]) => {
      const eventDate = shiftPlainDate(asOfDate, policy.offsetDays);
      return {
        templateCode,
        policy,
        eventDate,
        monthDay: eventDate.slice(5),
      };
    });
  const candidates = [];
  const stats = {
    scannedCustomers: customers.length,
    validBirthdayProfiles: 0,
    birthdayProfilesWithValidEmail: 0,
    invalidBirthday: 0,
    dueBeforeEligibility: 0,
    notSubscribed: 0,
    missingOrInvalidEmail: 0,
    ineligibleTier: 0,
    duplicateEmailMembers: 0,
  };

  for (const customer of customers) {
    const memberId = String(customer?.id ?? "").trim();
    const monthDay = birthdayMonthDay(customer?.birthday);
    if (!memberId || !monthDay) {
      if (customer?.birthday) stats.invalidBirthday += 1;
      continue;
    }
    stats.validBirthdayProfiles += 1;
    if (isValidEmail(customer?.email)) {
      stats.birthdayProfilesWithValidEmail += 1;
    }
    const due = schedule.filter((item) => item.monthDay === monthDay);
    if (!due.length) continue;
    stats.dueBeforeEligibility += 1;
    if (customer?.subscribed !== true) {
      stats.notSubscribed += 1;
      continue;
    }
    const email = String(customer?.email ?? "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      stats.missingOrInvalidEmail += 1;
      continue;
    }
    const level = levels.get(memberId);
    for (const item of due) {
      if (
        item.policy.eligibleLevels &&
        (!level || !item.policy.eligibleLevels.includes(level.key))
      ) {
        stats.ineligibleTier += 1;
        continue;
      }
      candidates.push({
        templateCode: item.templateCode,
        memberId,
        memberName: memberName(customer),
        email,
        birthdayDate: item.eventDate,
        level: level?.key ?? null,
      });
    }
  }

  const emailCounts = new Map();
  for (const delivery of candidates) {
    const key = `${delivery.templateCode}\0${delivery.email}`;
    emailCounts.set(key, (emailCounts.get(key) ?? 0) + 1);
  }
  const deliveries = candidates.filter((delivery) => {
    const key = `${delivery.templateCode}\0${delivery.email}`;
    if (emailCounts.get(key) === 1) return true;
    stats.duplicateEmailMembers += 1;
    return false;
  });

  deliveries.sort(
    (a, b) =>
      TEMPLATE_POLICIES[a.templateCode].offsetDays -
        TEMPLATE_POLICIES[b.templateCode].offsetDays ||
      a.memberId.localeCompare(b.memberId),
  );
  return { deliveries, stats };
}

export function buildDedupeKey(templateCode, eventDate, memberId) {
  if (!Object.hasOwn(TEMPLATE_POLICIES, templateCode)) {
    throw new Error(`Unknown template code: ${templateCode}.`);
  }
  plainDate(eventDate, "eventDate");
  const member = String(memberId ?? "").trim();
  if (!member) throw new TypeError("memberId is required.");
  const digest = createHash("sha256")
    .update(`${templateCode}\0${eventDate}\0${member}`)
    .digest("hex")
    .slice(0, 24);
  return `hotcrush-${templateCode}-${eventDate}-${digest}`;
}

export function createBirthdayLink({
  memberId,
  memberName: name,
  secret,
  baseUrl = "https://birthday.hotcrush.net",
  now = new Date(),
  ttlDays = 30,
}) {
  const member = String(memberId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(member)) {
    throw new TypeError("Invalid member ID for birthday link.");
  }
  if (Buffer.byteLength(String(secret ?? ""), "utf8") < 32) {
    throw new TypeError("Birthday link secret must contain at least 32 bytes.");
  }
  if (!Number.isSafeInteger(ttlDays) || ttlDays < 1 || ttlDays > 90) {
    throw new TypeError("Birthday link TTL must be between 1 and 90 days.");
  }
  const origin = new URL(baseUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password) {
    throw new TypeError("Birthday link base URL must use HTTPS.");
  }
  const displayName = String(name ?? "").trim().slice(0, 64);
  const payload = {
    v: 1,
    mid: member,
    exp: Math.floor(now.getTime() / 1000) + ttlDays * 86_400,
  };
  if (displayName) payload.name = displayName;
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", String(secret))
    .update(body)
    .digest("base64url");
  const prefix = origin.toString().replace(/\/$/, "");
  return `${prefix}/t/${body}.${signature}`;
}

export function htmlToPlainText(html) {
  return String(html)
    .replace(/<(?:head|style)\b[^>]*>[\s\S]*?<\/(?:head|style)>/gi, "")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
