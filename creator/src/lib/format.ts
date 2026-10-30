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

const ENERGY = ["", "very relaxed", "relaxed", "moderate", "active", "very active"];
const TRIP_FIELDS: Record<string, string> = {
  destination: "Destination",
  duration_days: "Trip length",
  start_date: "Starts",
  companions: "Travelling with",
  interests: "Interests",
  energy_level: "Pace",
  budget_level: "Budget",
  preferred_times: "Best times of day",
};

/** The chat's trip state as readable rows, in a sensible order, empty values left out. */
export function tripStateRows(state: Record<string, unknown>): { label: string; value: string }[] {
  const order = Object.keys(TRIP_FIELDS);
  return Object.entries(state)
    .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([key, v]) => {
      let value: string;
      if (Array.isArray(v)) value = v.map((x) => titleCase(String(x))).join(", ");
      else if (key === "energy_level" && typeof v === "number") value = `${titleCase(ENERGY[v] ?? "")} (${v}/5)`;
      else if (key === "budget_level" && typeof v === "number") value = COST_LABELS[v] ?? String(v);
      else if (key === "duration_days" && typeof v === "number") value = `${v} day${v === 1 ? "" : "s"}`;
      else if (key === "start_date" && typeof v === "string")
        value = new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      else value = titleCase(String(v));
      return { label: TRIP_FIELDS[key] ?? titleCase(key), value };
    });
}
