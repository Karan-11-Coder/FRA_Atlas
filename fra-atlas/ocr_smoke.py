from pdf2image import convert_from_path
import pytesseract, os

PDF = r"backend\mock_data\FRA_Baghpur.pdf"   # change if needed
POPPLER = os.getenv("POPPLER_PATH", r"C:\poppler\poppler-25.07.0\Library\bin")

pages = convert_from_path(PDF, poppler_path=POPPLER, dpi=300)
print("Pages:", len(pages))
print("OCR preview:\n", pytesseract.image_to_string(pages[0], lang=os.getenv("TESS_LANG","eng"))[:400])
