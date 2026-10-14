import type { Metadata } from "next";

import { Board2Screen } from "@/components/b4/screens/board2";

export const metadata: Metadata = { title: "Trip board (timeline) — wishtrip" };

export default function Page() {
  return <Board2Screen />;
}
