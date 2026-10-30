/**
 * The choices on the "Paste a reel → book" screens: who's coming, how many, the pace, and the
 * colour of each kind of place. No prices or sample trips: those come from TripJack and the reel.
 */

export type Kind = "Place" | "Stay" | "Food";
export const KIND_COLORS: Record<Kind, [string, string]> = {
  Place: ["#0B3050", "#DCF8F9"],
  Stay: ["#7A4E9A", "#F2EEFB"],
  Food: ["#C43B58", "#FCE9ED"],
};

// ---- Your details ------------------------------------------------------------------------------

export const GROUPS = [
  { id: "solo", label: "Solo", hint: "Just me", col: "#0A7C80", tint: "#DCF8F9", c: [1, 0, 0], icon: "M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20a7 7 0 0 1 14 0" },
  { id: "couple", label: "Couple", hint: "The two of us", col: "#C43B58", tint: "#FCE9ED", c: [2, 0, 0], icon: "M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 10a3 3 0 1 0 0-6M15.5 14.2A6 6 0 0 1 21 20" },
  { id: "family", label: "Family", hint: "With kids or parents", col: "#B86E00", tint: "#FBF1DC", c: [2, 0, 1], icon: "M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 20a5 5 0 0 1 8-4M22 20a5 5 0 0 0-8-4M8.5 21a3.5 3.5 0 0 1 7 0" },
  { id: "friends", label: "Friends", hint: "A group trip", col: "#7A4E9A", tint: "#F2EEFB", c: [4, 0, 0], icon: "M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 11a2.5 2.5 0 1 0 0-5M19 11a2.5 2.5 0 1 0 0-5M6 21a6 6 0 0 1 12 0M1 18a4.5 4.5 0 0 1 4.5-4M23 18a4.5 4.5 0 0 0-4.5-4" },
  { id: "seniors", label: "Seniors", hint: "Parents travelling", col: "#0B7A57", tint: "#E3F5EE", c: [0, 0, 2], icon: "M10 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 10v6l-3 6M10 16l3 6M10 11l-3 3M10 11h4M17 13v9M17 13a2 2 0 0 0-3-1.7" },
] as const;

export const PEOPLE = [
  { key: "adults", label: "Adults", hint: "18–59" },
  { key: "kids", label: "Children", hint: "Under 18" },
  { key: "seniors", label: "Seniors", hint: "60+" },
] as const;

export const PACES = [
  { id: "relaxed", label: "Relaxed", hint: "1–2 things a day" },
  { id: "balanced", label: "Balanced", hint: "2–3 things a day" },
  { id: "packed", label: "Packed", hint: "See it all" },
] as const;

/** The whole trip's budget, as the traveller chooses it (optional). The ids are the API's. */
export const BUDGETS = [
  { id: "under_40k", label: "Under ₹40k" },
  { id: "40k_60k", label: "₹40k–60k" },
  { id: "60k_80k", label: "₹60k–80k" },
  { id: "no_limit", label: "No fixed limit" },
] as const;
