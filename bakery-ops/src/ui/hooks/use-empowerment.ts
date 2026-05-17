"use client";

import { useState, useEffect, useCallback } from "react";
import { getEmpowermentEvents, addEmpowermentEvent, deleteEmpowermentEvent } from "@/app/(forecast)/actions";
import type { EmpowermentEvent } from "@/modules/domain/forecast/types";

export function useEmpowerment() {
  const [empowermentEvents, setEmpowermentEvents] = useState<EmpowermentEvent[]>([]);
  const [showNewEmpowerment, setShowNewEmpowerment] = useState(false);

  useEffect(() => { getEmpowermentEvents().then(setEmpowermentEvents).catch(() => {}); }, []);

  const handleAddEvent = useCallback(async (
    data: { eventName: string; startDate: string; endDate: string; eventType: "market" | "operation"; cost: number },
    showToast: (msg: string, type: "success" | "error" | "info") => void,
  ) => {
    if (!data.eventName || !data.startDate || !data.endDate) { showToast("请填写完整信息", "error"); return; }
    await addEmpowermentEvent({ ...data, targetProducts: "", platform: "", exposureCount: 0, clickCount: 0, operationType: "", operationDetail: "" });
    const events = await getEmpowermentEvents();
    setEmpowermentEvents(events);
    setShowNewEmpowerment(false);
    showToast("赋能事件已添加", "success");
  }, []);

  const handleDeleteEvent = useCallback(async (id: number, showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    await deleteEmpowermentEvent(id);
    setEmpowermentEvents((prev) => prev.filter((x) => x.id !== id));
    showToast("已删除", "info");
  }, []);

  const analyzeROI = useCallback(async (eventId: number, showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    const res = await fetch("/api/empowerment-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId }) });
    if (res.ok) {
      const events = await getEmpowermentEvents();
      setEmpowermentEvents(events);
      showToast("ROI 分析完成", "success");
    } else showToast("分析失败", "error");
  }, []);

  return { empowermentEvents, showNewEmpowerment, setShowNewEmpowerment, handleAddEvent, handleDeleteEvent, analyzeROI };
}
