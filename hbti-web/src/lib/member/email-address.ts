export const MAX_MEMBER_EMAIL_LENGTH = 254;

// 这里采用产品输入校验，不试图实现完整 RFC 5322。邮箱还会由 input[type=email]
// 做浏览器侧格式提示；服务端复用同一判词，避免只靠前端 required 被绕过。
const MEMBER_EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function normalizeMemberEmail(value: string): string {
  return value.trim();
}

export function isValidMemberEmail(value: string): boolean {
  const normalized = normalizeMemberEmail(value);
  return (
    normalized.length >= 3 &&
    normalized.length <= MAX_MEMBER_EMAIL_LENGTH &&
    MEMBER_EMAIL_PATTERN.test(normalized)
  );
}
