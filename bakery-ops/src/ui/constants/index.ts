export { DAY_TYPE_LABELS, DOW_LABELS, ALL_SLOTS } from "@/modules/domain/forecast/constants";

export const DEFAULT_COEFFICIENTS: Record<string, number> = {
  "1": 1.00, "2": 0.98, "3": 0.87, "4": 1.02, "5": 1.10, "6": 1.05,
  "7": 0.98, "8": 1.00, "9": 0.94, "10": 1.04, "11": 1.12, "12": 1.45,
};

export const TREND_COLORS = ["#0071e3", "#34C759", "#FF9500", "#AF52DE", "#FF3B30", "#5AC8FA", "#FF2D55", "#5856D6", "#FFCC00", "#1d1d1f"];

export type PageId = "overview" | "production" | "review" | "timeslots" | "trends" | "calendar" | "empowerment" | "settings";
