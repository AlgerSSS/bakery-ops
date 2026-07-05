import ExcelJS from "exceljs";
import { DAY_TYPE_LABELS, DOW_LABELS } from "./constants";
import type {
  TimeSlotSuggestion,
  ProductSuggestion,
  TimeslotSalesRecord,
  Product,
  DailyTarget,
} from "./types";

// 与门店真实「生产预估单」模板对齐：列布局 + 活公式(总数量=SUM逐时、总金额=单价×总数量、
// TC占比=(总数-试吃)/客单数、逐时金额=单价×逐时、12点前储存、试吃金额、合计=SUM)。
// 逐时格 10:00-19:00(与门店模板一致)；预测里 20-22 点的量折入 19:00，保证 总数=逐时之和。
const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const AVG_TICKET = 70; // 客单价(门店口径)

export async function buildForecastExcelBuffer(opts: {
  date: string;
  dailyTarget: DailyTarget;
  productSuggestions: ProductSuggestion[];
  timeSlotSuggestions: TimeSlotSuggestion[];
  timeslotSalesRecords: TimeslotSalesRecord[];
  fixedSchedule: Record<string, string[]>;
  products: Product[];
  lastWeekSales?: Map<string, number>;
}): Promise<Buffer> {
  const { date, dailyTarget, productSuggestions, timeSlotSuggestions, products, lastWeekSales } = opts;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`预估单_${date}`);
  ws.views = [{ showGridLines: false }];

  const col = (n: number) => ws.getColumn(n);
  const L = (n: number) => ws.getColumn(n).letter; // 列字母，供公式引用

  // ── 列宽 ──
  const widths = [8, 9, 5, 5, 8, 20, 26, 6, 6, 7, 7, 8, 7, 5, 8, 9,
    ...HOURS.map(() => 5), ...HOURS.map(() => 6),
    8, 9, 9, 6, 8, 12, 18, 8, 8, 14, 12, 12];
  widths.forEach((w, i) => { col(i + 1).width = w; });

  const thin = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const hFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF4340F4" } };
  const hFont = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
  const subFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEEF0FF" } };
  const botFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE7F7EC" } }; // 系统自动
  const inFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFFCEC" } };  // 手工填
  const sumFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFCE4E5" } };

  const dow = `周${DOW_LABELS[dailyTarget.dayOfWeek]}`;
  const dayTypeLabel = DAY_TYPE_LABELS[dailyTarget.dayType];
  const revenue = dailyTarget.revenue;
  const shipment = dailyTarget.shipmentAmount;
  const custCount = Math.round(revenue / AVG_TICKET);

  // 列位置(与真实模板一致)
  const C = {
    cat: 1, loc: 2, pos: 3, seq: 4, sub: 5, cn: 6, en: 7, price: 8, batch: 9,
    total: 10, actual: 11, soldout: 12, tc: 13, temp: 14, lastwk: 15, amount: 16,
    hq0: 17, ha0: 27, full: 37, store12: 38, storeAmt: 39, tasteQ: 40, tasteA: 41,
    addDetail: 42, addNote: 43, addPending: 44, addAmt: 45, remark: 46, addTime: 47, redTime: 48,
  };
  const HEAD = 4;      // 列头行
  const FIRST = 5;     // 首个产品行

  // ── 行1 标题 ──
  ws.mergeCells(1, 1, 1, 8);
  const t = ws.getCell(1, 1); t.value = "生产预估单"; t.font = { bold: true, size: 16 };
  // ── 行2 门店/日期/星期 ──
  const r2 = [["门店", C.cat], ["Hot Crush · Pavilion KL", C.loc], ["日期", C.price], [date, C.batch], ["星期", C.tc], [dow, C.temp], ["制表人", C.amount], ["系统", C.hq0]];
  for (const [v, c] of r2 as [string | number, number][]) ws.getCell(2, c).value = v;
  // ── 行3 KPI(业绩预估=客单数×客单价) ──
  ws.getCell(3, 1).value = "客单数"; ws.getCell(3, 2).value = custCount;
  ws.getCell(3, 3).value = "客单价"; ws.getCell(3, 5).value = AVG_TICKET;
  ws.getCell(3, C.price).value = "业绩预估";
  ws.getCell(3, C.batch).value = { formula: `${L(2)}3*${L(5)}3` }; // = 客单数 × 客单价
  ws.getCell(3, C.temp).value = "出货金额"; ws.getCell(3, C.lastwk).value = shipment;
  for (const r of [2, 3]) for (let c = 1; c <= 16; c++) { const cell = ws.getCell(r, c); cell.border = border; if (typeof cell.value === "string" && cell.value) { cell.fill = subFill; cell.font = { bold: true, size: 9 }; } }

  // ── 行4 列头 ──
  const heads: [number, string][] = [
    [C.cat, "品类"], [C.loc, "陈列位置"], [C.seq, "序号"], [C.sub, "品类"], [C.cn, "品名"], [C.en, "品名(英)"],
    [C.price, "单价"], [C.batch, "倍数"], [C.total, "总数量"], [C.actual, "实际出货"], [C.soldout, "断货时间"],
    [C.tc, "TC占比"], [C.temp, "冷/热"], [C.lastwk, "上周销售"], [C.amount, "总金额"],
    [C.full, "满柜"], [C.store12, "12点前储存"], [C.storeAmt, "堆放金额"], [C.tasteQ, "试吃量"], [C.tasteA, "试吃金额"],
    [C.addDetail, "加货明细"], [C.addNote, "加货备注(与后厨确认)"], [C.addPending, "加货待确认"], [C.remark, "备注"], [C.addTime, "加货时间"], [C.redTime, "减货时间"],
  ];
  HOURS.forEach((h, i) => heads.push([C.hq0 + i, `${h}点出货`]));
  HOURS.forEach((h, i) => heads.push([C.ha0 + i, `${h}点金额`]));
  for (const [c, txt] of heads) { const cell = ws.getCell(HEAD, c); cell.value = txt; cell.fill = hFill; cell.font = hFont; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; cell.border = border; }
  ws.getRow(HEAD).height = 26;

  // ── 数据行 ──
  const productMap = new Map(productSuggestions.map((p) => [p.productName, p]));
  const displayFull = new Map(products.map((p) => [p.name, p.displayFullQuantity]));
  const nameEn = new Map(products.map((p) => [p.name, p.nameEn]));
  const category = new Map(products.map((p) => [p.name, p.category]));
  // 每品原始逐时(真实小时曲线)
  const rawHourly = new Map<string, Record<number, number>>();
  for (const s of timeSlotSuggestions) {
    const h = parseInt(s.timeSlot.slice(0, 2), 10);
    const m = rawHourly.get(s.productName) || {};
    m[h] = (m[h] || 0) + s.quantity;
    rawHourly.set(s.productName, m);
  }
  // 把真实曲线摊到 10-19 格(区间外的量按形状比例摊回，避免 19 点堆峰)，整数且和=总量。
  const distribute = (raw: Record<number, number>, total: number): number[] => {
    if (total <= 0) return HOURS.map(() => 0);
    const base = HOURS.map((h) => raw[h] || 0);
    const baseSum = base.reduce((s, v) => s + v, 0);
    const shape = baseSum > 0 ? base.map((v) => v / baseSum) : HOURS.map(() => 1 / HOURS.length);
    const scaled = shape.map((f) => f * total);
    const arr = scaled.map((v) => Math.floor(v));
    let left = total - arr.reduce((s, v) => s + v, 0);
    scaled.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f)
      .forEach(({ i }) => { if (left > 0) { arr[i]++; left--; } });
    return arr;
  };

  let r = FIRST;
  for (const p of productSuggestions) {
    const nm = p.productName;
    const cur = ws.getRow(r);
    const set = (c: number, v: ExcelJS.CellValue) => { cur.getCell(c).value = v; };
    set(C.cat, category.get(nm) ?? p.positioning ?? "");
    set(C.pos, p.positioning ?? "");
    set(C.seq, r - HEAD);
    set(C.cn, nm); set(C.en, nameEn.get(nm) ?? "");
    set(C.price, p.price); set(C.batch, p.packMultiple);
    set(C.temp, p.coldHot);
    if (lastWeekSales?.has(nm)) set(C.lastwk, lastWeekSales.get(nm)!);
    set(C.full, displayFull.get(nm) || "");
    // 逐时出货(系统自动，真实曲线摊到 10-19)
    const grid = distribute(rawHourly.get(nm) || {}, p.suggestedQuantity);
    HOURS.forEach((_, i) => { if (grid[i] > 0) set(C.hq0 + i, grid[i]); });
    // 公式：总数量=SUM(逐时)；总金额=单价×总数量；TC=(总数-试吃)/客单数
    const q0 = L(C.hq0), q9 = L(C.hq0 + 9), pcol = L(C.price), tcol = L(C.total);
    set(C.total, { formula: `SUM(${q0}${r}:${q9}${r})` });
    set(C.amount, { formula: `${pcol}${r}*${tcol}${r}` });
    set(C.tc, { formula: `IF($${L(2)}$3=0,0,(${tcol}${r}-${L(C.tasteQ)}${r})/$${L(2)}$3)` });
    // 逐时金额=单价×逐时
    HOURS.forEach((h, i) => { set(C.ha0 + i, { formula: `${pcol}${r}*${L(C.hq0 + i)}${r}` }); });
    // 12点前储存=IF(10点+11点-满柜>0,...)；堆放金额=储存×单价；试吃金额=试吃量×单价；加货金额=单价×待确认
    set(C.store12, { formula: `IF(${L(C.hq0)}${r}+${L(C.hq0 + 1)}${r}-${L(C.full)}${r}>0,${L(C.hq0)}${r}+${L(C.hq0 + 1)}${r}-${L(C.full)}${r},0)` });
    set(C.storeAmt, { formula: `${L(C.store12)}${r}*${pcol}${r}` });
    set(C.tasteA, { formula: `${L(C.tasteQ)}${r}*${pcol}${r}` });
    set(C.addAmt, { formula: `${pcol}${r}*${L(C.addPending)}${r}` });
    // 冷热行加货/减货提前(按冷热)
    set(C.addTime, p.coldHot === "热" ? "提前40分钟-1个小时" : "提前4个小时");
    set(C.redTime, p.coldHot === "热" ? "提前2个小时" : "提前4个小时");
    // TC占比百分比格式
    cur.getCell(C.tc).numFmt = "0.0%";
    // 底色：绿=系统自动，黄=门店手工
    for (const c of [C.total, C.lastwk, C.full, ...HOURS.map((_, i) => C.hq0 + i)]) cur.getCell(c).fill = botFill;
    for (const c of [C.actual, C.soldout, C.tasteQ, C.addDetail, C.addNote, C.addPending, C.remark]) cur.getCell(c).fill = inFill;
    for (let c = 1; c <= C.ha0 + 9; c++) { const cell = cur.getCell(c); cell.border = border; cell.font = { size: 9 }; cell.alignment = { horizontal: c === C.cn || c === C.en ? "left" : "center", wrapText: false }; }
    r++;
  }
  const LAST = r - 1;

  // ── 合计行 ──
  const sum = ws.getRow(r);
  sum.getCell(C.cn).value = "合计";
  sum.getCell(C.total).value = { formula: `SUM(${L(C.total)}${FIRST}:${L(C.total)}${LAST})` };
  sum.getCell(C.amount).value = { formula: `SUM(${L(C.amount)}${FIRST}:${L(C.amount)}${LAST})` };
  HOURS.forEach((h, i) => {
    sum.getCell(C.hq0 + i).value = { formula: `SUM(${L(C.hq0 + i)}${FIRST}:${L(C.hq0 + i)}${LAST})` };
    sum.getCell(C.ha0 + i).value = { formula: `SUM(${L(C.ha0 + i)}${FIRST}:${L(C.ha0 + i)}${LAST})` };
  });
  for (let c = 1; c <= C.ha0 + 9; c++) { const cell = sum.getCell(c); cell.border = border; cell.fill = sumFill; cell.font = { bold: true, size: 9 }; cell.alignment = { horizontal: "center" }; }
  r += 2;

  // ── 右侧「预计销售」逐时表(对齐真实模板 时间/销售额；销售额=该时段逐时金额之和，活公式；
  //     合计=产品表总金额之和=真实需求，新口径下可高于/低于顶部「出货金额」预算目标) ──
  const S1 = 50, S2 = 51; // 时间 / 预计销售 两列
  col(S1).width = 14; col(S2).width = 11;
  const stTitle = ws.getCell(3, S1); stTitle.value = "预计销售(逐时)"; stTitle.font = { bold: true, size: 9 };
  ws.mergeCells(3, S1, 3, S2);
  for (const [c, txt] of [[S1, "时间"], [S2, "预计销售"]] as [number, string][]) {
    const cell = ws.getCell(HEAD, c); cell.value = txt; cell.fill = hFill; cell.font = hFont;
    cell.alignment = { horizontal: "center", vertical: "middle" }; cell.border = border;
  }
  HOURS.forEach((h, i) => {
    const rr = HEAD + 1 + i;
    const tc = ws.getCell(rr, S1); tc.value = `${h}:00-${h + 1}:00`; tc.border = border; tc.font = { size: 9 }; tc.alignment = { horizontal: "center" };
    const ac = ws.getCell(rr, S2); ac.value = { formula: `SUM(${L(C.ha0 + i)}${FIRST}:${L(C.ha0 + i)}${LAST})` };
    ac.border = border; ac.font = { size: 9 }; ac.fill = botFill; ac.alignment = { horizontal: "center" };
  });
  const stTot = HEAD + 1 + HOURS.length;
  const tt = ws.getCell(stTot, S1); tt.value = "合计"; tt.border = border; tt.fill = sumFill; tt.font = { bold: true, size: 9 }; tt.alignment = { horizontal: "center" };
  const ta = ws.getCell(stTot, S2); ta.value = { formula: `SUM(${L(S2)}${HEAD + 1}:${L(S2)}${HEAD + HOURS.length})` };
  ta.border = border; ta.fill = sumFill; ta.font = { bold: true, size: 9 }; ta.alignment = { horizontal: "center" };

  // ── 备注(10 条) ──
  const notes = "备注：\n" +
    "1. 优先加货，打造Top榜是核心工作；慎重加货、及时汇报上级，避免单小时加货过多导致下小时减货；批次数据永远第一。\n" +
    "2. 前场每日12点前给到后厨后天的预估单；如需改出货数量，改电子版预估单，不要群里口头通知，车间只以预估单为准。\n" +
    "3. 如有团购订单，需在预估单上体现。\n4. 每天14:00前，前场需确定最后一批搅拌类产品出货。\n" +
    "5. 牛乳吐司每批不超72条。\n6. 三种坚果棒每批最大120根。\n7. 奶酪核桃马卡龙、红豆松松吐司、心太软每批最多60个。\n" +
    "8. 加货明细：由战队长和主厨确定。\n9. 加货优先TOP榜，其次准TOP榜。\n10. 每小时必出：频次最重要；加货慎重，未达产能极限前寻求上级确认。";
  ws.mergeCells(r, 1, r + 11, 8);
  const nc = ws.getCell(r, 1); nc.value = notes; nc.alignment = { vertical: "top", wrapText: true }; nc.font = { size: 9 };
  const lg = ws.getCell(r + 13, 1);
  lg.value = "绿=系统自动填(预估量/逐时/上周销量) · 黄=门店手工(实际出货/断货/加货/试吃/备注) · 逐时10:00–19:00(晚档折入19点) · 数量按倍数整批";
  lg.font = { color: { argb: "FF8A8F98" }, size: 9 };

  ws.views = [{ showGridLines: false, state: "frozen", xSplit: 6, ySplit: HEAD }];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
