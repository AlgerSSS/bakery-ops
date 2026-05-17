export const DAY_TYPE_LABELS: Record<string, string> = {
  mondayToThursday: "周一至周四",
  friday: "周五",
  weekend: "周末",
};

export const DOW_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export const DEFAULT_COEFFICIENTS: Record<string, number> = {
  "1": 1.00, "2": 0.98, "3": 0.87, "4": 1.02, "5": 1.10, "6": 1.05,
  "7": 0.98, "8": 1.00, "9": 0.94, "10": 1.04, "11": 1.12, "12": 1.45,
};

export const ALL_SLOTS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];

export const TREND_COLORS = ["#0071e3", "#34C759", "#FF9500", "#AF52DE", "#FF3B30", "#5AC8FA", "#FF2D55", "#5856D6", "#FFCC00", "#1d1d1f"];

export type PageId = "overview" | "production" | "review" | "timeslots" | "trends" | "calendar" | "empowerment" | "settings";
