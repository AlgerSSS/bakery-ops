import { larkBaseService } from "./lark-base.service";
import { employeeRepository } from "../../data/repositories/employee.repository";
import type { EmployeeRow } from "../../data/repositories/employee.repository";
import type { EmployeeEventRow } from "../../data/repositories/employee-event.repository";
import type { ParsedResume } from "../resume/types";
import { logger } from "../../shared/logger";
import { supabase } from "../../data/supabase";

export class LarkSyncService {
  async onEmployeeCreated(employee: EmployeeRow, parsedResume?: ParsedResume): Promise<void> {
    try {
      const recordId = await larkBaseService.createEmployeeRecord(employee, parsedResume);
      if (recordId) {
        await this.saveLarkRecordId(employee.id, recordId);
        logger.info("Lark sync: employee created", { name: employee.name, recordId });
      } else {
        logger.warn("Lark sync: failed to create employee record", { name: employee.name });
      }
    } catch (err) {
      logger.warn("Lark sync: onEmployeeCreated failed", { name: employee.name, error: String(err) });
    }
  }

  async onStatusChanged(employee: EmployeeRow, newStatus: string, extra?: Record<string, unknown>): Promise<void> {
    try {
      const recordId = await this.ensureLarkRecord(employee);
      if (!recordId) return;
      const ok = await larkBaseService.updateEmployeeStatus(recordId, newStatus, extra);
      if (!ok) {
        logger.warn("Lark sync: status update failed, will not retry", { name: employee.name, newStatus });
      }
    } catch (err) {
      logger.warn("Lark sync: onStatusChanged failed", { name: employee.name, error: String(err) });
    }
  }

  async onEventRecorded(employee: EmployeeRow, event: EmployeeEventRow): Promise<void> {
    try {
      const recordId = await this.ensureLarkRecord(employee);
      if (!recordId) return;
      const ok = await larkBaseService.appendEvent(recordId, event);
      if (!ok) {
        logger.warn("Lark sync: event append failed", { name: employee.name, event: event.event_type });
      }
    } catch (err) {
      logger.warn("Lark sync: onEventRecorded failed", { name: employee.name, error: String(err) });
    }
  }

  async onResumeParsed(employee: EmployeeRow, resume: ParsedResume): Promise<void> {
    try {
      const recordId = await this.ensureLarkRecord(employee);
      if (!recordId) return;
      await larkBaseService.updateResumeFields(recordId, resume);
    } catch (err) {
      logger.warn("Lark sync: onResumeParsed failed", { name: employee.name, error: String(err) });
    }
  }

  private async ensureLarkRecord(employee: EmployeeRow): Promise<string | null> {
    const existing = employee.metadata?.lark_record_id as string | undefined;
    if (existing) return existing;

    const fresh = await employeeRepository.getById(employee.id);
    const freshRecordId = fresh?.metadata?.lark_record_id as string | undefined;
    if (freshRecordId) return freshRecordId;

    const recordId = await larkBaseService.createEmployeeRecord(employee);
    if (recordId) {
      await this.saveLarkRecordId(employee.id, recordId);
    }
    return recordId;
  }

  private async saveLarkRecordId(employeeId: string, larkRecordId: string): Promise<void> {
    const employee = await employeeRepository.getById(employeeId);
    if (!employee) return;
    const metadata = { ...employee.metadata, lark_record_id: larkRecordId };
    await supabase
      .from("employees")
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq("id", employeeId);
  }
}

export const larkSyncService = new LarkSyncService();
