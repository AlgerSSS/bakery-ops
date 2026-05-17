// 供应链订货模块类型定义

export interface CatalogItem {
  no: number;
  name: string;
  unit: string;
  channel: "whatsapp" | "wms";
  supplier?: string;
}

export interface OrderItem {
  name: string;
  quantity: number;
  unit: string;
  catalogNo?: number;
  channel?: "whatsapp" | "wms";
  supplier?: string;
}

export interface SupplyOrder {
  id?: string;
  orderDate: string; // YYYY-MM-DD
  storeId: string;
  status: "draft" | "confirmed" | "sent" | "partial" | "completed";
  items: OrderItem[];
  sentAt?: string;
  notes?: string;
  createdBy?: string;
  updatedAt?: string;
}

export interface ArrivalItem {
  name: string;
  quantity: number;
  unit: string;
  catalogNo?: number;
}

export interface ArrivalRecord {
  id?: string;
  orderId: string;
  arrivalDate: string;
  storeId: string;
  items: ArrivalItem[];
  reportedBy: string;
  syncedToInventory: boolean;
}

export interface Supplier {
  id?: string;
  name: string;
  whatsappId?: string;
  phone?: string;
  categories: string[];
  isActive: boolean;
}

export interface ParsedItem {
  name: string;
  quantity: number;
  unit: string;
}

export interface ChannelSplit {
  whatsappItems: OrderItem[];
  wmsItems: OrderItem[];
}

export interface OrderConsolidation {
  date: string;
  storeId: string;
  totalItems: number;
  channelSplit: ChannelSplit;
  summaryText: string;
}
