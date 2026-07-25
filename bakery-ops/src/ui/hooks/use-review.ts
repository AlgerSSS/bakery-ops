"use client";

import { useState, useCallback, useEffect } from "react";
import { useForecastContext } from "@/ui/components/providers/forecast-provider";
import {
  saveOutOfStockRecords, deleteOutOfStockByDate, adoptDailyReview, upsertDailyRevenue, addContextEvent,
  getTimeslotSalesRecords, getProducts, getProductAliases, getDailyRevenues,
} from "@/app/(forecast)/actions";
import { calculateLossSlots, calculateStockoutLoss, calculateStockoutLossWithTraffic } from "@/modules/domain/forecast/forecast-engine";
import type { OutOfStockRecord, DailyReviewResult } from "@/modules/domain/forecast/types";
import dayjs from "dayjs";

export interface StockoutEntry {
  productName: string;
  soldoutTime: string; // "HH:MM" 24h format
}

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
  const [stockoutEntries, setStockoutEntries] = useState<StockoutEntry[]>(() => loadSession()?.stockoutEntries ?? []);
  const [parsedStockouts, setParsedStockouts] = useState<OutOfStockRecord[]>(() => loadSession()?.parsedStockouts ?? []);
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
    saveSession({ reviewDate, reviewActualRevenue, stockoutEntries, parsedStockouts, reviewResult, transactionCount, avgTransactionValue, weatherCondition, specialNotes });
  }, [reviewDate, reviewActualRevenue, stockoutEntries, parsedStockouts, reviewResult, transactionCount, avgTransactionValue, weatherCondition, specialNotes]);

  // Recompute parsedStockouts whenever entries or date change
  useEffect(() => {
    const dow = new Date(reviewDate).getDay();
    const realDayType: OutOfStockRecord["dayType"] = (dow === 0 || dow === 6) ? "weekend" : dow === 5 ? "friday" : "mondayToThursday";
    const parsed = stockoutEntries
      .filter((e) => e.productName && e.soldoutTime)
      .map((e) => {
        const lossSlots = calculateLossSlots(e.soldoutTime);
        const soldoutSlot = `${e.soldoutTime.split(":")[0]}:00`;
        return { productName: e.productName, inputName: e.productName, soldoutTime: e.soldoutTime, soldoutSlot, date: reviewDate, lossSlots, dayType: realDayType, estimatedLossQty: 0, estimatedLossAmount: 0 } satisfies OutOfStockRecord;
      });
    setParsedStockouts(parsed);
  }, [stockoutEntries, reviewDate]);

  const addStockoutEntry = useCallback(() => {
    setStockoutEntries((prev) => [...prev, { productName: "", soldoutTime: "" }]);
  }, []);

  const removeStockoutEntry = useCallback((index: number) => {
    setStockoutEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateStockoutEntry = useCallback((index: number, field: keyof StockoutEntry, value: string) => {
    setStockoutEntries((prev) => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));
  }, []);

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

      let enrichedStockouts = parsedStockouts;
      if (parsedStockouts.length > 0) {
        // 从数据库获取真实的分时段历史数据和产品价格（不依赖排产页面是否已加载）
        const dow = new Date(reviewDate).getDay();
        const dayType = (dow === 0 || dow === 6) ? "weekend" : dow === 5 ? "friday" : "mondayToThursday";
        const [timeslotHistory, dbProducts, aliases] = await Promise.all([
          getTimeslotSalesRecords(dayType),
          state.products.length > 0 ? Promise.resolve(state.products) : getProducts(),
          getProductAliases(),
        ]);
        const priceMap = new Map(dbProducts.map((p) => [p.name, p.price]));
        // 构建别名→标准名映射（含产品名本身的模糊匹配）
        const productNames = dbProducts.map((p) => p.name);
        const resolveProductName = (inputName: string): string => {
          // 1. 精确匹配产品名
          if (priceMap.has(inputName)) return inputName;
          // 2. 别名表匹配
          if (aliases[inputName]) return aliases[inputName];
          // 3. 模糊匹配：输入名是标准名的子串，或标准名包含输入名
          const fuzzy = productNames.find((n) => n.includes(inputName) || inputName.includes(n));
          if (fuzzy) return fuzzy;
          return inputName;
        };

        enrichedStockouts = parsedStockouts.map((s) => {
          const standardName = resolveProductName(s.productName);
          const price = priceMap.get(standardName) || 0;
          const resolved = { ...s, productName: standardName, date: reviewDate };
          const { lossQty, lossAmount } = txCount > 0
            ? calculateStockoutLossWithTraffic(resolved, timeslotHistory, price, txCount)
            : calculateStockoutLoss(resolved, timeslotHistory, price);
          return { ...resolved, estimatedLossQty: lossQty, estimatedLossAmount: lossAmount };
        });
        await deleteOutOfStockByDate(reviewDate);
        await saveOutOfStockRecords(enrichedStockouts);
      }

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
            stockoutRecords: enrichedStockouts,
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
  }, [parsedStockouts, state.products, reviewDate, reviewActualRevenue, transactionCount, avgTransactionValue, weatherCondition, specialNotes, dispatch]);

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
    stockoutEntries, addStockoutEntry, removeStockoutEntry, updateStockoutEntry,
    parsedStockouts, productNames,
    reviewResult, reviewLoading, submitReview, adoptReview,
    transactionCount, setTransactionCount,
    avgTransactionValue, setAvgTransactionValue,
    weatherCondition, setWeatherCondition,
    specialNotes, setSpecialNotes,
  };
}