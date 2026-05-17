"use client";

import { useState, useRef, useEffect } from "react";
import { useForecastContext } from "@/ui/components/providers/forecast-provider";
import type { PageId } from "@/ui/constants";

const CORE_PAGES: { id: PageId; label: string }[] = [
  { id: "overview", label: "今日总览" },
  { id: "review", label: "昨日复盘" },
  { id: "production", label: "今日排产" },
  { id: "timeslots", label: "时段分配" },
];

const MORE_PAGES: { id: PageId; label: string }[] = [
  { id: "trends", label: "销售趋势" },
  { id: "calendar", label: "事件日历" },
  { id: "empowerment", label: "赋能分析" },
  { id: "settings", label: "设置" },
];

export function TopNav({ activePage, navigate }: { activePage: PageId; navigate: (page: PageId) => void }) {
  const { state, dispatch } = useForecastContext();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isMoreActive = MORE_PAGES.some((p) => p.id === activePage);

  return (
    <nav className="sticky top-0 z-40 h-14 bg-[rgba(0,0,0,0.85)] backdrop-blur-xl backdrop-saturate-[180%]">
      <div className="max-w-6xl mx-auto h-full px-4 flex items-center justify-between">
        <span className="text-[15px] font-semibold text-white/90 tracking-[-0.01em]">排产预估</span>
        <div className="flex items-center gap-2">
          {CORE_PAGES.map((p) => (
            <button key={p.id} onClick={() => navigate(p.id)} className={`px-3.5 py-1.5 text-[14px] font-normal rounded-md transition-all duration-200 ${activePage === p.id ? "text-white" : "text-white/60 hover:text-white"}`}>
              {p.label}
            </button>
          ))}
          {/* More menu */}
          <div ref={moreRef} className="relative">
            <button onClick={() => setMoreOpen(!moreOpen)} className={`px-3.5 py-1.5 text-[14px] font-normal rounded-md transition-all duration-200 ${isMoreActive ? "text-white" : "text-white/60 hover:text-white"}`}>
              ···
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-[rgba(30,30,30,0.95)] backdrop-blur-xl rounded-lg shadow-lg border border-white/10 py-1 z-50">
                {MORE_PAGES.map((p) => (
                  <button key={p.id} onClick={() => { navigate(p.id); setMoreOpen(false); }} className={`w-full text-left px-3.5 py-2 text-[13px] transition-colors ${activePage === p.id ? "text-white bg-white/10" : "text-white/70 hover:text-white hover:bg-white/5"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[14px] text-white/60">
          <span className="text-white/90">{state.year}年</span>
          <select
            value={state.selectedMonth}
            onChange={(e) => dispatch({ type: "SET_SELECTED_MONTH", payload: Number(e.target.value) })}
            className="bg-white/10 border-0 rounded-md px-2.5 py-1.5 text-[14px] text-white/90 focus:ring-1 focus:ring-white/30 focus:outline-none transition-all duration-200 appearance-none cursor-pointer"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1} className="bg-[#1d1d1f] text-white">{i + 1}月</option>
            ))}
          </select>
        </div>
      </div>
    </nav>
  );
}
