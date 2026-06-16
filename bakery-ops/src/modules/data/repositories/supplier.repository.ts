import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";

export interface SupplierRow {
  id: string;
  name: string;
  whatsapp_id?: string;
  phone?: string;
  categories: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const SELECT_COLUMNS =
  "id, name, whatsapp_id, phone, categories, is_active, created_at::text AS created_at, updated_at::text AS updated_at";

export class SupplierRepository {
  async create(supplier: {
    name: string;
    whatsappId?: string;
    phone?: string;
    categories: string[];
  }): Promise<SupplierRow | null> {
    try {
      const rows = await query<SupplierRow>(
        `INSERT INTO suppliers (name, whatsapp_id, phone, categories)
         VALUES (?, ?, ?, ?)
         RETURNING ${SELECT_COLUMNS}`,
        [
          supplier.name,
          supplier.whatsappId ?? null,
          supplier.phone ?? null,
          supplier.categories,
        ]
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("Failed to create supplier", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getAll(): Promise<SupplierRow[]> {
    try {
      return await query<SupplierRow>(
        `SELECT ${SELECT_COLUMNS} FROM suppliers WHERE is_active = true ORDER BY name`
      );
    } catch {
      return [];
    }
  }

  async getByCategory(category: string): Promise<SupplierRow[]> {
    try {
      return await query<SupplierRow>(
        `SELECT ${SELECT_COLUMNS} FROM suppliers WHERE is_active = true AND categories @> ARRAY[?]::text[]`,
        [category]
      );
    } catch {
      return [];
    }
  }

  async getById(id: string): Promise<SupplierRow | null> {
    try {
      const rows = await query<SupplierRow>(
        `SELECT ${SELECT_COLUMNS} FROM suppliers WHERE id = ?`,
        [id]
      );
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }

  async getDefaultSupplier(): Promise<SupplierRow | null> {
    const whatsappId = process.env.SUPPLIER_DEFAULT_WHATSAPP;
    if (!whatsappId) return null;

    try {
      const rows = await query<SupplierRow>(
        `SELECT ${SELECT_COLUMNS} FROM suppliers WHERE whatsapp_id = ? AND is_active = true LIMIT 1`,
        [whatsappId]
      );
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }
}

export const supplierRepository = new SupplierRepository();
