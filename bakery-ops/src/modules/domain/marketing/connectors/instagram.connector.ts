/**
 * Instagram Connector — Phase 1 stub
 * 骨架已建好，Phase 2 实现搜索 + DM
 */
import type { SocialPlatformConnector } from "./social-platform.interface";
import type { KOLRaw, KOLSearchParams } from "../types";
import { hasValidSession, refreshLogin } from "./instagram-login";
import { logger } from "../../../shared/logger";

export class InstagramConnector implements SocialPlatformConnector {
  readonly platformName = "instagram";

  async searchKOLs(_params: KOLSearchParams): Promise<KOLRaw[]> {
    logger.warn("Instagram: searchKOLs is stub-only in Phase 1");
    return [];
  }

  async sendDM(_kol: KOLRaw, _message: string): Promise<{ success: boolean; error?: string }> {
    logger.warn("Instagram: sendDM is stub-only in Phase 1");
    return { success: false, error: "Instagram DM not yet supported (Phase 2)" };
  }

  async getProfile(_handleOrUrl: string): Promise<KOLRaw | null> {
    logger.warn("Instagram: getProfile is stub-only in Phase 1");
    return null;
  }

  hasValidSession(): boolean {
    return hasValidSession();
  }

  async refreshLogin(): Promise<boolean> {
    return refreshLogin();
  }
}

export const instagramConnector = new InstagramConnector();
