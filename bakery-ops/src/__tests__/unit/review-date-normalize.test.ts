// 复盘日期规范化（修复"复盘7.1号"查无数据的 bug）
import { describe, it, expect } from "vitest";
import { normalizeDate } from "../../modules/skills/daily-review-chat/daily-review-chat.definition";

describe("normalizeDate", () => {
  const yr = new Date().getFullYear();
  it("短格式 7.1 / 7-1 / 7/1 → 补当前年 + 补零", () => {
    expect(normalizeDate("7.1")).toBe(`${yr}-07-01`);
    expect(normalizeDate("7-1")).toBe(`${yr}-07-01`);
    expect(normalizeDate("7/1")).toBe(`${yr}-07-01`);
  });
  it("中文 7月1日 / 7月1号", () => {
    expect(normalizeDate("7月1日")).toBe(`${yr}-07-01`);
    expect(normalizeDate("7月1号")).toBe(`${yr}-07-01`);
  });
  it("带年 2026-07-01 / 2026.7.1 原样规范", () => {
    expect(normalizeDate("2026-07-01")).toBe("2026-07-01");
    expect(normalizeDate("2026.7.1")).toBe("2026-07-01");
  });
  it("从整句里抽日期", () => {
    expect(normalizeDate("复盘一下7.1号的数据")).toBe(`${yr}-07-01`);
    expect(normalizeDate("帮我看看 2026-06-30 的复盘")).toBe("2026-06-30");
  });
  it("已规范化的日期幂等（follow-up 复用 _reviewDate 时安全）", () => {
    expect(normalizeDate(normalizeDate("7.1"))).toBe(`${yr}-07-01`);
  });
  it("取不到日期返回空串", () => {
    expect(normalizeDate("今天生意怎么样")).toBe("");
    expect(normalizeDate("")).toBe("");
  });
});

// 年份幻觉防护：用户说"6.29"，LLM 猜成 2024，应以用户原话（当前年）为准
describe("normalizeDate 年份来源", () => {
  const yr = new Date().getFullYear();
  it("无年份短格式 → 当前年（不是模型猜的历史年）", () => {
    expect(normalizeDate("6.29复盘")).toBe(`${yr}-06-29`);
  });
  it("用户显式带年份时才用该年份", () => {
    expect(normalizeDate("复盘2025年3月1日")).toBe("2025-03-01");
    expect(normalizeDate("2024-06-29")).toBe("2024-06-29");
  });
});

// 相对日（2026-08-06 事故）：店长在追问里说「昨天的复盘」，系统仍按首轮锁定的今天去查，
// 查到零流水日却报出一堆昨天的数字 —— 缺的字段被模型当场编了（含虚构的 TOP5 单品）。
describe("normalizeDate 相对日", () => {
  const KL = "Asia/Kuala_Lumpur";
  const shift = (n: number) => {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: KL }));
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  it("带「复盘」时认相对日", () => {
    expect(normalizeDate("昨天的复盘")).toBe(shift(1));
    expect(normalizeDate("前天的复盘")).toBe(shift(2));
    expect(normalizeDate("大前天的复盘")).toBe(shift(3));
    expect(normalizeDate("复盘3天前")).toBe(shift(3));
  });

  it("整句就是一个日期词时也认", () => {
    expect(normalizeDate("昨天")).toBe(shift(1));
    expect(normalizeDate("前天的数据")).toBe(shift(2));
    expect(normalizeDate("昨天的情况？")).toBe(shift(1));
  });

  // 「大前天」含「前天」子串，长的必须先判，否则会少算一天
  it("大前天不被前天抢先", () => {
    expect(normalizeDate("大前天")).toBe(shift(3));
    expect(normalizeDate("大前天")).not.toBe(shift(2));
  });

  // 显式日期优先：这一条正是 2026-08-06 首次实现时踩的坑 ——
  // 相对日判断排在数字之前，把「今天复盘：2026-07-01」解析成了今天。
  it("显式日期压过同句里的相对词", () => {
    expect(normalizeDate("今天复盘：2026-07-01 下午蛋挞断货")).toBe("2026-07-01");
    expect(normalizeDate("昨天说的那个，看下 7.1")).toBe(`${new Date().getFullYear()}-07-01`);
  });

  // 追问阶段以原话优先，若无差别地抓相对词，店长在 08-01 的复盘里
  // 随口问「今天生意怎么样」就会把复盘日整个跳走 —— 比原 bug 更难察觉。
  it("普通对话里的相对词不算日期选择", () => {
    expect(normalizeDate("今天生意怎么样")).toBe("");
    expect(normalizeDate("跟昨天比呢")).toBe("");
    expect(normalizeDate("昨天那个断货的问题解决了吗")).toBe("");
  });
});
