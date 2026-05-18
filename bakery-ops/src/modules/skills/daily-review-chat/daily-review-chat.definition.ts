import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { lightragClient } from "../../domain/knowledge/lightrag-client";
import { aiProvider } from "../../domain/ai/ai-provider";
import { query } from "../../shared/db/postgres";
import { getProductForecast } from "../../domain/forecast/forecast.service";
import { logger } from "../../shared/logger";

const SKILL_MD_PATH = resolve(process.cwd(), "src/modules/skills/daily-review-chat/SKILL.md");
let SKILL_PROMPT = "";
try { SKILL_PROMPT = readFileSync(SKILL_MD_PATH, "utf-8"); } catch { SKILL_PROMPT = "你是 Hot Crush Bakery 的运营分析顾问，请结合销售数据给出专业分析。"; }

export const dailyReviewChatSkillDefinition: SkillDefinition = {
  skillId: "daily_review_chat",
  name: "每日复盘",
  description: "接收店长每日复盘（特殊情况、问题），结合销售数据给出分析和策略建议，支持多轮对话追问",
  priority: 90,
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

async function getSalesData(date: string): Promise<string> {
  logger.info("getSalesData called", { date });
  const revenue = await query<any>("SELECT * FROM daily_revenue WHERE date = $1", [date]);
  const hourly = await query<any>("SELECT hour, bill_count, net_sales, avg_order_net_sales, total_discount FROM hourly_sales_summary WHERE date = $1 ORDER BY hour", [date]);
  const topItems = await query<any>("SELECT item_name, SUM(qty) as total_qty, SUM(net_sales) as total_sales FROM item_hourly_sales WHERE date = $1 GROUP BY item_name ORDER BY total_sales DESC LIMIT 15", [date]);
  const payment = await query<any>("SELECT * FROM daily_payment_breakdown WHERE date = $1 ORDER BY net_sales DESC", [date]);
  const dining = await query<any>("SELECT * FROM daily_dining_breakdown WHERE date = $1", [date]);
  const pnl = await query<any>("SELECT * FROM daily_pnl WHERE date = $1", [date]);
  const wasteByReason = await query<any>("SELECT waste_reason, SUM(qty) as total_qty, SUM(amount) as total_amount FROM item_waste WHERE date = $1 GROUP BY waste_reason", [date]);
  const wasteTop = await query<any>("SELECT item_name, waste_reason, qty, amount FROM item_waste WHERE date = $1 ORDER BY amount DESC LIMIT 10", [date]);

  // 上周同天对比
  const lastWeekDate = new Date(date);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lwStr = `${lastWeekDate.getFullYear()}-${String(lastWeekDate.getMonth() + 1).padStart(2, "0")}-${String(lastWeekDate.getDate()).padStart(2, "0")}`;
  const lastWeek = await query<any>("SELECT * FROM daily_revenue WHERE date = $1", [lwStr]);

  // 今日应做（forecast目标）
  let forecastTarget: { targetRevenue: number; targetShipment: number } | null = null;
  try {
    const forecast = await getProductForecast(date);
    forecastTarget = { targetRevenue: forecast.targetRevenue, targetShipment: forecast.targetShipment };
  } catch { /* forecast may not be configured */ }

  let ctx = "";
  if (revenue.length) {
    const r = revenue[0];
    ctx += `【${date} 当日数据】\n`;
    ctx += `营业额: RM${r.revenue} | 客单数: ${r.transaction_count}单 | 客单价: RM${r.avg_transaction_value}\n`;
    ctx += `毛销售额: RM${r.gross_sales} | 折扣: RM${r.total_discount} (折扣率${((r.discount_rate || 0) * 100).toFixed(1)}%)\n`;
    ctx += `会员支付占比: ${((r.member_sales_ratio || 0) * 100).toFixed(1)}%\n`;
    if (forecastTarget) {
      const achieveRate = ((r.revenue / forecastTarget.targetRevenue) * 100).toFixed(1);
      ctx += `今日应做: RM${forecastTarget.targetRevenue} | 达成率: ${achieveRate}%\n`;
    }
    if (lastWeek.length) {
      const lw = lastWeek[0];
      const revDiff = ((r.revenue - lw.revenue) / lw.revenue * 100).toFixed(1);
      ctx += `vs 上周同天(${lwStr}): 营业额RM${lw.revenue}(${Number(revDiff) > 0 ? "+" : ""}${revDiff}%), 客单数${lw.transaction_count}, 客单价RM${lw.avg_transaction_value}\n`;
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
      ctx += `报废TOP5:\n`;
      for (const w of wasteTop.slice(0, 5)) {
        ctx += `  ${w.item_name} (${REASON_LABELS[w.waste_reason] || w.waste_reason}): ${w.qty}个, RM${Number(w.amount).toFixed(0)}\n`;
      }
    }
  }

  if (hourly.length) {
    ctx += `\n【时段明细】\n`;
    ctx += `时段 | 客单数 | 营业额 | 客单价 | 折扣\n`;
    for (const h of hourly) {
      if (Number(h.bill_count) > 0) {
        ctx += `${String(h.hour).padStart(2, "0")}:00 | ${h.bill_count}单 | RM${Number(h.net_sales).toFixed(0)} | RM${h.avg_order_net_sales} | RM${Number(h.total_discount).toFixed(0)}\n`;
      }
    }
  }

  if (topItems.length) {
    ctx += `\n【单品销量TOP15】\n`;
    for (const item of topItems) {
      ctx += `${item.item_name}: ${item.total_qty}个, RM${Number(item.total_sales).toFixed(0)}\n`;
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

async function queryDataForQuestion(question: string, date: string): Promise<string> {
  // LLM 判断用户问的是什么数据，生成对应查询
  const intentPrompt = `用户在复盘对话中追问了一个问题。判断他需要什么数据，返回JSON。

用户问题: "${question}"
当前复盘日期: ${date}

返回格式:
{"type": "hourly_detail" | "item_detail" | "compare_days" | "item_by_hour" | "general", "item_name": "如果问具体产品", "hour": "如果问具体时段", "compare_date": "如果要对比某天"}

只返回JSON，不要其他文字。`;

  let intent: any = { type: "general" };
  try {
    const raw = await aiProvider.chatCompletion(intentPrompt, 200);
    intent = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
  } catch { /* fallback to general */ }

  let data = "";
  if (intent.type === "item_detail" && intent.item_name) {
    const rows = await query<any>("SELECT hour, qty, net_sales FROM item_hourly_sales WHERE date = $1 AND item_name ILIKE $2 ORDER BY hour", [date, `%${intent.item_name}%`]);
    if (rows.length) {
      data = `【${intent.item_name} 在 ${date} 的时段销量】\n`;
      for (const r of rows) data += `${r.hour}:00 — ${r.qty}个, RM${Number(r.net_sales).toFixed(0)}\n`;
      data += `合计: ${rows.reduce((a: number, r: any) => a + Number(r.qty), 0)}个, RM${rows.reduce((a: number, r: any) => a + Number(r.net_sales), 0).toFixed(0)}`;
    } else {
      data = `未找到 "${intent.item_name}" 在 ${date} 的数据`;
    }
  } else if (intent.type === "hourly_detail" || intent.hour) {
    const h = intent.hour || 12;
    const rows = await query<any>("SELECT item_name, qty, net_sales FROM item_hourly_sales WHERE date = $1 AND hour = $2 ORDER BY qty DESC LIMIT 10", [date, h]);
    const summary = await query<any>("SELECT * FROM hourly_sales_summary WHERE date = $1 AND hour = $2", [date, h]);
    data = `【${date} ${h}:00-${h + 1}:00 数据】\n`;
    if (summary.length) data += `客单数: ${summary[0].bill_count} | 营业额: RM${Number(summary[0].net_sales).toFixed(0)} | 客单价: RM${summary[0].avg_order_net_sales}\n`;
    if (rows.length) { data += `单品:\n`; for (const r of rows) data += `  ${r.item_name}: ${r.qty}个, RM${Number(r.net_sales).toFixed(0)}\n`; }
  } else if (intent.type === "compare_days" && intent.compare_date) {
    const rows = await query<any>("SELECT * FROM daily_revenue WHERE date = $1", [intent.compare_date]);
    if (rows.length) {
      const r = rows[0];
      data = `【${intent.compare_date} 数据】\n营业额: RM${r.revenue} | 客单数: ${r.transaction_count} | 客单价: RM${r.avg_transaction_value} | 折扣率: ${((r.discount_rate || 0) * 100).toFixed(1)}%`;
    }
  } else if (intent.type === "item_by_hour" && intent.item_name) {
    const rows = await query<any>("SELECT date, hour, qty, net_sales FROM item_hourly_sales WHERE item_name ILIKE $1 ORDER BY date DESC, hour LIMIT 30", [`%${intent.item_name}%`]);
    if (rows.length) {
      data = `【${intent.item_name} 近期销量】\n`;
      let currentDate = "";
      for (const r of rows) {
        const d = String(r.date).slice(0, 10);
        if (d !== currentDate) { currentDate = d; data += `\n${d}:\n`; }
        data += `  ${r.hour}:00 — ${r.qty}个\n`;
      }
    }
  }
  return data;
}

export class DailyReviewChatSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const rawText = String(input.input.jdText || input.rawMessage?.text || "");
    const isFollowUp = input.input._isFollowUp === true;
    const conversationHistory = (input.input._history as string) || "";

    // Extract date from multiple possible sources
    let reviewDate = (input.input._reviewDate as string)
      || (input.input.date as string)
      || (input.input.targetDate as string)
      || "";

    // Try to extract date from raw text if not provided
    if (!reviewDate) {
      const dateMatch = rawText.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
      const shortMatch = rawText.match(/(\d{1,2})[.\/-](\d{1,2})/);
      if (dateMatch) {
        reviewDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
      } else if (shortMatch) {
        const year = new Date().getFullYear();
        reviewDate = `${year}-${shortMatch[1].padStart(2, "0")}-${shortMatch[2].padStart(2, "0")}`;
      }
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
      logger.error("Daily review chat failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "daily_review_chat",
        status: "error",
        summary: `分析失败: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  }

  private async handleInitialReview(rawText: string, date: string): Promise<SkillExecutionResult> {
    const salesData = await getSalesData(date);

    // Query RAG for historical context
    let ragContext = "";
    const ragAvailable = await lightragClient.isAvailable();
    if (ragAvailable) {
      const ragResult = await lightragClient.query(`复盘 运营问题 策略 ${rawText.slice(0, 100)}`, "hybrid");
      if (ragResult) ragContext = `\n【历史经验/SOP参考】\n${ragResult}\n`;
    }

    // Ingest this review
    if (ragAvailable) {
      await lightragClient.ingest(`[复盘 ${date}] ${rawText}`, { type: "daily_review", date });
    }

    // Save to daily_review table
    try {
      await query("INSERT INTO daily_review (date, content, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (date) DO UPDATE SET content = $2", [date, rawText]);
    } catch { /* table might not have unique on date, ignore */ }

    const prompt = `${SKILL_PROMPT}\n\n---\n\n【店长今日反馈】\n${rawText}\n\n【系统销售数据】\n${salesData}\n${ragContext}\n\n请按照 SKILL.md 中定义的输出格式生成分析报告。最后问店长还有什么想了解的。`;

    const analysis = await aiProvider.chatCompletionLong(prompt);

    return {
      runId: uuidv4(),
      skillId: "daily_review_chat",
      status: "success",
      summary: analysis,
      data: { date, phase: "initial_review" },
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

    return {
      runId: uuidv4(),
      skillId: "daily_review_chat",
      status: "success",
      summary: reply,
      data: { date, phase: "follow_up" },
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

    // Write to RAG
    const ragAvailable = await lightragClient.isAvailable();
    if (ragAvailable && extractedKnowledge) {
      await lightragClient.ingest(
        `[复盘总结 ${date}] ${extractedKnowledge}`,
        { type: "review_insight", date, source: "daily_review_chat" },
      );
      logger.info("Review insights ingested to RAG", { date });
    }

    return {
      runId: uuidv4(),
      skillId: "daily_review_chat",
      status: "success",
      summary: `好的，今天的复盘就到这里。\n\n📝 **已提炼的经验：**\n${extractedKnowledge || "(无新增)"}\n\n这些已经存入知识库，下次复盘时会作为参考。明天见！`,
      data: { date, phase: "end", extractedKnowledge },
    };
  }
}
