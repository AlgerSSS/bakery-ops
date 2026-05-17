// 通用类型定义

export interface OutputFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  url: string;
  size: number;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type UserRole =
  | "owner"
  | "admin"
  | "hr_manager"
  | "store_manager"
  | "kitchen_manager"
  | "marketing_manager"
  | "staff"
  | "kol";

export interface User {
  userId: string;
  phone: string;
  lid?: string; // WhatsApp Linked ID（@lid 格式的数字部分）
  name: string;
  role: UserRole;
  permissions: string[];
  storeIds: string[];
}
