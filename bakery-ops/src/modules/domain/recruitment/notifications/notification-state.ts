import * as fs from "fs";
import * as path from "path";
import type { NotificationState } from "./notification.types";
import { logger } from "../../../shared/logger";

const STATE_FILE = path.resolve(process.cwd(), "notification-state.json");

const DEFAULT_STATE: NotificationState = {
  lastCheckedAt: new Date().toISOString(),
};

export function loadNotificationState(): NotificationState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (err) {
    logger.warn("Failed to load notification state, using default", { error: String(err) });
  }
  return { ...DEFAULT_STATE };
}

export function saveNotificationState(state: NotificationState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.error("Failed to save notification state", { error: String(err) });
  }
}
