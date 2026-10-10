"""Normalize the old GoExperience/WishTrip catalogue into Wishtrip's knowledge-base schema.

Input:  client_work/knowledge_base/raw/{catalogue,geo,crossbase,opendays}.json
        (exported from old_client_work with tools/dump.mts and tools/dumpgeo.mts)
Output: client_work/knowledge_base/{locations,relations}.json + summary.md

Rules (see client_work/README.md):
- Prices from the old KB are hand-entered estimates. They are kept under `reference`
  for internal use only and never become a traveler-facing price (price_note stays "").
- Durations never existed in the old KB (their K9 gap), so duration_minutes stays null.
- Hotels are imported as drafts until a person verifies them.
"""

import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "knowledge_base"
SOURCE = "goexperience-kb"

COUNTRY = {
    "goa": "India", "kerala": "India", "dharamshala": "India",
    "thailand": "Thailand", "japan": "Japan",
}
REGION = {"goa": "Goa", "kerala": "Kerala", "dharamshala": "Himachal Pradesh"}
COUNTRY_INFO = {
    "India": {"summary": "From Goa's beaches to Kerala's backwaters and the Himalayan foothills.",
              "latitude": 22.35, "longitude": 78.67},
    "Thailand": {"summary": "Temples, islands, street food and northern hills.",
                 "latitude": 15.87, "longitude": 100.99},
    "Japan": {"summary": "Neon cities, ancient temples, mountains and island beaches.",
              "latitude": 36.2, "longitude": 138.25},
}
TOD = {"AM": ["morning"], "PM": ["afternoon"], "EVE": ["evening"]}
PACE_ENERGY = {"easy": 2, "moderate": 3, "active": 4}
THEME_TAG = {
    "culture": "Culture", "nature": "Nature", "food": "Food", "offbeat": "Offbeat",
    "adventure": "Adventure", "spiritual": "Spiritual", "heritage": "Heritage", "beach": "Beach",
    "shopping": "Shopping", "wellness": "Wellness", "nightlife": "Nightlife",
    "trekking": "Trekking", "learn": "Learning", "theme-parks": "Theme parks",
}
FIT_TAG = {"solo": "Solo friendly", "friends": "Good for groups", "seniors": "Senior friendly",
           "family-kids": "Kid friendly"}
STAY_TIER_COST = {"budget": 1, "balanced": 2, "premium": 3}
SEASON_HINT = {"sakura": ["spring"], "autumn": ["autumn"], "winter": ["winter"], "snow": ["winter"],
               "summer": ["summer"]}
DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]


def slug(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def city_aliases(dest: dict, base: dict) -> list[str]:
    """Names travellers use: the destination ("Dharamshala") for single-base destinations,
    and the short form of descriptive labels ("Munnar tea hills" → "Munnar")."""
    label = base["label"]
    names = set()
    if len(dest["bases"]) == 1 and dest["name"] != label:
        names.add(dest["name"])
    short = re.split(r"\s*[(·]|\s+(?:tea hills|backwaters|cliff)$", label)[0].strip()
    if short and short != label:
        names.add(short)
    for part in re.split(r"\s*·\s*", label):
        if part and part != label:
            names.add(part.strip())
    return sorted(names)


def load(name: str) -> dict:
    return json.loads((ROOT / "raw" / f"{name}.json").read_text())


def main() -> None:
    catalogue = load("catalogue")
    geo = load("geo")
    cross = load("crossbase")
    open_days = load("opendays")["OPEN_DAYS"]
    poi, zone, base_geo = geo["GEO_POI"], geo["GEO_ZONE"], geo["GEO_BASE"]

    locations: list[dict] = []
    relations: list[dict] = []
    stats: Counter = Counter()

    def coords(dest_id: str, name: str, area: str | None, base_id: str) -> tuple:
        if name in poi.get(dest_id, {}):
            lat, lng = poi[dest_id][name]
            return lat, lng, "venue"
        if area and area in zone.get(dest_id, {}):
            lat, lng = zone[dest_id][area]
            return lat, lng, "zone-centroid"
        if base_id in base_geo.get(dest_id, {}):
            lat, lng = base_geo[dest_id][base_id]
            return lat, lng, "city-centre"
        return None, None, "none"

    for country, info in COUNTRY_INFO.items():
        locations.append({
            "external_id": f"{SOURCE}:country:{slug(country)}", "type": "country", "name": country,
            "parent_external_id": None, "status": "published", **info, "tags": [],
            "provenance": {"source": SOURCE},
        })

    for dest in catalogue:
        dest_id = dest["id"]
        country_ext = f"{SOURCE}:country:{slug(COUNTRY[dest_id])}"
        months = dest.get("monsoonMonths") or []
        base_ids = [b["id"] for b in dest["bases"]]
        zone_base = cross["ZONE_BASE"].get(dest_id, {})

        for base in dest["bases"]:
            city_ext = f"{SOURCE}:city:{dest_id}:{base['id']}"
            lat, lng = base_geo.get(dest_id, {}).get(base["id"], (None, None))
            access = "; ".join(x for x in (base.get("fromAirport"), base.get("toAirport")) if x)
            locations.append({
                "external_id": city_ext, "type": "city", "name": base["label"],
                "parent_external_id": country_ext, "status": "published",
                "summary": dest.get("vibe", "") if len(dest["bases"]) == 1 else f"{base['label']} — part of {dest['name']}",
                "latitude": lat, "longitude": lng,
                "tips": f"Airport access: {access}" if access else "",
                "tags": [],
                "region": REGION.get(dest_id, dest["name"]),
                "aliases": city_aliases(dest, base),
                "provenance": {"source": SOURCE, "source_id": f"{dest_id}/{base['id']}"},
                "reference": {"monsoon_months": months, "arrival_code": dest.get("arrivalCode"),
                              "drive_in_from": base.get("driveInFrom")},
            })
            stats["city"] += 1

            for exp in base.get("experiences", []):
                themes = exp.get("themes", [])
                if "adventure" in themes or "trekking" in themes or exp.get("pace") == "active":
                    loc_type = "activity"
                elif exp.get("marquee") or "heritage" in themes:
                    loc_type = "attraction"
                else:
                    loc_type = "experience"
                fit = set(exp.get("travellerFit", []))
                energy = 5 if exp.get("strenuous") else PACE_ENERGY.get(exp.get("pace"), None)
                lat, lng, precision = coords(dest_id, exp["title"], exp.get("area"), base["id"])
                tod = exp.get("onlyTod") or exp.get("tod")
                hours = {}
                for record in open_days.get(dest_id, {}).get(exp["id"], []):
                    if record.get("applies") == "card":
                        hours["open_days"] = ", ".join(DAY_NAMES[d] for d in record["openDays"])
                        hours["source"] = record.get("source", "")
                        hours["verified"] = record.get("verified", "")
                        if record.get("note"):
                            hours["note"] = record["note"]
                cautions = ["Take it gently: can be tiring for seniors or limited mobility."] if exp.get("gentleCaution") else []
                if exp.get("stepsHard"):
                    cautions.append("Many steps / steep climb")
                locations.append({
                    "external_id": f"{SOURCE}:experience:{exp['id']}", "type": loc_type,
                    "name": exp["title"], "parent_external_id": city_ext, "status": "published",
                    "summary": exp.get("blurb") or exp.get("insight", ""),
                    "description": exp.get("insight", "") if exp.get("blurb") else "",
                    "latitude": lat, "longitude": lng, "address": exp.get("area", ""),
                    "duration_minutes": None,
                    "best_times": TOD.get(tod, []) if isinstance(tod, str) else [],
                    "seasons": SEASON_HINT.get(exp.get("seasonTag"), []),
                    "opening_hours": hours,
                    "energy_level": energy,
                    "difficulty": 4 if exp.get("strenuous") or exp.get("stepsHard") else None,
                    "family_friendly": bool(fit & {"family", "family-kids"}),
                    "couple_friendly": "couple" in fit,
                    "accessible": False if (exp.get("stepsHard") or exp.get("strenuous")) else None,
                    "tips": " ".join(cautions + ([exp["timeHint"]] if exp.get("timeHint") else [])),
                    "tags": sorted({THEME_TAG[t] for t in themes if t in THEME_TAG}
                                   | {FIT_TAG[f] for f in fit if f in FIT_TAG}),
                    "highlight": bool(exp.get("marquee")),
                    "provenance": {"source": SOURCE, "source_id": exp["id"],
                                   "coordinate_precision": precision},
                    "reference": {
                        "ticket_price_per_person_inr_unverified": exp.get("ticketPricePerPerson"),
                        "season_tag": exp.get("seasonTag"), "group_safe": exp.get("groupSafe"),
                        "traveller_fit": sorted(fit), "suitability": exp.get("suitability"),
                        "meal_included": exp.get("mealIncluded"),
                    },
                })
                stats[loc_type] += 1

            seen = set()
            for stay in (base.get("stayList") or base.get("stays", [])) + (base.get("familyStays") or []):
                if stay["name"] in seen:
                    continue
                seen.add(stay["name"])
                fit = set(stay.get("forTravellers") or [])
                lat, lng, precision = coords(dest_id, stay["name"], stay.get("area"), base["id"])
                kind = stay.get("kind", "")
                review = stay.get("reviewEvidence")
                locations.append({
                    "external_id": f"{SOURCE}:stay:{dest_id}:{base['id']}:{slug(stay['name'])}",
                    "type": "hotel", "name": stay["name"], "parent_external_id": city_ext,
                    # Hotels stay hidden from travelers until a person verifies them.
                    "status": "draft",
                    "summary": stay.get("why", ""), "latitude": lat, "longitude": lng,
                    "address": stay.get("area", ""),
                    "cost_level": 4 if kind == "luxury" else STAY_TIER_COST.get(stay.get("tier")),
                    "family_friendly": bool(fit & {"family", "family-kids"}) if fit else None,
                    "couple_friendly": ("couple" in fit) if fit else None,
                    "tags": sorted({kind.replace("-", " ").title()} if kind else set()),
                    "provenance": {"source": SOURCE, "source_id": f"{dest_id}/{base['id']}/{stay['name']}",
                                   "coordinate_precision": precision, "needs_verification": True},
                    "reference": {"rate_per_night_inr_unverified": stay.get("ratePerNight"),
                                  "tier": stay.get("tier"), "stars": stay.get("stars"),
                                  "vibe": stay.get("vibe"), "review_evidence": review},
                })
                stats["hotel"] += 1

        for food in dest.get("food", []):
            base_id = food.get("baseId") or (zone_base.get(food.get("area"), [None])[0]) or base_ids[0]
            if base_id not in base_ids:
                base_id = base_ids[0]
            lat, lng, precision = coords(dest_id, food["name"], food.get("area"), base_id)
            tags = {"Food"}
            if food.get("veg"):
                tags.add("Vegetarian")
            if food.get("jain"):
                tags.add("Jain options")
            if food.get("cuisine"):
                tags.add(food["cuisine"])
            fit = set(food.get("forTravellers") or [])
            locations.append({
                "external_id": f"{SOURCE}:food:{dest_id}:{slug(food['name'])}",
                "type": "restaurant", "name": food["name"],
                "parent_external_id": f"{SOURCE}:city:{dest_id}:{base_id}", "status": "published",
                "summary": f"{food.get('cuisine') or food['type'].title()} — {food['type']} spot"
                           + (", vegetarian" if food.get("veg") else ""),
                "latitude": lat, "longitude": lng, "address": food.get("area", ""),
                "family_friendly": bool(fit & {"family", "family-kids"}) if fit else None,
                "couple_friendly": ("couple" in fit) if fit else None,
                "tags": sorted(tags),
                "provenance": {"source": SOURCE, "source_id": f"{dest_id}/{food['name']}",
                               "coordinate_precision": precision},
                "reference": {"food_type": food["type"], "veg": food.get("veg"), "jain": food.get("jain")},
            })
            stats["restaurant"] += 1

        for pair, link in cross["CROSS_BASE"].get(dest_id, {}).items():
            a, b = pair.split("|")
            minutes = link.get("minutes") or link.get("airMinutesAtoB")
            relations.append({
                "source_external_id": f"{SOURCE}:city:{dest_id}:{a}",
                "target_external_id": f"{SOURCE}:city:{dest_id}:{b}",
                "relation": "route_to", "travel_minutes": minutes,
                "distance_meters": int(link["distanceKm"] * 1000) if link.get("distanceKm") else None,
                "note": f"{link.get('mode', '')}"
                        + (f" — {link['flavourAtoB']}" if link.get("flavourAtoB") else "")
                        + (f" (verified {link['verifiedOn']})" if link.get("verifiedOn") else ""),
            })
            stats["route"] += 1

    # Drop duplicate external ids (a few restaurants appear under two zones).
    unique: dict[str, dict] = {}
    for loc in locations:
        unique.setdefault(loc["external_id"], loc)
    locations = list(unique.values())

    (ROOT / "locations.json").write_text(json.dumps(locations, indent=1, ensure_ascii=False))
    (ROOT / "relations.json").write_text(json.dumps(relations, indent=1, ensure_ascii=False))

    precision = Counter(l.get("provenance", {}).get("coordinate_precision", "n/a") for l in locations)
    lines = [
        "# Normalized client knowledge base — summary", "",
        f"Generated by `tools/normalize.py` from `raw/` ({len(locations)} locations, {len(relations)} routes).", "",
        "| Type | Count |", "|---|---|",
        *[f"| {k} | {v} |" for k, v in sorted(stats.items())], "",
        "Coordinate precision: " + ", ".join(f"{k} {v}" for k, v in precision.items()), "",
        "By destination:", "",
    ]
    for dest in catalogue:
        lines.append(f"- **{dest['name']}** ({COUNTRY[dest['id']]}): "
                     + ", ".join(b["label"] for b in dest["bases"]))
    (ROOT / "summary.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:16]))


if __name__ == "__main__":
    sys.exit(main())
