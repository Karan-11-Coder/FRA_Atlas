<p align="center">
  <img src="logo/fra_logo.jpeg" width="220" />
</p>

<h1 align="center">FRA Atlas</h1>
<p align="center">
  An interactive ML lab for Forest Rights Act (FRA, 2006) claims
</p>

---

## What it is

The Forest Rights Act recognises the land and forest rights of tribal and forest-dwelling communities. Rights come as Individual Forest Rights (IFR), Community Rights (CR) and Community Forest Resource rights (CFR). Claim records are mostly paper forms.

FRA Atlas is a dashboard with three parts:

1. **Document AI.** Upload a claim PDF. OCR (pdfplumber / Tesseract) reads it, labelled-field rules and **spaCy NER** extract the fields, and you review and save the claim. The extracted entities are highlighted in the text, and an extraction-quality view compares the full pipeline with spaCy alone.
2. **Scheme-suitability models.** Six model families score every plot or claim for six central schemes: PM-KISAN, MGNREGA, Jal Jeevan Mission, PMFBY, PMKSY and Soil Health Card. They are simple linear, multiple linear, decision tree, SVR, random forest and MLP.
3. **A lab to see how the models differ.** Change inputs and watch every model react, compare leaderboards against the best achievable score, inspect explanations, move decision thresholds, explore clusters, and edit the scoring rules' cutoffs.

> **Honesty first:** the models reproduce **rule-derived** labels (`fra-atlas/backend/services/scheme_rules.py` plus noise) on **synthetic** plots in 7 districts. A score is "what the rule would say for these inputs", **not an eligibility decision**, and nothing has been validated against real scheme outcomes. The dashboard says so on every page.

## The dashboard

| Page | What you can do |
|---|---|
| **Atlas** | Map of the 7 districts shaded by any scheme's score, with stored claims as dots. Shows the district ranking, a district card (climate, soil, imputed share, model vs rule vs label) and the district × scheme grid |
| **Playground** | Sliders for every input, district presets or click a map point. Shows **all six models' scores live next to the noiseless rule**, plus a sweep chart showing how each model bends as one input moves (the tree draws the rule's steps, SVR and MLP smooth them into ramps, linear models can only tilt). Open any stored claim here |
| **Model arena** | A per-scheme leaderboard with train / CV / test R², bootstrap intervals, % of the test **oracle**, **new-district** (leave-one-district-out) R², gap to the rule and baselines. Also tree-depth bias–variance curves, predicted-vs-actual plots and error by district and by imputed soil |
| **Explainability** | Permutation importance for every model with the rule's true inputs outlined, partial-dependence curves against the rule's own curve, and the lat/lon ablation |
| **Classification** | PMKSY terciles with six classifiers: confusion matrices, ROC curves, a **live decision-threshold slider** (precision / recall / F1) and the PM-KISAN sanity check |
| **Data & structure** | Dataset explorer, distributions, correlations, t-SNE / PCA maps with k-means (k slider, silhouette, ARI), and mined association rules |
| **Scoring rules** | Each scheme's formula and inputs, anchor vs constructed constants, and **live cutoff what-ifs** (move the pH or organic-carbon bands and see how many plots change) |
| **Claims & documents** | PDF intake (OCR → highlighted entities → review → save → score), spreadsheet import, a claims table (edit, delete, CSV export) and extraction quality |

## Architecture

```
 Browser ──► Next.js 14 dashboard (fra-atlas/UI_FRA, :3000)
                │  fetch (no auth)
                ▼
            FastAPI (fra-atlas/backend, :8000)
             ├─ routes/lab.py          precomputed views · live predict / sweep / resolve · rule cutoffs · extraction quality
             ├─ routes/diagnostics.py  DSS scores for a stored claim (chosen models)
             ├─ routes/claims.py       claims CRUD, import/export, PDF intake (ocr.py + ner.py)
             ├─ services/ml_inference.py ─► ml/artifacts/{model,all_models}.joblib
             └─ SQLite (claims, villages)

 ml/ (offline)  labeled_dataset.csv → notebooks 01–05 → model.joblib → export_dashboard.py → all_models.joblib + dashboard/*.json
```

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind, Recharts, react-leaflet.
- **Backend:** FastAPI, SQLAlchemy/aiosqlite, scikit-learn 1.9.1, spaCy (`en_core_web_sm`), pytesseract, pdfplumber, pdf2image.
- **No authentication, by design.** Anyone who can reach the ports can read and edit claims. Run it on your own machine or a trusted network. The officer/login version of the app is preserved at git tag `v1-officer-app`.

## Run with Docker (recommended)

Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/), or Docker Engine with the compose plugin.

```bash
docker compose up --build
```

Then open:
- **Dashboard:** http://localhost:3000
- **API docs:** http://localhost:8000/docs

The first start seeds 16 reference villages and 14 clearly-synthetic demo claims, labelled "Demo Claimant NN". Data persists in the `fra_data` and `fra_uploads` volumes; `docker compose down -v` deletes them. To change settings (seeding, geocoding, ports or hosts, OCR language), copy `.env.example` to `.env`. It's optional.

## Run without Docker

Needs Python 3.12 and Node 20+.
- **Windows:** also install the Microsoft Visual C++ Redistributable (x64), which spaCy needs.
- **Scanned PDFs:** install Tesseract and Poppler. On Windows, set `POPPLER_PATH` in `fra-atlas/backend/.env`.

**Backend** (run from `fra-atlas/`):

```bash
python -m venv venv
venv/Scripts/python -m pip install -r requirements.txt
venv/Scripts/python -m backend.scripts.seed_demo
venv/Scripts/python -m uvicorn backend.main:app --reload --port 8000
```

On macOS/Linux use `venv/bin/python`. Run it from `fra-atlas/` (imports are `backend.…`).

**Dashboard** (run from `fra-atlas/UI_FRA/`):

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

**Checks:**

```bash
venv/Scripts/python -m pip install -r requirements-dev.txt
venv/Scripts/python -m pytest backend/tests
```

From `fra-atlas/`, that runs 57 tests covering claims, intake and NER, the lab API, export-vs-notebook consistency and the DSS. In `UI_FRA/`, `npm run lint` and `npm run build` must both pass; type and lint errors fail the build.

## The ML pipeline

Everything lives in `ml/`. See [`ml/MODEL_CARD.md`](ml/MODEL_CARD.md) and [`ml/DATA_DICTIONARY.md`](ml/DATA_DICTIONARY.md).

1. **Data.** 1,540 **synthetic** plots, 220 in each of 7 districts: Chhindwara and Shivpuri (MP), Kandhamal and Koraput (Odisha), Adilabad and Warangal (Telangana), and West Tripura.
   - Soil comes from ISRIC SoilGrids; about 30% of readings are imputed with district means.
   - Climate is one reference value per district.
   - The six labels come from `scheme_rules.py` (rules plus Gaussian noise).
2. **Notebooks** (`ml/notebooks/`, all run clean top to bottom):
   - `01_eda`: findings and a decisions log.
   - `02_regression`: baselines plus the five classical models, group-aware CV, an oracle-R² leakage guard, leave-one-district-out and an ablation. It picks the simplest model within 0.02 CV R² of the best.
   - `03_classification` and `04_neural_net`.
   - `05_unsupervised`: clustering, PCA / t-SNE and association rules.
3. **Dashboard export.** `ml/export_dashboard.py` refits every model with the tuned parameters (≈3 min) and writes `all_models.joblib` plus `ml/artifacts/dashboard/*.json`. A backend test checks that the export reproduces the notebooks' numbers.

To rebuild the models:

```bash
python -m venv ml/.venv
ml/.venv/Scripts/python -m pip install -r ml/requirements-ml.txt
```

Then run notebook `02_regression`, and after it:

```bash
ml/.venv/Scripts/python ml/export_dashboard.py
```

scikit-learn must be the same version (1.9.1) in `ml/` and in the backend.

## Honest limits

- **The labels are rule-derived.** Accuracy means "recovers `scheme_rules.py`". No real allocation or outcome data exists here.
- **7 districts.** The models refuse locations outside them, and leave-one-district-out shows that several models don't transfer. Climate inputs are one reference value per district (only Chhindwara's rainfall is verified against a published source).
- **Imputed soil.** Soil is mostly imputed in Kandhamal (83%) and Koraput (65%).
- **Constructed organic-carbon bands.** The cutoffs (1.5% / 2.0%) come from this data's thirds, not an official standard; the Scoring rules page shows how much they matter.
- **Document AI is evaluated on 3 hand-labelled synthetic forms only.** That's a regression check, not an accuracy estimate. spaCy's pretrained English model is generic and sometimes tags field labels as names.
- **Claims are not linked to claimants**, and there's no water-body data.

## 5-minute demo

1. **Start the app:** `docker compose up --build`, then open http://localhost:3000.
2. **Atlas:** switch schemes, and watch JJM and PMKSY favour the dry districts while PMFBY favours the wet ones. Click a claim dot and choose **Score with every model**.
3. **Playground:** pick **Soil Health Card** and sweep **Soil organic carbon**. The rule is a staircase. The tree reproduces it, the line can't, and SVR and MLP blur it. Switch claim type to CR and watch PM-KISAN fall from about 85 to about 22.
4. **Model arena:** for MGNREGA, every model is near the oracle in-district, but the MLP's new-district R² collapses (shown in red).
5. **Claims & documents:** upload `fra-atlas/backend/mock_data/FRA_Telangana.pdf`. You'll see the highlighted OCR text (rules vs spaCy), the area converted from 12 acres to 4.86 ha, and IFR detected. Save it, then score it. It falls just outside the Warangal boundary the models use, so the Playground says so and uses Warangal's averages.
6. **Scoring rules:** move the organic-carbon "low" cutoff from 1.5 to 1.75, and about 15% of soil-health scores change.

## Authors

- [Imroz Kamboj](https://github.com/Imrozdotpi)
- [Karan Chauhan](https://github.com/Karan-11-Coder)
- [Palak Gupta](https://github.com/PalakGupta6006)
- [Mansi Punia](https://github.com/mansi-punia)

## License

This project is licensed under the [MIT](https://choosealicense.com/licenses/mit/) License.
