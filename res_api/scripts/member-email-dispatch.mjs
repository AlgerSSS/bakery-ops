#!/usr/bin/env node

import "dotenv/config";

import { spawn } from "node:child_process";

import {
  buildBirthdayAudience,
  buildDedupeKey,
  createBirthdayLink,
  isValidEmail,
  normalizeTemplateRecords,
  renderTemplate,
  TEMPLATE_POLICIES,
} from "../lib/member-email.js";
import {
  DEFAULT_CORPORATION_ID,
  exitCodeFor,
  fetchCrmList,
  openAuthedPage,
} from "../lib/report-client.js";

const DEFAULT_ORG_PATH = "/1000833/1000835/900846";
const DEFAULT_CARD_PROGRAM_ID = "1991044916737863680";
const DEFAULT_MAILBOX = "pavilionstore.my@hotcrush.net";
const DEFAULT_BASE_TOKEN = "CE6WbyvHNayXh8sgByWjArJlpvh";
const DEFAULT_TABLE_ID = "tble1DdoQGjfydrI";
const TEST_CONFIRMATION = "HOT_CRUSH_LARK_EMAIL_TEST_V1";
const LIVE_CONFIRMATION = "HOT_CRUSH_LARK_EMAIL_LIVE_V1";
const BIRTHDAY_TEMPLATE_CODES = new Set([
  "birthday_cake_t5",
  "birthday_basque_t2",
  "birthday_card_t0",
]);
const TIER_TEMPLATE_CODES = new Set(["tier_upgrade", "tier_downgrade"]);
const REQUIRED_TEMPLATE_CODES = new Set(Object.keys(TEMPLATE_POLICIES));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function usage() {
  return [
    "Usage:",
    "  npm run email:preview",
    "  npm run email:preview -- --preview-audience [--as-of=YYYY-MM-DD]",
    "  npm run email:dispatch -- --test-template=birthday_card_t0",
    `  npm run email:dispatch -- --test-template=birthday_card_t0 --send-test --confirm=${TEST_CONFIRMATION}`,
    `  npm run email:dispatch -- --send-live --limit=20 --confirm=${LIVE_CONFIRMATION}`,
    "",
    "Default mode reads and validates Lark Base only. It never sends email.",
    "A test send uses only the selected row's 测试收件人. Live delivery also",
    "requires MEMBER_EMAIL_LIVE_ENABLED=1 and MEMBER_EMAIL_CONSENT_MODE=res_subscribed.",
  ].join("\n");
}

function parseArgs(argv) {
  const known = new Set([
    "as-of",
    "confirm",
    "help",
    "limit",
    "preview-audience",
    "send-live",
    "send-test",
    "test-template",
  ]);
  const parsed = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) throw new Error(`Unknown argument: ${raw}`);
    const [key, ...rest] = raw.slice(2).split("=");
    if (!known.has(key)) throw new Error(`Unknown argument: --${key}`);
    if (Object.hasOwn(parsed, key)) {
      throw new Error(`Duplicate argument: --${key}`);
    }
    parsed[key] = rest.length ? rest.join("=") : true;
  }
  if (parsed.help) return { help: true };

  const today = todayInKualaLumpur();
  const asOfDate = String(parsed["as-of"] ?? today);
  if (!DATE_RE.test(asOfDate)) {
    throw new Error("--as-of must use YYYY-MM-DD.");
  }
  const sendLive = parsed["send-live"] === true;
  const sendTest = parsed["send-test"] === true;
  const testTemplate = parsed["test-template"]
    ? String(parsed["test-template"])
    : null;
  if (sendLive && (sendTest || testTemplate)) {
    throw new Error("Live and test modes cannot be combined.");
  }
  if (sendTest && !testTemplate) {
    throw new Error("--send-test requires --test-template.");
  }
  if (sendLive && asOfDate !== today) {
    throw new Error("Live delivery is allowed only for today's MYT date.");
  }
  if (testTemplate && !REQUIRED_TEMPLATE_CODES.has(testTemplate)) {
    throw new Error(`Unknown test template: ${testTemplate}.`);
  }
  const limit = parsed.limit === undefined ? 20 : Number(parsed.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be an integer from 1 to 100.");
  }
  if (sendTest && parsed.confirm !== TEST_CONFIRMATION) {
    throw new Error("Test delivery requires the exact confirmation phrase.");
  }
  if (sendLive && parsed.confirm !== LIVE_CONFIRMATION) {
    throw new Error("Live delivery requires the exact confirmation phrase.");
  }
  return {
    help: false,
    asOfDate,
    limit,
    previewAudience: parsed["preview-audience"] === true || sendLive,
    sendLive,
    sendTest,
    testTemplate,
  };
}

function todayInKualaLumpur(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sanitizeCliError(value) {
  return String(value ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(
      /((?:access|refresh|tenant)[_-]?token["'=:\s]+)[A-Za-z0-9._~-]+/gi,
      "$1[redacted]",
    )
    .slice(0, 500);
}

function runLarkCli(args, { input, timeoutMs = 45_000 } = {}) {
  const command = process.env.LARK_CLI_BIN?.trim() || "lark-cli";
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(reject, new Error("lark-cli timed out."));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 5 * 1024 * 1024) {
        child.kill("SIGKILL");
        finish(reject, new Error("lark-cli output exceeded 5 MiB."));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code, signal) => {
      if (code !== 0) {
        const detail = sanitizeCliError(Buffer.concat(stderr).toString("utf8"));
        finish(
          reject,
          new Error(
            `lark-cli failed (exit=${code ?? "null"} signal=${signal ?? "none"})${detail ? `: ${detail}` : ""}`,
          ),
        );
        return;
      }
      finish(resolve, Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function parseLarkResponse(raw, label) {
  if (!raw.trim()) throw new Error(`${label} returned an empty response.`);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
  if (payload?.code !== undefined && Number(payload.code) !== 0) {
    throw new Error(`${label} failed with Lark code ${payload.code}.`);
  }
  return payload;
}

async function larkApi(method, path, { data, params } = {}) {
  const args = ["api", method, path, "--as", "user", "--format", "json"];
  if (params) args.push("--params", JSON.stringify(params));
  if (data) args.push("--data", "-");
  const raw = await runLarkCli(args, {
    input: data ? JSON.stringify(data) : undefined,
  });
  return parseLarkResponse(raw, `${method} ${path}`);
}

async function readTemplates() {
  const baseToken =
    process.env.MEMBER_EMAIL_BASE_TOKEN?.trim() || DEFAULT_BASE_TOKEN;
  const tableId =
    process.env.MEMBER_EMAIL_TABLE_ID?.trim() || DEFAULT_TABLE_ID;
  const path = `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(tableId)}/records`;
  const payload = await larkApi("GET", path, {
    params: { page_size: 100 },
  });
  const data = payload?.data ?? payload;
  if (data?.has_more === true) {
    throw new Error("The email template table has more than 100 records.");
  }
  let records = data?.items;
  if (
    !Array.isArray(records) &&
    Array.isArray(data?.data) &&
    Array.isArray(data?.fields)
  ) {
    const recordIds = Array.isArray(data.record_id_list)
      ? data.record_id_list
      : [];
    records = data.data.map((row, rowIndex) => ({
      record_id: recordIds[rowIndex] ?? "",
      fields: Object.fromEntries(
        data.fields.map((field, fieldIndex) => [field, row[fieldIndex]]),
      ),
    }));
  }
  const templates = normalizeTemplateRecords(records);
  for (const code of REQUIRED_TEMPLATE_CODES) {
    if (!templates.has(code)) {
      throw new Error(`Required template ${code} is missing from Lark Base.`);
    }
  }
  return templates;
}

function sampleVariables(asOfDate) {
  return {
    member_name: "HOT CRUSH Test Member",
    birthday_date: asOfDate,
    reservation_url: "https://birthday.hotcrush.net/",
    birthday_card_url: "https://birthday.hotcrush.net/",
    old_level: "L2 Sweet Crush",
    new_level: "L3 Hot Crush",
    effective_date: asOfDate,
    member_center_url:
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex",
    unsubscribe_url:
      "mailto:pavilionstore.my@hotcrush.net?subject=Unsubscribe",
  };
}

function inspectTemplate(template, asOfDate) {
  let contentReady = false;
  let problem = null;
  try {
    renderTemplate(template, sampleVariables(asOfDate));
    contentReady = true;
  } catch (error) {
    problem = error.message;
  }
  return {
    code: template.code,
    enabled: template.enabled,
    contentReady,
    testRecipientConfigured: isValidEmail(template.testRecipient),
    deliveryConnected: BIRTHDAY_TEMPLATE_CODES.has(template.code),
    problem,
  };
}

function printTemplateStatus(templates, asOfDate) {
  const status = [...templates.values()].map((template) =>
    inspectTemplate(template, asOfDate),
  );
  console.log("[member-email] Lark Base template status:");
  for (const row of status) {
    const problem = row.problem ? ` problem=${JSON.stringify(row.problem)}` : "";
    console.log(
      `  ${row.code}: enabled=${row.enabled} content=${row.contentReady ? "ready" : "missing"}` +
        ` test-recipient=${row.testRecipientConfigured ? "configured" : "missing"}` +
        ` delivery=${row.deliveryConnected ? "birthday-connected" : "pending-tier-event-source"}${problem}`,
    );
  }
  return status;
}

async function sendLarkMail({ recipient, recipientName, rendered, dedupeKey }) {
  const mailbox = process.env.MEMBER_EMAIL_MAILBOX?.trim() || DEFAULT_MAILBOX;
  const path = `/open-apis/mail/v1/user_mailboxes/${encodeURIComponent(mailbox)}/messages/send`;
  const payload = await larkApi("POST", path, {
    data: {
      subject: rendered.subject,
      to: [{ mail_address: recipient, name: recipientName }],
      body_html: rendered.html,
      body_plain_text: rendered.plainText,
      dedupe_key: dedupeKey,
    },
  });
  const data = payload?.data ?? payload;
  const messageId = String(data?.message_id ?? data?.id ?? "").trim();
  if (!messageId) {
    throw new Error("Lark Mail accepted no verifiable message ID.");
  }
  return messageId;
}

async function runTestMode(args, templates) {
  const template = templates.get(args.testTemplate);
  const rendered = renderTemplate(template, sampleVariables(args.asOfDate));
  if (!isValidEmail(template.testRecipient)) {
    throw new Error(`${template.code} has no valid 测试收件人.`);
  }
  if (!args.sendTest) {
    console.log(
      `[member-email] TEST PREVIEW only: template=${template.code} subjectChars=${rendered.subject.length} htmlChars=${rendered.html.length}. No email sent.`,
    );
    return;
  }
  const messageId = await sendLarkMail({
    recipient: template.testRecipient,
    recipientName: "HOT CRUSH Test Recipient",
    rendered,
    dedupeKey: `hotcrush-test-${template.code}-${Date.now()}`,
  });
  console.log(
    `[member-email] Test email accepted by Lark Mail: template=${template.code} messageId=${messageId}.`,
  );
}

async function fetchBirthdaySources() {
  const corporationId =
    process.env.CRM_CORPORATION_ID?.trim() || DEFAULT_CORPORATION_ID;
  const orgPath = process.env.CRM_ORG_PATH?.trim() || DEFAULT_ORG_PATH;
  const storageState = process.env.RES_STORAGE_STATE || "storageState.json";
  const session = await openAuthedPage({
    storageState,
    warmupPath: "/card-management",
    log: () => {},
  });
  try {
    const cardResult = await fetchCrmList(
      session.call,
      "/crm/datamanage/card/page",
      { corporationId, orgPath },
      {
        pageSize: 500,
        maxPages: 60,
        label: "email card/page",
        log: () => {},
      },
    );
    const customerResult = await fetchCrmList(
      session.call,
      "/crm/datamanage/customer/page",
      { corporationId },
      {
        pageSize: 500,
        maxPages: 60,
        label: "email customer/page",
        log: () => {},
      },
    );
    const minCards = Number(process.env.MEMBER_EMAIL_MIN_CARDS || 4_000);
    const minCustomers = Number(process.env.MEMBER_EMAIL_MIN_CUSTOMERS || 3_000);
    if (cardResult.items.length < minCards) {
      throw new Error(
        `RES returned only ${cardResult.items.length} cards; refusing an incomplete audience.`,
      );
    }
    if (customerResult.items.length < minCustomers) {
      throw new Error(
        `RES returned only ${customerResult.items.length} customer profiles; refusing an incomplete audience.`,
      );
    }
    return { cards: cardResult.items, customers: customerResult.items };
  } finally {
    await session.close();
  }
}

function assertLiveGates(templates) {
  if (process.env.MEMBER_EMAIL_LIVE_ENABLED !== "1") {
    throw new Error("Live email is disabled by MEMBER_EMAIL_LIVE_ENABLED.");
  }
  if (process.env.MEMBER_EMAIL_CONSENT_MODE !== "res_subscribed") {
    throw new Error(
      "Live email requires an explicit MEMBER_EMAIL_CONSENT_MODE=res_subscribed decision.",
    );
  }
  const enabledTierTemplates = [...TIER_TEMPLATE_CODES].filter(
    (code) => templates.get(code)?.enabled,
  );
  if (enabledTierTemplates.length) {
    throw new Error(
      `Tier email rows are enabled but their event source is not connected: ${enabledTierTemplates.join(", ")}.`,
    );
  }
}

function configuredUnsubscribeUrl({ live }) {
  const value = process.env.MEMBER_EMAIL_UNSUBSCRIBE_URL?.trim();
  if (!value && live) {
    throw new Error("Live email requires MEMBER_EMAIL_UNSUBSCRIBE_URL.");
  }
  return (
    value || "mailto:pavilionstore.my@hotcrush.net?subject=Unsubscribe"
  );
}

function prepareLiveDeliveries(args, templates, audience) {
  const secret = process.env.BIRTHDAY_LINK_SECRET?.trim();
  if (!secret) throw new Error("Live birthday email requires BIRTHDAY_LINK_SECRET.");
  const baseUrl =
    process.env.BIRTHDAY_LINK_BASE?.trim() ||
    "https://birthday.hotcrush.net";
  const unsubscribeUrl = configuredUnsubscribeUrl({ live: true });
  const prepared = [];
  for (const delivery of audience.deliveries) {
    const template = templates.get(delivery.templateCode);
    if (!template?.enabled) continue;
    const requiredLinkVariable =
      delivery.templateCode === "birthday_card_t0"
        ? "birthday_card_url"
        : "reservation_url";
    for (const requiredVariable of [requiredLinkVariable, "unsubscribe_url"]) {
      const pattern = new RegExp(
        `\\{\\{\\s*${requiredVariable}\\s*\\}\\}`,
      );
      if (!pattern.test(`${template.subject}\n${template.html}`)) {
        throw new Error(
          `${template.code} must include {{${requiredVariable}}} before live delivery.`,
        );
      }
    }
    const birthdayLink = createBirthdayLink({
      memberId: delivery.memberId,
      memberName: delivery.memberName,
      secret,
      baseUrl,
    });
    const rendered = renderTemplate(template, {
      member_name: delivery.memberName,
      birthday_date: delivery.birthdayDate,
      reservation_url: birthdayLink,
      birthday_card_url: birthdayLink,
      unsubscribe_url: unsubscribeUrl,
    });
    prepared.push({
      recipient: delivery.email,
      recipientName: delivery.memberName,
      rendered,
      templateCode: delivery.templateCode,
      dedupeKey: buildDedupeKey(
        delivery.templateCode,
        delivery.birthdayDate,
        delivery.memberId,
      ),
    });
  }
  if (prepared.length > args.limit) {
    throw new Error(
      `Prepared ${prepared.length} emails, above --limit=${args.limit}; none were sent.`,
    );
  }
  return prepared;
}

async function runAudienceMode(args, templates) {
  const enabledBirthdayCodes = [...BIRTHDAY_TEMPLATE_CODES].filter(
    (code) => templates.get(code)?.enabled,
  );
  if (args.sendLive) {
    assertLiveGates(templates);
    for (const code of enabledBirthdayCodes) {
      renderTemplate(templates.get(code), sampleVariables(args.asOfDate));
    }
  }
  if (!enabledBirthdayCodes.length && args.sendLive) {
    console.log("[member-email] No birthday template is enabled. No email sent.");
    return;
  }

  const sources = await fetchBirthdaySources();
  const audience = buildBirthdayAudience(sources.customers, sources.cards, {
    asOfDate: args.asOfDate,
    cardProgramId:
      process.env.RES_CARD_PROGRAM_ID?.trim() || DEFAULT_CARD_PROGRAM_ID,
  });
  const dueByTemplate = Object.fromEntries(
    [...BIRTHDAY_TEMPLATE_CODES].map((code) => [
      code,
      audience.deliveries.filter((row) => row.templateCode === code).length,
    ]),
  );
  console.log(
    `[member-email] Audience preview ${args.asOfDate}: cards=${sources.cards.length} customers=${sources.customers.length}`,
  );
  console.log(`[member-email] Due counts: ${JSON.stringify(dueByTemplate)}`);
  console.log(`[member-email] Exclusion counts: ${JSON.stringify(audience.stats)}`);
  if (!args.sendLive) {
    console.log("[member-email] PREVIEW only. No email sent.");
    return;
  }

  const prepared = prepareLiveDeliveries(args, templates, audience);
  if (!prepared.length) {
    console.log("[member-email] No enabled-template delivery is due. No email sent.");
    return;
  }
  let accepted = 0;
  for (const delivery of prepared) {
    await sendLarkMail(delivery);
    accepted += 1;
    console.log(
      `[member-email] Lark accepted ${accepted}/${prepared.length} (${delivery.templateCode}).`,
    );
    if (accepted < prepared.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  console.log(`[member-email] Live batch complete: accepted=${accepted}.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const templates = await readTemplates();
  printTemplateStatus(templates, args.asOfDate);
  if (args.testTemplate) {
    await runTestMode(args, templates);
    return;
  }
  if (args.previewAudience) {
    await runAudienceMode(args, templates);
    return;
  }
  console.log("[member-email] Template preview only. No email sent.");
}

try {
  await main();
} catch (error) {
  console.error(`[member-email] FAILED: ${sanitizeCliError(error.message)}`);
  process.exit(exitCodeFor(error));
}
