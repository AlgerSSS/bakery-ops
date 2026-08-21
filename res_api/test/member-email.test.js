import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildBirthdayAudience,
  buildDedupeKey,
  createBirthdayLink,
  normalizeTemplateRecords,
  renderTemplate,
} from "../lib/member-email.js";

function templateRecord(fields, recordId = "rec-1") {
  return { record_id: recordId, fields };
}

test("Lark Base rows normalize into a code-keyed template map", () => {
  const templates = normalizeTemplateRecords([
    templateRecord({
      模板代码: "birthday_card_t0",
      模板名称: "生日当天贺卡",
      发送规则: "生日当天 10:00 MYT",
      启用: true,
      邮件标题: "Happy birthday, {{member_name}}",
      HTML内容: "<p>Hello {{member_name}}</p>",
      测试收件人: "owner@example.com",
    }),
  ]);

  assert.equal(templates.get("birthday_card_t0").enabled, true);
  assert.equal(
    templates.get("birthday_card_t0").subject,
    "Happy birthday, {{member_name}}",
  );
});

test("unknown and duplicate template codes fail closed", () => {
  assert.throws(
    () =>
      normalizeTemplateRecords([
        templateRecord({ 模板代码: "made_up", 启用: false }),
      ]),
    /unknown template code/i,
  );
  assert.throws(
    () =>
      normalizeTemplateRecords([
        templateRecord({ 模板代码: "birthday_card_t0", 启用: false }),
        templateRecord(
          { 模板代码: "birthday_card_t0", 启用: false },
          "rec-2",
        ),
      ]),
    /duplicate template code/i,
  );
});

test("template rendering escapes member data and keeps trusted markup", () => {
  const rendered = renderTemplate(
    {
      code: "birthday_card_t0",
      subject: "Happy birthday, {{member_name}}",
      html: '<p>Hello {{member_name}}</p><a href="{{birthday_card_url}}">Open</a>',
    },
    {
      member_name: '<Amy & "Co">',
      birthday_card_url: "https://birthday.hotcrush.net/t/signed",
    },
  );

  assert.equal(rendered.subject, 'Happy birthday, <Amy & "Co">');
  assert.match(rendered.html, /&lt;Amy &amp; &quot;Co&quot;&gt;/);
  assert.match(rendered.html, /https:\/\/birthday\.hotcrush\.net\/t\/signed/);
  assert.doesNotMatch(rendered.html, /<Amy/);
});

test("template rendering rejects unknown placeholders and dangerous HTML", () => {
  assert.throws(
    () =>
      renderTemplate(
        {
          code: "birthday_card_t0",
          subject: "Hello",
          html: "<p>{{not_allowed}}</p>",
        },
        { not_allowed: "x" },
      ),
    /not allowed/i,
  );
  assert.throws(
    () =>
      renderTemplate(
        {
          code: "birthday_card_t0",
          subject: "Hello",
          html: "<script>alert(1)</script>",
        },
        {},
      ),
    /unsafe html/i,
  );
  assert.throws(
    () =>
      renderTemplate(
        {
          code: "birthday_card_t0",
          subject: "Hello",
          html: '<a href="{{birthday_card_url}}">Open</a>',
        },
        { birthday_card_url: "javascript:alert(1)" },
      ),
    /https or mailto/i,
  );
});

test("birthday audiences follow T-5 cake, T-2 Basque and birthday-day rules", () => {
  const customers = [
    {
      id: "member-l1",
      firstName: "L1",
      email: "l1@example.com",
      birthday: "1990-08-21",
      subscribed: true,
    },
    {
      id: "member-l2",
      firstName: "L2",
      email: "l2@example.com",
      birthday: "1990-08-23",
      subscribed: true,
    },
    {
      id: "member-l3",
      firstName: "L3",
      email: "l3@example.com",
      birthday: "1990-08-26",
      subscribed: true,
    },
    {
      id: "no-consent",
      email: "no-consent@example.com",
      birthday: "1990-08-21",
      subscribed: false,
    },
  ];
  const cards = [
    {
      id: "card-1",
      customerId: "member-l1",
      cardProgramId: "program",
      status: 10,
      levelId: "1998685858403844100",
    },
    {
      id: "card-2",
      customerId: "member-l2",
      cardProgramId: "program",
      status: 10,
      levelId: "2090027041029333000",
    },
    {
      id: "card-3",
      customerId: "member-l3",
      cardProgramId: "program",
      status: 10,
      levelId: "2090027043797577737",
    },
  ];

  const result = buildBirthdayAudience(customers, cards, {
    asOfDate: "2026-08-21",
    cardProgramId: "program",
  });

  assert.deepEqual(
    result.deliveries.map((row) => [row.templateCode, row.memberId]),
    [
      ["birthday_card_t0", "member-l1"],
      ["birthday_basque_t2", "member-l2"],
      ["birthday_cake_t5", "member-l3"],
    ],
  );
  assert.equal(result.stats.notSubscribed, 1);
});

test("birthday audience skips duplicate recipient addresses instead of double-sending", () => {
  const result = buildBirthdayAudience(
    [
      {
        id: "member-a",
        email: "same@example.com",
        birthday: "1990-08-21",
        subscribed: true,
      },
      {
        id: "member-b",
        email: "SAME@example.com",
        birthday: "1985-08-21",
        subscribed: true,
      },
    ],
    [],
    { asOfDate: "2026-08-21", cardProgramId: "program" },
  );

  assert.equal(result.deliveries.length, 0);
  assert.equal(result.stats.duplicateEmailMembers, 2);
});

test("dedupe keys contain no member id or email", () => {
  const key = buildDedupeKey(
    "birthday_card_t0",
    "2026-08-21",
    "member-123",
  );
  assert.match(key, /^hotcrush-birthday_card_t0-2026-08-21-[a-f0-9]{24}$/);
  assert.doesNotMatch(key, /member-123/);
});

test("birthday links are signed, expire, and contain no email address", () => {
  const link = createBirthdayLink({
    memberId: "member123",
    memberName: "Amy",
    secret: "x".repeat(32),
    baseUrl: "https://birthday.hotcrush.net",
    now: new Date("2026-08-21T02:00:00Z"),
    ttlDays: 30,
  });
  assert.match(link, /^https:\/\/birthday\.hotcrush\.net\/t\//);
  assert.doesNotMatch(link, /@/);
});

test("the committed scheduler stays at 10:00 MYT in preview mode", () => {
  const cron = readFileSync(
    new URL("../member-email.cron.example", import.meta.url),
    "utf8",
  );
  assert.match(cron, /CRON_TZ=Asia\/Kuala_Lumpur/);
  assert.match(cron, /0 10 \* \* \* root/);
  assert.match(cron, /MEMBER_EMAIL_MODE=preview/);
  assert.doesNotMatch(cron, /MEMBER_EMAIL_MODE=live/);
});
