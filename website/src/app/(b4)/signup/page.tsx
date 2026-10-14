import { Suspense } from "react";

import { B4Auth } from "@/components/b4/screens/auth";

export default function SignupPage() {
  return (
    <Suspense>
      <B4Auth mode="signup" />
    </Suspense>
  );
}
