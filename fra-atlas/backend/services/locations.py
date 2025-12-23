import re, asyncio, aiohttp
from typing import Optional, Tuple

INDIA_BBOX = (6.0, 68.0, 37.5, 97.5)

def normalize_part(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).title()

def normalize_triplet(state, district, village):
    return normalize_part(state), normalize_part(district), normalize_part(village)

def coords_plausible(lat, lon) -> bool:
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return False
    minLat, minLon, maxLat, maxLon = INDIA_BBOX
    return minLat <= lat <= maxLat and minLon <= lon <= maxLon

async def geocode_village(state, district, village) -> Optional[Tuple[float,float]]:
    q = f"{village}, {district}, {state}, India"
    url = f"https://nominatim.openstreetmap.org/search?format=json&q={q}"
    headers = {"User-Agent": "fra-atlas/1.0 (contact: your-email@example.com)"}
    await asyncio.sleep(1.1)  # be polite
    async with aiohttp.ClientSession(headers=headers) as sess:
        async with sess.get(url) as r:
            if r.status != 200:
                return None
            data = await r.json()
            if not data: return None
            return float(data[0]["lat"]), float(data[0]["lon"])
