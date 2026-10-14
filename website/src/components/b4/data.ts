/**
 * Content for the B4 home page, as designed in the Option B4 prototype. Static sample content —
 * nothing here is wired to the knowledge base or bookings yet. When pages get integrated, this
 * is the one file whose contents move to the API.
 */

const A = (file: string) => `/b4/${file}`;

export const IMG = {
  logo: A("wishtrip-logo-header-on-light.png"),
  mark: A("wishtrip-mark.png"),
  heritageHouse: A("goa-goan-heritage-house.webp"),
  heroBeach9x16: A("goa-hero-beach-9x16.webp"),
  rahul: A("px-av-man-b.webp"),
};

/** Where links go. Screens not built yet point at the closest page that exists today. */
export const LINKS = {
  home: "/",
  signIn: "/login",
  createAccount: "/signup",
  start: "/plan",
  arya: "/plan",
  destinations: "/explore",
  destination: "/destination",
  creatorTrip: "/creator-trip",
  creators: "/creators",
  // Paste a reel → book
  reel: "/reel",
  details: "/trip/details",
  board: "/trip/board",
  checkout: "/trip/book",
  bookings: "/trip/booked",
};

// ---- Scroll story ---------------------------------------------------------------------------

export type StoryCard = {
  id: "reel" | "flight" | "stay" | "ai" | "maps" | "wa";
  why: string;
  img?: string;
  icon?: keyof typeof STORY_ICONS;
  iconBg?: string;
  /** Scattered: how it looks in its own app. */
  title: string;
  sub: string;
  /** On the board: what wishtrip made of it. */
  bt: string;
  bs: string;
  src: string;
  sc: string;
};

export const STORY_ICONS = {
  plane: "M2 16l20-6-20-6 4 6-4 6zM6 10h8",
  chat: "M4 5h16v11H9l-5 4z",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
};

export const STORY_CARDS: StoryCard[] = [
  { id: "reel", why: "Where it started", img: A("goa-hero-beach-9x16.webp"), title: "@ananyawanders", sub: "Saved reel · 0:42", bt: "The reel you saved", bs: "6 places pulled out", src: "Instagram", sc: "#C43B58" },
  { id: "flight", why: "Cheapest, seats together", icon: "plane", iconBg: "#E8EEF4", title: "BLR → GOI · 8:10 am", sub: "IndiGo · ₹6,600 each", bt: "Flights · 3 seats together", bs: "12 Dec 8:10 am · 16 Dec 6:30 pm", src: "Flight app", sc: "#1A6094" },
  { id: "stay", why: "Ground floor for Mum", img: A("goa-stay-north-anjuna.webp"), title: "Assagao villa · 4 nights", sub: "Ground floor? Not listed", bt: "Stay · Assagao villa", bs: "2 ground-floor rooms, 4 nights", src: "Hotel site", sc: "#7A4E9A" },
  { id: "ai", why: "Locals’ pick", icon: "spark", iconBg: "#F2EEFB", title: "“Best fish thali in Anjuna?”", sub: "AI chat · 14 tabs open", bt: "Day 2 · fish thali, 1 pm", bs: "Table for 3, booked", src: "AI chat", sc: "#566E85" },
  { id: "maps", why: "Short drives only", icon: "pin", iconBg: "#E3F5EE", title: "Fort Aguada → Anjuna", sub: "35 min drive", bt: "Route checked", bs: "Nothing more than 25 min apart", src: "Maps", sc: "#0B7A57" },
  { id: "wa", why: "Remembered", icon: "chat", iconBg: "#DCF8DD", title: "Mum: “I can’t do long walks”", sub: "Family group · 3 new", bt: "Noted for every day", bs: "Easy pace, step-free entries", src: "WhatsApp", sc: "#1F8A4C" },
];

/** [x, y, rotation°, width] in the design's stage, scattered (s) and on the board (b). */
type Pose = [number, number, number, number];
export type StoryLayout = {
  stage: { w: number; h: number };
  /** Scroll distance over which the story plays (px). */
  travel: number;
  s: Record<StoryCard["id"], Pose>;
  b: Record<StoryCard["id"], Pose>;
  board: { x: number; y: number; w: number; h: number };
  imgH: number;
  imgHs: number;
};

export const STORY_DESKTOP: StoryLayout = {
  stage: { w: 1200, h: 900 },
  travel: 1500,
  s: { reel: [40, 304, -8, 196], flight: [930, 364, 6, 300], stay: [70, 724, 5, 300], ai: [860, 644, -4, 330], maps: [450, 764, 7, 270], wa: [930, 484, -7, 290] },
  b: { reel: [112, 400, 0, 190], flight: [330, 400, 0, 360], stay: [330, 476, 0, 360], maps: [330, 552, 0, 360], ai: [720, 400, 0, 368], wa: [720, 476, 0, 368] },
  board: { x: 80, y: 344, w: 1040, h: 520 },
  imgH: 250,
  imgHs: 270,
};

export const STORY_MOBILE: StoryLayout = {
  stage: { w: 390, h: 844 },
  travel: 1400,
  s: { reel: [-18, 338, -9, 126], flight: [180, 344, 6, 220], stay: [198, 502, -5, 214], ai: [-26, 592, 4, 236], maps: [222, 666, 8, 176], wa: [8, 756, -6, 226] },
  b: { reel: [24, 364, 0, 104], flight: [138, 364, 0, 228], stay: [138, 428, 0, 228], ai: [138, 492, 0, 228], maps: [138, 556, 0, 228], wa: [24, 624, 0, 342] },
  board: { x: 12, y: 320, w: 366, h: 440 },
  imgH: 148,
  imgHs: 180,
};

/** The three headline phases: [eyebrow, before pill, pill, after pill, subline]. */
export const STORY_COPY = [
  ["THE OLD WAY", "Your trip is", "scattered", "across 6 apps.", "A reel on Instagram. Flights on one app, stays on another. Questions in an AI chat. Mum’s needs in the family WhatsApp."],
  ["WITH WISHTRIP", "Now it’s all", "in one place", "", "wishtrip’s AI travel agent reads your reel, finds the flights and stays, and remembers that Mum can’t walk far."],
  ["ONE BOARD, ONE PRICE", "Your whole trip,", "booked", "in one go.", "Everything from the reel to the room, checked, priced and ready to book. Want a change? Just ask."],
] as const;

export const START_IDEAS = ["Goa with my parents, December", "A long weekend under ₹40k", "First trip abroad, Thailand"];

// ---- Arya --------------------------------------------------------------------------------------

export type AryaStep =
  | { st: number; who: "me"; text: string; hold?: number }
  | { st: number; who: "sep"; text: string; hold?: number }
  | { st: number; who: "arya"; kind: "text" | "human"; text: string; note?: string; hold?: number }
  | { st: number; who: "arya"; kind: "trip" | "receipt"; hold?: number }
  | { st: number; who: "arya"; kind: "choice"; text: string; hold?: number }
  | { st: number; who: "arya"; kind: "alert"; title: string; text: string; hold?: number };

export const ARYA_SCRIPT: AryaStep[] = [
  { st: 0, who: "me", text: "Goa in December with my parents. Mum can’t walk much." },
  { st: 0, who: "arya", kind: "text", text: "Lovely. North Goa, 4 nights, ground-floor rooms and nothing more than 25 minutes apart. I’ll start from the reel you saved." },
  { st: 0, who: "arya", kind: "trip" },
  { st: 0, who: "me", text: "Can we add a sunset river cruise?" },
  { st: 0, who: "arya", kind: "text", text: "Added on Day 3, 5:30 pm on the Mandovi. Step-free boarding, so Mum’s fine.", note: "Trip board updated · +₹3,400 · now ₹49,600" },
  { st: 1, who: "me", text: "Perfect. Let’s book it." },
  { st: 1, who: "arya", kind: "choice", text: "Asha, Ramesh and Sunita’s details are filled in. How do you want to go ahead?" },
  { st: 1, who: "me", text: "Book now" },
  { st: 1, who: "arya", kind: "receipt", hold: 3200 },
  { st: 2, who: "sep", text: "11 Dec · the day before you fly" },
  { st: 2, who: "arya", kind: "alert", title: "You’re checked in. Seats 14A–C, together.", text: "IndiGo 6E 2135 is on time. A cab will wait at Arrivals, Gate 2.", hold: 2800 },
  { st: 2, who: "sep", text: "14 Dec · on the trip" },
  { st: 2, who: "me", text: "Mum’s tired today. Can we skip the Fontainhas walk?" },
  { st: 2, who: "arya", kind: "text", text: "Done. Swapped for a slow lunch at the villa, same price. I’ve told the driver to come at 1 pm.", note: "Day 3 updated" },
  { st: 2, who: "arya", kind: "human", text: "Hi Asha, I’m keeping an eye on today. Message me here anytime." },
  { st: 2, who: "sep", text: "16 Dec · back home" },
  { st: 2, who: "arya", kind: "text", text: "Welcome home! Share your trip so the next family can book it? Ananya, whose reel you started from, gets credited too.", hold: 4200 },
];

export const ARYA_STAGES = [
  { label: "Plan", title: "Plan", desc: "Tell her who’s going. Change anything.", status: "Planning your trip" },
  { label: "Book", title: "Book", desc: "One checkout. Nothing paid without your OK.", status: "Booking your trip" },
  { label: "After you book", title: "After you book", desc: "Check-ins, cabs and a real person on WhatsApp.", status: "With you on the trip" },
];
/** Where each stage starts and ends in the script. */
export const ARYA_STARTS = [0, 5, 9];
export const ARYA_ENDS = [5, 9, ARYA_SCRIPT.length];

export const ARYA_OPTIONS: [string, string][] = [
  ["Book now", "₹49,600"],
  ["Hold for 72 hours", "₹5,000"],
  ["Talk to a person", "Free"],
];

// ---- Destinations, creator reels, traveller trips ---------------------------------------------

export const DESTINATIONS = [
  { name: "Goa", region: "INDIA", trips: "1,240", price: "₹27,800", img: A("goa-hero-beach-16x9.webp"), alt: "North Goa beach from above" },
  { name: "Kerala", region: "INDIA", trips: "610", price: "₹41,200", img: A("px-kerala-houseboat.webp"), alt: "Houseboat under palms, Kerala" },
  { name: "Dharamshala", region: "INDIA", trips: "380", price: "₹31,500", img: A("px-dharamshala.webp"), alt: "Snow on the Dhauladhar above Dharamshala" },
  { name: "Thailand", region: "INTERNATIONAL", trips: "520", price: "₹72,400", img: A("px-thailand-aerial.webp"), alt: "Phi Phi islands from above" },
  { name: "Japan", region: "INTERNATIONAL", trips: "190", price: "₹1,49,000", img: A("px-kyoto-pagoda.webp"), alt: "Pagoda in Kyoto" },
];

export type Reel = {
  title: string;
  handle: string;
  platform: string;
  views: number;
  saves: number;
  booked: number;
  img: string;
  alt: string;
  vid?: string;
};

export const REELS: Reel[] = [
  { title: "Sunrise at Fort Aguada", handle: "@ananyawanders", platform: "Instagram", views: 182000, saves: 9400, booked: 312, img: A("goa-aguada-fort-9x16.webp"), alt: "Fort Aguada at sunrise" },
  { title: "Goa thali crawl", handle: "@kabireatsgoa", platform: "YouTube Shorts", views: 96000, saves: 6100, booked: 148, img: A("goa-food-fish-thali.webp"), alt: "Goan thali" },
  { title: "Lunch in a 200-year-old house", handle: "@kabireatsgoa", platform: "Instagram", views: 41000, saves: 3200, booked: 89, img: A("goa-goan-heritage-house.webp"), alt: "Goan heritage house" },
  { title: "South Goa, the quiet side", handle: "@twoandaway", platform: "Instagram", views: 128000, saves: 7800, booked: 205, img: A("goa-beach-sunset-9x16.webp"), alt: "Goa beach at sunset" },
  { title: "Old Goa churches before 9 am", handle: "@meeramaps", platform: "YouTube Shorts", views: 33000, saves: 2000, booked: 41, img: A("goa-day3-panaji-church.webp"), alt: "Old Goa church" },
  { title: "A colour walk in Fontainhas", handle: "@meeramaps", platform: "Instagram", views: 27000, saves: 2600, booked: 35, img: A("goa-day3-panaji-street.webp"), alt: "Fontainhas street" },
  { title: "Thai islands beyond Phi Phi", handle: "@islandhopper.in", platform: "Instagram", views: 240000, saves: 15000, booked: 342, img: A("px-thailand-longtail.webp"), alt: "Longtail boat off a Thai island", vid: A("px-v-thailand.mp4") },
  { title: "First Japan trip, done right", handle: "@tokyotwo", platform: "YouTube Shorts", views: 151000, saves: 11000, booked: 186, img: A("px-kyoto-pagoda.webp"), alt: "Pagoda in Kyoto", vid: A("px-v-kyoto.mp4") },
];

export const REEL_SORTS = [
  { id: "booked", label: "Most booked" },
  { id: "views", label: "Most viewed" },
  { id: "saves", label: "Most saved" },
] as const;

export type TravellerTrip = {
  type: "family" | "couple" | "friends";
  who: string;
  trip: string;
  len: string;
  img: string;
  alt: string;
  route: string[];
  price: string;
  priceFor: string;
};

export const TRAVELLER_TRIPS: TravellerTrip[] = [
  { type: "family", who: "The Mehtas, Pune · family of 4", trip: "North Goa · 5 days · Dec 2025", len: "0:48", img: A("px-family-sea.webp"), alt: "The Mehtas in the sea at Candolim", route: ["Candolim", "Aguada", "Anjuna", "Panaji", "Morjim"], price: "₹58,400", priceFor: "for 4, all-in" },
  { type: "couple", who: "Riya & Karan, Delhi", trip: "South Goa · 4 days · Nov 2025", len: "0:36", img: A("px-couple-arambol.webp"), alt: "Riya and Karan on the beach at sunset", route: ["Palolem", "Galgibaga", "Cabo de Rama", "Agonda"], price: "₹36,900", priceFor: "for 2, all-in" },
  { type: "friends", who: "5 friends from Bengaluru", trip: "North Goa · 4 days · Jan 2026", len: "0:52", img: A("px-friends-trip.webp"), alt: "Five friends on a trip", route: ["Anjuna", "Arpora", "Vagator", "Morjim"], price: "₹19,200", priceFor: "each, all-in" },
  { type: "family", who: "The Iyers, Chennai · with grandparents", trip: "Kerala · 6 days · Dec 2025", len: "1:04", img: A("px-munnar-tea.webp"), alt: "Tea hills in Munnar", route: ["Kochi", "Munnar", "Thekkady", "Alleppey", "Kochi"], price: "₹82,600", priceFor: "for 5, all-in" },
  { type: "couple", who: "Sana & Arjun, Mumbai", trip: "Thailand · 6 days · Feb 2026", len: "0:58", img: A("px-thailand-longtail.webp"), alt: "Longtail boat off a Thai island", route: ["Phuket", "Phi Phi", "Krabi", "Bangkok"], price: "₹1,24,000", priceFor: "for 2, all-in" },
  { type: "friends", who: "Office gang, Hyderabad · 6 friends", trip: "Goa · 3 days · Mar 2026", len: "0:31", img: A("goa-day3-panaji-street.webp"), alt: "Fontainhas street", route: ["Panaji", "Fontainhas", "Old Goa"], price: "₹14,800", priceFor: "each, all-in" },
];

export const TRIP_FILTERS = [
  { id: "all", label: "All trips" },
  { id: "family", label: "Families" },
  { id: "couple", label: "Couples" },
  { id: "friends", label: "Friends" },
] as const;

// ---- Creators, trust ---------------------------------------------------------------------------

export const CREATOR_STEPS = [
  { icon: "M4 4h16v16H4zM10 9l5 3-5 3z", title: "Connect your Instagram or YouTube", desc: "Pick the trips you’ve posted. No new content needed." },
  { icon: "M4 7h16v12H4zM9 7V5h6v2M8 13h8", title: "We turn them into bookable trips", desc: "Your reels become a day-by-day trip with real prices, credited to you." },
  { icon: "M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6", title: "Earn every time someone books", desc: "You get [X%] of every booking from your trip, paid monthly to your bank." },
];

export const CREATOR_DASHBOARD = [
  { label: "Views on wishtrip", value: "18.2k" },
  { label: "Bookings this month", value: "42" },
  { label: "Your share of each booking", value: "[X%]" },
  { label: "Earned this month", value: "₹ [your earnings]", earned: true },
];

export const TRUST = [
  { icon: "M4 7h16v10H4zM4 11h16", title: "One price, all-in", desc: "Flights, stays, transfers and taxes in one number." },
  { icon: "M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z", title: "Pay only on your OK", desc: "Arya never spends a rupee without your yes." },
  { icon: "M4 5h16v11H9l-5 4z", title: "A real person on WhatsApp", desc: "A trip expert is with you from booking until you’re home." },
  { icon: "M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z", title: "Creators get credited", desc: "Book from a reel and the creator who made it earns." },
];

export const MENU = [
  {
    heading: "PLAN A TRIP",
    items: [
      { href: LINKS.start, icon: "M5 12h14M13 6l6 6-6 6", label: "Start planning" },
      { href: LINKS.arya, icon: "M4 5h16v11H9l-5 4z", label: "Talk to Arya, your AI travel agent" },
      { href: LINKS.reel, icon: "M4 4h16v16H4zM10 9l5 3-5 3z", label: "Turn a reel into a trip" },
    ],
  },
  {
    heading: "EXPLORE",
    items: [
      { href: LINKS.destinations, icon: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z", label: "Destinations" },
      { href: "/#b4-reels", icon: "M6 3h12v18l-6-4-6 4z", label: "Creator trips" },
      { href: "/#b4-travellers", icon: "M4 7h16v12H4zM9 7V5h6v2", label: "Trips booked by travellers" },
    ],
  },
  {
    heading: "YOUR TRIPS",
    items: [
      { href: LINKS.board, icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", label: "My trip boards" },
      { href: LINKS.bookings, icon: "M5 12l5 5 9-10", label: "Bookings and tickets" },
    ],
  },
];

/** 182000 → "182k", 9400 → "9.4k" (as the prototype prints counts). */
export function compact(n: number) {
  return n >= 1000 ? `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, "")}k` : String(n);
}
