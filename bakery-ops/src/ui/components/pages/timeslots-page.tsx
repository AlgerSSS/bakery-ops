"use client";

import { useForecast } from "@/ui/hooks/use-forecast";
import { useAI } from "@/ui/hooks/use-ai";
import { useExport } from "@/ui/hooks/use-export";
import { useToastContext } from "@/ui/components/providers/toast-provider";
import { TimeSlotTable } from "@/ui/components/domain/timeslot-table";
import type { PageId } from "@/ui/constants";

export function TimeslotsPage({ navigate }: { navigate: (page: PageId) => void }) {
  const { showToast } = useToastContext();
  void showToast;
  const forecast = useForecast();
  const ai = useAI();
  const { exportToExcel } = useExport();
  const { selectedDate, productSuggestions, timeSlotSuggestions, timeslotSalesRecords, fixedSchedule, loading } = forecast;
  const { aiTimeSlotAnalysis, aiTimeSlotLoading, aiTimeSlotError, aiTimeSlotAdopted, fetchAITimeSlot, adoptAITimeSlot } = ai;

  return (
    <div className="space-y-6 animate-fade-slide-up">
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">分时段出货建议 - {selectedDate}</h2>
          <div className="flex gap-2">
            <button onClick={fetchAITimeSlot} disabled={aiTimeSlotLoading || productSuggestions.length === 0} className="bg-[#0071e3] text-white px-6 py-2.5 rounded-xl hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">
              {aiTimeSlotLoading ? "AI 分析中..." : "AI 智能分配"}
            </button>
            <button onClick={forecast.generateTimeSlots} disabled={loading || productSuggestions.length === 0} className="bg-gray-50 text-[#1d1d1f] px-4 py-2.5 rounded-xl hover:bg-gray-100 hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 text-sm font-medium transition-all duration-200">
              规则生成
            </button>
          </div>
        </div>
        {aiTimeSlotError && <div className="mb-4 p-3 bg-red-50/70 text-red-700 rounded-2xl text-sm">{aiTimeSlotError}</div>}
        {aiTimeSlotAnalysis && !aiTimeSlotAdopted && (
          <div className="mb-4 p-4 bg-[#0071e3]/15 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[#1d1d1f]">AI 分析结果</span>
              <button onClick={adoptAITimeSlot} className="bg-[#0071e3] text-white px-4 py-1.5 rounded-xl text-sm hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] font-medium transition-all duration-200">采纳 AI 建议</button>
            </div>
            <p className="text-sm text-[#1d1d1f]/70">{aiTimeSlotAnalysis}</p>
          </div>
        )}
        {aiTimeSlotAdopted && <div className="mb-4 p-3 bg-green-50/70 text-green-700 rounded-2xl text-sm">已采纳 AI 分时段建议</div>}
        {timeSlotSuggestions.length > 0 && (
          <div className="overflow-x-auto rounded-xl">
            <TimeSlotTable suggestions={timeSlotSuggestions} productSuggestions={productSuggestions} fixedSchedule={fixedSchedule} timeslotSalesRecords={timeslotSalesRecords} />
          </div>
        )}
      </div>
      <div className="flex justify-between">
        <button onClick={() => navigate("production")} className="text-[#86868b] hover:text-[#1d1d1f] px-4 py-2.5 text-sm font-medium transition-colors">← 单品建议</button>
        <button onClick={async () => { await exportToExcel(); showToast("导出成功", "success"); }} disabled={timeSlotSuggestions.length === 0} className="bg-[#0071e3] text-white px-6 py-2.5 rounded-xl hover:bg-[#005bb5] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 font-medium transition-all duration-200">
          导出排产单
        </button>
      </div>
    </div>
  );
}
