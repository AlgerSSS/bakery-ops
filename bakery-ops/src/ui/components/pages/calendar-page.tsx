"use client";

import { useCalendar } from "@/ui/hooks/use-calendar";
import { useToastContext } from "@/ui/components/providers/toast-provider";
import type { ContextEvent } from "@/modules/domain/forecast/types";
import dayjs from "dayjs";

export function CalendarPage() {
  const { showToast } = useToastContext();
  const cal = useCalendar();
  const {
    calendarMonth, calendarYear, calendarEvents, selectedCalendarDate,
    setSelectedCalendarDate, navigateMonth,
    newEventTag, setNewEventTag, newEventType, setNewEventType, newEventDesc, setNewEventDesc,
    handleAddEvent, handleDeleteEvent,
  } = cal;

  return (
    <div className="space-y-6 animate-fade-slide-up">
      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#1d1d1f]">事件日历 {calendarYear}年{calendarMonth + 1}月</h2>
          <div className="flex gap-2">
            <button onClick={() => navigateMonth(-1)} className="text-sm text-[#86868b] hover:text-[#1d1d1f] px-3 py-1.5 rounded-xl hover:bg-gray-50 transition-all">← 上月</button>
            <button onClick={() => navigateMonth(1)} className="text-sm text-[#86868b] hover:text-[#1d1d1f] px-3 py-1.5 rounded-xl hover:bg-gray-50 transition-all">下月 →</button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-4">
          {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
            <div key={d} className="text-center text-xs text-[#86868b] py-2 font-medium">{d}</div>
          ))}
          {(() => {
            const firstDay = dayjs().year(calendarYear).month(calendarMonth).startOf("month");
            const daysInMonth = firstDay.daysInMonth();
            const startDow = firstDay.day();
            const cells = [];
            for (let i = 0; i < startDow; i++) cells.push(<div key={`empty-${i}`} />);
            for (let d = 1; d <= daysInMonth; d++) {
              const dateStr = firstDay.date(d).format("YYYY-MM-DD");
              const dayEvents = calendarEvents.filter((e) => e.date === dateStr);
              const isSelected = selectedCalendarDate === dateStr;
              const isToday = dateStr === dayjs().format("YYYY-MM-DD");
              cells.push(
                <button key={d} onClick={() => setSelectedCalendarDate(dateStr)} className={`p-2 rounded-xl text-sm min-h-[60px] flex flex-col items-center transition-all duration-200 ${isSelected ? "bg-[#0071e3] shadow-sm" : isToday ? "bg-[#0071e3]/15" : "hover:bg-gray-50"}`}>
                  <span className={`font-medium ${isSelected ? "text-white" : "text-[#1d1d1f]/80"}`}>{d}</span>
                  {dayEvents.length > 0 && <div className="flex gap-0.5 mt-1 flex-wrap justify-center">{dayEvents.slice(0, 2).map((_, i) => (<span key={i} className="w-1.5 h-1.5 rounded-full bg-[#0071e3]" />))}</div>}
                </button>
              );
            }
            return cells;
          })()}
        </div>
      </div>
      {selectedCalendarDate && (
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-8">
          <h3 className="text-md font-semibold text-[#1d1d1f] mb-3">{selectedCalendarDate} 事件</h3>
          {calendarEvents.filter((e) => e.date === selectedCalendarDate).length > 0 ? (
            <div className="space-y-2 mb-4">
              {calendarEvents.filter((e) => e.date === selectedCalendarDate).map((e, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <div>
                    <span className="text-sm font-medium text-[#1d1d1f]">{e.eventTag}</span>
                    {e.description && <span className="text-xs text-[#86868b] ml-2">{e.description}</span>}
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${e.eventType === "promotion" ? "bg-[#0071e3] text-white" : e.eventType === "competition" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"}`}>{e.eventType}</span>
                  </div>
                  <button onClick={() => { if (e.id) handleDeleteEvent(e.id, showToast); }} className="text-red-400 text-xs hover:text-red-600 transition-colors">删除</button>
                </div>
              ))}
            </div>
          ) : (<p className="text-sm text-[#86868b] mb-4">该日暂无事件</p>)}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-[#86868b]">事件标签</label>
              <input value={newEventTag} onChange={(e) => setNewEventTag(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" placeholder="如: 开斋节" />
            </div>
            <div>
              <label className="text-xs text-[#86868b]">类型</label>
              <select value={newEventType} onChange={(e) => setNewEventType(e.target.value as ContextEvent["eventType"])} className="border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200">
                <option value="internal">内部活动</option>
                <option value="promotion">促销</option>
                <option value="weather">天气</option>
                <option value="competition">竞品</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#86868b]">描述</label>
              <input value={newEventDesc} onChange={(e) => setNewEventDesc(e.target.value)} className="w-full border-0 bg-gray-50 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#0071e3] focus:outline-none transition-all duration-200" placeholder="可选" />
            </div>
            <button onClick={() => handleAddEvent(showToast)} className="bg-[#0071e3] text-white px-4 py-1.5 rounded-xl text-sm hover:bg-[#005bb5] font-medium transition-all duration-200">添加</button>
          </div>
        </div>
      )}
    </div>
  );
}
