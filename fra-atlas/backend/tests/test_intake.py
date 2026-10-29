"""Document-AI intake: OCR + NER spans, claim-type detection, area units, review -> save."""
import pytest

from backend.ner import detect_claim_type, entity_spans
from backend.utils.normalize_claims import _parse_area

from .conftest import MOCK_DIR


@pytest.mark.parametrize("text, expected", [
    ("Claim Type: CFR\nVillage: X", "CFR"),
    ("Type of right: Community Rights", "CR"),
    ("This is an Individual Forest Rights application", "IFR"),
    ("Community Forest Resource rights over the grazing land", "CFR"),
    ("No rights mentioned here", None),
])
def test_detect_claim_type(text, expected):
    assert detect_claim_type(text) == expected


@pytest.mark.parametrize("raw, ha", [("8 acres", 3.2375), ("1.2 ha", 1.2), ("1200 sq.m", 0.12), ("2.5 Hectares", 2.5),
                                     ("3 bigha", None), ("4", 4.0)])
def test_area_units_become_hectares(raw, ha):
    assert _parse_area(raw) == ha


def test_entity_spans_point_at_the_text():
    text = "Village: Rampur\nDistrict: Sehore\nState: Madhya Pradesh\nPatta Holder: Ram Singh\n"
    spans = entity_spans(text)
    regex = {s["field"]: s for s in spans if s["source"] == "regex"}
    assert regex["village"]["text"] == "Rampur" and text[regex["village"]["start"]:regex["village"]["end"]] == "Rampur"
    assert regex["patta_holder"]["text"] == "Ram Singh"
    assert any(s["source"] == "spacy" for s in spans)


def test_parse_review_commit_saves_the_reviewed_fields(client):
    with open(MOCK_DIR / "FRA_Baghpur.pdf", "rb") as fh:
        parsed = client.post("/api/claims/parse-fra", files={"file": ("FRA_Baghpur.pdf", fh, "application/pdf")}).json()
    assert parsed["text_found"] and parsed["fields"]["village"] == "Baghpur"
    assert parsed["fields"]["claim_type"] == "IFR" and abs(parsed["fields"]["land_area"] - 3.2375) < 1e-3
    assert parsed["spans"] and {"ocr", "ner"} <= set(parsed["timing_ms"])

    reviewed = {**parsed["fields"], "patta_holder": "Sita Devi (corrected)", "land_area": 3.0}
    saved = client.post("/api/claims/commit-parsed", json={"tmp_filename": parsed["filename"], "fields": reviewed})
    assert saved.status_code == 200, saved.text
    claim = saved.json()["claim"]
    assert claim["patta_holder"] == "Sita Devi (corrected)" and claim["land_area"] == 3.0 and claim["source"] == "ocr"
    # temp file is gone after commit
    again = client.post("/api/claims/commit-parsed", json={"tmp_filename": parsed["filename"], "fields": reviewed})
    assert again.status_code == 404


def test_parse_rejects_non_pdf_and_traversal(client):
    assert client.post("/api/claims/parse-fra", files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 400
    r = client.post("/api/claims/commit-parsed", json={"tmp_filename": "../../main.py", "fields": {}})
    assert r.status_code in (400, 404)


def test_extraction_quality_on_sample_documents(client):
    q = client.get("/api/lab/extraction-quality").json()
    assert len(q["documents"]) == 3
    assert q["pipeline_accuracy"] == 1.0, q["per_field"]
    assert q["per_field"]["patta_holder"]["spacy_only"] is not None
