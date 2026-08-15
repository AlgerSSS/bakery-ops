import type { Metadata, Viewport } from "next";

import { BirthdayExperience } from "../../BirthdayExperience";

export const metadata: Metadata = {
  title: "生日快乐",
};

export const viewport: Viewport = {
  themeColor: "#f2e6d6",
};

/** 专属签名链接入口：/birthday/t/<token>（birthday 域名上由中间件重写到这里）。 */
export default async function BirthdayTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <BirthdayExperience linkToken={token} />;
}
