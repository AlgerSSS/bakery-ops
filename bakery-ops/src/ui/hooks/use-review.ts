"use client";

import { useState, useCallback, useEffect } from "react";
import { useForecastContext } from "@/ui/components/providers/forecast-provider";
import {
  adoptDailyReview, upsertDailyRevenue, addContextEvent, getDailyRevenues, getProducts,
} from "@/app/(forecast)/actions";
import type { OutOfStockRecord, DailyReviewResult } from "@/modules/domain/forecast/types";
import dayjs from "dayjs";

const SESSION_KEY = "review_state";

function loadSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSession(data: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

export function useReview() {
  const { state, dispatch } = useForecastContext();

  const [reviewDate, setReviewDate] = useState<string>(() => loadSession()?.reviewDate ?? dayjs().subtract(1, "day").format("YYYY-MM-DD"));
  const [reviewActualRevenue, setReviewActualRevenue] = useState<string>(() => loadSession()?.reviewActualRevenue ?? "");
  const [reviewResult, setReviewResult] = useState<DailyReviewResult | null>(() => loadSession()?.reviewResult ?? null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [transactionCount, setTransactionCount] = useState<string>(() => loadSession()?.transactionCount ?? "");
  const [avgTransactionValue, setAvgTransactionValue] = useState<string>(() => loadSession()?.avgTransactionValue ?? "");
  const [weatherCondition, setWeatherCondition] = useState<string>(() => loadSession()?.weatherCondition ?? "");
  const [specialNotes, setSpecialNotes] = useState<string>(() => loadSession()?.specialNotes ?? "");
  const [productNames, setProductNames] = useState<string[]>([]);

  // Load product names from DB
  useEffect(() => {
    getProducts().then((products) => setProductNames(products.map((p) => p.name).sort()));
  }, []);

  // Prefill from POS-synced daily_revenue when reviewDate changes (only fills fields still empty)
  useEffect(() => {
    let cancelled = false;
    getDailyRevenues(reviewDate, reviewDate).then((rows) => {
      if (cancelled || rows.length === 0) return;
      const row = rows[0];
      if (row.revenue != null) setReviewActualRevenue((prev) => prev === "" ? String(row.revenue) : prev);
      if (row.transaction_count != null) setTransactionCount((prev) => prev === "" ? String(row.transaction_count) : prev);
      if (row.avg_transaction_value != null) setAvgTransactionValue((prev) => prev === "" ? String(row.avg_transaction_value) : prev);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [reviewDate]);

  // Persist state to sessionStorage on every change
  useEffect(() => {
    saveSession({ reviewDate, reviewActualRevenue, reviewResult, transactionCount, avgTransactionValue, weatherCondition, specialNotes });
  }, [reviewDate, reviewActualRevenue, reviewResult, transactionCount, avgTransactionValue, weatherCondition, specialNotes]);

  const submitReview = useCallback(async (showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    setReviewLoading(true);
    try {
      const txCount = Number(transactionCount) || 0;
      const actualRevenue = Number(reviewActualRevenue) || 0;
      // Auto-calculate avgTransactionValue if not manually set
      let avgTxValue = Number(avgTransactionValue) || 0;
      if (txCount > 0 && avgTxValue === 0 && actualRevenue > 0) {
        avgTxValue = Math.round((actualRevenue / txCount) * 100) / 100;
        setAvgTransactionValue(String(avgTxValue));
      }

      /* 断货记录不再由复盘页写入：stockout-detector 每晚自动检测并落库。
         这里原本会 deleteOutOfStockByDate 整天清空再写人工记录——自动检测 2026-07 上线后，
         店长补记一条就会抹掉当天全部自动结果。人工通道自 2026-04-12 起无人使用，已整块下线。 */

      if (actualRevenue > 0) {
        await upsertDailyRevenue(reviewDate, actualRevenue, txCount || undefined, avgTxValue || undefined);
      }

      // Save weather as context_event
      if (weatherCondition) {
        await addContextEvent({
          date: reviewDate,
          eventType: "weather",
          eventTag: weatherCondition,
          description: `天气：${weatherCondition}`,
          impactProducts: "",
          createdBy: "review",
        });
      }

      const res = await fetch("/api/daily-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedData: {
            date: reviewDate,
            actualRevenue,
            transactionCount: txCount || undefined,
            avgTransactionValue: avgTxValue || undefined,
            weatherCondition: weatherCondition || undefined,
            specialNotes: specialNotes || undefined,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setReviewResult(data);
        const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
        if (reviewDate === yesterday) {
          if (actualRevenue > 0) dispatch({ type: "SET_YESTERDAY_SALES", payload: actualRevenue });
          dispatch({ type: "SET_DASHBOARD_REVIEW", payload: data });
        }
        showToast("AI 复盘完成", "success");
      }
      else showToast(data.error || "复盘失败", "error");
    } catch (err) { showToast(String(err), "error"); }
    finally { setReviewLoading(false); }
  }, [reviewDate, reviewActualRevenue, transactionCount, avgTransactionValue, weatherCondition, specialNotes, dispatch]);

  const adoptReview = useCallback(async (showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    if (!reviewResult) return;
    await adoptDailyReview(reviewDate);
    const updated = { ...reviewResult, adopted: true };
    setReviewResult(updated);
    dispatch({ type: "SET_DASHBOARD_REVIEW", payload: updated });

    // 需求7: 将明日产品调整建议应用到排产 adjustedQuantities
    const productAdjustments = reviewResult.tomorrowSuggestions?.productAdjustments;
    if (productAdjustments && productAdjustments.length > 0 && state.productSuggestions.length > 0) {
      const newAdjusted = { ...state.adjustedQuantities };
      const updatedSuggestions = state.productSuggestions.map((s) => {
        const adj = productAdjustments.find((a: { productName: string; adjustRatio: number; reason: string }) => a.productName === s.productName);
        if (adj && adj.adjustRatio) {
          const base = s.adjustedQuantity ?? s.roundedQuantity;
          const newQty = Math.max(s.packMultiple, Math.round(base * adj.adjustRatio / s.packMultiple) * s.packMultiple);
          newAdjusted[s.productName] = newQty;
          return { ...s, adjustedQuantity: newQty, totalAmount: Math.round(newQty * s.price) };
        }
        return s;
      });
      dispatch({ type: "SET_PRODUCT_SUGGESTIONS", payload: updatedSuggestions });
      dispatch({ type: "SET_ADJUSTED_QUANTITIES", payload: newAdjusted });
    }

    showToast("已采纳复盘建议", "success");
  }, [reviewResult, reviewDate, dispatch, state.productSuggestions, state.adjustedQuantities]);

  return {
    reviewDate, setReviewDate, reviewActualRevenue, setReviewActualRevenue,
    reviewResult, reviewLoading, submitReview, adoptReview,
    transactionCount, setTransactionCount,
    avgTransactionValue, setAvgTransactionValue,
    weatherCondition, setWeatherCondition,
    specialNotes, setSpecialNotes,
  };
}