import { redirect } from "next/navigation";

/** The tree view became Destinations (country → city → History · Hotels · Experiences · Food). */
export default function HierarchyPage() {
  redirect("/destinations");
}
