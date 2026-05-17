// ============================================================
// 市场营销 KOL 管理 — 类型定义
// ============================================================

/** 平台爬虫返回的原始 KOL 数据 */
export interface KOLRaw {
  platform: "tiktok" | "instagram";
  platformId: string; // 平台内部 ID
  handle: string; // @username
  name: string;
  bio: string;
  followerCount: number;
  engagementRate?: number;
  avgViews?: number;
  avgLikes?: number;
  niche: string[];
  location?: string;
  verified: boolean;
  avatarUrl?: string;
  profileUrl: string;
  contactInfo?: { email?: string; phone?: string; whatsapp?: string };
}

/** KOL 搜索参数 */
export interface KOLSearchParams {
  keywords: string[];
  niche?: string;
  minFollowers?: number;
  maxFollowers?: number;
  minEngagementRate?: number;
  location?: string;
  platform?: "tiktok" | "instagram" | "all";
  maxResults?: number;
}

/** 数据库 KOL 行 */
export interface KOLRow {
  id: string;
  name: string;
  platform: string;
  platform_handle: string;
  platform_id: string;
  follower_count: number;
  engagement_rate?: number;
  avg_views?: number;
  avg_likes?: number;
  niche: string[];
  location?: string;
  bio?: string;
  verified: boolean;
  avatar_url?: string;
  contact_info: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** 合作记录行 */
export interface KOLCollaborationRow {
  id: string;
  kol_id: string;
  campaign_id?: string;
  status: "prospected" | "contacted" | "negotiating" | "confirmed" | "completed" | "declined";
  dm_sent: boolean;
  dm_sent_at?: string;
  dm_template_used?: string;
  dm_response?: string;
  dm_responded_at?: string;
  negotiation_notes?: string;
  deal_amount?: number;
  deal_terms?: string;
  deliverables: string[];
  scheduled_at?: string;
  completed_at?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** 聊天样本行 */
export interface ChatSampleRow {
  id: string;
  kol_id?: string;
  platform: string;
  message_content: string;
  message_type: "dm_sent" | "dm_received" | "comment" | "post";
  chat_context: Record<string, unknown>;
  captured_at: string;
  created_at: string;
}

/** 营销活动行 */
export interface CampaignRow {
  id: string;
  name: string;
  description?: string;
  goals?: string;
  budget?: number;
  kol_ids: string[];
  status: "draft" | "active" | "paused" | "completed";
  start_date?: string;
  end_date?: string;
  metrics: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** KOL 搜索结果 */
export interface KOLDiscoveryResult {
  kol: KOLRow;
  source: string;
  matchScore: number;
  matchReason: string;
}

/** 触达结果 */
export interface KOLOutreachResult {
  kolName: string;
  platform: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  collaborationId?: string;
}

/** DM 消息模板 */
export interface DMTemplate {
  subject?: string;
  body: string; // 支持 {name}, {platform}, {handle} 占位符
}
