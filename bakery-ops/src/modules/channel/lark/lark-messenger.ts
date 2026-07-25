// Lark 消息发送（内部通知通道）。
// 凭据走 LARK_APP_ID/LARK_APP_SECRET（tenant_access_token，缓存续期）；
// 收件人按手机号解析 open_id（LARK_USER_MAP 手动映射优先，其次 contact API 动态解析并缓存）。
// 所有失败路径只返回 false + 日志，不抛出——上层 internal-notify 负责回落 WhatsApp。
import { logger } from "../../shared/logger";
import { buildLarkMessagePayload } from "./lark-card";

const LARK_BASE = "https://open.larksuite.com";
const TIMEOUT_MS = 15_000;

let cachedToken: { token: string; expiresAt: number } | null = null;
const openIdCache = new Map<string, string>();

function normalizePhone(raw: string): string {
  // 兼容 "60175439502@c.us" 预格式化 chat id 与裸号码
  return raw.replace(/@.*$/, "").replace(/[^\d]/g, "");
}

function envUserMap(): Record<string, string> {
  try {
    const map = JSON.parse(process.env.LARK_USER_MAP || "{}") as Record<string, string>;
    return map;
  } catch {
    logger.warn("LARK_USER_MAP is not valid JSON, ignoring");
    return {};
  }
}

async function larkFetch(path: string, body: unknown, token?: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${LARK_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    logger.warn("Lark API request failed", { path, error: String(err) });
    return null;
  }
}

async function getTenantToken(): Promise<string | null> {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) return null;
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const data = await larkFetch("/open-apis/auth/v3/tenant_access_token/internal", {
    app_id: appId,
    app_secret: appSecret,
  });
  if (!data || data.code !== 0 || typeof data.tenant_access_token !== "string") {
    logger.warn("Lark tenant token fetch failed", { code: data?.code, msg: data?.msg });
    return null;
  }
  const expireSec = typeof data.expire === "number" ? data.expire : 3600;
  cachedToken = { token: data.tenant_access_token, expiresAt: Date.now() + (expireSec - 300) * 1000 };
  return cachedToken.token;
}

export async function resolveLarkOpenId(phone: string): Promise<string | null> {
  const digits = normalizePhone(phone);
  if (!digits) return null;

  const mapped = envUserMap()[digits];
  if (mapped) return mapped;
  const cached = openIdCache.get(digits);
  if (cached) return cached;

  const token = await getTenantToken();
  if (!token) return null;
  const data = await larkFetch(
    "/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id",
    { mobiles: [`+${digits}`] },
    token,
  );
  const list = (data?.data as { user_list?: Array<{ mobile: string; user_id?: string }> } | undefined)?.user_list;
  const openId = list?.find((u) => u.user_id)?.user_id;
  if (!openId) {
    logger.info("Lark open_id not found for phone (will fall back to WhatsApp)", { phone: digits });
    return null;
  }
  openIdCache.set(digits, openId);
  return openId;
}

// 按 chat_id 发送（inbound 回复用；p2p 与群聊通用）
export async function sendLarkTextToChat(chatId: string, text: string): Promise<boolean> {
  const token = await getTenantToken();
  if (!token) return false;
  const { msg_type, content } = buildLarkMessagePayload(text); // Markdown → 卡片富格式
  const data = await larkFetch(
    "/open-apis/im/v1/messages?receive_id_type=chat_id",
    { receive_id: chatId, msg_type, content },
    token,
  );
  if (!data || data.code !== 0) {
    logger.warn("Lark chat message send failed", { chatId, code: data?.code, msg: data?.msg });
    return false;
  }
  return true;
}

// 发送文件到 chat（先上传拿 file_key，再发 file 消息）。实测：上传+发送均 code 0。
/** 按 open_id 直发给组织成员（p2p）。Markdown → 卡片富格式。失败只 false + 日志。 */
export async function sendLarkToUser(openId: string, text: string): Promise<boolean> {
  const token = await getTenantToken();
  if (!token) return false;
  const { msg_type, content } = buildLarkMessagePayload(text);
  const data = await larkFetch(
    "/open-apis/im/v1/messages?receive_id_type=open_id",
    { receive_id: openId, msg_type, content },
    token,
  );
  if (!data || data.code !== 0) {
    logger.warn("Lark user message send failed", { openId, code: data?.code, msg: data?.msg });
    return false;
  }
  return true;
}

// larkFetch 不适用（文件上传是 multipart，不是 JSON），单独用 fetch。
export async function sendLarkFileToChat(
  chatId: string,
  buffer: Buffer,
  fileName: string,
): Promise<boolean> {
  const token = await getTenantToken();
  if (!token) return false;

  // 文件类型：Lark 只接受特定枚举，未知类型统一按 stream 传
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const fileType = ["opus", "mp4", "pdf", "doc", "xls", "ppt"].includes(ext) ? ext : "stream";

  let fileKey: string;
  try {
    const fd = new FormData();
    fd.append("file_type", fileType);
    fd.append("file_name", fileName);
    fd.append("file", new Blob([new Uint8Array(buffer)]), fileName);
    const upRes = await fetch(`${LARK_BASE}/open-apis/im/v1/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const up = (await upRes.json()) as { code?: number; msg?: string; data?: { file_key?: string } };
    if (up.code !== 0 || !up.data?.file_key) {
      logger.warn("Lark file upload failed", { fileName, code: up.code, msg: up.msg });
      return false;
    }
    fileKey = up.data.file_key;
  } catch (err) {
    logger.warn("Lark file upload request failed", { fileName, error: String(err) });
    return false;
  }

  const data = await larkFetch(
    "/open-apis/im/v1/messages?receive_id_type=chat_id",
    { receive_id: chatId, msg_type: "file", content: JSON.stringify({ file_key: fileKey }) },
    token,
  );
  if (!data || data.code !== 0) {
    logger.warn("Lark file message send failed", { chatId, code: data?.code, msg: data?.msg });
    return false;
  }
  return true;
}

// ── 组织架构（部门权限用）──
// 部门 id→名 与 用户→部门 都带 TTL 缓存，避免每条消息打 Lark API。
const DEPT_CACHE_TTL = 60 * 60 * 1000; // 1 小时
let deptMapCache: { map: Map<string, string>; at: number } | null = null;
const userDeptCache = new Map<string, { names: string[]; at: number }>();

async function getDepartmentMap(): Promise<Map<string, string>> {
  if (deptMapCache && Date.now() - deptMapCache.at < DEPT_CACHE_TTL) return deptMapCache.map;
  const token = await getTenantToken();
  const map = new Map<string, string>();
  if (!token) return deptMapCache?.map ?? map;
  try {
    const res = await fetch(
      `${LARK_BASE}/open-apis/contact/v3/departments?parent_department_id=0&fetch_child=true&page_size=50`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const data = (await res.json()) as { code?: number; data?: { items?: Array<{ open_department_id?: string; name?: string }> } };
    for (const d of data.data?.items || []) {
      if (d.open_department_id && d.name) map.set(d.open_department_id, d.name);
    }
    if (map.size > 0) deptMapCache = { map, at: Date.now() };
    return map.size > 0 ? map : (deptMapCache?.map ?? map);
  } catch (err) {
    logger.warn("Lark department list fetch failed", { error: String(err) });
    return deptMapCache?.map ?? map;
  }
}

export interface OrgMember { openId: string; name: string; deptNames: string[]; }

/** 遍历 Lark 组织架构返回全部成员（含部门名）。供 syncLarkOrg 用（不缓存，同步频率低）。 */
export async function getOrgMembersFull(): Promise<OrgMember[]> {
  const token = await getTenantToken();
  if (!token) return [];
  const deptMap = await getDepartmentMap();
  const deptIds = new Set<string>(["0", ...deptMap.keys()]);
  const byId = new Map<string, OrgMember>();
  try {
    for (const d of deptIds) {
      let pageToken = "";
      do {
        const url = `${LARK_BASE}/open-apis/contact/v3/users?department_id=${encodeURIComponent(d)}&user_id_type=open_id&page_size=50${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const data = (await res.json()) as { data?: { items?: Array<{ open_id?: string; name?: string; department_ids?: string[] }>; has_more?: boolean; page_token?: string } };
        for (const u of data.data?.items || []) {
          if (!u.open_id || !u.name || byId.has(u.open_id)) continue;
          byId.set(u.open_id, { openId: u.open_id, name: u.name.trim(), deptNames: (u.department_ids || []).map((id) => deptMap.get(id) || "").filter(Boolean) });
        }
        pageToken = data.data?.has_more ? (data.data.page_token || "") : "";
      } while (pageToken);
    }
  } catch (err) {
    logger.warn("Lark org member list fetch failed", { error: String(err) });
    return [];
  }
  return [...byId.values()];
}

let orgMemberCache: { map: Map<string, string>; at: number } | null = null; // 小写显示名 → open_id

/** 显示名(小写) → open_id，缓存 1 小时。用于按名字一次性发送（team_member 表才是权限/推送真源）。 */
export async function getOrgMemberMap(): Promise<Map<string, string>> {
  if (orgMemberCache && Date.now() - orgMemberCache.at < DEPT_CACHE_TTL) return orgMemberCache.map;
  const members = await getOrgMembersFull();
  const map = new Map<string, string>(members.map((m) => [m.name.toLowerCase(), m.openId]));
  if (map.size > 0) orgMemberCache = { map, at: Date.now() };
  return map.size > 0 ? map : (orgMemberCache?.map ?? map);
}

/** 一批显示名 → open_id（按 Lark 显示名精确匹配，大小写不敏感）。查不到的名字进 misses。 */
export async function resolveOpenIdsByNames(names: string[]): Promise<{ resolved: Map<string, string>; misses: string[] }> {
  const org = await getOrgMemberMap();
  const resolved = new Map<string, string>();
  const misses: string[] = [];
  for (const n of names) {
    const oid = org.get(n.trim().toLowerCase());
    if (oid) resolved.set(n, oid);
    else misses.push(n);
  }
  return { resolved, misses };
}

/** open_id → 该用户所属的 Lark 部门名列表。解析不到返回 []（上层 fail-open）。 */
export async function resolveUserDepartments(openId: string): Promise<string[]> {
  const cached = userDeptCache.get(openId);
  if (cached && Date.now() - cached.at < DEPT_CACHE_TTL) return cached.names;
  const token = await getTenantToken();
  if (!token) return cached?.names ?? [];
  try {
    const res = await fetch(
      `${LARK_BASE}/open-apis/contact/v3/users/${openId}?user_id_type=open_id`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const data = (await res.json()) as { code?: number; data?: { user?: { department_ids?: string[] } } };
    const ids = data.data?.user?.department_ids || [];
    if (data.code !== 0) return cached?.names ?? [];
    const deptMap = await getDepartmentMap();
    const names = ids.map((id) => deptMap.get(id) || id);
    userDeptCache.set(openId, { names, at: Date.now() });
    return names;
  } catch (err) {
    logger.warn("Lark resolveUserDepartments failed", { openId, error: String(err) });
    return cached?.names ?? [];
  }
}

// open_id -> 手机号反查（inbound 身份识别用）：先查 LARK_USER_MAP 与解析缓存，
// 都没有再调 contact API 取用户 mobile 并回填缓存。失败返回 null。
export async function reverseLookupPhone(openId: string): Promise<string | null> {
  for (const [digits, id] of Object.entries(envUserMap())) {
    if (id === openId) return digits;
  }
  for (const [digits, id] of openIdCache.entries()) {
    if (id === openId) return digits;
  }
  const token = await getTenantToken();
  if (!token) return null;
  try {
    const res = await fetch(
      `${LARK_BASE}/open-apis/contact/v3/users/${openId}?user_id_type=open_id`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const data = (await res.json()) as { code?: number; data?: { user?: { mobile?: string } } };
    const mobile = data.code === 0 ? data.data?.user?.mobile : undefined;
    if (!mobile) return null;
    const digits = mobile.replace(/[^\d]/g, "");
    openIdCache.set(digits, openId);
    return digits;
  } catch (err) {
    logger.warn("Lark reverse lookup failed", { openId, error: String(err) });
    return null;
  }
}

export async function sendLarkText(phone: string, text: string): Promise<boolean> {
  const openId = await resolveLarkOpenId(phone);
  if (!openId) return false;
  const token = await getTenantToken();
  if (!token) return false;

  const { msg_type, content } = buildLarkMessagePayload(text); // Markdown → 卡片富格式
  const data = await larkFetch(
    "/open-apis/im/v1/messages?receive_id_type=open_id",
    { receive_id: openId, msg_type, content },
    token,
  );
  if (!data || data.code !== 0) {
    logger.warn("Lark message send failed", { phone: normalizePhone(phone), code: data?.code, msg: data?.msg });
    return false;
  }
  return true;
}
