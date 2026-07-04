// Markdown → Lark 卡片富格式转换
import { describe, it, expect } from "vitest";
import { hasMarkdown, markdownToLarkElements, buildLarkMessagePayload } from "../../modules/channel/lark/lark-card";

describe("hasMarkdown", () => {
  it("识别加粗/标题/表格/分隔线/列表", () => {
    expect(hasMarkdown("**营业额** RM46,477")).toBe(true);
    expect(hasMarkdown("## 核心指标")).toBe(true);
    expect(hasMarkdown("| 指标 | 值 |")).toBe(true);
    expect(hasMarkdown("---")).toBe(true);
    expect(hasMarkdown("- 一项")).toBe(true);
  });
  it("纯文本返回 false（走轻量纯文本消息）", () => {
    expect(hasMarkdown("已取消本次下单")).toBe(false);
    expect(hasMarkdown("好的，正在处理，稍等一下~")).toBe(false);
  });
});

describe("markdownToLarkElements", () => {
  it("## 标题 → 加粗", () => {
    const els = markdownToLarkElements("## 核心指标\n营业额 RM46,477") as Array<{ tag: string; text?: { content: string } }>;
    expect(els[0].text?.content).toContain("**核心指标**");
    expect(els[0].text?.content).not.toContain("##");
  });

  it("--- 分块并插入 hr", () => {
    const els = markdownToLarkElements("第一段\n---\n第二段");
    expect(els.filter((e) => e.tag === "hr").length).toBe(1);
    expect(els.filter((e) => e.tag === "div").length).toBe(2);
  });

  it("表格 → 单个转置 column_set（每列竖直堆叠，跨行才对齐），表头加粗，丢弃分隔行", () => {
    const md = [
      "| 指标 | 2026-07-01 | 上周同天 | 变化 |",
      "|---|---:|---:|---:|",
      "| 营业额 | RM46,477.20 | RM37,448.45 | +24.1% |",
      "| 客单数 | 797单 | 687单 | +16.0% |",
    ].join("\n");
    const els = markdownToLarkElements(md) as Array<{ tag: string; columns?: Array<{ elements: Array<{ text: { content: string } }> }> }>;
    const colSets = els.filter((e) => e.tag === "column_set");
    expect(colSets.length).toBe(1); // 整表一个 column_set（转置），不是每行一个
    expect(colSets[0].columns!.length).toBe(4); // 4 列
    // 每列 = 表头 + 各行值，在同一 lark_md 文本块内逐行排列；表头加粗
    expect(colSets[0].columns![0].elements[0].text.content).toBe("**指标**\n营业额\n客单数");
    expect(colSets[0].columns![1].elements[0].text.content).toBe("**2026-07-01**\nRM46,477.20\n797单");
    expect(colSets[0].columns![3].elements[0].text.content).toBe("**变化**\n+24.1%\n+16.0%");
    // 全文无裸竖线
    expect(JSON.stringify(els)).not.toMatch(/\|/);
  });

  it("宽表（长内容列）→ 回退成列表 div，不用分栏（窄屏防逐字竖排）", () => {
    const md = [
      "| 单品 | 销量 | 金额 |",
      "|---|---|---|",
      "| Signature Black Truffle Wellington Steak Croissant | 273个 | **RM7917** |",
      "| Hot Crush Egg Tart | 701个 | RM6309 |",
    ].join("\n");
    const els = markdownToLarkElements(md) as Array<{ tag: string; text?: { content: string } }>;
    // 宽表（长品名）→ 回退成列表 div，不是 column_set（避免窄屏逐字竖排）
    expect(els.every((e) => e.tag !== "column_set")).toBe(true);
    const div = els.find((e) => e.tag === "div")!;
    // 每行：**品名** 换行 　销量/金额（带表头标签、·分隔），品名不截断
    expect(div.text!.content).toContain("**Signature Black Truffle Wellington Steak Croissant**");
    expect(div.text!.content).toContain("销量 273个 · 金额 RM7917");
  });

  it("加粗 ** 原样保留（卡片 lark_md 会渲染）", () => {
    const el = markdownToLarkElements("**报废率 8.8%** 越过警戒线")[0] as { text: { content: string } };
    expect(el.text.content).toContain("**报废率 8.8%**");
  });
});

describe("buildLarkMessagePayload", () => {
  it("有 Markdown → interactive 卡片", () => {
    const p = buildLarkMessagePayload("## 复盘\n**营业额** RM46,477\n\n---\n| 指标 | 值 |\n|---|---|\n| 客单价 | RM58 |");
    expect(p.msg_type).toBe("interactive");
    const card = JSON.parse(p.content);
    expect(card.elements.length).toBeGreaterThan(0);
    expect(JSON.stringify(card)).not.toContain("##");
  });
  it("纯文本 → text 消息", () => {
    const p = buildLarkMessagePayload("已取消本次下单");
    expect(p.msg_type).toBe("text");
    expect(JSON.parse(p.content).text).toBe("已取消本次下单");
  });
});
