# backend/ocr.py
import os
import pdfplumber
import pytesseract
from pdf2image import convert_from_path
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps


# ---- Config (edit if needed) ----------------------------------------------

# Force pdf2image to use your Poppler binaries (Windows-safe).
# If you set the POPPLER_PATH env var, that value will be used instead.
POPPLER_PATH = os.getenv(
    "POPPLER_PATH",
    r"C:\poppler\poppler-25.07.0\Library\bin"  # <-- update if your path differs
)

# OCR languages (install Tesseract language packs first if you add more)
# Example: "eng+hin" for English + Hindi
TESS_LANG = os.getenv("TESS_LANG", "eng")

# DPI for rasterizing scanned PDFs (higher = sharper OCR but slower & more RAM)
PDF_DPI = int(os.getenv("PDF_DPI", "300"))


# ---- Helpers ---------------------------------------------------------------

def _preprocess_for_ocr(img: Image.Image) -> Image.Image:
    """
    Light preprocessing to help Tesseract on faint/low-contrast scans.
    You can tune/remove this if your scans are already clean.
    """
    try:
        # convert to grayscale, slightly increase contrast, light sharpen
        gray = ImageOps.grayscale(img)
        gray = ImageOps.autocontrast(gray, cutoff=1)
        gray = gray.filter(ImageFilter.UnsharpMask(radius=1.2, percent=150, threshold=3))
        return gray
    except Exception:
        return img


# ---- Main API --------------------------------------------------------------

def extract_text(file_path: str) -> str:
    """
    Extract text from a PDF:
      1) Try pdfplumber (works for text-based PDFs).
      2) If empty, convert pages to images (via Poppler) and OCR with Tesseract.
    Returns a single string (may be "NO_TEXT_EXTRACTED" if nothing found).
    """
    text_content = ""

    # 1) Try extracting with pdfplumber (fast path for selectable PDFs)
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_content += page_text + "\n"
    except Exception as e:
        print(f"[OCR] pdfplumber failed: {e}")

    # 2) Fallback OCR if no text found
    if not text_content.strip():
        try:
            # convert PDF pages to images using Poppler
            images = convert_from_path(
                file_path,
                dpi=PDF_DPI,
                poppler_path=POPPLER_PATH if POPPLER_PATH else None
            )

            for img in images:
                pre = _preprocess_for_ocr(img)
                # NOTE: add `config="--oem 1 --psm 6"` if layout is simple paragraphs
                text_content += pytesseract.image_to_string(pre, lang=TESS_LANG) + "\n"

        except Exception as e:
            print(f"[OCR] Tesseract OCR failed: {e}")

    # 3) Final return
    text_content = (text_content or "").strip()
    return text_content if text_content else "NO_TEXT_EXTRACTED"
