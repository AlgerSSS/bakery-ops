import type { Metadata, Viewport } from "next";

import { parseBirthdayDeliveryMode } from "@/lib/birthday/delivery-mode";

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
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const deliveryMode = parseBirthdayDeliveryMode(query.mode);
  return (
    <BirthdayExperience linkToken={token} deliveryMode={deliveryMode} />
  );
}
