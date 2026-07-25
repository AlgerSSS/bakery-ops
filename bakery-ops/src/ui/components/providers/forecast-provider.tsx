"use client";

import { createContext, useContext, useReducer, useEffect, useRef, type ReactNode, type Dispatch } from "react";
import {
  getProducts, getStrategies, getSalesBaselines, getFixedShipmentSchedules,
  getBusinessRulesFromDB, getProductAliases, getDailyReview, getContextEvents,
  getDailySalesTotal, updateBusinessRule,
} from "@/app/(forecast)/actions";
import type {
  Product, ProductStrategy, ProductSalesBaseline, BusinessRules,
  MonthlyTarget, DailyTarget, ProductSuggestion, TimeSlotSuggestion,
  TimeslotSalesRecord, DailyAICorrection, AIProductCorrection,
  ImportResult, DailyReviewResult, ContextEvent,
} from "@/modules/domain/forecast/types";
import { DEFAULT_COEFFICIENTS } from "@/ui/constants";
import dayjs from "dayjs";

// ========== State ==========
export interface ForecastState {
  // Core data (loaded from DB once)
  products: Product[];
  strategies: ProductStrategy[];
  baselines: ProductSalesBaseline[];
  businessRulesState: BusinessRules | null;
  fixedSchedule: Record<string, string[]>;
  aliases: Record<string, string>;

  // Pipeline data
  monthlyCoefficients: Record<string, number>;
  monthlyTargets: MonthlyTarget[];
  dailyTargets: DailyTarget[];
  productSuggestions: ProductSuggestion[];
  timeSlotSuggestions: TimeSlotSuggestion[];
  timeslotSalesRecords: TimeslotSalesRecord[];
  adjustedQuantities: Record<string, number>;

  // Selection
  year: number;
  selectedMonth: number;
  selectedDate: string;

  // AI state
  aiCorrections: DailyAICorrection[];
  aiLoading: boolean;
  aiError: string;
  aiProductCorrections: AIProductCorrection[];
  aiProductAnalysis: string;
  aiProductCorrectionLoading: boolean;
  aiProductCorrectionError: string;
  aiProductCorrectionAdopted: boolean;
  aiTimeSlotSuggestions: TimeSlotSuggestion[];
  aiTimeSlotAnalysis: string;
  aiTimeSlotLoading: boolean;
  aiTimeSlotError: string;
  aiTimeSlotAdopted: boolean;

  // Dashboard
  dashboardReview: DailyReviewResult | null;
  dashboardEvents: ContextEvent[];
  yesterdaySales: number | null;

  // Import
  importStatus: { products?: ImportResult; sales?: ImportResult; strategy?: ImportResult; timeslot?: ImportResult };

  // Global flags
  loading: boolean;
  dataLoaded: boolean;
}
// ========== Actions ==========
export type ForecastAction =
  | { type: "SET_CORE_DATA"; payload: { products: Product[]; strategies: ProductStrategy[]; baselines: ProductSalesBaseline[]; fixedSchedule: Record<string, string[]>; businessRulesState: BusinessRules; aliases: Record<string, string> } }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_DATA_LOADED"; payload: boolean }
  | { type: "SET_MONTHLY_COEFFICIENTS"; payload: Record<string, number> }
  | { type: "SET_MONTHLY_TARGETS"; payload: MonthlyTarget[] }
  | { type: "SET_DAILY_TARGETS"; payload: DailyTarget[] }
  | { type: "SET_PRODUCT_SUGGESTIONS"; payload: ProductSuggestion[] }
  | { type: "SET_TIME_SLOT_SUGGESTIONS"; payload: TimeSlotSuggestion[] }
  | { type: "SET_TIMESLOT_SALES_RECORDS"; payload: TimeslotSalesRecord[] }
  | { type: "SET_ADJUSTED_QUANTITIES"; payload: Record<string, number> }
  | { type: "SET_SELECTED_MONTH"; payload: number }
  | { type: "SET_SELECTED_DATE"; payload: string }
  | { type: "SET_YEAR"; payload: number }
  | { type: "SET_AI_CORRECTIONS"; payload: DailyAICorrection[] }
  | { type: "SET_AI_LOADING"; payload: boolean }
  | { type: "SET_AI_ERROR"; payload: string }
  | { type: "SET_AI_PRODUCT_CORRECTIONS"; payload: AIProductCorrection[] }
  | { type: "SET_AI_PRODUCT_ANALYSIS"; payload: string }
  | { type: "SET_AI_PRODUCT_LOADING"; payload: boolean }
  | { type: "SET_AI_PRODUCT_ERROR"; payload: string }
  | { type: "SET_AI_PRODUCT_ADOPTED"; payload: boolean }
  | { type: "SET_AI_TIMESLOT_SUGGESTIONS"; payload: TimeSlotSuggestion[] }
  | { type: "SET_AI_TIMESLOT_ANALYSIS"; payload: string }
  | { type: "SET_AI_TIMESLOT_LOADING"; payload: boolean }
  | { type: "SET_AI_TIMESLOT_ERROR"; payload: string }
  | { type: "SET_AI_TIMESLOT_ADOPTED"; payload: boolean }
  | { type: "SET_DASHBOARD_REVIEW"; payload: DailyReviewResult | null }
  | { type: "SET_DASHBOARD_EVENTS"; payload: ContextEvent[] }
  | { type: "SET_YESTERDAY_SALES"; payload: number | null }
  | { type: "SET_IMPORT_STATUS"; payload: ForecastState["importStatus"] }
  | { type: "SET_BUSINESS_RULES"; payload: BusinessRules }
  | { type: "SET_FIXED_SCHEDULE"; payload: Record<string, string[]> }
  | { type: "SET_ALIASES"; payload: Record<string, string> };

const initialState: ForecastState = {
  products: [], strategies: [], baselines: [],
  businessRulesState: null, fixedSchedule: {}, aliases: {},
  monthlyCoefficients: DEFAULT_COEFFICIENTS,
  monthlyTargets: [], dailyTargets: [],
  productSuggestions: [], timeSlotSuggestions: [],
  timeslotSalesRecords: [], adjustedQuantities: {},
  year: 2026, selectedMonth: 4, selectedDate: "",
  aiCorrections: [], aiLoading: false, aiError: "",
  aiProductCorrections: [], aiProductAnalysis: "",
  aiProductCorrectionLoading: false, aiProductCorrectionError: "", aiProductCorrectionAdopted: false,
  aiTimeSlotSuggestions: [], aiTimeSlotAnalysis: "",
  aiTimeSlotLoading: false, aiTimeSlotError: "", aiTimeSlotAdopted: false,
  dashboardReview: null, dashboardEvents: [], yesterdaySales: null,
  importStatus: {},
  loading: false, dataLoaded: false,
};

function coreDataReducer(state: ForecastState, action: ForecastAction): ForecastState {
  switch (action.type) {
    case "SET_CORE_DATA": return { ...state, ...action.payload, dataLoaded: true };
    case "SET_LOADING": return { ...state, loading: action.payload };
    case "SET_DATA_LOADED": return { ...state, dataLoaded: action.payload };
    case "SET_MONTHLY_COEFFICIENTS": return { ...state, monthlyCoefficients: action.payload };
    case "SET_MONTHLY_TARGETS": return { ...state, monthlyTargets: action.payload };
    case "SET_DAILY_TARGETS": return { ...state, dailyTargets: action.payload };
    case "SET_PRODUCT_SUGGESTIONS": return { ...state, productSuggestions: action.payload };
    case "SET_TIME_SLOT_SUGGESTIONS": return { ...state, timeSlotSuggestions: action.payload };
    case "SET_TIMESLOT_SALES_RECORDS": return { ...state, timeslotSalesRecords: action.payload };
    case "SET_ADJUSTED_QUANTITIES": return { ...state, adjustedQuantities: action.payload };
    default: return state;
  }
}

function selectionReducer(state: ForecastState, action: ForecastAction): ForecastState {
  switch (action.type) {
    case "SET_SELECTED_MONTH": return { ...state, selectedMonth: action.payload };
    case "SET_SELECTED_DATE": return { ...state, selectedDate: action.payload };
    case "SET_YEAR": return { ...state, year: action.payload };
    default: return state;
  }
}

function aiStateReducer(state: ForecastState, action: ForecastAction): ForecastState {
  switch (action.type) {
    case "SET_AI_CORRECTIONS": return { ...state, aiCorrections: action.payload };
    case "SET_AI_LOADING": return { ...state, aiLoading: action.payload };
    case "SET_AI_ERROR": return { ...state, aiError: action.payload };
    case "SET_AI_PRODUCT_CORRECTIONS": return { ...state, aiProductCorrections: action.payload };
    case "SET_AI_PRODUCT_ANALYSIS": return { ...state, aiProductAnalysis: action.payload };
    case "SET_AI_PRODUCT_LOADING": return { ...state, aiProductCorrectionLoading: action.payload };
    case "SET_AI_PRODUCT_ERROR": return { ...state, aiProductCorrectionError: action.payload };
    case "SET_AI_PRODUCT_ADOPTED": return { ...state, aiProductCorrectionAdopted: action.payload };
    case "SET_AI_TIMESLOT_SUGGESTIONS": return { ...state, aiTimeSlotSuggestions: action.payload };
    case "SET_AI_TIMESLOT_ANALYSIS": return { ...state, aiTimeSlotAnalysis: action.payload };
    case "SET_AI_TIMESLOT_LOADING": return { ...state, aiTimeSlotLoading: action.payload };
    case "SET_AI_TIMESLOT_ERROR": return { ...state, aiTimeSlotError: action.payload };
    case "SET_AI_TIMESLOT_ADOPTED": return { ...state, aiTimeSlotAdopted: action.payload };
    default: return state;
  }
}

function dashboardReducer(state: ForecastState, action: ForecastAction): ForecastState {
  switch (action.type) {
    case "SET_DASHBOARD_REVIEW": return { ...state, dashboardReview: action.payload };
    case "SET_DASHBOARD_EVENTS": return { ...state, dashboardEvents: action.payload };
    case "SET_YESTERDAY_SALES": return { ...state, yesterdaySales: action.payload };
    default: return state;
  }
}

function settingsReducer(state: ForecastState, action: ForecastAction): ForecastState {
  switch (action.type) {
    case "SET_BUSINESS_RULES": return { ...state, businessRulesState: action.payload };
    case "SET_FIXED_SCHEDULE": return { ...state, fixedSchedule: action.payload };
    case "SET_ALIASES": return { ...state, aliases: action.payload };
    case "SET_IMPORT_STATUS": return { ...state, importStatus: action.payload };
    default: return state;
  }
}

function forecastReducer(state: ForecastState, action: ForecastAction): ForecastState {
  let next = coreDataReducer(state, action);
  next = selectionReducer(next, action);
  next = aiStateReducer(next, action);
  next = dashboardReducer(next, action);
  next = settingsReducer(next, action);
  return next;
}

// ========== Context ==========
interface ForecastContextValue {
  state: ForecastState;
  dispatch: Dispatch<ForecastAction>;
}

const ForecastContext = createContext<ForecastContextValue | null>(null);

export function useForecastContext() {
  const ctx = useContext(ForecastContext);
  if (!ctx) throw new Error("useForecastContext must be used within ForecastProvider");
  return ctx;
}

export function ForecastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(forecastReducer, initialState);
  const coefficientsLoadedRef = useRef(false);

  // Auto-save monthly coefficients to DB (debounced 800ms)
  useEffect(() => {
    if (!coefficientsLoadedRef.current) return;
    const timer = setTimeout(() => {
      updateBusinessRule("monthlyCoefficients", state.monthlyCoefficients);
    }, 800);
    return () => clearTimeout(timer);
  }, [state.monthlyCoefficients]);

  // Load initial data from DB
  useEffect(() => {
    async function loadFromDB() {
      dispatch({ type: "SET_LOADING", payload: true });
      try {
        const [prods, strats, bls, sched, rules, al] = await Promise.all([
          getProducts(), getStrategies(), getSalesBaselines(),
          getFixedShipmentSchedules(), getBusinessRulesFromDB(), getProductAliases(),
        ]);
        dispatch({
          type: "SET_CORE_DATA",
          payload: { products: prods, strategies: strats, baselines: bls, fixedSchedule: sched, businessRulesState: rules, aliases: al },
        });
        if (rules.monthlyCoefficients && Object.keys(rules.monthlyCoefficients).length > 0) {
          dispatch({ type: "SET_MONTHLY_COEFFICIENTS", payload: rules.monthlyCoefficients });
        }
        setTimeout(() => { coefficientsLoadedRef.current = true; }, 0);

        // Load dashboard data
        try {
          const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
          const today = dayjs().format("YYYY-MM-DD");
          const [review, events, ySales] = await Promise.all([
            getDailyReview(yesterday), getContextEvents(today), getDailySalesTotal(yesterday),
          ]);
          if (review) dispatch({ type: "SET_DASHBOARD_REVIEW", payload: review });
          dispatch({ type: "SET_DASHBOARD_EVENTS", payload: events });
          dispatch({ type: "SET_YESTERDAY_SALES", payload: ySales });
        } catch { /* Dashboard data is optional */ }
      } catch (err) {
        console.error("从数据库加载数据失败:", err);
      }
      dispatch({ type: "SET_LOADING", payload: false });
    }
    loadFromDB();
  }, []);

  return (
    <ForecastContext.Provider value={{ state, dispatch }}>
      {children}
    </ForecastContext.Provider>
  );
}
