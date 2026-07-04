// 把机器人产出的 Markdown 文本渲染成 Lark 能显示的富格式。
// Lark 纯文本消息不渲染 Markdown（**/##/表格/--- 会露出原始符号）；交互式卡片的 lark_md
// 元素原生渲染加粗/斜体/列表/链接，表格用原生 column_set 分栏组件做真正的竖直对齐。
// 无 Markdown 结构的短文本仍走纯文本（更轻）。

interface LarkDiv { tag: "div"; text: { tag: "lark_md"; content: string } }
interface LarkHr { tag: "hr" }
interface LarkColumn {
  tag: "column";
  width: "weighted";
  weight: number;
  vertical_align: "top";
  elements: LarkDiv[];
}
interface LarkColumnSet {
  tag: "column_set";
  flex_mode: "none";
  horizontal_spacing: "default";
  columns: LarkColumn[];
}
type LarkElement = LarkDiv | LarkHr | LarkColumnSet;

/** 文本是否含需要富渲染的 Markdown 结构。 */
export function hasMarkdown(text: string): boolean {
  return (
    /\*\*[^*]+\*\*/.test(text) || // 加粗
    /^#{1,6}\s/m.test(text) ||    // 标题
    /^\s*\|.*\|\s*$/m.test(text) || // 表格
    /^\s*(---|\*\*\*|___)\s*$/m.test(text) || // 分隔线
    /^\s*[-*]\s+/m.test(text) ||  // 无序列表
    /^\s*\d+\.\s+/m.test(text)    // 有序列表
  );
}

const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSeparatorRow = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-");
const isHrLine = (l: string) => /^\s*(---|\*\*\*|___)\s*$/.test(l);

function splitCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

// 显示宽度：中文/全角算 2，其余算 1（用于按内容分配列宽）
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[⺀-￯]/.test(ch) ? 2 : 1;
  return w;
}

/** 按显示宽度截断（中文算 2），超出加省略号。防止超长单元格换行破坏列对齐。 */
function truncateToWidth(s: string, maxW: number): string {
  if (displayWidth(s) <= maxW) return s;
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = /[⺀-￯]/.test(ch) ? 2 : 1;
    if (w + cw > maxW - 1) break; // 留 1 给省略号
    out += ch;
    w += cw;
  }
  return out + "…";
}

// 窄表才用分栏：任一列内容超 MAX_COL_WIDTH，或整表总宽超 MAX_TOTAL_WIDTH（显示宽度，
// 中文算 2），窄屏(手机)分栏会把窄列挤到逐字换行 → 改用列表渲染。
const MAX_COL_WIDTH = 20;
const MAX_TOTAL_WIDTH = 40;

/** 宽表 → 列表 div：每行「**首列** \n 　其余列(表头 值 · …)」。自然折行，不依赖列对齐，手机也不崩。 */
function tableToListDiv(rows: string[][], ncols: number): LarkDiv {
  const header = rows[0];
  const strip = (s: string) => (s ?? "").replace(/\*\*/g, "").trim();
  const lines = rows.slice(1).map((cells) => {
    const name = strip(cells[0]);
    const rest: string[] = [];
    for (let c = 1; c < ncols; c++) {
      const label = strip(header[c]);
      const val = strip(cells[c]);
      if (val) rest.push(label ? `${label} ${val}` : val);
    }
    return rest.length ? `**${name}**\n　${rest.join(" · ")}` : `**${name}**`;
  });
  return { tag: "div", text: { tag: "lark_md", content: lines.join("\n") } };
}

/**
 * 一段 Markdown 表格 → 单个 Lark 元素。
 * 窄表（短单元格）→ 转置 column_set（每列所有单元格在一个 lark_md 文本块内逐行，跨行真对齐，
 * 电脑手机都齐）。宽表（有长内容列，如超长英文品名/长行动句）→ 列表 div：分栏在窄屏会把窄列
 * 逼成逐字竖排，列表则自然折行、每行自洽，两端都可读。表头单元格加粗。
 */
function tableToElement(tableLines: string[]): LarkElement | null {
  const rows = tableLines.filter((l) => !isSeparatorRow(l)).map(splitCells);
  if (rows.length === 0) return null;
  const ncols = Math.max(...rows.map((r) => r.length));

  // 每列最大内容宽度（去掉 **）
  const colWidth: number[] = new Array(ncols).fill(0);
  for (const cells of rows) {
    for (let c = 0; c < ncols; c++) {
      const w = displayWidth((cells[c] ?? "").replace(/\*\*/g, ""));
      if (w > colWidth[c]) colWidth[c] = w;
    }
  }
  const totalWidth = colWidth.reduce((a, b) => a + b, 0);
  const maxCol = Math.max(...colWidth);
  // 宽表 → 列表；至少 2 列才谈得上分栏/列表结构
  if (ncols >= 2 && (maxCol > MAX_COL_WIDTH || totalWidth > MAX_TOTAL_WIDTH)) {
    return tableToListDiv(rows, ncols);
  }

  // 窄表 → 转置 column_set
  const weights = colWidth.map((w) => Math.min(8, Math.max(1, Math.ceil(w / 6))));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const caps = weights.map((wt) => Math.max(12, Math.round((wt / totalWeight) * 80)));

  const columns: LarkColumn[] = [];
  for (let c = 0; c < ncols; c++) {
    const lines = rows.map((cells, rowIdx) => {
      const raw = (cells[c] ?? "").trim();
      const bold = rowIdx === 0 || /^\*\*.*\*\*$/.test(raw);
      const inner = raw.replace(/\*\*/g, "");
      const t = truncateToWidth(inner, caps[c]);
      return t ? (bold ? `**${t}**` : t) : " ";
    });
    columns.push({
      tag: "column",
      width: "weighted",
      weight: weights[c],
      vertical_align: "top",
      elements: [{ tag: "div", text: { tag: "lark_md", content: lines.join("\n") } }],
    });
  }
  return { tag: "column_set", flex_mode: "none", horizontal_spacing: "default", columns };
}

/** Markdown 文本 → Lark 卡片元素数组。文本段落聚成 div(lark_md)，表格转 column_set，--- 转 hr。 */
export function markdownToLarkElements(text: string): LarkElement[] {
  const elements: LarkElement[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    buffer = [];
    if (content) elements.push({ tag: "div", text: { tag: "lark_md", content } });
  };
  const pushHr = () => {
    // 避免开头/连续的分隔线
    if (elements.length > 0 && elements[elements.length - 1].tag !== "hr") elements.push({ tag: "hr" });
  };

  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isHrLine(line)) { flush(); pushHr(); i++; continue; }
    if (isTableLine(line)) {
      flush();
      const tbl: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) { tbl.push(lines[i]); i++; }
      const el = tableToElement(tbl);
      if (el) elements.push(el);
      continue;
    }
    const h = line.match(/^#{1,6}\s+(.*)$/);
    buffer.push(h ? `**${h[1].trim()}**` : line);
    i++;
  }
  flush();
  // 去掉可能残留的尾部 hr
  while (elements.length && elements[elements.length - 1].tag === "hr") elements.pop();
  return elements;
}

/** 文本 → Lark 发送 payload。有 Markdown 结构 → 交互式卡片；否则纯文本（更轻）。 */
export function buildLarkMessagePayload(text: string): { msg_type: string; content: string } {
  if (!hasMarkdown(text)) {
    return { msg_type: "text", content: JSON.stringify({ text }) };
  }
  const card = {
    config: { wide_screen_mode: true },
    elements: markdownToLarkElements(text),
  };
  return { msg_type: "interactive", content: JSON.stringify(card) };
}
