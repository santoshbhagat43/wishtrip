import { Suspense } from "react";

import { B4Auth } from "@/components/b4/screens/auth";

export default function LoginPage() {
  return (
    <Suspense>
      <B4Auth mode="login" />
    </Suspense>
  );
}
