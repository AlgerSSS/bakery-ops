"use client";

import { useCallback } from "react";
import { useForecastContext } from "@/ui/components/providers/forecast-provider";
import { getTimeslotSalesRecords, saveAIDailyCorrection } from "@/app/(forecast)/actions";
import type { DailyAICorrection, AIProductCorrection } from "@/modules/domain/forecast/types";

export function useAI() {
  const { state, dispatch } = useForecastContext();

  // ========== Daily AI Correction ==========
  const fetchAICorrection = useCallback(async () => {
    if (state.dailyTargets.length === 0) return;
    dispatch({ type: "SET_AI_LOADING", payload: true });
    dispatch({ type: "SET_AI_ERROR", payload: "" });
    try {
      const res = await fetch("/api/ai-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: state.year, month: state.selectedMonth }),
      });
      const data = await res.json();
      if (!res.ok) { dispatch({ type: "SET_AI_ERROR", payload: data.error || "AI 调用失败" }); return; }

      const monthlyTarget = state.monthlyTargets.find((t) => t.month === state.selectedMonth);
      const shipmentRate = 0.95;
      const corrections: DailyAICorrection[] = [];
      const aiTotalWeight = (data.corrections as { coefficient: number }[])
        .reduce((s: number, c: { coefficient: number }) => s + (Number(c.coefficient) || 1.0), 0);
      const monthRevenue = monthlyTarget?.enhancedRevenue || 0;

      for (const c of data.corrections as { date: string; coefficient: number; reason: string }[]) {
        const aiRevenue = aiTotalWeight > 0 ? Math.round((monthRevenue * c.coefficient) / aiTotalWeight) : 0;
        corrections.push({
          date: c.date, aiCoefficient: c.coefficient, aiRevenue,
          aiShipmentAmount: Math.round(aiRevenue * shipmentRate), reason: c.reason, adopted: false,
        });
      }
      dispatch({ type: "SET_AI_CORRECTIONS", payload: corrections });
    } catch (err) {
      dispatch({ type: "SET_AI_ERROR", payload: String(err) });
    } finally {
      dispatch({ type: "SET_AI_LOADING", payload: false });
    }
  }, [state.dailyTargets, state.year, state.selectedMonth, state.monthlyTargets, dispatch]);

  const adoptAICorrection = useCallback((date: string) => {
    const correction = state.aiCorrections.find((c) => c.date === date);
    if (!correction) return;
    const monthlyTarget = state.monthlyTargets.find((t) => t.month === state.selectedMonth);
    const monthRevenue = monthlyTarget?.enhancedRevenue || 0;
    const shipmentRate = state.businessRulesState?.shipmentFormula?.shipmentRate || 0.95;

    // G2-②: 采纳结果落库（AI_CORRECTION_APPLY=true 时参与排产计算）；失败不影响原有 state 行为
    saveAIDailyCorrection(date, correction.aiCoefficient, correction.reason).catch((err) => console.warn("AI 修正落库失败", err));

    dispatch({ type: "SET_AI_CORRECTIONS", payload: state.aiCorrections.map((c) => c.date === date ? { ...c, adopted: true } : c) });
    const updated = state.dailyTargets.map((d) => d.date === date ? { ...d, weight: correction.aiCoefficient } : d);
    const newTotalWeight = updated.reduce((s, d) => s + d.weight, 0);
    dispatch({
      type: "SET_DAILY_TARGETS",
      payload: updated.map((d) => {
        const rev = newTotalWeight > 0 ? Math.round((monthRevenue * d.weight) / newTotalWeight) : 0;
        return { ...d, revenue: rev, shipmentAmount: Math.round(rev * shipmentRate) };
      }),
    });
  }, [state.aiCorrections, state.monthlyTargets, state.selectedMonth, state.businessRulesState, state.dailyTargets, dispatch]);

  const adoptAllAICorrections = useCallback(() => {
    const correctionMap = new Map(state.aiCorrections.map((c) => [c.date, c]));
    const monthlyTarget = state.monthlyTargets.find((t) => t.month === state.selectedMonth);
    const monthRevenue = monthlyTarget?.enhancedRevenue || 0;
    const shipmentRate = state.businessRulesState?.shipmentFormula?.shipmentRate || 0.95;

    // G2-②: 全部采纳同样逐条落库；失败不影响原有 state 行为
    for (const c of state.aiCorrections) {
      saveAIDailyCorrection(c.date, c.aiCoefficient, c.reason).catch((err) => console.warn("AI 修正落库失败", err));
    }

    dispatch({ type: "SET_AI_CORRECTIONS", payload: state.aiCorrections.map((c) => ({ ...c, adopted: true })) });
    const updated = state.dailyTargets.map((d) => {
      const c = correctionMap.get(d.date);
      return c ? { ...d, weight: c.aiCoefficient } : d;
    });
    const newTotalWeight = updated.reduce((s, d) => s + d.weight, 0);
    dispatch({
      type: "SET_DAILY_TARGETS",
      payload: updated.map((d) => {
        const rev = newTotalWeight > 0 ? Math.round((monthRevenue * d.weight) / newTotalWeight) : 0;
        return { ...d, revenue: rev, shipmentAmount: Math.round(rev * shipmentRate) };
      }),
    });
  }, [state.aiCorrections, state.monthlyTargets, state.selectedMonth, state.businessRulesState, state.dailyTargets, dispatch]);

  // ========== AI Product Correction ==========
  const fetchAIProductCorrection = useCallback(async () => {
    if (state.productSuggestions.length === 0) return;
    const dayTarget = state.dailyTargets.find((d) => d.date === state.selectedDate);
    if (!dayTarget) return;
    dispatch({ type: "SET_AI_PRODUCT_LOADING", payload: true });
    dispatch({ type: "SET_AI_PRODUCT_ERROR", payload: "" });
    dispatch({ type: "SET_AI_PRODUCT_ADOPTED", payload: false });
    try {
      const res = await fetch("/api/ai-product-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayType: dayTarget.dayType, date: state.selectedDate,
          shipmentAmount: dayTarget.shipmentAmount,
          productSuggestions: state.productSuggestions.map((p) => ({
            productName: p.productName, price: p.price, packMultiple: p.packMultiple,
            unitType: p.unitType, positioning: p.positioning, coldHot: p.coldHot,
            roundedQuantity: p.roundedQuantity, adjustedQuantity: p.adjustedQuantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { dispatch({ type: "SET_AI_PRODUCT_ERROR", payload: data.error || "AI 调用失败" }); return; }
      dispatch({ type: "SET_AI_PRODUCT_CORRECTIONS", payload: data.corrections || [] });
      const totalInfo = data.correctedTotal && data.targetAmount
        ? `\n校正后总金额: ${data.correctedTotal.toLocaleString()} | 目标: ${data.targetAmount.toLocaleString()} | 偏差: ${(data.correctedTotal - data.targetAmount > 0 ? "+" : "")}${(data.correctedTotal - data.targetAmount).toLocaleString()}`
        : "";
      dispatch({ type: "SET_AI_PRODUCT_ANALYSIS", payload: (data.analysis || "") + totalInfo });
    } catch (err) {
      dispatch({ type: "SET_AI_PRODUCT_ERROR", payload: String(err) });
    } finally {
      dispatch({ type: "SET_AI_PRODUCT_LOADING", payload: false });
    }
  }, [state.productSuggestions, state.dailyTargets, state.selectedDate, dispatch]);

  const adoptAIProductCorrection = useCallback(() => {
    if (state.aiProductCorrections.length === 0) return;
    const correctionMap = new Map<string, AIProductCorrection>();
    for (const c of state.aiProductCorrections) correctionMap.set(c.productName, c);
    const newAdjusted = { ...state.adjustedQuantities };
    dispatch({
      type: "SET_PRODUCT_SUGGESTIONS",
      payload: state.productSuggestions.map((s) => {
        const correction = correctionMap.get(s.productName);
        if (correction) {
          newAdjusted[s.productName] = correction.suggestedQuantity;
          return { ...s, adjustedQuantity: correction.suggestedQuantity, adjustReason: `AI校正: ${correction.reason}`, totalAmount: Math.round(correction.suggestedQuantity * s.price) };
        }
        return s;
      }),
    });
    dispatch({ type: "SET_ADJUSTED_QUANTITIES", payload: newAdjusted });
    dispatch({ type: "SET_AI_PRODUCT_ADOPTED", payload: true });
  }, [state.aiProductCorrections, state.adjustedQuantities, state.productSuggestions, dispatch]);

  // ========== AI Timeslot ==========
  const fetchAITimeSlot = useCallback(async () => {
    if (state.productSuggestions.length === 0) return;
    const dayTarget = state.dailyTargets.find((d) => d.date === state.selectedDate);
    if (!dayTarget) return;
    dispatch({ type: "SET_AI_TIMESLOT_LOADING", payload: true });
    dispatch({ type: "SET_AI_TIMESLOT_ERROR", payload: "" });
    dispatch({ type: "SET_AI_TIMESLOT_ADOPTED", payload: false });
    getTimeslotSalesRecords(dayTarget.dayType).then((r) => dispatch({ type: "SET_TIMESLOT_SALES_RECORDS", payload: r })).catch(() => {});
    try {
      const res = await fetch("/api/ai-timeslot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayType: dayTarget.dayType,
          productSuggestions: state.productSuggestions.map((p) => ({
            productName: p.productName, price: p.price, packMultiple: p.packMultiple,
            unitType: p.unitType, positioning: p.positioning, coldHot: p.coldHot,
            roundedQuantity: p.roundedQuantity, adjustedQuantity: p.adjustedQuantity,
          })),
          timeSlots: ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"],
        }),
      });
      const data = await res.json();
      if (!res.ok) { dispatch({ type: "SET_AI_TIMESLOT_ERROR", payload: data.error || "AI 调用失败" }); return; }
      dispatch({ type: "SET_AI_TIMESLOT_SUGGESTIONS", payload: data.suggestions || [] });
      dispatch({ type: "SET_AI_TIMESLOT_ANALYSIS", payload: data.analysis || "" });
    } catch (err) {
      dispatch({ type: "SET_AI_TIMESLOT_ERROR", payload: String(err) });
    } finally {
      dispatch({ type: "SET_AI_TIMESLOT_LOADING", payload: false });
    }
  }, [state.productSuggestions, state.dailyTargets, state.selectedDate, dispatch]);

  const adoptAITimeSlot = useCallback(() => {
    if (state.aiTimeSlotSuggestions.length === 0) return;
    dispatch({ type: "SET_TIME_SLOT_SUGGESTIONS", payload: state.aiTimeSlotSuggestions });
    dispatch({ type: "SET_AI_TIMESLOT_ADOPTED", payload: true });
  }, [state.aiTimeSlotSuggestions, dispatch]);

  return {
    aiCorrections: state.aiCorrections, aiLoading: state.aiLoading, aiError: state.aiError,
    fetchAICorrection, adoptAICorrection, adoptAllAICorrections,
    aiProductCorrections: state.aiProductCorrections, aiProductAnalysis: state.aiProductAnalysis,
    aiProductCorrectionLoading: state.aiProductCorrectionLoading, aiProductCorrectionError: state.aiProductCorrectionError,
    aiProductCorrectionAdopted: state.aiProductCorrectionAdopted,
    fetchAIProductCorrection, adoptAIProductCorrection,
    aiTimeSlotSuggestions: state.aiTimeSlotSuggestions, aiTimeSlotAnalysis: state.aiTimeSlotAnalysis,
    aiTimeSlotLoading: state.aiTimeSlotLoading, aiTimeSlotError: state.aiTimeSlotError,
    aiTimeSlotAdopted: state.aiTimeSlotAdopted,
    fetchAITimeSlot, adoptAITimeSlot,
  };
}
