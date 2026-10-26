import type { Metadata } from "next";

import { MineScreen } from "@/components/b4/screens/mine";

export const metadata: Metadata = { title: "Your trip — wishtrip" };

export default function Page() {
  return <MineScreen />;
}
