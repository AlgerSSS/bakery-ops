import type { Metadata } from "next";

import { HbtiExperience } from "@/components/HbtiExperience";

export const metadata: Metadata = {
  title: "Your HBTI",
};

export default async function HbtiTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <HbtiExperience token={token} />;
}
