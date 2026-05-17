"use client";

import { useReview } from "@/ui/hooks/use-review";
import { useToastContext } from "@/ui/components/providers/toast-provider";
import type { PageId } from "@/ui/constants";

const WEATHER_OPTIONS = ["晴天", "多云", "阴天", "小雨", "大雨", "雷暴", "炎热", "凉爽"];

const STOCKOUT_TIME_OPTIONS = (() => {
  const options: string[] = [];
  for (let h = 12; h <= 21; h++) {
    for (const m of ["00", "15", "30", "45"]) {
      options.push(`${String(h).padStart(2, "0")}:${m}`);
    }
  }
  return options;
})();

export function ReviewPage({ navigate }: { navigate: (page: PageId) => void }) {
  const { showToast } = useToastContext();
  const {
    reviewDate, setReviewDate, reviewActualRevenue, setReviewActualRevenue,
    stockoutEntries, addStockoutEntry, removeStockoutEntry, updateStockoutEntry,
    parsedStockouts, productNames,
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
        {/* Row 4: Stockout entries */}
        <div className="mb-4">
          <label className="text-sm font-medium text-[#1d1d1f]">断货记录</label>
          <div className="mt-2 space-y-2">
            {stockoutEntries.map((entry, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={entry.productName} onChange={(e) => updateStockoutEntry(i, "productName", e.target.value)} className={`${inputClass} min-w-0 w-[70%]`}>
                  <option value="">-- 选择产品 --</option>
                  {productNames.map((name) => (<option key={name} value={name}>{name}</option>))}
                </select>
                <select value={entry.soldoutTime} onChange={(e) => updateStockoutEntry(i, "soldoutTime", e.target.value)} className={`${inputClass} min-w-0 w-[25%]`}>
                  <option value="">-- 时间 --</option>
                  {STOCKOUT_TIME_OPTIONS.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
                <button type="button" onClick={() => removeStockoutEntry(i)} className="text-red-400 hover:text-red-600 text-lg shrink-0 px-1 transition-colors" title="删除">×</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addStockoutEntry} className="mt-2 text-sm text-[#0071e3] hover:text-[#005bb5] font-medium transition-colors">+ 添加断货产品</button>
        </div>
        {parsedStockouts.length > 0 && (
          <div className="mb-4 p-3 bg-[#0071e3]/10 rounded-2xl">
            <p className="text-xs font-medium text-[#1d1d1f] mb-2">解析预览：</p>
            <div className="flex flex-wrap gap-2">
              {parsedStockouts.map((s, i) => (
                <span key={i} className="text-xs bg-white px-2 py-1 rounded-lg shadow-sm">
                  {s.productName} {s.soldoutTime} → 损失时段: {s.lossSlots.join(", ") || "无"}
                </span>
              ))}
            </div>
          </div>
        )}
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