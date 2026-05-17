"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface ToastContextValue {
  toast: { message: string; type: "success" | "error" | "info" } | null;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast, showToast }}>
      {children}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.12)] text-sm font-medium z-50 animate-fade-slide-up ${toast.type === "success" ? "bg-[#1d1d1f] text-white" : toast.type === "error" ? "bg-red-600 text-white" : "bg-[#0071e3] text-white"}`}>
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToastContext() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToastContext must be used within ToastProvider");
  return ctx;
}
