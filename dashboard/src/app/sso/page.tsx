import { redirect } from "next/navigation";

export default function SsoIndex() {
  redirect("/sso/login");
}
