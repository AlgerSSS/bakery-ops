"use client";

import { useCallback } from "react";
import { useForecastContext } from "@/ui/components/providers/forecast-provider";
import {
  generateMonthlyTargetsWithCustomCoefficients,
  generateDailyTargets,
  generateProductSuggestions,
  generateTimeSlotSuggestions,
  getTimeslotSalesRecords,
} from "@/app/(forecast)/actions";
import dayjs from "dayjs";

export function useForecast() {
  const { state, dispatch } = useForecastContext();

  const generateMonthly = useCallback(async () => {
    dispatch({ type: "SET_LOADING", payload: true });
    const targets = await generateMonthlyTargetsWithCustomCoefficients(state.year, state.monthlyCoefficients);
    dispatch({ type: "SET_MONTHLY_TARGETS", payload: targets });
    dispatch({ type: "SET_LOADING", payload: false });
    return targets;
  }, [state.year, state.monthlyCoefficients, dispatch]);

  const generateDaily = useCallback(async () => {
    let targets = state.monthlyTargets;
    if (targets.length === 0) {
      targets = await generateMonthly();
    }
    dispatch({ type: "SET_LOADING", payload: true });
    const target = targets.find((t) => t.month === state.selectedMonth);
    if (target) {
      const dailies = await generateDailyTargets(target);
      dispatch({ type: "SET_DAILY_TARGETS", payload: dailies });
      if (dailies.length > 0 && !state.selectedDate) {
        const today = dayjs().format("YYYY-MM-DD");
        const todayInList = dailies.find((d) => d.date === today);
        dispatch({ type: "SET_SELECTED_DATE", payload: todayInList ? today : dailies[0].date });
      }
    }
    dispatch({ type: "SET_LOADING", payload: false });
  }, [state.monthlyTargets, state.selectedMonth, state.selectedDate, generateMonthly, dispatch]);

  const generateProducts = useCallback(async () => {
    if (!state.selectedDate || state.dailyTargets.length === 0) return;
    dispatch({ type: "SET_LOADING", payload: true });
    const dayTarget = state.dailyTargets.find((d) => d.date === state.selectedDate);
    if (dayTarget) {
      const suggestions = await generateProductSuggestions(dayTarget);
      dispatch({ type: "SET_PRODUCT_SUGGESTIONS", payload: suggestions });
      dispatch({ type: "SET_ADJUSTED_QUANTITIES", payload: {} });
      dispatch({ type: "SET_AI_PRODUCT_CORRECTIONS", payload: [] });
      dispatch({ type: "SET_AI_PRODUCT_ANALYSIS", payload: "" });
      dispatch({ type: "SET_AI_PRODUCT_ERROR", payload: "" });
      dispatch({ type: "SET_AI_PRODUCT_ADOPTED", payload: false });
    }
    dispatch({ type: "SET_LOADING", payload: false });
  }, [state.selectedDate, state.dailyTargets, dispatch]);

  const generateTimeSlots = useCallback(async () => {
    if (state.productSuggestions.length === 0) return;
    dispatch({ type: "SET_LOADING", payload: true });
    const dayTarget = state.dailyTargets.find((d) => d.date === state.selectedDate);
    if (dayTarget) {
      const [slots, records] = await Promise.all([
        generateTimeSlotSuggestions(state.productSuggestions, dayTarget),
        getTimeslotSalesRecords(dayTarget.dayType),
      ]);
      dispatch({ type: "SET_TIME_SLOT_SUGGESTIONS", payload: slots });
      dispatch({ type: "SET_TIMESLOT_SALES_RECORDS", payload: records });
    }
    dispatch({ type: "SET_LOADING", payload: false });
  }, [state.productSuggestions, state.dailyTargets, state.selectedDate, dispatch]);

  const adjustQuantity = useCallback((productName: string, newQty: number) => {
    dispatch({ type: "SET_ADJUSTED_QUANTITIES", payload: { ...state.adjustedQuantities, [productName]: newQty } });
    dispatch({
      type: "SET_PRODUCT_SUGGESTIONS",
      payload: state.productSuggestions.map((s) =>
        s.productName === productName
          ? { ...s, adjustedQuantity: newQty, adjustReason: "手动调整", totalAmount: Math.round(newQty * s.price) }
          : s
      ),
    });
  }, [state.adjustedQuantities, state.productSuggestions, dispatch]);

  const currentDayTarget = state.dailyTargets.find((d) => d.date === state.selectedDate);
  const totalSuggestedAmount = state.productSuggestions.reduce((sum, s) => sum + s.totalAmount, 0);

  return {
    ...state,
    dispatch,
    currentDayTarget,
    totalSuggestedAmount,
    generateMonthly,
    generateDaily,
    generateProducts,
    generateTimeSlots,
    adjustQuantity,
  };
}
