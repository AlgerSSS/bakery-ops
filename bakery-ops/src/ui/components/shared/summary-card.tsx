"use client";

export function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-all duration-300">
      <p className="text-xs text-[#86868b] tracking-[-0.01em]">{label}</p>
      <p className="text-lg font-semibold text-[#1d1d1f] mt-1 tracking-[-0.02em]">{value}</p>
    </div>
  );
}
