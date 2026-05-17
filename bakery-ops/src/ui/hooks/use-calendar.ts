"use client";

import { useState, useEffect, useCallback } from "react";
import { getContextEvents, addContextEvent, deleteContextEvent } from "@/app/(forecast)/actions";
import type { ContextEvent } from "@/modules/domain/forecast/types";
import dayjs from "dayjs";

export function useCalendar() {
  const [calendarYearMonth, setCalendarYearMonth] = useState({ year: dayjs().year(), month: dayjs().month() });
  const [calendarEvents, setCalendarEvents] = useState<ContextEvent[]>([]);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState("");
  const [newEventTag, setNewEventTag] = useState("");
  const [newEventType, setNewEventType] = useState<ContextEvent["eventType"]>("other");
  const [newEventDesc, setNewEventDesc] = useState("");

  const { year: calendarYear, month: calendarMonth } = calendarYearMonth;

  // Load events directly in effect — no useCallback wrapper to avoid set-state-in-effect lint
  useEffect(() => {
    let cancelled = false;
    const start = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-01`;
    const end = dayjs().year(calendarYear).month(calendarMonth).endOf("month").format("YYYY-MM-DD");
    getContextEvents(undefined, start, end).then((events) => {
      if (!cancelled) setCalendarEvents(events);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [calendarYear, calendarMonth]);

  const reloadEvents = useCallback(async () => {
    const start = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-01`;
    const end = dayjs().year(calendarYear).month(calendarMonth).endOf("month").format("YYYY-MM-DD");
    const events = await getContextEvents(undefined, start, end);
    setCalendarEvents(events);
  }, [calendarYear, calendarMonth]);

  const navigateMonth = useCallback((delta: number) => {
    const d = dayjs().year(calendarYear).month(calendarMonth).add(delta, "month");
    setCalendarYearMonth({ year: d.year(), month: d.month() });
  }, [calendarYear, calendarMonth]);

  const handleAddEvent = useCallback(async (showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    if (!newEventTag || !selectedCalendarDate) return;
    await addContextEvent({ date: selectedCalendarDate, eventTag: newEventTag, eventType: newEventType, description: newEventDesc, impactProducts: "", createdBy: "user" });
    await reloadEvents();
    setNewEventTag(""); setNewEventDesc("");
    showToast("事件已添加", "success");
  }, [newEventTag, newEventType, newEventDesc, selectedCalendarDate, reloadEvents]);

  const handleDeleteEvent = useCallback(async (id: number, showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    await deleteContextEvent(id);
    setCalendarEvents((prev) => prev.filter((x) => x.id !== id));
    showToast("已删除", "info");
  }, []);

  return {
    calendarMonth, calendarYear, calendarEvents, selectedCalendarDate,
    setSelectedCalendarDate, navigateMonth,
    newEventTag, setNewEventTag, newEventType, setNewEventType, newEventDesc, setNewEventDesc,
    handleAddEvent, handleDeleteEvent,
  };
}
