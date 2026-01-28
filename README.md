
##   About
FRA Atlas is an AI-powered geospatial governance platform designed to digitize, verify, and monitor Forest Rights Act (FRA) claims across India. The current FRA implementation relies heavily on paper-based records, manual verification, and fragmented databases, which leads to delays, lack of transparency, and exclusion of eligible beneficiaries from welfare schemes.

The platform integrates automated document processing, satellite-based mapping, and decision-support analytics to create a unified digital atlas of forest land claims. By combining OCR and NLP for extracting data from legacy claim forms, GIS layers for boundary validation, and rule-based intelligence for scheme eligibility mapping, FRA Atlas enables faster, more reliable, and more transparent claim verification.

FRA Atlas is built to support government officers, district administrators, Gram Sabhas, and policy planners by providing real-time visibility into claim status, land distribution, and beneficiary coverage. The system aims to strengthen governance, reduce disputes, and ensure that forest-dependent and tribal communities receive secure land rights and timely access to development schemes.


## Problem Statement
The Forest Rights Act (FRA), 2006 grants land and forest rights to tribal and forest-dwelling communities, yet its implementation remains constrained by fragmented, paper-based records and limited use of digital verification tools. Legacy data related to Individual Forest Rights (IFR), Community Rights (CR), and Community Forest Resource (CFR) claims is scattered across departments, often non-digitized, and difficult to validate spatially. There is no centralized, real-time geospatial repository to visualize FRA claims, granted titles, and village-level assets together on a single platform.

Additionally, current systems do not integrate satellite-based land-use and asset mapping with FRA data, making it difficult to assess agricultural potential, water resources, forest cover, and infrastructure needs in FRA villages. As a result, policymakers and field officers lack data-driven tools to link eligible FRA beneficiaries with relevant Central Sector Schemes (CSS) such as PM-KISAN, MGNREGA, and Jal Jeevan Mission. The absence of an integrated Decision Support System (DSS) limits targeted planning, slows service delivery, and reduces the overall socio-economic impact of FRA implementation.
## Features

- Automated Claim Digitization
- Geospatial Boundary Validation
- Interactive WebGIS Atlas
- Rule Based Decision Support System (DSS)
- Officer Dashboard & Analytics
- Search, Filter & Status Tracking
- Tamper Resistant Digital Records
- Export & Reporting Tools
- Scalable & Government Ready Architecture




## System Architecture
FRA Atlas follows a modular, service oriented architecture that integrates document intelligence, geospatial processing, and decision support analytics into a unified digital governance platform. Users such as Gram Sabha members and district officers interact with the system through a web based frontend built using React and Leaflet, where claim forms, sketches, or GeoJSON files can be uploaded and visualized on an interactive map interface. These inputs are sent to a FastAPI based backend that orchestrates all processing workflows through secure REST APIs.

Uploaded documents are first processed by an OCR and NLP pipeline that extracts structured claim information such as claimant identity, land category, and ownership type from scanned forms and handwritten documents. In parallel, geospatial data is validated and converted into standardized GeoJSON layers using GIS processing modules powered by GeoPandas and Shapely, with reference to satellite imagery and boundary datasets from sources such as OpenStreetMap and Sentinel. Both textual and spatial data are then stored in a centralized spatially enabled database, currently implemented using SQLite for prototyping and designed to scale to PostgreSQL with PostGIS for production deployments.

Once claims are verified and structured, they are passed to a rule-based Decision Support System (DSS) that evaluates eligibility conditions and maps beneficiaries to relevant government welfare schemes such as PM-KISAN, MGNREGA, and Jal Jeevan Mission. The backend continuously aggregates claim status, processing timelines, and scheme coverage metrics, which are exposed to the frontend through analytics APIs. Officers can monitor progress through administrative dashboards, perform searches and filters, and export verified datasets in CSV or GeoJSON formats for audits and inter-departmental coordination. This layered architecture enables independent scaling of AI services, geospatial validation, and policy engines, making the platform suitable for phased rollout from pilot districts to nationwide deployments.
## Intelligent Processing Pipeline
The system automates the transformation of unstructured and spatial data into actionable intelligence through a multi-stage processing pipeline. Scanned FRA claim forms and supporting documents are first processed using OCR to extract raw text, followed by NLP-based entity recognition to identify key fields such as claimant details, village names, land categories, and claim status. In parallel, uploaded sketches, shapefiles, and satellite-derived datasets are converted into standardized GeoJSON formats. These textual and spatial datasets are then validated, structured, and stored in a centralized database, enabling consistent downstream analytics, visualization, and decision-making workflows.
## Decision Support System
The Decision Support System (DSS) acts as a policy intelligence layer that evaluates verified FRA claims against predefined eligibility rules and development indicators. Using rule-based logic combined with contextual geospatial data, the DSS identifies suitable Central Sector Schemes such as PM-KISAN, MGNREGA, Jal Jeevan Mission, and other convergence programs. It prioritizes interventions based on parameters such as land type, water availability, forest dependency, and infrastructure access, enabling targeted and evidence-based welfare delivery. The DSS is designed to support future integration of predictive models for early identification of development gaps and policy bottlenecks.
## Geospatial Intelligence
FRA Atlas integrates multiple geospatial data sources to provide accurate spatial validation and asset-level visibility for FRA villages. Satellite imagery, village boundaries, forest compartments, and land-use layers are processed using GIS tools to validate claim boundaries and detect assets such as agricultural plots, water bodies, forest cover, and habitation clusters. These layers are dynamically visualized through a WebGIS interface, allowing officials to assess environmental conditions, infrastructure availability, and resource distribution alongside FRA ownership data. This spatial intelligence supports planning for sustainable livelihoods and conservation-aligned development.
## Dashboard & Analytics
The platform provides role-based dashboards for administrators and field officers to monitor operational and policy-level metrics. Key indicators include claim processing status, approval timelines, geographic distribution of beneficiaries, and scheme coverage across districts and villages. Interactive charts, filters, and map-based views enable rapid identification of underserved areas and procedural delays. Built-in reporting and export features allow data to be shared across departments, supporting audits, progress tracking, and inter-ministerial coordination.
## Tech Stack

**Client:** Next.js, Leaflet.js, Tailwind CSS, Recharts

**Server:** FastAPI, REST APIs

**AI / Decision Support Systems:** Tesseract OCR, EasyOCR, OpenCV, spaCy

**Database:** SQLite, SQLAlchemy

**GIS:** GeoJSON, GeoPandas, Shapely, OpenStreetMap


## Installation & Setup
## 1) Clone the repository:
git clone https://github.com/Karan-11-Coder/FRA_Atlas.git

cd FRA_Atlas


## 2) Frontend setup:
cd fra-atlas/frontend

npm install

npm run dev

Frontend: http://localhost:5173

## 3) Backend setup:
cd ../backend

python -m venv venv


venv\Scripts\activate

pip install -r requirements.txt

uvicorn main:app --reload

Backend: http://127.0.0.1:8000

API Docs: http://127.0.0.1:8000/docs

## 4) Database:
SQLite is used by default, no setup needed





## Authors

- [@Imroz Kamboj](https://github.com/Imrozdotpi)
- [@Karan Chauhan](https://github.com/Karan-11-Coder)
- [@Ishatv Mago](https://github.com/Ishatvmago)
- [@Palak Gupta](https://github.com/PalakGupta6006)
- [@Mansi Punia](https://github.com/mansi-punia)


## License
This project is licensed under the [MIT](https://choosealicense.com/licenses/mit/) License.


