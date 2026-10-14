import type { Metadata } from "next";

import { CreatorsScreen } from "@/components/b4/screens/creators";

export const metadata: Metadata = { title: "For creators — wishtrip" };

export default function Page() {
  return <CreatorsScreen />;
}
