"""
extraction_eval.py: how well the document-AI pipeline (OCR -> regex + spaCy
NER -> normalisation) recovers claim fields, on the hand-labelled sample PDFs
in backend/mock_data (expected.json).

Two extractors are compared per field:
  pipeline   what the app actually saves (labelled-line regex + normaliser)
  spaCy only what spaCy's pretrained NER alone would give (PERSON -> holder,
             GPE -> place names, DATE -> date), i.e. the ML-only baseline.

Three documents is a regression check, not an accuracy estimate.
"""
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

from backend.ner import extract_entities, nlp
from backend.ocr import extract_text
from backend.utils.normalize_claims import normalize_entities

MOCK_DIR = Path(os.getenv("EXTRACTION_SAMPLES_DIR", Path(__file__).resolve().parents[1] / "mock_data"))
FIELDS = ["village", "district", "state", "patta_holder", "land_area", "status", "claim_type", "ifr_number", "date"]
SPACY_FIELDS = {"village": "GPE", "district": "GPE", "state": "GPE", "patta_holder": "PERSON", "date": "DATE"}

_cache: Dict[str, Any] = {}


def _same(field: str, got: Any, want: Any) -> bool:
    if got is None or want is None:
        return got is want
    if field == "land_area":
        try:
            return abs(float(got) - float(want)) < 0.01
        except (TypeError, ValueError):
            return False
    return " ".join(str(got).split()).lower() == " ".join(str(want).split()).lower()


def _pipeline_fields(text: str) -> Dict[str, Any]:
    ents = extract_entities(text)
    claim = (normalize_entities(ents) or [{}])[0]
    out = {f: claim.get(f) for f in FIELDS if f in claim}
    out["ifr_number"] = ents.get("ifr_number")
    out["date"] = ents.get("dates", [None])[0] if ents.get("dates") else None
    return out


def _spacy_hits(text: str, expected: Dict[str, Any]) -> Dict[str, Optional[bool]]:
    """For fields spaCy can cover: did any entity of the right label equal the expected value?"""
    ents = [(e.label_, e.text) for e in nlp(text).ents]
    hits = {}
    for f in FIELDS:
        label = SPACY_FIELDS.get(f)
        hits[f] = None if label is None else any(lab == label and _same(f, txt, expected[f]) for lab, txt in ents)
    return hits


def evaluate(force: bool = False) -> Dict[str, Any]:
    if _cache.get("result") and not force:
        return _cache["result"]
    expected = json.loads((MOCK_DIR / "expected.json").read_text(encoding="utf-8"))
    docs = []
    for name, want in expected.items():
        if name.startswith("_"):
            continue
        path = MOCK_DIR / name
        t0 = time.perf_counter()
        text = extract_text(str(path))
        t1 = time.perf_counter()
        got = _pipeline_fields(text)
        t2 = time.perf_counter()
        docs.append({
            "document": name,
            "chars": len(text),
            "ocr_ms": round((t1 - t0) * 1000), "ner_ms": round((t2 - t1) * 1000),
            "fields": {f: {"expected": want[f], "pipeline": got.get(f), "pipeline_ok": _same(f, got.get(f), want[f])}
                       for f in FIELDS},
            "spacy_only": _spacy_hits(text, want),
        })
    per_field = {}
    for f in FIELDS:
        pipe = [d["fields"][f]["pipeline_ok"] for d in docs]
        sp = [d["spacy_only"][f] for d in docs if d["spacy_only"][f] is not None]
        per_field[f] = {"pipeline": sum(pipe) / len(pipe),
                        "spacy_only": (sum(sp) / len(sp)) if sp else None}
    result = {
        "documents": docs,
        "per_field": per_field,
        "pipeline_accuracy": sum(d["fields"][f]["pipeline_ok"] for d in docs for f in FIELDS) / (len(docs) * len(FIELDS)),
        "note": f"{len(docs)} hand-labelled synthetic sample documents: a regression check, not an accuracy estimate.",
    }
    _cache["result"] = result
    return result
