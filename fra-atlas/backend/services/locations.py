import os
import re
import json
import asyncio
from urllib.parse import urlencode
from urllib.request import urlopen, Request as UrlRequest
from typing import Optional, Tuple

from starlette.concurrency import run_in_threadpool

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

async def geocode_village(state, district, village) -> Optional[Tuple[float, float]]:
    """
    Geocode via Nominatim using stdlib urllib in a thread — same approach as
    claims.py's _geocode_village_backend, deliberately avoiding an aiohttp
    dependency for a single occasional lookup.
    """
    q = f"{village}, {district}, {state}, India"
    url = "https://nominatim.openstreetmap.org/search?" + urlencode({"format": "json", "q": q})
    headers = {
        "User-Agent": os.getenv(
            "NOMINATIM_USER_AGENT",
            "fra-atlas-sih2025/1.0 (+https://github.com/imrozdotpi; no-reply@example.com)",
        )
    }

    def _do_req_sync() -> Optional[Tuple[float, float]]:
        try:
            req = UrlRequest(url, headers=headers)
            with urlopen(req, timeout=10) as resp:
                data = resp.read()
            arr = json.loads(data.decode("utf-8"))
            if not arr:
                return None
            return float(arr[0]["lat"]), float(arr[0]["lon"])
        except Exception:
            return None

    await asyncio.sleep(1.1)  # be polite to Nominatim's rate limit
    return await run_in_threadpool(_do_req_sync)
