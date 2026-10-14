import { Suspense } from "react";

import { AuthPanel } from "@/components/auth-panel";

export default function LoginPage() {
  return <Suspense><AuthPanel mode="login" /></Suspense>;
}
