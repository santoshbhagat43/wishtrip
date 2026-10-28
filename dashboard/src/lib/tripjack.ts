import { relativeTime } from "@/lib/format";

/** Money from TripJack is in rupees already (not paise). */
export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const today = () => new Date().toISOString().slice(0, 10);
export const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "";
export const hoursMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/** What the server says about where an answer came from (our `supplier` block). */
export type Supplier = {
  environment: string;
  trace_id: string;
  served_from: "tripjack" | "cache";
  upstream_ms: number;
  server_ms: number;
  calls: { endpoint: string; status: number | null; ok: boolean; ms: number; error: string }[];
  cache?: { age_seconds: number | null };
};

export type Cancellation = { refundable: boolean; free_until: string | null; slabs: { from: string; to: string; amount: number }[] };
export type Price = { base: number; taxes: number; management_fee?: number; management_fee_tax?: number; total: number; currency: string };

export type HotelOption = {
  option_id: string;
  rooms: { name: string; adults?: number; children?: number }[];
  meal_basis: string;
  inclusions: string[];
  booking_notes?: string;
  price: Price;
  needs_pan?: boolean;
  needs_passport?: boolean;
  cancellation: Cancellation;
};
export type HotelCard = {
  hotel_id: string;
  name: string;
  stars: number | null;
  property_type: string;
  address: string;
  hero_image: string | null;
  amenities: string[];
  rank: number;
  option: HotelOption;
};
export type HotelSearchResult = { hotels: HotelCard[]; total: number; partial?: boolean; region?: { city: string; country: string }; supplier: Supplier };
export type HotelDetail = {
  hotel: { name: string; stars?: number | null; address?: string; headline?: string; description?: string; images?: { caption: string; url: string }[]; amenities?: string[] };
  options: HotelOption[];
  supplier: Supplier;
};

export type Airport = { code: string; name: string; city: string; country: string; terminal: string };
export type Segment = {
  airline: { code: string; name: string; low_cost: boolean };
  flight_number: string;
  from: Airport;
  to: Airport;
  departs: string;
  arrives: string;
  duration_minutes: number;
  layover_minutes: number;
  technical_stops: number;
};
export type Fare = {
  price_id: string;
  fare_type: string;
  cabin: string;
  fare_name: string;
  refundable: "refundable" | "non_refundable" | "partially_refundable" | "unknown";
  baggage: { check_in: string; cabin: string };
  seats_left: number | null;
  price: Price;
};
export type FlightTrip = {
  journey: string;
  legs: Segment[][];
  departs: string;
  arrives: string;
  duration_minutes: number;
  stops: number;
  airlines: { code: string; name: string }[];
  cheapest: Fare;
  fares: Fare[];
};
export type FlightSearchResult = { total: number; flights: FlightTrip[]; supplier: Supplier };
export type FareBand = { from_hours: number | null; to_hours: number | null; period: string | null; airline_fee: number; service_fee: number; note: string };
/** Rules by sector ("DEL-GOI"), then by kind (CANCELLATION, DATECHANGE, NO_SHOW, …). */
export type FareRules = { sectors: Record<string, Record<string, FareBand[]>>; supplier: Supplier };

export { relativeTime };
