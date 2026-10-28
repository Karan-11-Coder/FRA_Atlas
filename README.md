<p align="center">
  <img src="logo/fra_logo.jpeg" width="220" />
</p>

<h1 align="center">FRA Atlas</h1>
<p align="center">
  AI-Powered Geospatial Governance Platform
</p>

---

##   About
FRA Atlas is an AI-powered geospatial governance platform designed to digitize, verify, and monitor Forest Rights Act (FRA) claims across India. The current FRA implementation relies heavily on paper-based records, manual verification, and fragmented databases, which leads to delays, lack of transparency, and exclusion of eligible beneficiaries from welfare schemes.

The platform integrates automated document processing, satellite-based mapping, and decision-support analytics to create a unified digital atlas of forest land claims. By combining OCR and NLP for extracting data from legacy claim forms, GIS layers for boundary validation, and rule-based intelligence for scheme eligibility mapping, FRA Atlas enables faster, more reliable, and more transparent claim verification.

FRA Atlas is built to support government officers, district administrators, Gram Sabhas, and policy planners by providing real-time visibility into claim status, land distribution, and beneficiary coverage. The system aims to strengthen governance, reduce disputes, and ensure that forest-dependent and tribal communities receive secure land rights and timely access to development schemes.


## Problem Statement
The Forest Rights Act (FRA), 2006 grants land and forest rights to tribal and forest-dwelling communities, yet its implementation remains constrained by fragmented, paper-based records and limited use of digital verification tools. Legacy data related to Individual Forest Rights (IFR), Community Rights (CR), and Community Forest Resource (CFR) claims is scattered across departments, often non-digitized, and difficult to validate spatially. There is no centralized, real-time geospatial repository to visualize FRA claims, granted titles, and village-level assets together on a single platform.

Additionally, current systems do not integrate satellite-based land-use and asset mapping with FRA data, making it difficult to assess agricultural potential, water resources, forest cover, and infrastructure needs in FRA villages. As a result, policymakers and field officers lack data-driven tools to link eligible FRA beneficiaries with relevant Central Sector Schemes (CSS) such as PM-KISAN, MGNREGA, and Jal Jeevan Mission. The absence of an integrated Decision Support System (DSS) limits targeted planning, slows service delivery, and reduces the overall socio-economic impact of FRA implementation.
## Features

- Automated Claim Digitization (OCR + NLP)
- Geospatial Boundary Validation
- Interactive WebGIS Atlas
- Rule-Based Decision Support System (DSS) — see note below on current data sources
- Officer Dashboard & Analytics
- Search, Filter & Status Tracking
- Export & Reporting Tools
- Scalable & Government Ready Architecture




## System Architecture
FRA Atlas follows a modular, service oriented architecture that integrates document intelligence, geospatial processing, and decision support analytics into a unified digital governance platform. Users such as Gram Sabha members and district officers interact with the system through a web based frontend built using React and Leaflet, where claim forms, sketches, or GeoJSON files can be uploaded and visualized on an interactive map interface. These inputs are sent to a FastAPI based backend that orchestrates all processing workflows through secure REST APIs.

Uploaded documents are first processed by an OCR and NLP pipeline that extracts structured claim information such as claimant identity, land category, and ownership type from scanned forms and handwritten documents. In parallel, geospatial data is validated and converted into standardized GeoJSON layers using GIS processing modules powered by GeoPandas and Shapely, with reference to satellite imagery and boundary datasets from sources such as OpenStreetMap and Sentinel. Both textual and spatial data are then stored in a centralized spatially enabled database, currently implemented using SQLite for prototyping and designed to scale to PostgreSQL with PostGIS for production deployments.

Once claims are verified and structured, they are passed to a rule-based Decision Support System (DSS) that evaluates eligibility conditions and maps beneficiaries to relevant government welfare schemes such as PM-KISAN, MGNREGA, and Jal Jeevan Mission. The backend continuously aggregates claim status, processing timelines, and scheme coverage metrics, which are exposed to the frontend through analytics APIs. Officers can monitor progress through administrative dashboards, perform searches and filters, and export verified datasets in CSV or GeoJSON formats for audits and inter-departmental coordination. This layered architecture enables independent scaling of AI services, geospatial validation, and policy engines, making the platform suitable for phased rollout from pilot districts to nationwide deployments.
## Intelligent Processing Pipeline
The system automates the transformation of unstructured and spatial data into actionable intelligence through a multi-stage processing pipeline. Scanned FRA claim forms and supporting documents are first processed using OCR to extract raw text, followed by NLP-based entity recognition to identify key fields such as claimant details, village names, land categories, and claim status. In parallel, uploaded sketches, shapefiles, and satellite-derived datasets are converted into standardized GeoJSON formats. These textual and spatial datasets are then validated, structured, and stored in a centralized database, enabling consistent downstream analytics, visualization, and decision-making workflows.
## Decision Support System
The Decision Support System (DSS) is a policy intelligence layer intended to evaluate verified FRA claims against eligibility rules and development indicators, scoring suitability for Central Sector Schemes such as PM-KISAN, MGNREGA, and Jal Jeevan Mission.

**Current status:** `POST /api/diagnostics` (`backend/routes/diagnostics.py`, `backend/services/ml_inference.py`) scores a claim for six schemes with the models trained in `ml/notebooks/02_regression.ipynb` (`ml/artifacts/model.joblib`; see `ml/MODEL_CARD.md`). A claim supplies its coordinates, land area and claim type. Its district comes from point-in-polygon, groundwater and rainfall from the district reference tables, and soil from the nearest real SoilGrids reading in the training data (else the district mean). All of those are shown in the UI as estimated inputs. Claims outside the 7 training districts are refused, and if the model file is missing the endpoint returns 503 rather than made-up numbers.

**These are rule-derived suitability scores, not eligibility decisions.** The models were trained on labels generated by `backend/services/scheme_rules.py` (rules plus noise), on synthetic plots. No real allocation or outcome data has validated them.
## Geospatial Intelligence
FRA Atlas integrates multiple geospatial data sources to provide accurate spatial validation and asset-level visibility for FRA villages. Satellite imagery, village boundaries, forest compartments, and land-use layers are processed using GIS tools to validate claim boundaries and detect assets such as agricultural plots, water bodies, forest cover, and habitation clusters. These layers are dynamically visualized through a WebGIS interface, allowing officials to assess environmental conditions, infrastructure availability, and resource distribution alongside FRA ownership data. This spatial intelligence supports planning for sustainable livelihoods and conservation-aligned development.
## Dashboard & Analytics
The platform provides role-based dashboards for administrators and field officers to monitor operational and policy-level metrics. Key indicators include claim processing status, approval timelines, geographic distribution of beneficiaries, and scheme coverage across districts and villages. Interactive charts, filters, and map-based views enable rapid identification of underserved areas and procedural delays. Built-in reporting and export features allow data to be shared across departments, supporting audits, progress tracking, and inter-ministerial coordination.
## Tech Stack

**Client:** `UI_FRA/` — Next.js 14 + TypeScript + Radix UI/shadcn, Leaflet.js, Tailwind CSS. This is the single UI; an earlier parallel Vite/React app (`frontend/`) has been retired and its map/upload/claims-management functionality ported in under `/dashboard/workspace`.

**Server:** FastAPI, REST APIs

**Document Processing:** pytesseract (Tesseract OCR) + pdfplumber + pdf2image for extraction, spaCy for NLP entity recognition

**Database:** SQLite, SQLAlchemy

**GIS:** GeoJSON, GeoPandas, Shapely, OpenStreetMap


## Installation & Setup
## 1) Clone the repository:
git clone https://github.com/Karan-11-Coder/FRA_Atlas.git


cd FRA_Atlas/fra-atlas

## 2) Backend setup:
cd backend

python -m venv venv

venv\Scripts\activate   (macOS/Linux: source venv/bin/activate)

pip install -r requirements.txt

cp .env.example .env    (macOS/Linux) or copy .env.example .env (Windows), then fill in real values — JWT_SECRET especially, see below

cd ..

`backend/main.py` uses absolute imports (`from backend...`), so it must be run as a module from the `fra-atlas/` directory — not from inside `backend/`:

uvicorn backend.main:app --reload --port 8000

(or `bash backend/scripts/run-backend.sh` from `fra-atlas/`, which does the same thing — this used to be a root-level `npm run backend` wrapping a Node script, but it never did anything Node-specific, so it's a plain shell script now and there's no root-level `package.json` anymore)

Backend: http://127.0.0.1:8000

API Docs: http://127.0.0.1:8000/docs

**Generate a JWT_SECRET** rather than reusing any value that may have been committed previously:
`python -c "import secrets; print(secrets.token_hex(32))"`

## 3) Frontend setup:
cd UI_FRA
npm install
npm run dev

Frontend: http://localhost:3000 — log in at `/login`, land on `/dashboard` (analytics) or `/dashboard/workspace` (map + claims management: upload, OCR review, Excel import, claim CRUD, diagnostics).

Run the backend and frontend in two terminals (`bash backend/scripts/run-backend.sh` in one, `npm run dev` inside `UI_FRA/` in the other) — there's no combined root-level launcher anymore.

## 4) Database:
SQLite, no setup needed for local dev. The bundled `backend/fra_atlas.db` is no longer committed to git (see `.gitignore`) — if you're starting fresh, the backend creates the required tables automatically on first run.





## Authors

- [@Imroz Kamboj](https://github.com/Imrozdotpi)
- [@Karan Chauhan](https://github.com/Karan-11-Coder)
- [@Palak Gupta](https://github.com/PalakGupta6006)
- [@Mansi Punia](https://github.com/mansi-punia)


## License
This project is licensed under the [MIT](https://choosealicense.com/licenses/mit/) License.


