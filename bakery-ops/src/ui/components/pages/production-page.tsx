"use client";

import { useState } from "react";
import { useForecast } from "@/ui/hooks/use-forecast";
import { useAI } from "@/ui/hooks/use-ai";
import { useToastContext } from "@/ui/components/providers/toast-provider";
import { SummaryCard } from "@/ui/components/shared/summary-card";
import { DAY_TYPE_LABELS, DOW_LABELS } from "@/ui/constants";
import type { PageId } from "@/ui/constants";

export function ProductionPage({ navigate }: { navigate: (page: PageId) => void }) {
  const { showToast } = useToastContext();
  void showToast;
  const forecast = useForecast();
  const ai = useAI();
  const {
    monthlyCoefficients, monthlyTargets, dailyTargets, productSuggestions,
    selectedMonth, selectedDate, year, loading, adjustedQuantities,
    currentDayTarget, totalSuggestedAmount,
    generateMonthly, generateDaily, generateProducts, adjustQuantity, dispatch,
  } = forecast;
  const {
    aiCorrections, aiLoading, aiError, fetchAICorrection, adoptAICorrection, adoptAllAICorrections,
    aiProductCorrections, aiProductAnalysis, aiProductCorrectionLoading, aiProductCorrectionError, aiProductCorrectionAdopted,
    fetchAIProductCorrection, adoptAIProductCorrection,
  } = ai;

  const [editingCoefficients, setEditingCoefficients] = useState(false);
  const [forecastStep, setForecastStep] = useState<"targets" | "products">("targets");
  const amountDiff = currentDayTarget ? totalSuggestedAmount - currentDayTarget.shipmentAmount : 0;

  return (
    <div className="space-y-6 animate-fade-slide-up">
      {/* Step Indicator */}
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-4">
        <div className="flex items-center justify-center gap-2">
          {(["targets", "products"] as const).map((step, i) => {
            const labels = ["月/日目标", "单品建议"];
            const isActive = forecastStep === step;
            const isDone = (["targets", "products"] as const).indexOf(forecastStep) > i;
            return (
              <div key={step} className="flex items-center">
                {i > 0 && <div className={`w-8 h-0.5 mx-1 ${isDone ? "bg-[#0071e3]" : "bg-gray-200"}`} />}
                <button onClick={() => setForecastStep(step)} className={`px-4 py-2 text-sm font-medium rounded-full transition-all duration-300 ${isActive ? "bg-[#0071e3] text-white shadow-sm" : isDone ? "bg-[#0071e3]/25 text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f] hover:bg-gray-50"}`}>
                  {isDone ? "✓ " : `${i + 1}. `}{labels[i]}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {forecastStep === "targets" && (
        <>
          {/* 月度系数配置 */}
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-[#1d1d1f]">月度系数配置</h2>
                {editingCoefficients && <span className="text-xs text-[#86868b]">修改后自动保存</span>}
              </div>
              <button onClick={() => setEditingCoefficients(!editingCoefficients)} className="text-sm text-[#1d1d1f] bg-gray-50 hover:bg-gray-100 px-4 py-1.5 rounded-xl font-medium hover:scale-[1.03] active:scale-[0.97] transition-all duration-200">
                {editingCoefficients ? "收起编辑" : "修改系数"}
              </button>
            </div>
            {editingCoefficients ? (
              <div className="grid grid-cols-6 gap-3 mb-4">
                {Array.from({ length: 12 }, (_, i) => {
                  const key = String(i + 1);
                  return (
                    <div key={key} className="flex flex-col">
                      <label className="text-xs text-[#86868b] mb-1">{i + 1}月</label>
                      <input type="number" step="0.01" min="0" value={monthlyCoefficients[key] ?? 1}
                        onChange={(e) => dispatch({ type: "SET_MONTHLY_COEFFICIENTS", payload: { ...monthlyCoefficients, [key]: Number(e.target.value) || 0 } })}
                        className="border-0 bg-gray-50 rounded-xl px-2 py-1.5 text-sm text-center w-full focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap text-xs text-[#86868b]">
                {Array.from({ length: 12 }, (_, i) => (
                  <span key={i} className="bg-[#0071e3]/15 px-2.5 py-1 rounded-full">{i + 1}月: {monthlyCoefficients[String(i + 1)]}</span>
                ))}
              </div>
            )}
          </div>
          {/* 月营业额目标 */}
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#1d1d1f]">月营业额目标 ({year}年)</h2>
              <button onClick={generateMonthly} disabled={loading} className="bg-[#0071e3] text-white px-6 py-2.5 rounded-xl hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">计算月目标</button>
            </div>
            {monthlyTargets.length > 0 && (
              <div className="overflow-x-auto rounded-xl">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50/50">
                    <tr>
                      <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">月份</th>
                      <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">系数</th>
                      <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">基础营业额</th>
                      <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">含赋能营业额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyTargets.map((t) => (
                      <tr key={t.month} className={`hover:bg-[#0071e3]/5 cursor-pointer transition-colors duration-200 border-b border-gray-50 ${t.month === selectedMonth ? "bg-[#0071e3]/15" : ""}`} onClick={() => dispatch({ type: "SET_SELECTED_MONTH", payload: t.month })}>
                        <td className="px-3 py-2 font-medium">{t.month}月</td>
                        <td className="px-3 py-2 text-right">{t.coefficient}</td>
                        <td className="px-3 py-2 text-right">{t.baseRevenue.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-semibold text-[#1d1d1f]">{t.enhancedRevenue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#0071e3]/10 font-semibold">
                    <tr>
                      <td className="px-3 py-2">合计</td>
                      <td className="px-3 py-2 text-right">-</td>
                      <td className="px-3 py-2 text-right">{monthlyTargets.reduce((s, t) => s + t.baseRevenue, 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-[#1d1d1f]">{monthlyTargets.reduce((s, t) => s + t.enhancedRevenue, 0).toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* 日营业额目标 */}
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#1d1d1f]">{selectedMonth}月 日营业额目标</h2>
              <div className="flex gap-2">
                <button onClick={fetchAICorrection} disabled={aiLoading || dailyTargets.length === 0} className="bg-gray-50 text-[#1d1d1f] px-4 py-2.5 rounded-xl hover:bg-gray-100 hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">
                  {aiLoading ? "AI分析中..." : "获取AI修正建议"}
                </button>
                {aiCorrections.length > 0 && (
                  <button onClick={adoptAllAICorrections} className="bg-gray-50 text-[#1d1d1f] px-4 py-2.5 rounded-xl hover:bg-gray-100 hover:scale-[1.03] active:scale-[0.97] text-sm font-medium transition-all duration-200">一键采用全部AI建议</button>
                )}
                <button onClick={generateDaily} disabled={loading} className="bg-[#0071e3] text-white px-6 py-2.5 rounded-xl hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">计算日目标</button>
              </div>
            </div>
            {aiError && <div className="mb-4 p-3 rounded-2xl bg-red-50/70 text-red-700 text-sm">{aiError}</div>}
            {dailyTargets.length === 0 && (
              <div className="p-4 rounded-2xl bg-amber-50/70 text-amber-800 text-sm">业务规则已更新，请点击「计算日目标」重新生成。</div>
            )}
            {dailyTargets.length > 0 && (
              <>
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <SummaryCard label="月总营业额" value={dailyTargets.reduce((s, d) => s + d.revenue, 0).toLocaleString()} />
                  <SummaryCard label="月总出货金额" value={dailyTargets.reduce((s, d) => s + d.shipmentAmount, 0).toLocaleString()} />
                  <SummaryCard label="工作日均" value={Math.round(dailyTargets.filter((d) => d.dayType === "mondayToThursday").reduce((s, d) => s + d.revenue, 0) / (dailyTargets.filter((d) => d.dayType === "mondayToThursday").length || 1)).toLocaleString()} />
                  <SummaryCard label="周末日均" value={Math.round(dailyTargets.filter((d) => d.dayType === "weekend").reduce((s, d) => s + d.revenue, 0) / (dailyTargets.filter((d) => d.dayType === "weekend").length || 1)).toLocaleString()} />
                </div>
                <div className="overflow-x-auto rounded-xl">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">日期</th>
                        <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">星期</th>
                        <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">类型</th>
                        <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">原权重</th>
                        <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">营业额</th>
                        <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">出货金额</th>
                        {aiCorrections.length > 0 && (<>
                          <th className="px-3 py-2 text-right bg-[#0071e3]/10 text-[#86868b] font-medium text-xs">AI系数</th>
                          <th className="px-3 py-2 text-right bg-[#0071e3]/10 text-[#86868b] font-medium text-xs">AI营业额</th>
                          <th className="px-3 py-2 text-left bg-[#0071e3]/10 text-[#86868b] font-medium text-xs">AI理由</th>
                          <th className="px-3 py-2 text-center bg-[#0071e3]/10 text-[#86868b] font-medium text-xs">操作</th>
                        </>)}
                        <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">查看</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyTargets.map((d) => {
                        const aiC = aiCorrections.find((c) => c.date === d.date);
                        return (
                          <tr key={d.date} className={`hover:bg-[#0071e3]/5 transition-colors duration-200 border-b border-gray-50 ${d.date === selectedDate ? "bg-[#0071e3]/15" : ""} ${d.dayType === "weekend" ? "bg-orange-50/30" : d.dayType === "friday" ? "bg-yellow-50/30" : ""}`}>
                            <td className="px-3 py-2 font-medium">{d.date}</td>
                            <td className="px-3 py-2 text-center">周{DOW_LABELS[d.dayOfWeek]}</td>
                            <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${d.dayType === "weekend" ? "bg-orange-100 text-orange-700" : d.dayType === "friday" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-700"}`}>{DAY_TYPE_LABELS[d.dayType]}</span></td>
                            <td className="px-3 py-2 text-right">{d.baseWeight}</td>
                            <td className="px-3 py-2 text-right">{d.revenue.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-semibold">{d.shipmentAmount.toLocaleString()}</td>
                            {aiCorrections.length > 0 && (<>
                              <td className={`px-3 py-2 text-right bg-[#0071e3]/5 ${aiC && aiC.aiCoefficient !== d.baseWeight ? "font-bold text-[#0071e3]" : ""}`}>{aiC ? aiC.aiCoefficient : "-"}</td>
                              <td className="px-3 py-2 text-right bg-[#0071e3]/5">{aiC ? aiC.aiRevenue.toLocaleString() : "-"}</td>
                              <td className="px-3 py-2 text-left bg-[#0071e3]/5 text-xs max-w-[200px] truncate" title={aiC?.reason}>{aiC?.reason || "-"}</td>
                              <td className="px-3 py-2 text-center bg-[#0071e3]/5">
                                {aiC && !aiC.adopted ? (<button onClick={() => adoptAICorrection(d.date)} className="text-[#0071e3] hover:text-[#1d1d1f] text-xs font-medium transition-colors duration-200">采用</button>) : aiC?.adopted ? (<span className="text-green-600 text-xs">已采用</span>) : null}
                              </td>
                            </>)}
                            <td className="px-3 py-2 text-center">
                              <button onClick={() => { dispatch({ type: "SET_SELECTED_DATE", payload: d.date }); setForecastStep("products"); }} className="text-[#0071e3] hover:text-[#1d1d1f] text-xs transition-colors duration-200">查看单品</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          <div className="flex justify-end">
            <button onClick={() => setForecastStep("products")} className="bg-[#0071e3] text-white px-6 py-2.5 rounded-xl hover:bg-[#005bb5] text-sm font-medium transition-all duration-200">下一步：单品建议 →</button>
          </div>
        </>
      )}
      {forecastStep === "products" && (
        <>
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-[#1d1d1f]">单品出货建议</h2>
                <p className="text-sm text-[#86868b] mt-1">日期：{selectedDate || "请先选择日期"} | 目标出货金额：{currentDayTarget?.shipmentAmount?.toLocaleString() || "-"}</p>
              </div>
              <div className="flex gap-2">
                <select value={selectedDate} onChange={(e) => dispatch({ type: "SET_SELECTED_DATE", payload: e.target.value })} className="border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200">
                  <option value="">选择日期</option>
                  {dailyTargets.map((d) => (<option key={d.date} value={d.date}>{d.date} (周{DOW_LABELS[d.dayOfWeek]})</option>))}
                </select>
                <button onClick={fetchAIProductCorrection} disabled={aiProductCorrectionLoading || productSuggestions.length === 0} className="bg-gray-50 text-[#1d1d1f] px-4 py-2.5 rounded-xl hover:bg-gray-100 hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">
                  {aiProductCorrectionLoading ? "AI 分析中..." : "AI 智能校正"}
                </button>
                <button onClick={generateProducts} disabled={loading || !selectedDate} className="bg-[#0071e3] text-white px-6 py-2.5 rounded-xl hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">生成建议</button>
              </div>
            </div>
            {productSuggestions.length > 0 && (
              <div className={`mb-4 p-3 rounded-2xl text-sm ${Math.abs(amountDiff) < 1000 ? "bg-green-50/70 text-green-800" : Math.abs(amountDiff) < 5000 ? "bg-amber-50/70 text-amber-800" : "bg-red-50/70 text-red-800"}`}>
                <span className="font-medium">金额偏差：</span>建议总金额 {totalSuggestedAmount.toLocaleString()} | 目标 {currentDayTarget?.shipmentAmount?.toLocaleString()} | 偏差 {amountDiff > 0 ? "+" : ""}{amountDiff.toLocaleString()} ({currentDayTarget?.shipmentAmount ? ((amountDiff / currentDayTarget.shipmentAmount) * 100).toFixed(1) : 0}%)
              </div>
            )}
            {aiProductCorrectionError && <div className="mb-4 p-3 bg-red-50/70 text-red-700 rounded-2xl text-sm">{aiProductCorrectionError}</div>}
            {aiProductAnalysis && !aiProductCorrectionAdopted && (
              <div className="mb-4 p-4 bg-[#0071e3]/15 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[#1d1d1f]">AI 校正分析</span>
                  <button onClick={adoptAIProductCorrection} className="bg-[#0071e3] text-white px-4 py-1.5 rounded-xl text-sm hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] font-medium transition-all duration-200">采纳 AI 建议</button>
                </div>
                <p className="text-sm text-[#1d1d1f]/70">{aiProductAnalysis}</p>
              </div>
            )}
            {aiProductCorrectionAdopted && <div className="mb-4 p-3 bg-green-50/70 text-green-700 rounded-2xl text-sm">已采纳 AI 单品校正建议</div>}
            {productSuggestions.length > 0 && (
              <div className="overflow-x-auto rounded-xl">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50/50">
                    <tr>
                      <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">品名</th>
                      <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">定位</th>
                      <th className="px-3 py-2 text-center text-[#86868b] font-medium text-xs">冷/热</th>
                      <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">单价</th>
                      <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">倍数</th>
                      <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">历史基线</th>
                      <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">建议数量</th>
                      {aiProductCorrections.length > 0 && !aiProductCorrectionAdopted && <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">AI建议</th>}
                      {aiProductCorrections.length > 0 && !aiProductCorrectionAdopted && <th className="px-3 py-2 text-left text-[#86868b] font-medium text-xs">AI理由</th>}
                      <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">调整数量</th>
                      <th className="px-3 py-2 text-right text-[#86868b] font-medium text-xs">金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productSuggestions.map((s) => (
                      <tr key={s.productName} className={`hover:bg-[#0071e3]/5 transition-colors duration-200 border-b border-gray-50 ${s.positioning === "TOP" ? "bg-red-50/20" : s.positioning === "潜在TOP" ? "bg-amber-50/20" : ""}`}>
                        <td className="px-3 py-2 font-medium">{s.productName}</td>
                        <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${s.positioning === "TOP" ? "bg-red-100 text-red-700" : s.positioning === "潜在TOP" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"}`}>{s.positioning}</span></td>
                        <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${s.coldHot === "热" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>{s.coldHot}</span></td>
                        <td className="px-3 py-2 text-right">{s.price}</td>
                        <td className="px-3 py-2 text-right">{s.packMultiple}</td>
                        <td className="px-3 py-2 text-right">{s.baselineQuantity}</td>
                        <td className="px-3 py-2 text-right">{s.roundedQuantity}</td>
                        {aiProductCorrections.length > 0 && !aiProductCorrectionAdopted && (() => {
                          const c = aiProductCorrections.find((x) => x.productName === s.productName);
                          return (<><td className="px-3 py-2 text-right font-medium text-[#0071e3]">{c ? c.suggestedQuantity : "-"}</td><td className="px-3 py-2 text-left text-xs text-[#1d1d1f]/60 max-w-[200px] truncate">{c ? c.reason : "-"}</td></>);
                        })()}
                        <td className="px-3 py-2 text-right">
                          <input type="number" value={adjustedQuantities[s.productName] ?? s.adjustedQuantity ?? s.roundedQuantity} onChange={(e) => adjustQuantity(s.productName, Number(e.target.value))} className="w-20 border-0 bg-gray-50 rounded-xl px-2 py-1 text-right text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" min={0} step={s.packMultiple} />
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">{s.totalAmount.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#0071e3]/10 font-semibold">
                    <tr>
                      <td className="px-3 py-2" colSpan={aiProductCorrections.length > 0 && !aiProductCorrectionAdopted ? 10 : 8}>合计</td>
                      <td className="px-3 py-2 text-right">{totalSuggestedAmount.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          <div className="flex justify-between">
            <button onClick={() => setForecastStep("targets")} className="text-[#86868b] hover:text-[#1d1d1f] px-4 py-2.5 text-sm font-medium transition-colors">← 月/日目标</button>
            <button onClick={() => navigate("timeslots")} className="bg-[#0071e3] text-white px-6 py-2.5 rounded-xl hover:bg-[#005bb5] text-sm font-medium transition-all duration-200">确认，分配时段 →</button>
          </div>
        </>
      )}
    </div>
  );
}
