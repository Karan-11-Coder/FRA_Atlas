# backend/utils/normalize_claims.py
from typing import Any, Dict, List, Optional, Tuple
import re
import logging

logger = logging.getLogger(__name__)

Number = float


def _pick_first_from(obj: Dict[str, Any], keys: List[str]) -> Optional[Any]:
    """Return first non-empty value found under keys in obj."""
    for k in keys:
        v = obj.get(k)
        if v is None:
            continue
        # if it's a list, return first non-empty element
        if isinstance(v, (list, tuple)) and len(v) > 0:
            if v[0] is not None and v[0] != "":
                return v[0]
            # fallback to scanning the list for a usable element
            for item in v:
                if item is not None and item != "":
                    return item
            continue
        if v != "":
            return v
    return None


def _as_list(obj: Dict[str, Any], keys: List[str]) -> List[Any]:
    """Return a flattened list from the first key found containing iterable or single value."""
    for k in keys:
        v = obj.get(k)
        if v is None:
            continue
        if isinstance(v, (list, tuple)):
            return list(v)
        return [v]
    return []


# Unit -> hectares. Claims store land_area in hectares (the DSS model's unit).
_AREA_UNITS = [
    (re.compile(r"(?i)\b(?:ha|hectares?|hect)\b"), 1.0),
    (re.compile(r"(?i)\b(?:acres?|ac)\b"), 0.40468564),
    (re.compile(r"(?i)(?:sq\.?\s*m|m2|m²|square\s+met(?:er|re)s?)"), 0.0001),
    (re.compile(r"(?i)\b(?:bighas?)\b"), None),      # varies by state: not converted
]


def _parse_area(area_raw: Optional[str]) -> Optional[Number]:
    """
    Parse a land area string to HECTARES (best-effort).
    "1.2 ha" -> 1.2, "8 acres" -> 3.24, "1200 sq.m" -> 0.12, "1,234.5" -> 1234.5
    (a bare number is assumed to already be hectares). Units whose size
    varies by state (bigha) return None rather than a wrong number.
    """
    if not area_raw:
        return None
    try:
        s = str(area_raw).strip().replace(",", "")
        m = re.search(r"(-?\d+(?:\.\d+)?)", s)
        if not m:
            return None
        value = float(m.group(1))
        for pattern, factor in _AREA_UNITS:
            if pattern.search(s):
                return None if factor is None else round(value * factor, 4)
        return value
    except Exception as e:
        logger.debug("parse_area failed for %r: %s", area_raw, e)
        return None


def _extract_coords(entities: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    """
    Extract lat/lon if present in entities.
    Accepts keys like 'lat','lon' or a coords tuple/list under 'coords' or 'location'.
    """
    lat = None
    lon = None
    # direct keys
    if "lat" in entities and "lon" in entities:
        try:
            lat = float(entities.get("lat")) if entities.get("lat") not in (None, "") else None
            lon = float(entities.get("lon")) if entities.get("lon") not in (None, "") else None
            if lat is not None or lon is not None:
                return lat, lon
        except Exception:
            pass

    # coords as pair
    for k in ("coords", "location", "point"):
        v = entities.get(k)
        if isinstance(v, (list, tuple)) and len(v) >= 2:
            try:
                # common order: [lat, lon] or [lon, lat] — assume lat,lon unless values out of range
                a = float(v[0])
                b = float(v[1])
                # simple heuristic: lat in [-90,90], lon in [-180,180]
                if -90 <= a <= 90 and -180 <= b <= 180:
                    return a, b
                if -90 <= b <= 90 and -180 <= a <= 180:
                    return b, a
            except Exception:
                continue

    return None, None


def normalize_entities(entities: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Convert an OCR/NER `entities` dictionary into one or more claim-shaped dicts
    matching the claims schema:
      {
        "state": str or None,
        "district": str or None,
        "block": str or None,
        "village": str or None,
        "patta_holder": str or None,
        "address": str or None,
        "land_area": float or None,
        "status": str or None,
        "date": str or None,
        "lat": float or None,
        "lon": float or None,
        "raw_ner": <original entities dict>
      }

    Returns a list of claim dicts. If multiple villages are found, returns one claim per village.
    Patta-holder lists are matched by index to villages when possible, otherwise the first
    patta_holder is reused for all villages.
    """
    if not entities or not isinstance(entities, dict):
        return []

    # Candidate keys for simple fields
    state = _pick_first_from(entities, ["state", "states", "st", "province"])
    district = _pick_first_from(entities, ["district", "districts", "dist"])
    block = _pick_first_from(entities, ["block", "blocks", "tehsil", "taluk"])
    address = _pick_first_from(entities, ["address", "addr", "location", "place"])
    status = _pick_first_from(entities, ["claim_status", "status", "claimstatus"])
    date = _pick_first_from(entities, ["date", "dates", "document_date"])

    # villages and patta holders as lists
    villages = _as_list(entities, ["villages", "village", "village_name", "villages_found"])
    patta_holders = _as_list(entities, ["patta_holders", "patta_holder", "owner", "owners", "patta"])

    # land area: try multiple keys and parse numeric
    raw_area = _pick_first_from(entities, ["land_area", "area", "area_sq_m", "landarea"])
    parsed_area = None
    if raw_area is not None:
        parsed_area = _parse_area(raw_area)

    # coords if any
    lat, lon = _extract_coords(entities)

    # If no villages found, try to synthesize a single entry from other fields
    if not villages:
        maybe_v = _pick_first_from(entities, ["village", "village_name", "location", "place"])
        if maybe_v:
            villages = [maybe_v]
        else:
            # no village info at all — produce one generic claim with village None
            villages = [None]

    # Determine patta_holder strategy: if no patta_holders, try owner or use None
    if not patta_holders or patta_holders == [None]:
        ph = _pick_first_from(entities, ["patta_holder", "owner", "owners", "patta"])
        if ph:
            patta_holders = [ph]
        else:
            patta_holders = [None]

    claims: List[Dict[str, Any]] = []
    # produce one claim per village found; pair patta_holders by index when possible
    for i, v in enumerate(villages):
        # choose patta holder by same index if exists, else first, else None
        ph = None
        if i < len(patta_holders):
            ph = patta_holders[i]
        elif len(patta_holders) > 0:
            ph = patta_holders[0]
        else:
            ph = None

        claim = {
            "state": state if state is not None else None,
            "district": district if district is not None else None,
            "block": block if block is not None else None,
            "village": v if v is not None else None,
            "patta_holder": ph if ph is not None else None,
            "address": address if address is not None else None,
            "land_area": parsed_area,
            "status": status if status is not None else "Pending",
            "date": date if date is not None else None,
            "lat": lat,
            "lon": lon,
            "claim_type": entities.get("claim_type"),
            "raw_ner": entities,
        }
        claims.append(claim)

    return claims
