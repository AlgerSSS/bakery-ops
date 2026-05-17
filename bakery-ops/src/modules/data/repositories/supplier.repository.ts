import { supabase } from "../supabase";
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

export class SupplierRepository {
  async create(supplier: {
    name: string;
    whatsappId?: string;
    phone?: string;
    categories: string[];
  }): Promise<SupplierRow | null> {
    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        name: supplier.name,
        whatsapp_id: supplier.whatsappId,
        phone: supplier.phone,
        categories: supplier.categories,
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create supplier", { error: error.message });
      return null;
    }
    return data as SupplierRow;
  }

  async getAll(): Promise<SupplierRow[]> {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) return [];
    return (data || []) as SupplierRow[];
  }

  async getByCategory(category: string): Promise<SupplierRow[]> {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("is_active", true)
      .contains("categories", [category]);

    if (error) return [];
    return (data || []) as SupplierRow[];
  }

  async getById(id: string): Promise<SupplierRow | null> {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return data as SupplierRow;
  }

  async getDefaultSupplier(): Promise<SupplierRow | null> {
    const whatsappId = process.env.SUPPLIER_DEFAULT_WHATSAPP;
    if (!whatsappId) return null;

    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("whatsapp_id", whatsappId)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (error || !data) return null;
    return data as SupplierRow;
  }
}

export const supplierRepository = new SupplierRepository();
