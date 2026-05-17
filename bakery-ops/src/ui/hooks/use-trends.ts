"use client";

import { useState, useCallback } from "react";
import { getProductSalesTrend } from "@/app/(forecast)/actions";
import dayjs from "dayjs";

export function useTrends() {
  const [trendSelectedProducts, setTrendSelectedProducts] = useState<string[]>([]);
  const [trendStartDate, setTrendStartDate] = useState(dayjs().subtract(30, "day").format("YYYY-MM-DD"));
  const [trendEndDate, setTrendEndDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [trendData, setTrendData] = useState<{ product_name: string; date: string; day_of_week: number; total_qty: number }[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendDropdownOpen, setTrendDropdownOpen] = useState(false);
  const [trendDayTypeFilter, setTrendDayTypeFilter] = useState<"monThu" | "friday" | "weekend">("monThu");

  const fetchTrend = useCallback(async (showToast: (msg: string, type: "success" | "error" | "info") => void) => {
    if (trendSelectedProducts.length === 0) { showToast("请先选择产品", "error"); return; }
    setTrendLoading(true);
    try {
      const data = await getProductSalesTrend(trendSelectedProducts, trendStartDate, trendEndDate);
      setTrendData(data);
      if (data.length === 0) showToast("该时间段无销售数据", "info");
    } catch { showToast("查询失败", "error"); }
    finally { setTrendLoading(false); }
  }, [trendSelectedProducts, trendStartDate, trendEndDate]);

  return {
    trendSelectedProducts, setTrendSelectedProducts,
    trendStartDate, setTrendStartDate, trendEndDate, setTrendEndDate,
    trendData, trendLoading, trendDropdownOpen, setTrendDropdownOpen,
    trendDayTypeFilter, setTrendDayTypeFilter, fetchTrend,
  };
}
