import type { Metadata } from "next";

import { StaffConsole } from "./StaffConsole";

export const metadata: Metadata = { title: "门店会员权益台" };

export default function StaffPage() {
  return <StaffConsole />;
}
