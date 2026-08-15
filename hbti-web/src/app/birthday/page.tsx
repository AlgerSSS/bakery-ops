import type { Metadata, Viewport } from "next";

import { BirthdayExperience } from "./BirthdayExperience";

export const metadata: Metadata = {
  title: "生日快乐",
};

export const viewport: Viewport = {
  themeColor: "#f2e6d6",
};

/**
 * 生日卡落地页。不带 token 时由客户端组件展示「打开你的专属链接或
 * 短信验证进入」；带 ?t=<token> 时把 token 交给客户端组件去取数。
 */
export default async function BirthdayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.t;
  const token = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  return <BirthdayExperience linkToken={token} />;
}
