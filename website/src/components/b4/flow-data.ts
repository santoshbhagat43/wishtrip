/**
 * Content for the "Paste a reel → book" flow, as designed in the Option B4 prototype.
 * Static sample content (Asha's Goa trip); not wired to the API yet.
 */

const A = (file: string) => `/b4/${file}`;

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// ---- 1 · Reel → your trip board --------------------------------------------------------------

export const REEL = {
  img: A("goa-hero-beach-9x16.webp"),
  handle: "@goadiaries · 0:42",
  url: "instagram.com/reel/C9xGoaSlow…",
};

export const REEL_PROGRESS = ["Watched the reel", "Found 6 things", "Matched to bookable options"];

export type Kind = "Place" | "Stay" | "Food";
export const KIND_COLORS: Record<Kind, [string, string]> = {
  Place: ["#0B3050", "#DCF8F9"],
  Stay: ["#7A4E9A", "#F2EEFB"],
  Food: ["#C43B58", "#FCE9ED"],
};

export const REEL_PLACES: { id: string; name: string; meta: string; t: string; kind: Kind; img: string }[] = [
  { id: "aguada", name: "Fort Aguada", meta: "Candolim · 17th-century fort, best at 5 pm", t: "0:04", kind: "Place", img: A("goa-aguada-fort-9x16.webp") },
  { id: "font", name: "Fontainhas, Panaji", meta: "Latin quarter walk · 1.5 km, flat", t: "0:11", kind: "Place", img: A("goa-day3-panaji-street.webp") },
  { id: "thali", name: "Fish thali at a beach shack", meta: "Anjuna · matched to 3 bookable shacks", t: "0:19", kind: "Food", img: A("goa-food-fish-thali.webp") },
  { id: "stay", name: "Heritage villa stay", meta: "Assagao · matched to a similar bookable villa", t: "0:23", kind: "Stay", img: A("goa-goan-heritage-house.webp") },
  { id: "morjim", name: "Morjim beach", meta: "Quiet north beach · sunrise walk", t: "0:27", kind: "Place", img: A("goa-day5-morjim-shore.webp") },
  { id: "curry", name: "Fish curry rice lunch", meta: "Home kitchen in Siolim", t: "0:35", kind: "Food", img: A("goa-day2-fish-curry-rice.webp") },
];

export const REEL_MATCHES = [
  { title: "Slow North Goa: shacks, forts & fish thalis", handle: "@ananyawanders", price: "₹39,900", match: "Covers 5 of your 6", img: A("goa-hero-beach-9x16.webp") },
  { title: "Goa food trail: 12 kitchens in 4 days", handle: "@kabireatsgoa", price: "₹34,600", match: "Covers 3 of your 6", img: A("goa-food-fish-thali.webp") },
];

// ---- 2 · Your details --------------------------------------------------------------------------

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

/** Per-person estimate the prototype uses: adult, child, senior. */
export const PER_PERSON = { adults: 19950, kids: 12400, seniors: 6300 };

export const PACES = [
  { id: "relaxed", label: "Relaxed", hint: "1–2 things a day" },
  { id: "balanced", label: "Balanced", hint: "2–3 things a day" },
  { id: "packed", label: "Packed", hint: "See it all" },
] as const;

export const BUDGETS = [
  { id: "b1", label: "Under ₹40k" },
  { id: "b2", label: "₹40k–60k" },
  { id: "b3", label: "₹60k–80k" },
  { id: "b4", label: "No fixed limit" },
] as const;

export const STARTING_POINT = {
  img: A("goa-hero-beach-9x16.webp"),
  title: "6 places from @goadiaries’ reel",
  list: "Fort Aguada · Fontainhas · fish thali · heritage villa · Morjim · Siolim",
};

// ---- 3 · The trip board ------------------------------------------------------------------------

export const STAYS = [
  { id: "villa", name: "Assagao heritage villa", meta: "2 ground-floor rooms · 4 nights", img: A("goa-goan-heritage-house.webp"), amt: 14400 },
  { id: "siolim", name: "Siolim boutique stay", meta: "Ground floor · rated 4.6 by families", img: A("goa-stay-north-anjuna.webp"), amt: 8200 },
] as const;
export type StayId = (typeof STAYS)[number]["id"];

export type BoardItem = { t: string; name: string; why: string; img?: string; flight?: boolean };
export type BoardDay = { n: number; date: string; title: string; items: BoardItem[] };

export function boardDays(stay: (typeof STAYS)[number]): BoardDay[] {
  return [
    { n: 1, date: "Thu 12 Dec", title: "Arrive slow", items: [
      { t: "8:10 am", name: "Fly BLR → GOI", why: "Seats together", flight: true },
      { t: "12:30 pm", name: `Check in, ${stay.name}`, why: "Ground floor for Mum", img: stay.img },
      { t: "5:00 pm", name: "Sunset at Fort Aguada", why: "From the reel · 0:04", img: A("goa-aguada-fort-9x16.webp") },
    ] },
    { n: 2, date: "Fri 13 Dec", title: "Beaches and a long lunch", items: [
      { t: "9:00 am", name: "Slow breakfast at the villa", why: "Easy start" },
      { t: "1:00 pm", name: "Fish thali, Anjuna", why: "Locals’ pick", img: A("goa-food-fish-thali.webp") },
      { t: "5:30 pm", name: "Morjim beach walk", why: "Flat, short walk", img: A("goa-day5-morjim-shore.webp") },
    ] },
    { n: 3, date: "Sat 14 Dec", title: "Old Panaji", items: [
      { t: "10:00 am", name: "Fontainhas walk, 1.5 km", why: "Easy pace", img: A("goa-day3-panaji-street.webp") },
      { t: "1:00 pm", name: "Lunch in a 200-year-old house", why: "From the reel · 0:23", img: A("goa-goan-heritage-house.webp") },
      { t: "6:00 pm", name: "Mandovi sunset cruise", why: "Lift to the upper deck", img: A("goa-beach-sunset-9x16.webp") },
    ] },
    { n: 4, date: "Sun 15 Dec", title: "Churches and curry", items: [
      { t: "10:00 am", name: "Old Goa churches", why: "Step-free entries", img: A("goa-day3-panaji-church.webp") },
      { t: "1:30 pm", name: "Fish curry rice, Siolim", why: "From the reel · 0:35", img: A("goa-day2-fish-curry-rice.webp") },
      { t: "Evening", name: "Free at the villa", why: "Rest day" },
    ] },
    { n: 5, date: "Mon 16 Dec", title: "Fly home", items: [
      { t: "11:00 am", name: "Check out", why: "Late checkout held" },
      { t: "6:30 pm", name: "Fly GOI → BLR", why: "Seats together", flight: true },
    ] },
  ];
}

export const BOARD_FIXED = { flights: 19800, experiences: 5400, transfers: 3200, taxes: 3400 };

// ---- 4 · Book it in one go ---------------------------------------------------------------------

export const SAVED_TRAVELLERS = [
  { i: "A", name: "Asha Sharma", meta: "Lead traveller · details saved" },
  { i: "V", name: "Vikram Sharma", meta: "Details saved" },
];

export const GO_OPTIONS = [
  { id: "book", title: "Book the trip", sub: "Everything confirmed today", icon: "M5 12l5 5 9-10", col: "#0B7A57", tint: "#E3F5EE" },
  { id: "hold", title: "Hold it for 72 hours", sub: "Pay ₹5,000 now. Prices locked, and it counts toward the total", icon: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", col: "#B86E00", tint: "#FBF1DC" },
  { id: "human", title: "Talk to a human advisor", sub: "A trip expert calls you back within 10 minutes", icon: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2", col: "#1A6094", tint: "#E8EEF4" },
] as const;
export type GoOption = (typeof GO_OPTIONS)[number]["id"];

export const BASE_TOTAL = 46200;
export const REFUNDABLE_EXTRA = 6900;

export function checkoutLines(refundable: boolean) {
  return [
    { k: "Flights", meta: `BLR ⇄ GOI · 3 seats · ${refundable ? "refundable" : "non-refundable"}`, v: refundable ? "₹24,600" : "₹19,800" },
    { k: "Stay", meta: `Assagao villa · 4 nights · ${refundable ? "free cancellation" : "non-refundable"}`, v: refundable ? "₹16,500" : "₹14,400" },
    { k: "Experiences & meals", meta: "Fort drive, Fontainhas walk, cruise, lunches", v: "₹5,400" },
    { k: "Transfers", meta: "Private SUV · airport + 3 day trips", v: "₹3,200" },
    { k: "Taxes & fees", meta: "GST and our service fee", v: "₹3,400" },
  ];
}

export const CHECKOUT_IMG = A("goa-village-aerial-16x9.webp");

// ---- 5 · Booked --------------------------------------------------------------------------------

export const BOOKED_ITEMS = [
  { title: "Flights · BLR ⇄ GOI", meta: "3 seats together · 12 Dec 8:10 am · 16 Dec 6:30 pm", ref: "PNR ••••••", masked: true },
  { title: "Assagao heritage villa", meta: "2 ground-floor rooms · 4 nights · breakfast", ref: "Conf. ••••••", masked: true },
  { title: "Private transfers", meta: "Same driver · airport + 3 day trips", ref: "Voucher", masked: false },
  { title: "Mandovi sunset cruise", meta: "Sat 14 Dec · 6 pm · upper deck, lift access", ref: "Voucher", masked: false },
  { title: "Lunches and walks", meta: "Anjuna thali · heritage house · Siolim · Fontainhas", ref: "Voucher", masked: false },
];

export const BOOKED_IMG = A("goa-beach-sunset-9x16.webp");
