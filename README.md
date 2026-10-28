<p align="center">
  <img src="logo/fra_logo.jpeg" width="220" />
</p>

<h1 align="center">FRA Atlas</h1>
<p align="center">
  WebGIS + decision support for Forest Rights Act (FRA, 2006) claims
</p>

---

## What it is

The Forest Rights Act recognises the land and forest rights of tribal and forest-dwelling communities: Individual Forest Rights (IFR), Community Rights (CR) and Community Forest Resource rights (CFR). Claim records are mostly on paper and scattered across departments. FRA Atlas is a Smart India Hackathon prototype that:

1. **Digitises claims.** Upload a scanned claim PDF; OCR (Tesseract/pdfplumber) and NER (spaCy plus rules) pre-fill the fields for an officer to review. Excel/CSV bulk import is also supported.
2. **Maps them.** Claims and villages are shown on an interactive Leaflet map with state and district boundaries.
3. **Supports officers.** Officer login, claim management (create, edit, grant or reject, delete), per-officer dashboards and claim export. Tribal claimants can log in with an OTP.
4. **Scores scheme suitability (DSS).** For a claim, ML models give 0–100 suitability scores for PM-KISAN, MGNREGA, Jal Jeevan Mission, PMFBY, PMKSY and Soil Health Card. **These reproduce rule-derived labels and are not eligibility decisions**; see [Honest limits](#honest-limits).

## Architecture

```
 Browser ──► Next.js 14 frontend (fra-atlas/UI_FRA, :3000)
                │  fetch + JWT bearer
                ▼
            FastAPI backend (fra-atlas/backend, :8000)
             ├─ routes/auth.py, auth_tribal.py   officer JWT login · tribal OTP login
             ├─ routes/claims.py, officers.py    claims CRUD, import, export · officer metrics
             ├─ ocr.py, ner.py                   PDF → text → claim fields
             ├─ routes/diagnostics.py ─► services/ml_inference.py ─► ml/artifacts/model.joblib
             └─ SQLite (SQLAlchemy async + sqlite3)

 ml/ (offline)  labeled_dataset.csv → notebooks 01–05 → model.joblib + feature_schema.json
```

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind, shadcn/Radix, react-leaflet.
- **Backend:** FastAPI, SQLAlchemy/aiosqlite, python-jose (JWT), passlib (bcrypt_sha256), pytesseract, pdfplumber, pdf2image, spaCy, scikit-learn.
- **Data:** SQLite file (a Docker volume, or `fra-atlas/backend/fra_atlas.db` locally). It is never committed.

## Run with Docker (recommended)

Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine with the compose plugin).

```bash
cp .env.example .env
```

Open `.env` and set `JWT_SECRET` to a fresh random value, generated with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Then:

```bash
docker compose up --build
```

- **Frontend:** http://localhost:3000. **Backend:** http://localhost:8000 (API docs at `/docs`).
- **First start** seeds a demo officer (`demo.officer@example.org`), 16 villages and 14 sample claims in the 7 model districts. If `DEMO_OFFICER_PASSWORD` is empty, a random password is generated and **printed once** in the backend log (`docker compose logs backend`). Set it in `.env` if you'd rather choose your own.
- **Data** persists in the `fra_data` and `fra_uploads` volumes. `docker compose down -v` deletes them.
- **Changing ports or hosts:** set `NEXT_PUBLIC_API_BASE` (the backend URL as the browser sees it; it is built into the frontend, so rebuild after changing it) and `CORS_ORIGINS` (the frontend origins the backend accepts) together.

## Run without Docker

Needs Python 3.12 and Node 20+. Windows also needs the Microsoft Visual C++ Redistributable (x64), which spaCy requires. For OCR on scanned PDFs, install Tesseract and Poppler; on Windows, set `POPPLER_PATH` in `fra-atlas/backend/.env`.

**Backend** (from `fra-atlas/`):

```bash
python -m venv venv
venv/Scripts/python -m pip install -r requirements.txt
```

(on macOS/Linux use `venv/bin/python`). Copy `backend/.env.example` to `backend/.env` and set `JWT_SECRET`. Then:

```bash
venv/Scripts/python -m backend.scripts.seed_demo
venv/Scripts/python -m uvicorn backend.main:app --reload --port 8000
```

The backend uses absolute imports (`from backend...`), so run it from `fra-atlas/`, not from inside `backend/`. To create an extra officer:

```bash
venv/Scripts/python backend/scripts/create_officer.py --username you@example.org --password <choose one> --role admin
```

**Frontend** (from `fra-atlas/UI_FRA/`):

```bash
npm install
npm run dev
```

Open http://localhost:3000. Run the backend and frontend in two terminals.

**Tests and checks:**

```bash
venv/Scripts/python -m pip install -r requirements-dev.txt
venv/Scripts/python -m pytest backend/tests
```

That runs the suite (from `fra-atlas/`): auth and OTP, claims, officers, the DSS API, and model agreement with the rules. The tests use a throwaway database and refuse to run against a real one. For the frontend (in `UI_FRA/`), `npm run lint` and `npm run build` must both pass; type and lint errors fail the build.

## Secrets and configuration

**Secrets live in `.env` files only, never in code, images or git.** The `.env` files are gitignored; only the `.env.example` templates are committed.

- `JWT_SECRET` is required, and the backend refuses to start without it. There is no fallback.
- An old JWT secret and old officer password hashes exist in this repository's git **history**, from before they were untracked. Treat them as compromised: always generate a fresh `JWT_SECRET`, and don't reuse old officer passwords.
- Uploaded claim documents can contain personal data. They stay in `uploads/` (or the `fra_uploads` volume), which is gitignored.

## The ML pipeline (DSS)

Everything is in `ml/`; the full details are in [`ml/MODEL_CARD.md`](ml/MODEL_CARD.md) and [`ml/DATA_DICTIONARY.md`](ml/DATA_DICTIONARY.md).

1. **Data:** `fra-atlas/backend/services/` builds `ml/data/labeled_dataset.csv`: 1,540 **synthetic** plots, 220 in each of 7 districts (Chhindwara and Shivpuri in MP; Kandhamal and Koraput in Odisha; Adilabad and Warangal in Telangana; West Tripura), sampled inside real district boundaries.
   - **Soil:** real ISRIC SoilGrids readings, with about 30% imputed by district mean.
   - **Climate:** rainfall and groundwater are one reference value per district.
   - **Labels:** the six scheme scores come from `scheme_rules.py` (rules plus Gaussian noise).
2. **Notebooks** (`ml/notebooks/`, all run clean top to bottom):
   - `01_eda`: findings and a decisions log.
   - `02_regression`: baselines, linear models, tree, SVR and forest, with group-aware CV, bootstrap intervals, an oracle-R² leakage guard, leave-one-district-out, and ablation. It saves the model.
   - `03_classification` and `04_neural_net`: check the regression choices.
   - `05_unsupervised`: clustering, PCA/t-SNE and association rules.
3. **Selection:** the simplest model within 0.02 CV R² of the best, chosen per scheme. Every chosen model is within 5% of the best score achievable on the test plots.
4. **Serving:** `services/ml_inference.py` loads `ml/artifacts/model.joblib`. For a claim it works out the district (point-in-polygon), groundwater and rainfall (reference tables), and soil (the nearest real reading within 5 km, else the district mean). The UI marks those inputs as **estimated**. Claims outside the 7 districts are refused. If the model is missing, the API returns 503, never placeholder numbers.

To rebuild the model:

```bash
python -m venv ml/.venv
ml/.venv/Scripts/python -m pip install -r ml/requirements-ml.txt
```

Then run `ml/notebooks/02_regression.ipynb`. scikit-learn must match between `ml/` and the backend (1.9.1).

## Honest limits

- **The DSS labels are rule-derived.** The models reproduce `scheme_rules.py`; they do not predict real eligibility or real scheme outcomes. No real allocation data has validated them.
- **There are only 7 districts.** The models don't cover any other district, and the API refuses claims outside them.
- **Climate is coarse:** one reference value per district. Only Chhindwara's rainfall is verified against a published source.
- **Soil is mostly imputed in Kandhamal (83%) and Koraput (65%)**, so soil-driven scores there are close to district averages.
- **Claims have no `claim_type` field yet.** The officer picks IFR, CFR or CR in the DSS panel.
- **There is no water-body data**, so distance to water isn't used.
- **Tribal claimants** can log in, but claims aren't linked to them yet.
- **Tribal OTPs** are stored in memory. Without a real MSG91 key they are only printed to the backend log, which is dev mode.
- **SQLite** is fine for a prototype; a production deployment should move to PostgreSQL/PostGIS.

## 5-minute demo walkthrough

1. **Start:** `docker compose up --build`, then read the demo password from `docker compose logs backend` if you didn't set one.
2. **Log in** at http://localhost:3000/login as `demo.officer@example.org`.
3. **Map:** open **Claims Workspace** and pick a state, for example Madhya Pradesh. Markers appear once a state is selected: red "P" for pending, green ✓ for granted.
4. **Claim:** click a marker to see its details. Optionally create a claim with **New FRA Claim**, or upload a scanned claim PDF in **Upload FRA Document** and review the extracted fields.
5. **DSS:** in the marker popup, click **Run diagnostics**, then choose the claim type.
   - Six scheme scores appear, each with a typical error (±) and its top contributing inputs.
   - The amber badge lists the estimated inputs and their sources.
   - Switching IFR to CR shows PM-KISAN drop from about 85 to about 22, because that rule depends on claim type.
6. **How the model was built:** open `ml/notebooks/01_eda.ipynb` (Findings) and `02_regression.ipynb` (comparison table, selection, robustness), then `ml/MODEL_CARD.md`.

## Authors

- [Imroz Kamboj](https://github.com/Imrozdotpi)
- [Karan Chauhan](https://github.com/Karan-11-Coder)
- [Palak Gupta](https://github.com/PalakGupta6006)
- [Mansi Punia](https://github.com/mansi-punia)

## License

This project is licensed under the [MIT](https://choosealicense.com/licenses/mit/) License.
