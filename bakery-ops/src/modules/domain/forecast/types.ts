// ========== Product Types ==========
export interface Product {
  id: string;
  category: string;
  name: string;
  nameEn: string;
  price: number;
  packMultiple: number;
  unitType: "batch" | "individual";
  displayFullQuantity: number;
}

export interface ProductAlias {
  alias: string;
  standardName: string;
}

export interface ProductStrategy {
  productName: string;
  positioning: "TOP" | "潜在TOP" | "其他";
  category: string;
  coldHot: "冷" | "热";
  salesRatio: number;
  targetTC: number | null;
  audience: string;
  breakStockTime: string;
  sortOrder: number;
}

// ========== Sales Data Types ==========
export interface DailySalesRecord {
  productName: string;
  standardName: string;
  quantity: number;
  date: string;
  dayOfWeek: number;
}

export interface ProductSalesBaseline {
  productName: string;
  avgMondayToThursday: number;
  avgFriday: number;
  avgWeekend: number;
  totalSales: number;
  dayCount: number;
}

// ========== Business Rules Types ==========
export interface BusinessRules {
  firstMonthRevenue: number;
  operationEnhancement: number;
  marketEnhancement: number;
  totalEnhancement: number;
  monthlyCoefficients: Record<string, number>;
  weekdayWeights: {
    mondayToThursday: number;
    friday: number;
    saturday: number;
    sunday: number;
  };
  shipmentFormula: {
    tastingWasteRate: number;
    waterBarRate: number;
    shipmentRate: number;
  };
  baselineOverrides?: Record<string, {
    mondayToThursday: number;
    friday: number;
    weekend: number;
  }>;
  productBoosts?: Record<string, number>;
  prophetDowWeights?: {
    monday: number;
    tuesday: number;
    wednesday: number;
    thursday: number;
  };
}

export interface PlanningRules {
  timeSlots: string[];
  restockLeadTime: { hot: string; cold: string };
  reductionLeadTime: { hot: string; cold: string };
  topPriorityRestock: boolean;
  breakStockThresholds: Record<string, string>;
  fixedShipmentSchedule: Record<string, string[]>;
}

// ========== Forecast Types ==========
export interface MonthlyTarget {
  month: number;
  year: number;
  coefficient: number;
  baseRevenue: number;
  enhancedRevenue: number;
}

export interface DailyTarget {
  date: string;
  dayOfWeek: number;
  dayType: "mondayToThursday" | "friday" | "weekend";
  baseWeight: number;
  weight: number;
  revenue: number;
  shipmentAmount: number;
}

export interface ProductSuggestion {
  productName: string;
  price: number;
  packMultiple: number;
  unitType: "batch" | "individual";
  baselineQuantity: number;
  suggestedQuantity: number;
  roundedQuantity: number;
  totalAmount: number;
  positioning: string;
  coldHot: string;
  displayFullQuantity: number;
  adjustedQuantity?: number;
  adjustReason?: string;
}

export interface TimeSlotSuggestion {
  productName: string;
  timeSlot: string;
  quantity: number;
  amount: number;
}

// ========== Timeslot Sales Data Types ==========
export interface TimeslotSalesRecord {
  productName: string;
  dayType: "mondayToThursday" | "friday" | "weekend";
  timeSlot: string;
  avgQuantity: number;
  sampleCount: number;
}

export interface AITimeSlotSuggestion {
  productName: string;
  timeSlot: string;
  quantity: number;
  amount: number;
  reason: string;
}

export interface AITimeSlotResult {
  suggestions: AITimeSlotSuggestion[];
  analysis: string;
  adopted: boolean;
}

export interface ForecastRun {
  id: string;
  month: number;
  year: number;
  createdAt: string;
  monthlyTargets: MonthlyTarget[];
  dailyTargets: DailyTarget[];
  productSuggestions: Record<string, ProductSuggestion[]>;
  timeSlotSuggestions: Record<string, TimeSlotSuggestion[]>;
}

// ========== Manual Adjustment Types ==========
export interface ManualAdjustment {
  id: string;
  targetType: "daily" | "product" | "timeSlot";
  targetDate: string;
  productName?: string;
  timeSlot?: string;
  fieldName: string;
  originalValue: number;
  adjustedValue: number;
  reason: string;
  adjustedBy: string;
  adjustedAt: string;
}

// ========== Import Result Types ==========
export interface ImportResult {
  success: boolean;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errors: string[];
  unmatchedProducts?: string[];
}

// ========== Planning Case Types ==========
export interface PlanningCaseItem {
  productName: string;
  price: number;
  packMultiple: number;
  totalQuantity: number;
  coldHot: string;
  timeSlotQuantities: Record<string, number>;
  restockNote: string;
  reductionTime: string;
}

export interface PlanningCase {
  date: string;
  dayType: string;
  estimatedRevenue: number;
  customerCount: number;
  averageSpend: number;
  items: PlanningCaseItem[];
}

// ========== App State ==========
export interface AppData {
  products: Product[];
  strategies: ProductStrategy[];
  salesData: DailySalesRecord[];
  salesBaselines: ProductSalesBaseline[];
  planningCases: PlanningCase[];
  forecastRun: ForecastRun | null;
  adjustments: ManualAdjustment[];
}

// ========== Holiday Types ==========
export interface Holiday {
  id?: number;
  date: string;
  name: string;
  type: "public_holiday" | "festival" | "promotion" | "ramadan" | "other";
  coefficient?: number | null;
  note: string;
}

// ========== AI Correction Types ==========
export interface DailyAICorrection {
  date: string;
  aiCoefficient: number;
  aiRevenue: number;
  aiShipmentAmount: number;
  reason: string;
  adopted: boolean;
}

export interface AIProductCorrection {
  productName: string;
  suggestedQuantity: number;
  reason: string;
}

// ========== V2: Out of Stock Types ==========
export interface OutOfStockRecord {
  id?: number;
  date: string;
  productName: string;
  inputName: string;
  soldoutTime: string;
  soldoutSlot: string;
  dayType: "mondayToThursday" | "friday" | "weekend";
  lossSlots: string[];
  estimatedLossQty: number;
  estimatedLossAmount: number;
}

// ========== V2: Context Event Types ==========
export interface ContextEvent {
  id?: number;
  date: string;
  eventType: "weather" | "competition" | "promotion" | "internal" | "other";
  eventTag: string;
  description: string;
  impactProducts: string;
  createdBy: string;
}

// ========== V2: Daily Feed & Review Types ==========
export interface DailyFeedData {
  date: string;
  dayType: "mondayToThursday" | "friday" | "weekend";
  targetRevenue: number;
  actualRevenue: number;
  idealRevenue: number;
  achievementRate: number;
  productSales: Array<{
    productName: string;
    positioning: string;
    forecastQty: number;
    actualQty: number;
    idealQty: number;
    stockoutPeriods: string[];
    wastageQty: number;
  }>;
  timeslotSales: Array<{
    timeSlot: string;
    totalRevenue: number;
    topProducts: string[];
  }>;
  contextEvents: ContextEvent[];
  transactionCount?: number;
  avgTransactionValue?: number;
  weatherCondition?: string;
  specialNotes?: string;
  weather?: {
    condition: string;
    temperature: number;
    humidity: number;
  };
}

export interface DailyReviewResult {
  id?: number;
  date: string;
  review: {
    summary: string;
    highlights: string[];
    painPoints: string[];
    stockoutAnalysis: Array<{
      product: string;
      lossQty: number;
      lossAmount: number;
      suggestion: string;
    }>;
    timeslotInsights: string[];
    transactionAnalysis?: string;
  };
  tomorrowSuggestions: {
    overallCoefficientAdjust: number;
    reason: string;
    productAdjustments: Array<{
      productName: string;
      adjustRatio: number;
      reason: string;
    }>;
    timeslotAdjustments: Array<{
      productName: string;
      timeSlot: string;
      adjustRatio: number;
      reason: string;
    }>;
  };
  adopted: boolean;
}

// ========== V2: Prompt Management Types ==========
export interface PromptSegment {
  id?: number;
  segmentKey: string;
  category: "role" | "knowledge" | "rule" | "format" | "context";
  title: string;
  content: string;
  variables: string;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

export interface PromptTemplate {
  id?: number;
  templateKey: string;
  title: string;
  systemInstructionKey: string;
  segmentKeys: string;
  model: string;
  temperature: number;
  topP: number;
  isActive: boolean;
}

// ========== V2: Empowerment Types ==========
export interface EmpowermentEvent {
  id?: number;
  eventName: string;
  eventType: "market" | "operation";
  startDate: string;
  endDate: string;
  targetProducts: string;
  platform: string;
  exposureCount: number;
  clickCount: number;
  cost: number;
  operationType: string;
  operationDetail: string;
  reviewJson: string;
  reviewedAt: string | null;
}
