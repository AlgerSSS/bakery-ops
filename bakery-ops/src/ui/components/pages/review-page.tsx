"use client";

import { useReview } from "@/ui/hooks/use-review";
import { useToastContext } from "@/ui/components/providers/toast-provider";
import type { PageId } from "@/ui/constants";

const WEATHER_OPTIONS = ["晴天", "多云", "阴天", "小雨", "大雨", "雷暴", "炎热", "凉爽"];

export function ReviewPage({ navigate }: { navigate: (page: PageId) => void }) {
  const { showToast } = useToastContext();
  const {
    reviewDate, setReviewDate, reviewActualRevenue, setReviewActualRevenue,
    reviewResult, reviewLoading, submitReview, adoptReview,
    transactionCount, setTransactionCount,
    avgTransactionValue, setAvgTransactionValue,
    weatherCondition, setWeatherCondition,
    specialNotes, setSpecialNotes,
  } = useReview();

  // Auto-calculate avg transaction value display
  const computedAvgTxValue = (() => {
    const rev = Number(reviewActualRevenue) || 0;
    const txCount = Number(transactionCount) || 0;
    if (txCount > 0 && rev > 0 && !avgTransactionValue) {
      return (rev / txCount).toFixed(2);
    }
    return avgTransactionValue;
  })();

  const inputClass = "mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200";

  return (
    <div className="space-y-6 animate-fade-slide-up">
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
        <h2 className="text-lg font-semibold text-[#1d1d1f] mb-4">每日复盘</h2>
        {/* Row 1: Date + Revenue */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">复盘日期</label>
            <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">实际营业额 (RM)</label>
            <input type="number" value={reviewActualRevenue} onChange={(e) => setReviewActualRevenue(e.target.value)} placeholder="如 58000" className={inputClass} />
          </div>
        </div>
        {/* Row 2: Transaction Count + Avg Transaction Value */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">客单数（交易笔数）</label>
            <input type="number" value={transactionCount} onChange={(e) => setTransactionCount(e.target.value)} placeholder="如 320" className={inputClass} />
          </div>
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">客单价 (RM) <span className="text-xs text-gray-400">自动计算，可覆盖</span></label>
            <input type="number" value={avgTransactionValue || computedAvgTxValue} onChange={(e) => setAvgTransactionValue(e.target.value)} placeholder="自动=营业额÷客单数" className={inputClass} />
          </div>
        </div>
        {/* Row 3: Weather + Special Notes */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">天气状况</label>
            <select value={weatherCondition} onChange={(e) => setWeatherCondition(e.target.value)} className={inputClass}>
              <option value="">-- 选择天气 --</option>
              {WEATHER_OPTIONS.map((w) => (<option key={w} value={w}>{w}</option>))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">特别备注</label>
            <input type="text" value={specialNotes} onChange={(e) => setSpecialNotes(e.target.value)} placeholder="如：商场活动、附近竞品开业..." className={inputClass} />
          </div>
        </div>
        {/* 断货记录不再人工录入：stockout-detector 每晚从 item_last_sale / item_hourly_sales
            自动检测（最后成交时间 vs 打烊时间），并按近 4 周同日型历史估算损失后落库。
            人工录入曾会整天覆盖自动结果，2026-04-12 后也再无人使用，故整块下线。 */}
        <button onClick={() => submitReview(showToast)} disabled={reviewLoading} className="bg-[#0071e3] text-white px-6 py-2.5 rounded-xl hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200">
          {reviewLoading ? "AI 分析中..." : "提交复盘"}
        </button>
      </div>
      {reviewResult && (
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
          <h3 className="text-md font-semibold text-[#1d1d1f] mb-3">AI 复盘结果</h3>
          <p className="text-sm text-[#1d1d1f]/80 mb-3">{reviewResult.review?.summary || ""}</p>
          {reviewResult.review?.highlights && reviewResult.review.highlights.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {reviewResult.review.highlights.map((h: string, i: number) => (<span key={i} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-lg">✓ {h}</span>))}
            </div>
          )}
          {reviewResult.review?.painPoints && reviewResult.review.painPoints.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {reviewResult.review.painPoints.map((p: string, i: number) => (<span key={i} className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded-lg">✗ {p}</span>))}
            </div>
          )}
          {/* Transaction Analysis Card */}
          {reviewResult.review?.transactionAnalysis && (
            <div className="mb-4 p-4 bg-purple-50/70 rounded-2xl border border-purple-100">
              <p className="text-sm font-medium text-purple-800 mb-1">客单分析</p>
              <p className="text-sm text-purple-700 whitespace-pre-line">{reviewResult.review.transactionAnalysis}</p>
            </div>
          )}
          {reviewResult.tomorrowSuggestions && (
            <div className="mt-4 p-4 bg-blue-50/50 rounded-2xl">
              <p className="text-sm font-medium text-blue-800 mb-2">明日建议</p>
              <p className="text-sm text-blue-700">{reviewResult.tomorrowSuggestions.reason}</p>
            </div>
          )}
          {!reviewResult.adopted && (
            <button onClick={() => { adoptReview(showToast); navigate("production"); }} className="mt-4 bg-[#0071e3] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#005bb5] transition-all duration-200">采纳建议，开始排产 →</button>
          )}
          {reviewResult.adopted && <p className="mt-4 text-sm text-green-600 font-medium">已采纳</p>}
        </div>
      )}
    </div>
  );
}