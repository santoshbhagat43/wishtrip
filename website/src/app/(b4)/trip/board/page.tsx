import type { Metadata } from "next";

import { BoardScreen } from "@/components/b4/screens/board";

export const metadata: Metadata = { title: "Your trip board — wishtrip" };

export default function Page() {
  return <BoardScreen />;
}
