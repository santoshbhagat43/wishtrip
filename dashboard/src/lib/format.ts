export const LOCATION_TYPES = [
  "country", "city", "attraction", "hotel", "restaurant", "activity", "experience", "route",
] as const;
export const PLACE_TYPES = LOCATION_TYPES.filter((t) => t !== "country" && t !== "city");
export const STATUSES = ["draft", "published", "archived"] as const;
export const TIMES = ["morning", "afternoon", "evening", "night"] as const;
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export const RELATIONS = ["near", "route_to", "pairs_with", "similar_to", "alternative_to"] as const;
export const COST_LABELS = ["Free", "Budget", "Moderate", "Expensive", "Luxury"];

export function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function minutes(value: number | null | undefined) {
  if (value == null) return "—";
  if (value < 60) return `${value} min`;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
