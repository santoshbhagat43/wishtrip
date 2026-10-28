/** Where travellers start from: the main airports (code, city), for the Details screen. TripJack
 *  searches flights by these codes. */
export type Airport = { code: string; city: string };

export const AIRPORTS: Airport[] = [
  // India
  { code: "DEL", city: "Delhi" }, { code: "BOM", city: "Mumbai" }, { code: "BLR", city: "Bengaluru" },
  { code: "MAA", city: "Chennai" }, { code: "HYD", city: "Hyderabad" }, { code: "CCU", city: "Kolkata" },
  { code: "AMD", city: "Ahmedabad" }, { code: "PNQ", city: "Pune" }, { code: "GOI", city: "Goa (Dabolim)" },
  { code: "GOX", city: "Goa (Mopa)" }, { code: "COK", city: "Kochi" }, { code: "TRV", city: "Thiruvananthapuram" },
  { code: "CCJ", city: "Kozhikode" }, { code: "JAI", city: "Jaipur" }, { code: "LKO", city: "Lucknow" },
  { code: "IXC", city: "Chandigarh" }, { code: "ATQ", city: "Amritsar" }, { code: "SXR", city: "Srinagar" },
  { code: "IXJ", city: "Jammu" }, { code: "VNS", city: "Varanasi" }, { code: "PAT", city: "Patna" },
  { code: "BBI", city: "Bhubaneswar" }, { code: "GAU", city: "Guwahati" }, { code: "IXB", city: "Bagdogra" },
  { code: "IMF", city: "Imphal" }, { code: "NAG", city: "Nagpur" }, { code: "IDR", city: "Indore" },
  { code: "BHO", city: "Bhopal" }, { code: "RPR", city: "Raipur" }, { code: "IXR", city: "Ranchi" },
  { code: "VTZ", city: "Visakhapatnam" }, { code: "VGA", city: "Vijayawada" }, { code: "IXM", city: "Madurai" },
  { code: "CJB", city: "Coimbatore" }, { code: "TRZ", city: "Tiruchirappalli" }, { code: "IXE", city: "Mangaluru" },
  { code: "UDR", city: "Udaipur" }, { code: "JDH", city: "Jodhpur" }, { code: "DED", city: "Dehradun" },
  { code: "IXL", city: "Leh" }, { code: "IXZ", city: "Port Blair" }, { code: "AGR", city: "Agra" },
  { code: "STV", city: "Surat" }, { code: "BDQ", city: "Vadodara" }, { code: "RAJ", city: "Rajkot" },
  // Abroad
  { code: "DXB", city: "Dubai" }, { code: "AUH", city: "Abu Dhabi" }, { code: "SHJ", city: "Sharjah" },
  { code: "DOH", city: "Doha" }, { code: "MCT", city: "Muscat" }, { code: "SIN", city: "Singapore" },
  { code: "BKK", city: "Bangkok" }, { code: "DPS", city: "Bali (Denpasar)" }, { code: "KUL", city: "Kuala Lumpur" },
  { code: "CMB", city: "Colombo" }, { code: "KTM", city: "Kathmandu" }, { code: "MLE", city: "Malé" },
  { code: "HKG", city: "Hong Kong" }, { code: "LHR", city: "London" }, { code: "JFK", city: "New York" },
];

export const airportLabel = (a: Airport) => `${a.city} (${a.code})`;

/** What they typed or picked, as an airport: "Delhi (DEL)", "delhi", or "del". */
export function airportFrom(text: string): Airport | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return (
    AIRPORTS.find((a) => airportLabel(a).toLowerCase() === t) ??
    AIRPORTS.find((a) => a.code.toLowerCase() === t) ??
    AIRPORTS.find((a) => a.city.toLowerCase() === t) ??
    null
  );
}
