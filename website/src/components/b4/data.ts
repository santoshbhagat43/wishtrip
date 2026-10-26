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
  start: "/arya",
  arya: "/arya",
  destinations: "/destinations",
  destination: "/destination",
  creatorTrip: "/creator-trip",
  creators: "/creators#apply",
  // Paste a reel → book
  reel: "/reel",
  details: "/trip/details",
  // A creator's trip, shaped around the traveller ("Make it mine")
  mine: "/trip/mine",
  board: "/trip/board",
  checkout: "/trip/book",
  bookings: "/trip/booked",
};

// ---- Scroll story ---------------------------------------------------------------------------

export type StoryCard = {
  id: "reel" | "flight" | "stay" | "ai" | "maps" | "wa";
  /** Scattered: how it looks in its own app (and the app's name and colour). */
  img?: string;
  icon?: keyof typeof STORY_ICONS;
  iconBg?: string;
  title: string;
  sub: string;
  src: string;
  sc: string;
  /** On the board: a label, what wishtrip made of it, and the one thing it got right. */
  thumb?: string;
  cat: string;
  bt: string;
  bs: string;
  why: string;
};

export const STORY_ICONS = {
  plane: "M2 16l20-6-20-6 4 6-4 6zM6 10h8",
  chat: "M4 5h16v11H9l-5 4z",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
};

export const STORY_CARDS: StoryCard[] = [
  { id: "reel", img: A("px-bali-reel-poster.webp"), thumb: A("px-bali-temple2.webp"), title: "@globetrottervoyage", sub: "Saved reel · 0:53", src: "Instagram", sc: "#C43B58", cat: "YOUR REEL", bt: "Bali in 7 days", bs: "@globetrottervoyage", why: "Where it started" },
  { id: "flight", icon: "plane", iconBg: "#E8EEF4", title: "BLR → Bali", sub: "Thai Airways · ₹38,900", src: "Flight app", sc: "#1A6094", cat: "FLIGHTS", bt: "BLR → Bali (DPS)", bs: "Thai Airways, 1 stop", why: "Seats together" },
  { id: "stay", img: A("px-bali-resort.webp"), title: "Kuta pool resort", sub: "Couples? Not listed", src: "Hotel site", sc: "#7A4E9A", cat: "STAY · 6 NIGHTS", bt: "Kuta pool resort", bs: "4-star, with breakfast", why: "Quiet room for two" },
  { id: "ai", icon: "spark", iconBg: "#F2EEFB", title: "“Tanah Lot, sunset?”", sub: "AI chat · 11 tabs", src: "AI chat", sc: "#566E85", cat: "DAY 5 · SUNSET", bt: "Tanah Lot temple", bs: "After the lake temple", why: "Best light, 6 pm" },
  { id: "maps", icon: "pin", iconBg: "#E3F5EE", title: "Kuta → Kintamani", sub: "2 hr drive", src: "Maps", sc: "#0B7A57", cat: "GETTING AROUND", bt: "Private car daily", bs: "Door to door", why: "Checked on Maps" },
  { id: "wa", icon: "chat", iconBg: "#DCF8DD", title: "Rohan: “Anniversary!”", sub: "Chat · 2 new", src: "WhatsApp", sc: "#1F8A4C", cat: "DAY 2 · DINNER", bt: "Sunset cruise", bs: "Benoa Harbour, 6 pm", why: "For your anniversary" },
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
  /** Height of a card once it has settled on the board. */
  cardH: number;
};

export const STORY_DESKTOP: StoryLayout = {
  stage: { w: 1200, h: 900 },
  travel: 1500,
  s: { reel: [40, 304, -8, 196], flight: [930, 364, 6, 300], stay: [70, 724, 5, 300], ai: [860, 644, -4, 330], maps: [450, 764, 7, 270], wa: [930, 484, -7, 290] },
  b: { reel: [102, 444, 0, 321], flight: [439, 444, 0, 321], stay: [776, 444, 0, 321], ai: [102, 592, 0, 321], maps: [439, 592, 0, 321], wa: [776, 592, 0, 321] },
  board: { x: 80, y: 344, w: 1040, h: 520 },
  imgH: 250,
  imgHs: 270,
  cardH: 132,
};

export const STORY_MOBILE: StoryLayout = {
  stage: { w: 390, h: 844 },
  travel: 1400,
  s: { reel: [14, 326, -4, 168], flight: [178, 332, 5, 204], stay: [186, 462, -4, 196], ai: [10, 640, 4, 222], maps: [184, 704, 6, 198], wa: [16, 772, -5, 222] },
  b: { reel: [24, 394, 0, 166], flight: [200, 394, 0, 166], stay: [24, 510, 0, 166], ai: [200, 510, 0, 166], maps: [24, 626, 0, 166], wa: [200, 626, 0, 166] },
  board: { x: 12, y: 320, w: 366, h: 496 },
  imgH: 148,
  imgHs: 180,
  cardH: 106,
};

/** The three headline phases: [eyebrow, before pill, pill, after pill, subline]. */
export const STORY_COPY = [
  ["SOUND FAMILIAR?", "Your trip lives in", "6 different", "apps.", "A reel, a flight app, a hotel site, your chats."],
  ["WITH WISHTRIP", "Now it’s all", "in one place", "", "Arya turns them into one plan."],
  ["ONE BOARD, ONE PRICE", "Your whole trip,", "booked", "in one go.", "Checked, priced and ready. Want a change? Just ask."],
] as const;

export const START_IDEAS = ["Goa with a toddler, December", "A couple’s weekend under ₹40k", "Bali for two, 7 days"];

// ---- Arya --------------------------------------------------------------------------------------

export type AryaStep =
  | { st: number; who: "me"; text: string; hold?: number }
  | { st: number; who: "sep"; text: string; hold?: number }
  | { st: number; who: "arya"; kind: "text" | "human"; text: string; note?: string; hold?: number }
  | { st: number; who: "arya"; kind: "trip" | "receipt"; hold?: number }
  | { st: number; who: "arya"; kind: "choice"; text: string; hold?: number }
  | { st: number; who: "arya"; kind: "alert"; title: string; text: string; hold?: number };

export const ARYA_SCRIPT: AryaStep[] = [
  { st: 0, who: "me", text: "Bali for 7 days, just the two of us. Under ₹1.5L." },
  { st: 0, who: "arya", kind: "text", text: "Lovely. 6 nights at a Kuta pool resort, a private car every day, and the 5 experiences from the reel you saved." },
  { st: 0, who: "arya", kind: "trip" },
  { st: 0, who: "me", text: "Day 2 is our anniversary. Something special?" },
  { st: 0, who: "arya", kind: "text", text: "Added a sunset dinner cruise from Benoa Harbour on Day 2, with a table for two by the rail.", note: "Trip board updated · +₹6,200 · now ₹1,49,000" },
  { st: 1, who: "me", text: "Perfect. Let’s book it." },
  { st: 1, who: "arya", kind: "choice", text: "Nisha and Rohan’s passport details are filled in. How do you want to go ahead?" },
  { st: 1, who: "me", text: "Book now" },
  { st: 1, who: "arya", kind: "receipt", hold: 3200 },
  { st: 2, who: "sep", text: "7 May · the day before you fly" },
  { st: 2, who: "arya", kind: "alert", title: "You’re checked in. Seats 22A and 22B, together.", text: "Your Thai Airways flight is on time. Your driver will wait at Bali Arrivals with your names on a board.", hold: 2800 },
  { st: 2, who: "sep", text: "11 May · on the trip" },
  { st: 2, who: "me", text: "It’s pouring in Kintamani. Can we swap today?" },
  { st: 2, who: "arya", kind: "text", text: "Done. The volcano trip moves to Thursday, and today is a couples’ spa at the resort, same price. The driver now comes at 3.", note: "Day 4 updated" },
  { st: 2, who: "arya", kind: "human", text: "Hi Nisha, I’m keeping an eye on today. Message me here anytime." },
  { st: 2, who: "sep", text: "14 May · back home" },
  { st: 2, who: "arya", kind: "text", text: "Welcome home, and happy anniversary! Share your trip so the next couple can book it? Prateek, whose reel you started from, gets credited too.", hold: 4200 },
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
  ["Book now", "₹1,49,000"],
  ["Hold for 72 hours", "₹10,000"],
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
  { icon: "M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6", title: "Earn every time someone books", desc: "You earn a share of every booking from your trip, paid monthly to your bank." },
];

export const CREATOR_DASHBOARD = [
  { label: "Views on wishtrip", value: "18.2k" },
  { label: "Bookings this month", value: "42" },
  { label: "Your share of each booking", value: "Agreed with you" },
  { label: "Earned this month", value: "Paid monthly", earned: true },
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
      { href: "/creators/trips", icon: "M6 3h12v18l-6-4-6 4z", label: "Creator trips" },
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
