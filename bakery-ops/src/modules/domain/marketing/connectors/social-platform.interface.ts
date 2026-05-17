import type { KOLRaw, KOLSearchParams } from "../types";

export interface SocialPlatformConnector {
  readonly platformName: string;

  /** 搜索 KOL */
  searchKOLs(params: KOLSearchParams): Promise<KOLRaw[]>;

  /** 发送 DM */
  sendDM(kol: KOLRaw, message: string): Promise<{ success: boolean; error?: string }>;

  /** 获取单个 KOL 详情 */
  getProfile(handleOrUrl: string): Promise<KOLRaw | null>;

  /** 是否已登录 */
  hasValidSession(): boolean;

  /** 刷新登录 session */
  refreshLogin(): Promise<boolean>;
}
