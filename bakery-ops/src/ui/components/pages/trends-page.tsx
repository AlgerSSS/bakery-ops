"use client";

import { useTrends } from "@/ui/hooks/use-trends";
import { useForecastContext } from "@/ui/components/providers/forecast-provider";
import { useToastContext } from "@/ui/components/providers/toast-provider";
import { TrendChart } from "@/ui/components/domain/trend-chart";
import { TREND_COLORS } from "@/ui/constants";

export function TrendsPage() {
  const { state } = useForecastContext();
  const { showToast } = useToastContext();
  const trends = useTrends();
  const {
    trendSelectedProducts, setTrendSelectedProducts,
    trendStartDate, setTrendStartDate, trendEndDate, setTrendEndDate,
    trendData, trendLoading, trendDropdownOpen, setTrendDropdownOpen,
    trendDayTypeFilter, setTrendDayTypeFilter, fetchTrend,
  } = trends;

  const dayTypeColor: Record<string, string> = { monThu: "#0071e3", friday: "#FF9500", weekend: "#FF3B30" };
  const dayTypeLabel: Record<string, string> = { monThu: "周一至周四", friday: "周五", weekend: "周末" };
  const getDayType = (dow: number) => (dow === 0 || dow === 6) ? "weekend" : dow === 5 ? "friday" : "monThu";

  // Prepare chart data
  const dateSet = new Set(trendData.map((d) => d.date));
  const dates = Array.from(dateSet).sort();
  const chartData = dates.map((date) => {
    const dow = trendData.find((d) => d.date === date)?.day_of_week ?? new Date(date).getDay();
    const entry: Record<string, unknown> = { date: date.slice(5), fullDate: date, dayType: getDayType(dow) };
    for (const pName of trendSelectedProducts) {
      const row = trendData.find((d) => d.date === date && d.product_name === pName);
      entry[pName] = row ? Number(row.total_qty) : 0;
    }
    return entry;
  });

  // Summary
  const summary: Record<string, Record<string, { sum: number; count: number }>> = {};
  for (const pName of trendSelectedProducts) summary[pName] = { monThu: { sum: 0, count: 0 }, friday: { sum: 0, count: 0 }, weekend: { sum: 0, count: 0 } };
  for (const row of trendData) {
    const dt = getDayType(row.day_of_week);
    if (summary[row.product_name]?.[dt]) { summary[row.product_name][dt].sum += Number(row.total_qty); summary[row.product_name][dt].count += 1; }
  }

  return (
    <div className="space-y-6 animate-fade-slide-up">
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
        <h2 className="text-lg font-semibold text-[#1d1d1f] mb-4">单品销售趋势</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div className="md:col-span-2 relative">
            <label className="text-sm font-medium text-[#1d1d1f]">选择产品</label>
            <button onClick={() => setTrendDropdownOpen(!trendDropdownOpen)} className="mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm text-left focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200">
              {trendSelectedProducts.length === 0 ? "点击选择产品..." : `已选 ${trendSelectedProducts.length} 个产品`}
            </button>
            {trendDropdownOpen && (
              <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-gray-100 max-h-60 overflow-y-auto">
                {state.products.map((p) => (
                  <label key={p.name} className="flex items-center px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
                    <input type="checkbox" checked={trendSelectedProducts.includes(p.name)} onChange={(e) => {
                      if (e.target.checked) setTrendSelectedProducts((prev) => [...prev, p.name]);
                      else setTrendSelectedProducts((prev) => prev.filter((n) => n !== p.name));
                    }} className="mr-2 rounded" />
                    {p.name}
                  </label>
                ))}
                <div className="sticky bottom-0 bg-white border-t p-2 flex gap-2">
                  <button onClick={() => setTrendSelectedProducts(state.products.slice(0, 5).map((p) => p.name))} className="text-xs text-[#0071e3] hover:underline">TOP 5</button>
                  <button onClick={() => setTrendSelectedProducts([])} className="text-xs text-[#86868b] hover:underline">清空</button>
                  <button onClick={() => setTrendDropdownOpen(false)} className="text-xs ml-auto text-[#1d1d1f] font-medium">确定</button>
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">开始日期</label>
            <input type="date" value={trendStartDate} onChange={(e) => setTrendStartDate(e.target.value)} className="mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" />
          </div>
          <div>
            <label className="text-sm font-medium text-[#1d1d1f]">结束日期</label>
            <input type="date" value={trendEndDate} onChange={(e) => setTrendEndDate(e.target.value)} className="mt-1 w-full border-0 bg-gray-50 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" />
          </div>
        </div>
        <button onClick={() => fetchTrend(showToast)} disabled={trendLoading || trendSelectedProducts.length === 0} className="bg-[#0071e3] text-white px-6 py-2.5 rounded-xl hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200">
          {trendLoading ? "查询中..." : "查询趋势"}
        </button>
      </div>
      {trendData.length > 0 && (
        <>
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-md font-semibold text-[#1d1d1f]">销量趋势图 — {dayTypeLabel[trendDayTypeFilter]}</h3>
              <div className="flex gap-1 bg-gray-100 rounded-full p-1">
                {(["monThu", "friday", "weekend"] as const).map((key) => (
                  <button key={key} onClick={() => setTrendDayTypeFilter(key)} className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 ${trendDayTypeFilter === key ? "text-white shadow-sm" : "text-[#86868b] hover:text-[#1d1d1f]"}`} style={trendDayTypeFilter === key ? { backgroundColor: dayTypeColor[key] } : undefined}>
                    {dayTypeLabel[key]}
                  </button>
                ))}
              </div>
            </div>
            <TrendChart data={chartData.filter((d) => d.dayType === trendDayTypeFilter)} productNames={trendSelectedProducts} colors={TREND_COLORS} dayTypeColor={dayTypeColor} />
          </div>
          <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
            <h3 className="text-md font-semibold text-[#1d1d1f] mb-4">按日型分类平均销量</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-3 text-[#86868b] font-medium">产品</th>
                    <th className="text-right py-2 px-3 font-medium" style={{ color: dayTypeColor.monThu }}>周一至周四</th>
                    <th className="text-right py-2 px-3 font-medium" style={{ color: dayTypeColor.friday }}>周五</th>
                    <th className="text-right py-2 px-3 font-medium" style={{ color: dayTypeColor.weekend }}>周末</th>
                  </tr>
                </thead>
                <tbody>
                  {trendSelectedProducts.map((pName) => {
                    const s = summary[pName];
                    if (!s) return null;
                    const avg = (d: { sum: number; count: number }) => d.count > 0 ? (d.sum / d.count).toFixed(1) : "—";
                    return (
                      <tr key={pName} className="border-b border-gray-50 hover:bg-[#0071e3]/5">
                        <td className="py-2 px-3 font-medium text-[#1d1d1f]">{pName}</td>
                        <td className="py-2 px-3 text-right">{avg(s.monThu)}</td>
                        <td className="py-2 px-3 text-right">{avg(s.friday)}</td>
                        <td className="py-2 px-3 text-right">{avg(s.weekend)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
