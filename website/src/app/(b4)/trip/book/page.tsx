import type { Metadata } from "next";

import { CheckoutScreen } from "@/components/b4/screens/checkout";

export const metadata: Metadata = { title: "Book it in one go — wishtrip" };

export default function Page() {
  return <CheckoutScreen />;
}
