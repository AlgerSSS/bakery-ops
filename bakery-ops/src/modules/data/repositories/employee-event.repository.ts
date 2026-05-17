import { supabase } from "../supabase";
import { logger } from "../../shared/logger";

export interface EmployeeEventRow {
  id: string;
  employee_id: string;
  event_type: string;
  summary: string;
  raw_message?: string;
  reported_by?: string;
  data: Record<string, unknown>;
  created_at: string;
}

export class EmployeeEventRepository {
  async create(event: Omit<EmployeeEventRow, "id" | "created_at">): Promise<EmployeeEventRow | null> {
    const { data, error } = await supabase
      .from("employee_events")
      .insert(event)
      .select()
      .single();

    if (error) {
      logger.error("Failed to create employee event", { error: error.message });
      return null;
    }
    return data as EmployeeEventRow;
  }

  async getByEmployee(employeeId: string): Promise<EmployeeEventRow[]> {
    const { data, error } = await supabase
      .from("employee_events")
      .select("*")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });

    if (error) return [];
    return (data || []) as EmployeeEventRow[];
  }

  async getByType(eventType: string, limit = 50): Promise<EmployeeEventRow[]> {
    const { data, error } = await supabase
      .from("employee_events")
      .select("*")
      .eq("event_type", eventType)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as EmployeeEventRow[];
  }
}

export const employeeEventRepository = new EmployeeEventRepository();
