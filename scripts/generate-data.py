#!/usr/bin/env python3
"""Generate cafes.json and cafes.csv from the Google Doc + manual link overrides."""

import csv
import html
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_URL = (
    "https://docs.google.com/document/d/1QWughEV5NUyN4jirjhx82u-4p9fp_7GiWigqgmC5cY0/export?format=html"
)

MANUAL_LINKS = {
    "Finback Brewing": (
        "https://www.google.com/maps/place/Finback+Brooklyn/@40.677428,-73.9875275,2969m/"
        "data=!3m1!1e3!4m10!1m2!2m1!1sfinback+brewing!3m6!1s0x89c25b080f8e925b:0xa545c5dabd6b9209"
        "!8m2!3d40.6774565!4d-73.9847935!16s%2Fg%2F11fkr3l128?entry=ttu"
    ),
    "Cafe by the Girls": (
        "https://www.google.com/maps/place/Cafe+By+The+Girls,+Colombian+Coffee/"
        "@40.6706039,-73.9831493,682m/data=!3m2!1e3!4b1!4m6!3m5!1s0x89c25b000615e3c9:0x11345621060f27d4"
        "!8m2!3d40.670604!4d-73.9782784!16s%2Fg%2F11x20zglcs?entry=ttu"
    ),
    "Farm.One": (
        "https://www.google.com/maps/place/Farm.One/@40.6706039,-73.9831493,682m/"
        "data=!3m1!1e3!4m6!3m5!1s0x89c25a1a5865a093:0x5c514691efa86b31"
        "!8m2!3d40.679678!4d-73.9689121!16s%2Fg%2F11c5xsq82j?entry=ttu"
    ),
}

LINCOLN_NEAR = (
    "https://www.google.com/maps/place/Lincoln+Station+Park+Slope/@40.6719023,-73.9802289,682m/"
    "data=!3m2!1e3!4b1!4m6!3m5!1s0x89c25b006d131a43:0x5f5fad788cc7e55d"
    "!8m2!3d40.6719023!4d-73.977654!16s%2Fg%2F11mywq7zv1?entry=ttu"
)

SHORT_LINK_COORDS = {
    "https://maps.app.goo.gl/oVtH7tvnBUtmNRw89": (40.6655603, -73.971575),
    "https://maps.app.goo.gl/1TN5H65x9d2KTvJt7": (40.6707235, -73.9887535),
    "https://maps.app.goo.gl/atBAUJonv7Ao8p5Q7": (40.6644466, -73.9839441),
    "https://maps.app.goo.gl/535kZMW1ovYTV74G8": (40.670027, -73.9924893),
    "https://maps.app.goo.gl/qotnkZzzzd2hRG1e8": (40.6585833, -73.978115),
    "https://maps.app.goo.gl/WFun8TuToHCzaX2g9": (40.6654412, -73.9898668),
    "https://maps.app.goo.gl/JL4Gnry9Rd7nUCC56": (40.6638341, -73.9911409),
}

CLOSED_NAMES = {"Little Zelda", "Canela Cafe Bar"}
UNRATABLE_CLOSED = {"Griffins Coffee Cafe"}


def extract_maps_url(href: str) -> str:
    href = html.unescape(href)
    if "google.com/url?q=" in href:
        query = urllib.parse.parse_qs(urllib.parse.urlparse(href).query).get("q", [""])[0]
        return urllib.parse.unquote(query)
    return href


def coords_from_url(url):
    if not url:
        return None, None
    if url in SHORT_LINK_COORDS:
        return SHORT_LINK_COORDS[url]
    for pattern in (
        r"!8m2!3d([\d.-]+)!4d([\d.-]+)",
        r"/@([\d.-]+),([\d.-]+)",
        r"!3d([\d.-]+)!4d([\d.-]+)",
    ):
        match = re.search(pattern, url)
        if match:
            return float(match.group(1)), float(match.group(2))
    return None, None


def cell_text(row_html):
    cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.DOTALL)
    parsed = []
    for cell in cells:
        links = re.findall(r'href="([^"]+)"', cell)
        maps_url = None
        for link in links:
            if "google.com/maps" in link or "google.com/url?q=" in link or "maps.app.goo.gl" in link:
                maps_url = extract_maps_url(link)
                break
        text = html.unescape(re.sub(r"<[^>]+>", "", cell)).strip()
        parsed.append((text, maps_url))
    return parsed


def walk_bucket(mins):
    if mins is None:
        return ""
    if mins < 15:
        return "under_15"
    if mins < 20:
        return "15_19"
    return "20_plus"


def parse_walk(value):
    value = value.strip()
    if not value:
        return None
    if value.isdigit():
        return int(value)
    if value.replace(".", "", 1).isdigit():
        return float(value)
    return None


def parse_rating(value):
    value = value.strip()
    if not value or value.upper().startswith("N/A"):
        return None
    if value.replace(".", "", 1).isdigit():
        return float(value)
    return None


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def infer_food_yes_or_no(food_text):
    """Guess Yes/No for real food from free-text food notes."""
    text = (food_text or "").strip()
    if not text:
        return "No"

    lowered = text.lower()
    no_patterns = (
        "only pastry",
        "only pastries",
        "pastries and",
        "pastry",
        "can bring food",
        "bring food",
        "bring your own",
    )
    if any(pattern in lowered for pattern in no_patterns):
        return "No"

    yes_patterns = (
        "yes",
        "actual food",
        "real food",
        "quiche",
        "soup",
        "burrito",
        "bagel",
        "lots",
        "potato",
        "empanada",
        "food to order",
    )
    if any(pattern in lowered for pattern in yes_patterns):
        return "Yes"

    return "No"


def main() -> None:
    raw = urllib.request.urlopen(DOC_URL).read().decode("utf-8", errors="replace")
    cafes = []
    current_section = None
    lincoln_count = 0

    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", raw, re.DOTALL):
        cells = cell_text(row)
        if not cells:
            continue

        texts = [cell[0] for cell in cells]
        joined = " ".join(texts).strip()
        if not joined:
            continue

        if len(texts) == 1 and "walk" in texts[0]:
            current_section = texts[0]
            continue
        if texts[0] in ("Place", "0 = never go here again"):
            continue
        if texts[0].startswith(("1 = meh", "2 = would", "3 = a fave")):
            continue
        if texts[0] == "Closed":
            current_section = "Closed"
            continue
        if len(cells) < 2 or texts[0] in ("Address", "Rating", "Distance(mins)", "Food", "Notes"):
            continue

        name = texts[0]
        maps_url = cells[1][1]
        rating_raw = texts[2] if len(texts) > 2 else ""
        walk_raw = texts[3] if len(texts) > 3 else ""
        food = texts[4] if len(texts) > 4 else ""
        notes = texts[5] if len(texts) > 5 else ""

        display_name = name
        if name == "Lincoln Station":
            lincoln_count += 1
            display_name = (
                "Lincoln Station (Park Slope)" if lincoln_count == 1 else "Lincoln Station (far)"
            )
            if lincoln_count == 1 and not maps_url:
                maps_url = LINCOLN_NEAR

        if name in MANUAL_LINKS and not maps_url:
            maps_url = MANUAL_LINKS[name]

        status = "active"
        if name in CLOSED_NAMES:
            status = "closed"
        elif name in UNRATABLE_CLOSED or rating_raw.strip().upper().startswith("N/A"):
            status = "unratable"
        elif current_section == "Closed":
            status = "closed"

        rating = parse_rating(rating_raw)
        if status in ("closed", "unratable"):
            rating = None

        walk_mins = parse_walk(walk_raw)
        lat, lng = coords_from_url(maps_url)
        tried = rating is not None and status == "active"
        food_yes_or_no = infer_food_yes_or_no(food) if tried else ""

        cafes.append(
            {
                "id": slugify(display_name),
                "name": display_name,
                "lat": lat,
                "lng": lng,
                "rating": rating,
                "walk_mins": walk_mins,
                "walk_bucket": walk_bucket(walk_mins),
                "food": food,
                "food_yes_or_no": food_yes_or_no,
                "notes": notes,
                "maps_url": maps_url or "",
                "status": status,
                "auto_added": False,
                "tried": tried,
            }
        )

    seen = {}
    for cafe in cafes:
        base = cafe["id"]
        if base in seen:
            seen[base] += 1
            cafe["id"] = f"{base}-{seen[base]}"
        else:
            seen[base] = 1

    data_dir = ROOT / "data"
    data_dir.mkdir(exist_ok=True)

    with (data_dir / "cafes.json").open("w", encoding="utf-8") as handle:
        json.dump(cafes, handle, indent=2)

    fieldnames = [
        "id",
        "name",
        "lat",
        "lng",
        "rating",
        "walk_mins",
        "walk_bucket",
        "food",
        "food_yes_or_no",
        "notes",
        "maps_url",
        "status",
        "auto_added",
        "tried",
    ]
    with (data_dir / "cafes.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for cafe in cafes:
            row = {key: cafe[key] for key in fieldnames}
            row["auto_added"] = "FALSE"
            writer.writerow(row)

    missing = [cafe["name"] for cafe in cafes if cafe["lat"] is None]
    print(f"Generated {len(cafes)} cafes")
    if missing:
        print(f"Missing coordinates: {missing}")
    else:
        print("All cafes have coordinates")


if __name__ == "__main__":
    main()
