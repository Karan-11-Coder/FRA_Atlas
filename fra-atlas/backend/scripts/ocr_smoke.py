# backend/scripts/ocr_smoke.py
"""
Manual OCR smoke test against a real mock claim PDF. Run from anywhere:
    venv/Scripts/python.exe backend/scripts/ocr_smoke.py
"""
from pathlib import Path
import os

from pdf2image import convert_from_path
import pytesseract

# Same convention as backend/ocr.py: no hardcoded personal path, just
# POPPLER_PATH from the environment if set, otherwise fall back to
# whatever's on PATH.
POPPLER = os.getenv("POPPLER_PATH")
TESS_LANG = os.getenv("TESS_LANG", "eng")

# Resolve relative to this file's location, not the caller's cwd.
PDF = Path(__file__).resolve().parents[1] / "mock_data" / "FRA_Baghpur.pdf"

pages = convert_from_path(str(PDF), poppler_path=POPPLER, dpi=300)
print("Pages:", len(pages))
print("OCR preview:\n", pytesseract.image_to_string(pages[0], lang=TESS_LANG)[:400])
