"use client";

export function Toast({ message, type }: { message: string; type: "success" | "error" | "info" }) {
  return (
    <div className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.12)] text-sm font-medium z-50 animate-fade-slide-up ${type === "success" ? "bg-[#1d1d1f] text-white" : type === "error" ? "bg-red-600 text-white" : "bg-[#0071e3] text-white"}`}>
      {message}
    </div>
  );
}
