import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { lightragClient } from "../../domain/knowledge/lightrag-client";
import { aiProvider } from "../../domain/ai/ai-provider";
import { query } from "../../shared/db/postgres";
import { getProductForecast } from "../../domain/forecast/forecast.service";
import { queryDataForQuestion } from "../../domain/forecast/ops-data-query";
import { logger } from "../../shared/logger";

const SKILL_MD_PATH = resolve(process.cwd(), "src/modules/skills/daily-review-chat/SKILL.md");
let SKILL_PROMPT = "";
try { SKILL_PROMPT = readFileSync(SKILL_MD_PATH, "utf-8"); } catch { SKILL_PROMPT = "你是 Hot Crush Bakery 的运营分析顾问，请结合销售数据给出专业分析。"; }

export const dailyReviewChatSkillDefinition: SkillDefinition = {
  skillId: "daily_review_chat",
  name: "每日复盘",
  description: "接收店长每日复盘（特殊情况、问题），结合销售数据给出分析和策略建议，支持多轮对话追问",
  priority: 90,
  disambiguation: "店长当日复盘+结合销售数据给建议；不是生成明日预估(forecast_order)，也不是员工数据统计(knowledge_query)",
  triggerKeywords: [
    "复盘", "今日复盘", "日复盘", "当日总结", "今天总结",
    "review", "daily review", "今天情况",
  ],
  examples: [
    "今天复盘：下午2点蛋挞断货了，3点开始下雨客流少了很多",
    "复盘一下今天，有个设备故障导致出餐慢",
    "今天业绩不太好，可能是因为对面新开了一家奶茶店",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: ["sales.view"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: true,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

// PLACEHOLDER_HANDLER

async function getTodayDate(): Promise<string> {
  const tz = "Asia/Kuala_Lumpur";
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * 把各种日期写法规范成 YYYY-MM-DD（库里的格式）。支持：
 * 2026-07-01 / 2026.7.1 / 7-1 / 7.1 / 7/1 / 7月1日 / 07月01号。取不到返回 ""。
 * 缺年份补当前年（KL 时区）。
 */
export function normalizeDate(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  const currentYear = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" })).getFullYear();
  // 带年：2026-07-01 / 2026.7.1 / 2026/7/1
  let m = s.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // 中文带年：2025年3月1日
  m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // 中文：7月1日 / 7月1号
  m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (m) return `${currentYear}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  // 短格式：7.1 / 7-1 / 7/1
  m = s.match(/(?:^|[^\d])(\d{1,2})[.\/-](\d{1,2})(?:[^\d]|$)/);
  if (m) return `${currentYear}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}

async function getSalesData(date: string): Promise<string> {
  logger.info("getSalesData called", { date });
  const revenue = await query<any>("SELECT * FROM daily_revenue WHERE date = $1", [date]);
  // 全部分析口径改为「应收金额」= gross_sales（后台的应收，折扣前）。实收(net_sales/revenue)仅作对账。
  const hourly = await query<any>("SELECT hour, bill_count, gross_sales, net_sales, avg_order_net_sales, total_discount FROM hourly_sales_summary WHERE date = $1 ORDER BY hour", [date]);
  // 单品按「销量」排，品名转中文(经 name_en 归一化连接 product)；金额仍带出供参考。
  const NORM = (c: string) => `lower(btrim(regexp_replace(${c}, '[[:space:]]+', ' ', 'g')))`;
  const topItems = await query<any>(
    `SELECT COALESCE(p.name, s.item_name) AS name, SUM(s.qty) AS total_qty, SUM(s.gross_sales) AS total_sales
       FROM item_hourly_sales s
       LEFT JOIN product p ON ${NORM("p.name_en")} = ${NORM("s.item_name")}
      WHERE s.date = $1 GROUP BY COALESCE(p.name, s.item_name) ORDER BY total_qty DESC LIMIT 15`, [date]);
  // 水吧(饮品)营业额：item_hourly_sales × item_category（品类含"饮品"=咖啡饮品+特调饮品）
  const waterBar = await query<any>(
    `SELECT COALESCE(SUM(s.gross_sales),0) AS gross, COALESCE(SUM(s.qty),0) AS qty
       FROM item_hourly_sales s JOIN item_category c ON lower(btrim(s.item_name)) = lower(btrim(c.item_name))
      WHERE s.date = $1 AND c.category LIKE '%饮品%'`, [date]);
  const payment = await query<any>("SELECT * FROM daily_payment_breakdown WHERE date = $1 ORDER BY net_sales DESC", [date]);
  const dining = await query<any>("SELECT * FROM daily_dining_breakdown WHERE date = $1", [date]);
  const pnl = await query<any>("SELECT * FROM daily_pnl WHERE date = $1", [date]);
  const wasteByReason = await query<any>("SELECT waste_reason, SUM(qty) as total_qty, SUM(amount) as total_amount FROM item_waste WHERE date = $1 GROUP BY waste_reason", [date]);
  // 报废王只取「排产报废」(可改进的过量)；试吃(品尝)属品控/推广投入，不进报废王。品名转中文。
  const wasteTop = await query<any>(
    `SELECT COALESCE(p.name, w.item_name) AS name, SUM(w.qty) AS qty, SUM(w.amount) AS amount
       FROM item_waste w
       LEFT JOIN product p ON ${NORM("p.name_en")} = ${NORM("w.item_name")}
      WHERE w.date = $1 AND w.waste_reason = 'scheduling'
      GROUP BY COALESCE(p.name, w.item_name) ORDER BY amount DESC LIMIT 10`, [date]);

  // 上周同天对比
  const lastWeekDate = new Date(date);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lwStr = `${lastWeekDate.getFullYear()}-${String(lastWeekDate.getMonth() + 1).padStart(2, "0")}-${String(lastWeekDate.getDate()).padStart(2, "0")}`;
  const lastWeek = await query<any>("SELECT * FROM daily_revenue WHERE date = $1", [lwStr]);

  // 今日应做（forecast目标）。携带并显字段：当前生效口径 + 数据驱动(中位数/P85) + 旧预算。
  let forecastTarget: Awaited<ReturnType<typeof getProductForecast>> | null = null;
  try {
    forecastTarget = await getProductForecast(date);
  } catch { /* forecast may not be configured */ }

  let ctx = "";
  if (revenue.length) {
    const r = revenue[0];
    // 应收金额 = gross_sales（折扣前）；客单价按应收/客单数算
    const grossRev = Number(r.gross_sales) || 0;
    const cnt = Number(r.transaction_count) || 0;
    const avgGross = cnt > 0 ? (grossRev / cnt).toFixed(1) : "0";
    const netRev = Number(r.revenue) || 0;
    const wbGross = Number(waterBar[0]?.gross) || 0;
    ctx += `【${date} 当日数据｜口径=应收金额(折扣前)】\n`;
    ctx += `营业额(应收): RM${grossRev.toFixed(2)} | 实收(折后): RM${netRev.toFixed(2)} | 客单数: ${r.transaction_count}单 | 客单价(应收): RM${avgGross}\n`;
    ctx += `其中 水吧(饮品)营业额: RM${wbGross.toFixed(0)} (占应收 ${grossRev > 0 ? (wbGross / grossRev * 100).toFixed(1) : "0"}%)\n`;
    ctx += `折扣: RM${r.total_discount} (折扣率${((r.discount_rate || 0) * 100).toFixed(1)}%)\n`;
    ctx += `会员支付占比: ${((r.member_sales_ratio || 0) * 100).toFixed(1)}%\n`;
    if (forecastTarget) {
      const t = forecastTarget;
      const rate = (rev: number) => (rev > 0 ? ((grossRev / rev) * 100).toFixed(1) : "—");
      const modeLabel = t.forecastMode === "new" ? "P85目标" : "预算目标";
      ctx += `今日应做(${modeLabel}): RM${t.targetRevenue} | 达成率(应收): ${rate(t.targetRevenue)}%\n`;
      // 新旧并显：把另一套目标也列出来供对照（灰度期）
      if (t.dataDriven) {
        if (t.forecastMode === "new") {
          ctx += `  对照 → 需求(中位数): RM${t.dataDriven.medianDemand} | 旧预算: RM${t.legacyBudgetRevenue}(达成率${rate(t.legacyBudgetRevenue)}%)\n`;
        } else {
          ctx += `  对照(新法) → P85目标: RM${t.dataDriven.p85Target}(达成率${rate(t.dataDriven.p85Target)}%) | 需求(中位数): RM${t.dataDriven.medianDemand}\n`;
        }
      }
    }
    if (lastWeek.length) {
      const lw = lastWeek[0];
      const lwGross = Number(lw.gross_sales) || 0;
      const revDiff = lwGross > 0 ? ((grossRev - lwGross) / lwGross * 100).toFixed(1) : "0";
      const lwAvg = Number(lw.transaction_count) > 0 ? (lwGross / Number(lw.transaction_count)).toFixed(1) : "0";
      ctx += `vs 上周同天(${lwStr}): 营业额(应收)RM${lwGross.toFixed(0)}(${Number(revDiff) > 0 ? "+" : ""}${revDiff}%), 客单数${lw.transaction_count}, 客单价RM${lwAvg}\n`;
    }
  } else {
    ctx += `【${date} 当日数据】暂无（可能还未同步）\n`;
    if (forecastTarget) ctx += `今日应做: RM${forecastTarget.targetRevenue}\n`;
  }

  if (pnl.length) {
    const p = pnl[0];
    ctx += `\n【损益数据】\n`;
    ctx += `报废合计: RM${p.waste_total || 0} (排产:RM${p.waste_scheduling || 0}, 品尝:RM${p.waste_tasting || 0}, 生产:RM${p.waste_production || 0})\n`;
    if (p.labor_cost) ctx += `人力成本: RM${p.labor_cost}\n`;
    if (p.net_profit) ctx += `净利润: RM${p.net_profit}\n`;
  }

  if (wasteByReason.length) {
    ctx += `\n【报废明细（POS系统）】\n`;
    const REASON_LABELS: Record<string, string> = { scheduling: '排产报废', tasting: '试吃报废', production: '生产报废' };
    const totalWaste = wasteByReason.reduce((a: number, r: any) => a + Number(r.total_amount), 0);
    for (const r of wasteByReason) {
      ctx += `${REASON_LABELS[r.waste_reason] || r.waste_reason}: ${r.total_qty}个, RM${Number(r.total_amount).toFixed(0)}\n`;
    }
    ctx += `报废总额: RM${totalWaste.toFixed(0)}\n`;
    if (revenue.length) {
      const wasteRate = ((totalWaste / Number(revenue[0].gross_sales)) * 100).toFixed(1);
      ctx += `报废率: ${wasteRate}% (警戒线: 5%)\n`;
    }
    if (wasteTop.length) {
      ctx += `排产报废王(只计排产报废=预估过量，可据此判断明日该减产的品；不含试吃):\n`;
      for (const w of wasteTop.slice(0, 5)) {
        ctx += `  ${w.name}: ${w.qty}个, RM${Number(w.amount).toFixed(0)}\n`;
      }
    }
    const tasting = wasteByReason.find((x: any) => x.waste_reason === "tasting");
    if (tasting) ctx += `试吃(品尝)投入: ${tasting.total_qty}个 RM${Number(tasting.total_amount).toFixed(0)}——属品控/推广投入，不列入报废王；仅评估投入是否过量\n`;
  }

  if (hourly.length) {
    ctx += `\n【时段明细（营业额=应收）】\n`;
    ctx += `时段 | 客单数 | 营业额 | 客单价 | 折扣\n`;
    for (const h of hourly) {
      const bc = Number(h.bill_count);
      if (bc > 0) {
        const hGross = Number(h.gross_sales) || 0;
        const hAvg = (hGross / bc).toFixed(1);
        ctx += `${String(h.hour).padStart(2, "0")}:00 | ${h.bill_count}单 | RM${hGross.toFixed(0)} | RM${hAvg} | RM${Number(h.total_discount).toFixed(0)}\n`;
      }
    }
    // 峰谷只在营业时段 12:00-22:00 判定；22点及以后是打烊尾单，不计低谷。
    const op = hourly.filter((h: any) => Number(h.hour) >= 12 && Number(h.hour) < 22 && Number(h.bill_count) > 0);
    if (op.length) {
      const g = (h: any) => Number(h.gross_sales) || 0;
      const peak = op.reduce((a: any, b: any) => (g(b) > g(a) ? b : a));
      const trough = op.reduce((a: any, b: any) => (g(b) < g(a) ? b : a));
      ctx += `营业时段峰谷(仅取12:00-22:00，打烊后不计低谷)：高峰 ${peak.hour}点(${peak.bill_count}单/RM${g(peak).toFixed(0)})；低谷 ${trough.hour}点(${trough.bill_count}单/RM${g(trough).toFixed(0)})\n`;
    }
  }

  if (topItems.length) {
    const cntTC = Number(revenue[0]?.transaction_count) || 0;
    ctx += `\n【单品表现TOP15（按销量排；TC占比=该品销量/客单数=每单渗透率）】\n`;
    for (const item of topItems) {
      const tc = cntTC > 0 ? (Number(item.total_qty) / cntTC * 100).toFixed(0) : "0";
      ctx += `${item.name}: ${item.total_qty}个 (TC ${tc}%), RM${Number(item.total_sales).toFixed(0)}\n`;
    }
  }

  if (payment.length) {
    ctx += `\n【支付渠道】\n`;
    for (const p of payment) {
      if (Number(p.net_sales) > 0) ctx += `${p.payment_method}: RM${Number(p.net_sales).toFixed(0)} (${((Number(p.ratio) || 0) * 100).toFixed(1)}%)\n`;
    }
  }

  if (dining.length) {
    ctx += `\n【堂食/外带】\n`;
    for (const d of dining) {
      if (d.bill_count) ctx += `${d.dining_option}: ${d.bill_count}单 (${((Number(d.ratio) || 0) * 100).toFixed(1)}%)\n`;
    }
  }

  return ctx;
}

// queryDataForQuestion 已抽到 src/modules/domain/forecast/ops-data-query.ts
// 供 knowledge_query 经营类分支共用 — IMPROVEMENT-PLAN.md F9

/**
 * 生成某日的完整复盘分析文本（getSalesData 应收口径 + 昨日决策闭环 + SKILL.md 提示 → LLM）。
 * 两处复用：店长交互复盘（handleInitialReview）与每日自动早报（morning-brief.service）。
 * managerText 为空 = 自动早报：无店长反馈、跳过 RAG 检索、收尾改为前瞻动作而非提问。
 */
export async function generateDailyReviewText(date: string, managerText = ""): Promise<string> {
  const isAuto = !managerText.trim();

  // 昨日决策闭环：SQL 精确读昨日 manager_review.insight（不靠 RAG 模糊检索）
  const yd = new Date(date);
  yd.setDate(yd.getDate() - 1);
  const ydStr = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, "0")}-${String(yd.getDate()).padStart(2, "0")}`;
  let yesterdayInsight = "";
  try {
    const rows = await query<any>("SELECT insight FROM manager_review WHERE date = $1", [ydStr]);
    if (rows.length && rows[0].insight) yesterdayInsight = String(rows[0].insight);
  } catch (err) {
    logger.warn("Yesterday insight lookup failed", { date: ydStr, error: String(err) });
  }

  const salesData = await getSalesData(date);

  // RAG 只在有店长原话时检索（自动早报没有查询串）— naive 拿原始 chunks
  let ragContext = "";
  if (!isAuto && (await lightragClient.isAvailable())) {
    const ragResult = await lightragClient.query(managerText.slice(0, 100), "naive");
    if (ragResult) ragContext = `\n【历史经验/SOP参考】\n${ragResult}\n（引用以上历史经验时必须注明具体日期）\n`;
  }

  const yesterdaySection = yesterdayInsight
    ? `\n【昨日复盘提炼的决策/假设（${ydStr}）】\n${yesterdayInsight}\n`
    : "";
  const followUpRequirement = yesterdayInsight
    ? `报告中必须包含固定小节「【昨日决策跟进】」：逐条对照今日数据说明昨日决策/假设的落地/验证情况。`
    : "";
  const feedbackSection = isAuto
    ? `【说明】这是系统每天自动生成的经营早报（无店长反馈），请仅依据系统销售数据分析。\n`
    : `【店长今日反馈】\n${managerText}\n`;
  const closing = isAuto
    ? `结尾给出明日 1-2 条最关键的经营动作，不要向店长提问。`
    : `最后问店长还有什么想了解的。`;

  const prompt = `${SKILL_PROMPT}\n\n---\n\n${feedbackSection}\n【系统销售数据】\n${salesData}\n${yesterdaySection}${ragContext}\n\n请按照 SKILL.md 中定义的输出格式生成分析报告。${followUpRequirement}引用历史经验必须注明日期。${closing}`;

  return await aiProvider.chatCompletionLong(prompt);
}

export class DailyReviewChatSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const isFollowUp = input.input._isFollowUp === true;
    // 追问 resume 时 collectedInputs 可能残留首轮 jdText，以本条消息(text)为准 — IMPROVEMENT-PLAN.md B5
    const rawText = isFollowUp
      ? String(input.input.text || input.rawMessage?.text || "")
      : String(input.input.jdText || input.rawMessage?.text || "");
    const conversationHistory = (input.input._history as string) || "";

    // 日期解析（都走 normalizeDate 规范到 YYYY-MM-DD）：
    // - 追问：锁定首轮的 _reviewDate（会话日期不变）。
    // - 初始：【用户原话优先】。意图路由的 LLM 常把用户说的 "6.29"（无年份）猜成错误年份
    //   （如 2024）塞进 input.date；用户没说年份就用当前年，绝不信 LLM 填的年份。
    let reviewDate: string;
    if (isFollowUp) {
      reviewDate = normalizeDate((input.input._reviewDate as string) || "") || normalizeDate(rawText);
    } else {
      reviewDate =
        normalizeDate(rawText) ||
        normalizeDate((input.input.date as string) || (input.input.targetDate as string) || "");
    }
    if (!reviewDate) reviewDate = await getTodayDate();

    logger.info("DailyReviewChat: resolved date", { reviewDate, inputDate: input.input.date, rawText: rawText.slice(0, 50) });

    try {
      // Follow-up question in multi-turn
      if (isFollowUp) {
        return await this.handleFollowUp(rawText, reviewDate, conversationHistory);
      }

      // First message: generate full review analysis
      return await this.handleInitialReview(rawText, reviewDate);
    } catch (err) {
      // 原始错误只进日志，用户可见文案固定中文 — IMPROVEMENT-PLAN.md G3f
      logger.error("Daily review chat failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "daily_review_chat",
        status: "error",
        summary: "AI 分析暂时不可用，请稍后再试",
        error: String(err),
      };
    }
  }

  private async handleInitialReview(rawText: string, date: string): Promise<SkillExecutionResult> {
    // 复盘分析文本生成（昨日决策闭环 + 应收销售数据 + RAG）抽到 generateDailyReviewText，
    // 与每日自动早报共用 — IMPROVEMENT-PLAN.md F9/F1
    const analysis = await generateDailyReviewText(date, rawText);

    // Ingest this review — fire-and-forget，不阻塞店长收到回复 — IMPROVEMENT-PLAN.md G4-①
    if (await lightragClient.isAvailable()) {
      void lightragClient.ingest(`[复盘 ${date}] ${rawText}`, { type: "daily_review", date })
        .catch((e) => logger.warn("LightRAG ingest failed (fire-and-forget)", { date, error: String(e) }));
    }

    // 复盘原文落库（真相源）。此前写 daily_review 的 content 列——列不存在且表已被 005
    // 迁入 forecast schema，INSERT 必败且被静默吞掉，复盘正文一直在丢 — IMPROVEMENT-PLAN.md B7
    try {
      await query(
        "INSERT INTO manager_review (date, content) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET content = $2, updated_at = NOW()",
        [date, rawText],
      );
    } catch (err) {
      logger.error("manager_review insert failed — 复盘原文没有落库", { date, error: String(err) });
    }

    // 返回 pending 进入多轮追问：orchestrator 存下 data 到 collectedInputs，
    // 下一条消息 resume 时原样并回 input，execute 里 _isFollowUp 读取即生效 — IMPROVEMENT-PLAN.md B5
    return {
      runId: uuidv4(),
      skillId: "daily_review_chat",
      status: "pending",
      summary: `${analysis}\n\n（回复「没了」结束复盘）`,
      data: {
        date,
        phase: "initial_review",
        _isFollowUp: true,
        _reviewDate: date,
        _history: `店长: ${rawText}\n顾问: ${analysis}`,
      },
    };
  }

  private async handleFollowUp(question: string, date: string, history: string): Promise<SkillExecutionResult> {
    // Check if user wants to end the conversation
    if (/^(没了|没有了|ok|好的|结束|谢谢|没问题|就这些)$/i.test(question.trim())) {
      return await this.handleEndConversation(date, history, question);
    }

    // Query relevant data based on the question
    const extraData = await queryDataForQuestion(question, date);

    const prompt = `你是 Hot Crush Bakery 的运营分析顾问，正在和店长进行复盘对话。

【对话历史】
${history}

【店长追问】
${question}

${extraData ? `【系统查询到的数据】\n${extraData}\n` : ""}

请基于数据回答店长的问题。如果涉及具体数字，必须从数据中引用。回答要具体、有数据支撑。
如果数据不足以回答，诚实说明并建议其他角度。
最后可以追问店长是否还有其他问题。`;

    const reply = await aiProvider.chatCompletionLong(prompt);

    // 追问阶段不写 manager_review.content（只有 initial 写正文、end 写 insight），
    // 继续 pending 并把本轮问答追加进 _history — IMPROVEMENT-PLAN.md B5
    return {
      runId: uuidv4(),
      skillId: "daily_review_chat",
      status: "pending",
      summary: `${reply}\n\n（回复「没了」结束复盘）`,
      data: {
        date,
        phase: "follow_up",
        _isFollowUp: true,
        _reviewDate: date,
        _history: `${history}\n店长: ${question}\n顾问: ${reply}`,
      },
    };
  }

  private async handleEndConversation(date: string, history: string, lastMsg: string): Promise<SkillExecutionResult> {
    // Extract skills/insights and write to RAG
    const extractPrompt = `从以下复盘对话中提取可复用的运营知识和规则。

【对话内容】
${history}
用户: ${lastMsg}

请提取：
1. 确认的运营决策（如：蛋挞备货量从X增加到Y）
2. 发现的规律（如：下雨天客流减少30%）
3. 待验证的假设（如：对面新店可能分流了年轻客群）

用简洁的条目列出，每条一行。只列有价值的信息，不要废话。`;

    let extractedKnowledge = "";
    try {
      extractedKnowledge = await aiProvider.chatCompletionLong(extractPrompt);
    } catch { /* non-critical */ }

    // 提炼要点先落库（RAG 之外的可靠副本）— IMPROVEMENT-PLAN.md B7
    let persisted = false;
    if (extractedKnowledge) {
      try {
        await query(
          "UPDATE manager_review SET insight = $2, updated_at = NOW() WHERE date = $1",
          [date, extractedKnowledge],
        );
        persisted = true;
      } catch (err) {
        logger.error("manager_review insight update failed", { date, error: String(err) });
      }
    }

    // Write to RAG — fire-and-forget，不阻塞回复链路 — IMPROVEMENT-PLAN.md G4-①
    const ragAvailable = await lightragClient.isAvailable();
    if (ragAvailable && extractedKnowledge) {
      void lightragClient.ingest(
        `[复盘总结 ${date}] ${extractedKnowledge}`,
        { type: "review_insight", date, source: "daily_review_chat" },
      ).catch((e) => logger.warn("LightRAG ingest failed (fire-and-forget)", { date, error: String(e) }));
      logger.info("Review insights ingest dispatched to RAG", { date });
    }

    // 如实告知存储结果，不在提炼/存档失败时谎称"已存入知识库"
    const storageNote = extractedKnowledge
      ? (persisted || ragAvailable ? "这些已经存档，下次复盘时会作为参考。" : "（本次存档失败，已记录日志。）")
      : "";
    return {
      runId: uuidv4(),
      skillId: "daily_review_chat",
      status: "success",
      summary: `好的，今天的复盘就到这里。\n\n📝 **已提炼的经验：**\n${extractedKnowledge || "(无新增)"}\n\n${storageNote}明天见！`,
      data: { date, phase: "end", extractedKnowledge },
    };
  }
}
