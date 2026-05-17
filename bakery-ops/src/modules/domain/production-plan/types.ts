export interface ProductionBatch {
  productName: string;
  coldHot: "冷" | "热";
  timeSlot: string;
  quantity: number;
  packMultiple: number;
  batchCount: number;
  prepareBy: string;
  workstation: "oven-1" | "oven-2" | "cold-prep" | "assembly";
}

export interface ProductionPlan {
  date: string;
  dayType: string;
  targetRevenue: number;
  batches: ProductionBatch[];
  summary: string;
}
