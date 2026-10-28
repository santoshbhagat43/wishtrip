"""The main airport for a destination, so a trip to "Goa" can be priced as a flight to GOI.
A destination not listed has no airport here: its flight is not priced, never guessed."""

# Lower-case destination word -> the airport flown to.
AIRPORT_FOR = {
    "goa": "GOI", "bali": "DPS", "kerala": "COK", "kochi": "COK", "cochin": "COK",
    "munnar": "COK", "alleppey": "COK", "alappuzha": "COK", "varkala": "TRV", "jaipur": "JAI",
    "udaipur": "UDR", "jodhpur": "JDH", "agra": "AGR", "varanasi": "VNS", "delhi": "DEL",
    "mumbai": "BOM", "bengaluru": "BLR", "bangalore": "BLR", "chennai": "MAA",
    "hyderabad": "HYD", "kolkata": "CCU", "pune": "PNQ", "ahmedabad": "AMD", "srinagar": "SXR",
    "kashmir": "SXR", "leh": "IXL", "ladakh": "IXL", "amritsar": "ATQ", "manali": "IXC",
    "shimla": "IXC", "chandigarh": "IXC", "rishikesh": "DED", "dehradun": "DED",
    "andaman": "IXZ", "port blair": "IXZ", "darjeeling": "IXB", "gangtok": "IXB",
    "sikkim": "IXB", "guwahati": "GAU", "shillong": "GAU", "madurai": "IXM", "ooty": "CJB",
    "coimbatore": "CJB", "mysore": "BLR", "coorg": "BLR", "hampi": "BLR", "pondicherry": "MAA",
    "dubai": "DXB", "abu dhabi": "AUH", "doha": "DOH", "muscat": "MCT", "singapore": "SIN",
    "bangkok": "BKK", "phuket": "HKT", "krabi": "KBV", "pattaya": "BKK", "thailand": "BKK",
    "kuala lumpur": "KUL", "langkawi": "LGK", "colombo": "CMB", "sri lanka": "CMB",
    "kathmandu": "KTM", "nepal": "KTM", "maldives": "MLE", "male": "MLE", "hong kong": "HKG",
    "london": "LHR", "new york": "JFK", "tokyo": "HND", "paris": "CDG", "istanbul": "IST",
    "vietnam": "SGN", "hanoi": "HAN", "ho chi minh": "SGN", "da nang": "DAD",
}


def airport_for(destination: str) -> str | None:
    """The airport for the first listed place named in the destination ("Bali, Indonesia")."""
    text = f" {' '.join(destination.lower().replace(',', ' ').split())} "
    for place, code in sorted(AIRPORT_FOR.items(), key=lambda kv: -len(kv[0])):
        if f" {place} " in text:
            return code
    return None
