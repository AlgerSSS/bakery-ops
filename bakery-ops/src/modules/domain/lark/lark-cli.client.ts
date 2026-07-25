import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "../../shared/logger";

const execFileAsync = promisify(execFile);

const LARK_CLI_PATH = process.env.LARK_CLI_PATH || "npx";
const LARK_CLI_ARGS = ["@larksuite/cli@latest"];
const LARK_BASE_APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const LARK_BASE_TABLE_ID = process.env.LARK_BASE_TABLE_ID || "";
const EXEC_TIMEOUT = 20000;

export class LarkCliClient {
  private cliPath: string;
  private appToken: string;
  private tableId: string;

  constructor(opts?: { cliPath?: string; appToken?: string; tableId?: string }) {
    this.cliPath = opts?.cliPath || LARK_CLI_PATH;
    this.appToken = opts?.appToken || LARK_BASE_APP_TOKEN;
    this.tableId = opts?.tableId || LARK_BASE_TABLE_ID;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.exec(["--version"]);
      return result !== null;
    } catch {
      return false;
    }
  }

  async createRecord(fields: Record<string, unknown>): Promise<string | null> {
    const fieldNames = Object.keys(fields);
    const row = fieldNames.map((k) => fields[k] ?? null);
    const json = JSON.stringify({ fields: fieldNames, rows: [row] });

    const result = await this.exec([
      "base", "+record-batch-create",
      "--base-token", this.appToken,
      "--table-id", this.tableId,
      "--json", json,
    ]);
    if (!result) return null;

    try {
      const data = JSON.parse(result.stdout);
      if (!data?.ok) {
        logger.warn("Lark Base create failed", { error: data?.error?.message, hint: data?.error?.hint });
        return null;
      }
      const recordId = data?.data?.record_id_list?.[0];
      if (recordId) {
        logger.info("Lark Base record created", { recordId });
        return recordId;
      }
      logger.warn("Lark Base create: no record_id in response", { stdout: result.stdout.slice(0, 200) });
      return null;
    } catch (err) {
      logger.warn("Lark Base create: failed to parse response", { error: String(err) });
      return null;
    }
  }

  /**
   * Query records by exact field match. Uses `+record-list --filter-json` — the CLI's documented
   * filter shape `{logic, conditions:[[field, op, value]]}` — with `--format json` (default output
   * is markdown). Returns the reshaped record list.
   */
  async queryByField(
    baseToken: string,
    tableId: string,
    filters: Record<string, string>,
  ): Promise<Array<{ record_id: string; fields: Record<string, unknown> }>> {
    const conditions = Object.entries(filters).map(([field, value]) => [field, "==", value]);
    const filterJson = JSON.stringify({ logic: "and", conditions });

    const result = await this.exec([
      "base", "+record-list",
      "--base-token", baseToken,
      "--table-id", tableId,
      "--filter-json", filterJson,
      "--format", "json",
      "--limit", "200",
    ]);
    if (!result) return [];
    return this.parseRecordEnvelope(result.stdout, "search");
  }

  /** List up to 200 records in a table. Pass `--format json` (default CLI output is markdown). */
  async listRecords(
    baseToken: string,
    tableId: string,
  ): Promise<Array<{ record_id: string; fields: Record<string, unknown> }>> {
    const result = await this.exec([
      "base", "+record-list",
      "--base-token", baseToken,
      "--table-id", tableId,
      "--format", "json",
      "--limit", "200",
    ]);
    if (!result) return [];
    return this.parseRecordEnvelope(result.stdout, "list");
  }

  /** Get a single record by id via `+record-get` (preferred when the record_id is known). */
  async getRecord(
    baseToken: string,
    tableId: string,
    recordId: string,
  ): Promise<{ record_id: string; fields: Record<string, unknown> } | null> {
    const result = await this.exec([
      "base", "+record-get",
      "--base-token", baseToken,
      "--table-id", tableId,
      "--record-id", recordId,
      "--format", "json",
    ]);
    if (!result) return null;
    const records = this.parseRecordEnvelope(result.stdout, "get");
    return records[0] ?? null;
  }

  /**
   * Parse the Lark CLI read envelope. The CLI returns a COLUMN-ARRAY shape:
   *   { ok, data: { data: [[v0..vN]], fields: [name0..nameN], record_id_list: [id0..] } }
   * which we reshape into [{ record_id, fields: { name: value } }]. Falls back to the older
   * `{ data: { items: [{record_id, fields}] } }` shape if a future CLI returns it.
   */
  private parseRecordEnvelope(
    stdout: string,
    op: string,
  ): Array<{ record_id: string; fields: Record<string, unknown> }> {
    try {
      const parsed = JSON.parse(stdout);
      if (!parsed?.ok) {
        logger.warn(`Lark Base ${op} failed`, { error: parsed?.error?.message });
        return [];
      }
      const d = parsed?.data;
      if (!d) return [];

      const rows: unknown[] = Array.isArray(d.data) ? d.data : [];
      const names: string[] = Array.isArray(d.fields) ? d.fields : [];
      const ids: string[] = Array.isArray(d.record_id_list) ? d.record_id_list : [];
      if (rows.length > 0 && names.length > 0) {
        return rows.map((row, i) => {
          const values = Array.isArray(row) ? row : [];
          const fields: Record<string, unknown> = {};
          names.forEach((name, j) => {
            fields[name] = values[j];
          });
          return { record_id: ids[i] ?? "", fields };
        });
      }

      const items = d.items;
      return Array.isArray(items) ? items : [];
    } catch (err) {
      logger.warn(`Lark Base ${op}: failed to parse response`, { error: String(err) });
      return [];
    }
  }

  async searchUser(query: string): Promise<{ openId: string; name: string; department?: string } | null> {
    const result = await this.exec([
      "contact", "+search-user",
      "--query", query,
    ]);
    if (!result) return null;

    try {
      const data = JSON.parse(result.stdout);
      if (!data?.ok) return null;
      const user = data?.data?.users?.[0];
      if (!user) return null;
      return {
        openId: user.open_id,
        name: user.localized_name || user.name,
        department: user.department,
      };
    } catch {
      return null;
    }
  }

  async updateRecord(recordId: string, fields: Record<string, unknown>): Promise<boolean> {
    const json = JSON.stringify({ record_id_list: [recordId], patch: fields });

    const result = await this.exec([
      "base", "+record-batch-update",
      "--base-token", this.appToken,
      "--table-id", this.tableId,
      "--json", json,
    ]);
    if (!result) return false;

    try {
      const data = JSON.parse(result.stdout);
      if (!data?.ok) {
        logger.warn("Lark Base update failed", { error: data?.error?.message, recordId });
        return false;
      }
      logger.info("Lark Base record updated", { recordId });
      return true;
    } catch {
      return false;
    }
  }

  private async exec(args: string[], retries = 1): Promise<{ stdout: string; stderr: string } | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const fullArgs = [...LARK_CLI_ARGS, ...args];
        const result = await execFileAsync(this.cliPath, fullArgs, { timeout: EXEC_TIMEOUT });

        // 检查是否被限流，如果是则等待后重试
        if (result.stdout.includes("800004135") && attempt < retries) {
          logger.warn("Lark API rate limited, retrying in 3s...", { attempt });
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        return result;
      } catch (err) {
        const errStr = String(err);
        if (errStr.includes("800004135") && attempt < retries) {
          logger.warn("Lark API rate limited, retrying in 3s...", { attempt });
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        logger.warn("lark-cli exec failed (non-blocking)", { args: args.slice(0, 3), error: errStr });
        return null;
      }
    }
    return null;
  }
}

export const larkCliClient = new LarkCliClient();
