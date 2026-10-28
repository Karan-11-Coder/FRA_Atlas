# FRA Atlas backend (FastAPI + OCR + DSS model).
# Build context is the REPO ROOT (it needs ml/artifacts and the district
# GeoJSON too); docker-compose.yml sets this up. No secrets are baked in:
# JWT_SECRET etc. come from .env at run time.
FROM python:3.12.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Tesseract + Poppler for scanned-PDF OCR (backend/ocr.py)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY fra-atlas/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY fra-atlas/backend ./backend
COPY fra-atlas/UI_FRA/public/geojson ./geojson
COPY ml/artifacts ./ml/artifacts
COPY ml/data/labeled_dataset.csv ./ml/data/labeled_dataset.csv

ENV DATABASE_URL=sqlite+aiosqlite:////data/fra_atlas.db \
    ML_MODEL_PATH=/app/ml/artifacts/model.joblib \
    ML_SCHEMA_PATH=/app/ml/artifacts/feature_schema.json \
    ML_REFERENCE_DATA=/app/ml/data/labeled_dataset.csv \
    DISTRICT_GEOJSON_DIR=/app/geojson/districts

RUN useradd --create-home --uid 10001 app \
 && mkdir -p /data /app/uploads/temp \
 && chown -R app:app /data /app/uploads
USER app

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=4)"

CMD ["python", "-m", "backend.scripts.docker_start"]
