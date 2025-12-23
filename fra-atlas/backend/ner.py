# backend/ner.py
import re
import spacy

# Load SpaCy model once (already in your requirements)
nlp = spacy.load("en_core_web_sm")

# -------- Line-anchored regexes (stop at end-of-line) --------
P_STATE    = re.compile(r'(?im)^\s*state\s*[:\-]\s*([^\r\n]+)')
P_DISTRICT = re.compile(r'(?im)^\s*district\s*[:\-]\s*([^\r\n]+)')
P_VILLAGE  = re.compile(r'(?im)^\s*(?:village|vill\.)\s*[:\-]\s*([^\r\n]+)')
P_PATTA    = re.compile(r'(?im)^\s*(?:patta\s*holder|claimant|name)\s*[:\-]\s*([^\r\n]+)')

# IFR number variants: IFR-123, IFR No. 123, Claim ID 123, etc.
P_IFR      = re.compile(r'(?im)\b(?:ifr(?:\s*(?:no\.?|number))?|claim\s*id)\s*[:\-]?\s*([A-Za-z0-9\-\/]+)')

# Area lines: "Area: 10 acres", "Land Area: 1.25 ha", etc.
P_AREA     = re.compile(r'(?im)\b(?:area|land\s*area)\s*[:\-]\s*([^\r\n]+)')

# Status lines: "Claim Status: Approved", "Status: Pending", etc.
P_STATUS   = re.compile(r'(?im)\b(?:claim\s*status|status)\s*[:\-]\s*([^\r\n]+)')

# Date lines: match common formats or explicit labels "submitted on", "verified on"
P_DATE_LBL = re.compile(r'(?im)\b(?:date|submitted\s*on|verified\s*on)\s*[:\-]\s*([^\r\n]+)')
# Free-form date tokens in text (e.g., 01-Jan-2020, 1/1/2020, 15 Mar 2021)
P_DATE_FREE = re.compile(
    r'(?i)\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}[\/\-][A-Za-z]{3,9}[\/\-]\d{2,4}|'
    r'\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b'
)

# Optional: decimal coordinate pairs like "23.1984, 77.0951"
P_COORDS = re.compile(r'(?i)\b(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})\b')

# If labels leaked to next line, trim trailing label words
TRAILING_LABELS = re.compile(r'\s*(?:state|district|village|patta\s*holder)\s*$', re.I)


def _dedupe(seq):
    """Dedupe while preserving order and dropping falsy values."""
    seen = set()
    out = []
    for x in seq:
        if not x:
            continue
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _clean_val(s: str | None) -> str | None:
    if not s:
        return None
    s = s.strip()
    s = TRAILING_LABELS.sub('', s)
    # collapse internal whitespace/newlines
    s = ' '.join(s.split())
    return s


def _title_or_keep(s: str | None) -> str | None:
    if not s:
        return None
    # Avoid title-casing things that look like codes (e.g., IFR-123/2020)
    if re.search(r'[0-9\-\/]', s):
        return s
    return s.title()


def extract_entities(text: str):
    """
    Extract entities from OCR text using spaCy + robust regex.
    Returns a dict aligned with the Claim schema.
    """
    # ---------- spaCy pass ----------
    doc = nlp(text or "")
    villages_spacy = []
    names_spacy = []
    dates_spacy = []
    for ent in doc.ents:
        if ent.label_ == "GPE":
            villages_spacy.append(_clean_val(ent.text))
        elif ent.label_ == "PERSON":
            names_spacy.append(_clean_val(ent.text))
        elif ent.label_ == "DATE":
            dates_spacy.append(_clean_val(ent.text))

    # ---------- Regex pass (line-anchored) ----------
    state       = _clean_val((P_STATE.search(text) or (None,))[1] if P_STATE.search(text) else None)
    district    = _clean_val((P_DISTRICT.search(text) or (None,))[1] if P_DISTRICT.search(text) else None)
    villages_rx = [ _clean_val(m.group(1)) for m in P_VILLAGE.finditer(text) ]
    patta_lbl   = _clean_val((P_PATTA.search(text) or (None,))[1] if P_PATTA.search(text) else None)

    ifr         = _clean_val((P_IFR.search(text) or (None,))[1] if P_IFR.search(text) else None)
    area        = _clean_val((P_AREA.search(text) or (None,))[1] if P_AREA.search(text) else None)
    status      = _clean_val((P_STATUS.search(text) or (None,))[1] if P_STATUS.search(text) else None)

    # Dates: prefer labeled ones, then pick free-form tokens as fallback
    date_lbl    = _clean_val((P_DATE_LBL.search(text) or (None,))[1] if P_DATE_LBL.search(text) else None)
    dates_free  = [ _clean_val(m.group(0)) for m in P_DATE_FREE.finditer(text) ]

    # Optional coords
    coords = []
    for m in P_COORDS.finditer(text):
        try:
            lat = float(m.group(1))
            lon = float(m.group(2))
            coords.append((lat, lon))
        except Exception:
            pass

    # ---------- Merge & normalize ----------
    villages_all = _dedupe(villages_rx + villages_spacy)
    villages_all = [_title_or_keep(v) for v in villages_all]

    names_all = _dedupe([patta_lbl] + names_spacy)

    dates_all = _dedupe(([date_lbl] if date_lbl else []) + dates_spacy + dates_free)

    out = {
        "state": _title_or_keep(state),
        "district": _title_or_keep(district),
        "villages": villages_all,
        "patta_holders": names_all,
        "dates": dates_all,
        "ifr_number": ifr,
        "land_area": area,
        "status": _title_or_keep(status),
        # keep raw lists (useful for debugging/UIs)
        "raw_entities": {
            "villages": villages_spacy + villages_rx,
            "patta_holders": names_spacy + ([patta_lbl] if patta_lbl else []),
            "dates": dates_spacy + dates_free + ([date_lbl] if date_lbl else []),
            "coords": coords,
        },
    }

    # If coordinates were found, you could optionally choose the first one here
    # and attach it as numeric lat/lon for convenience:
    if coords:
        out["lat"], out["lon"] = coords[0]

    return out
