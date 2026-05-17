"use client";

import { useEmpowerment } from "@/ui/hooks/use-empowerment";
import { useToastContext } from "@/ui/components/providers/toast-provider";

export function EmpowermentPage() {
  const { showToast } = useToastContext();
  const { empowermentEvents, showNewEmpowerment, setShowNewEmpowerment, handleAddEvent, handleDeleteEvent, analyzeROI } = useEmpowerment();

  return (
    <div className="space-y-6 animate-fade-slide-up">
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">赋能分析</h2>
          <button onClick={() => setShowNewEmpowerment(!showNewEmpowerment)} className="bg-[#0071e3] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#005bb5] transition-all duration-200">
            {showNewEmpowerment ? "取消" : "+ 新增赋能事件"}
          </button>
        </div>
        {showNewEmpowerment && (
          <div className="mb-6 p-4 bg-gray-50 rounded-2xl space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs text-[#86868b]">事件名称</label><input id="emp-name" className="w-full border-0 bg-white rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none" placeholder="如: 新品上市推广" /></div>
              <div><label className="text-xs text-[#86868b]">开始日期</label><input id="emp-start" type="date" className="w-full border-0 bg-white rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none" /></div>
              <div><label className="text-xs text-[#86868b]">结束日期</label><input id="emp-end" type="date" className="w-full border-0 bg-white rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-[#86868b]">类型</label><select id="emp-type" className="w-full border-0 bg-white rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none"><option value="market">市场赋能</option><option value="operation">运营赋能</option></select></div>
              <div><label className="text-xs text-[#86868b]">投入成本 (RM)</label><input id="emp-cost" type="number" className="w-full border-0 bg-white rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none" placeholder="0" /></div>
            </div>
            <button onClick={() => {
              const name = (document.getElementById("emp-name") as HTMLInputElement)?.value;
              const startDate = (document.getElementById("emp-start") as HTMLInputElement)?.value;
              const endDate = (document.getElementById("emp-end") as HTMLInputElement)?.value;
              const eventType = (document.getElementById("emp-type") as HTMLSelectElement)?.value as "market" | "operation";
              const cost = Number((document.getElementById("emp-cost") as HTMLInputElement)?.value) || 0;
              handleAddEvent({ eventName: name, startDate, endDate, eventType, cost }, showToast);
            }} className="bg-[#0071e3] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#005bb5] transition-all duration-200">保存</button>
          </div>
        )}
        {empowermentEvents.length === 0 ? (
          <p className="text-sm text-[#86868b]">暂无赋能事件，点击上方按钮添加</p>
        ) : (
          <div className="space-y-4">
            {empowermentEvents.map((ev) => (
              <div key={ev.id} className="p-4 bg-gray-50 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-sm font-semibold text-[#1d1d1f]">{ev.eventName}</span>
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-[#0071e3] text-white">{ev.eventType}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => ev.id && analyzeROI(ev.id, showToast)} className="text-xs text-[#0071e3] hover:text-[#1d1d1f] font-medium transition-colors">AI 分析 ROI</button>
                    <button onClick={() => ev.id && handleDeleteEvent(ev.id, showToast)} className="text-xs text-red-400 hover:text-red-600 transition-colors">删除</button>
                  </div>
                </div>
                <p className="text-xs text-[#86868b]">{ev.startDate} ~ {ev.endDate} | 投入: RM {ev.cost?.toLocaleString() || 0}</p>
                {ev.reviewJson && (
                  <div className="mt-3 p-3 bg-white rounded-xl text-xs text-[#1d1d1f]/80">
                    <p className="font-medium text-[#1d1d1f] mb-1">ROI 分析结果</p>
                    <p>{typeof ev.reviewJson === "string" ? ev.reviewJson : JSON.stringify(ev.reviewJson, null, 2)}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
