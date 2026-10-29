# Model card: FRA Atlas scheme-suitability models

**Artifact:** `ml/artifacts/model.joblib` (one joblib object: a dict with one fitted scikit-learn `Pipeline` per target, plus metadata). Input contract: `ml/artifacts/feature_schema.json`.
**Built by:** `ml/notebooks/02_regression.ipynb` (seed 42). Checked against an MLP in `04_neural_net.ipynb`.
**Environment:** scikit-learn 1.9.1, Python 3.12. Load it with the same scikit-learn version.
**Dashboard bundle:** `ml/artifacts/all_models.joblib` holds *every* model family for every scheme (not just the chosen ones), refitted by `ml/export_dashboard.py` with the same tuned parameters, split and seed, for side-by-side comparison in the dashboard. The MLP for PM-KISAN, JJM and PMFBY exists only in that bundle: notebook 04 evaluated the MLP on the three primary schemes only, and its settings were applied to the other three.

## Read this first

**These models reproduce rule-derived labels. They do not predict real scheme eligibility or real scheme outcomes.** Each training label is a formula in `fra-atlas/backend/services/scheme_rules.py` plus Gaussian noise (SD 4–6). Each formula mixes numbers taken from scheme documents (`[anchor]`) with weights and cutoffs chosen by the authors (`[constructed]`). A score from these models means "what the rule would say, given these inputs". It is not an eligibility decision. No real allocation or outcome data has been used to validate anything.

## What the model does

Given a plot's land area, claim type, soil pH, soil organic carbon, groundwater stress and rainfall, it returns six 0–100 suitability scores: PM-KISAN, MGNREGA, Jal Jeevan Mission (JJM), PMFBY, PMKSY and Soil Health Card.

Pipeline per target:
1. `backend.services.ml_features.add_engineered_features`, which adds `oc_pct`, `ph_band`, `small_holding` and one-hot `is_ifr`/`is_cfr`.
2. Column selection plus `StandardScaler` (fit on the training split).
3. The model.

The bundle stores the scaler and model already fitted, so callers pass raw inputs. `backend.services.ml_features` must be importable wherever the file is loaded.

## Training data

`ml/data/labeled_dataset.csv`, described in full in `ml/DATA_DICTIONARY.md`.

- **1,540 synthetic plots**, 220 in each of 7 districts:
  - Madhya Pradesh: Chhindwara, Shivpuri.
  - Odisha: Kandhamal, Koraput.
  - Telangana: Adilabad, Warangal.
  - Tripura: West Tripura.
- **Coordinates** were sampled inside real district boundaries. They are not real claims.
- **`land_area_ha` and `claim_type`** were assigned at random (uniform 0.2–4 ha; IFR 55%, CFR 25%, CR 20%).
- **Soil** values are real ISRIC SoilGrids readings, but **30% of rows are imputed** with district means: Kandhamal 83%, Koraput 65%, 1–18% elsewhere.
- **`groundwater_stress_pct` and `rainfall_mm_avg`** are one constant per district (7 values each). Only Chhindwara's rainfall is verified against a published source.

**Split:** 1,211 train / 329 test plots, holding out whole `spatial_block`s (`GroupShuffleSplit`, 20%, seed 42). Tuning used `GroupKFold(5)` on `spatial_block` inside the training split, and the test set was used once. The test split over-represents Adilabad, Shivpuri and West Tripura; Koraput has only 11 test rows.

**Features used (9):** `land_area_ha`, `small_holding`, `is_ifr`, `is_cfr`, `soil_ph`, `ph_band`, `oc_pct`, `groundwater_stress_pct`, `rainfall_mm_avg`.
Deliberately excluded: `lat`, `lon`, `elevation_m` and `soil_clay_pct`. No rule reads them, and in testing lat/lon took importance away from the real inputs and lowered transfer to new districts (EDA F2; notebook 02 ablation).

## Chosen models and metrics

**Selection rule:** the simplest model whose GroupKFold CV R² is within 0.02 of the best model. Simplicity order: simple linear < multiple linear < decision tree < SVR < random forest < MLP.

| Target | Model | CV R² | Test R² (95% bootstrap CI) | Test MAE | Test oracle R² | Published ceiling | LODO R² |
|---|---|---|---|---|---|---|---|
| pm_kisan | simple linear on `is_ifr` | 0.975 | 0.977 (0.972–0.981) | 3.8 | 0.977 | 0.975 | 0.976 |
| mgnrega | decision tree (depth 6, leaf ≥ 20) | 0.547 | 0.601 (0.531–0.662) | 4.0 | 0.629 | 0.583 | 0.518 |
| jjm | multiple linear | 0.834 | 0.875 (0.849–0.895) | 4.7 | 0.877 | 0.846 | 0.841 |
| pmfby | simple linear on `rainfall_mm_avg` | 0.588 | 0.681 (0.626–0.729) | 5.0 | 0.681 | 0.627 | 0.612 |
| pmksy | multiple linear | 0.896 | 0.872 (0.848–0.891) | 4.1 | 0.896 | 0.917 | 0.674 |
| soil_health_card | decision tree (depth 3, leaf ≥ 10) | 0.917 | 0.888 (0.860–0.909) | 3.4 | 0.893 | 0.922 | 0.909 |

What the columns mean:
- **Oracle R²** is what the *noiseless* rule itself scores on the same rows: the best any model can possibly get there.
- **Published ceiling** is the population version, from `check_labels.py`.
- **LODO** is leave-one-district-out: train on 6 districts, predict the 7th, pooled over all 7.

The leakage guard compares every result with the oracle on the same rows. The first run flagged jjm and pmfby test R² above the *published* ceiling. Investigation showed the test split simply has more signal variance (the oracle is higher there too), so there was no leakage. No model exceeds its oracle by more than 0.02.

**Baselines for comparison (CV R²):**
- per-claim_type mean: pm_kisan 0.975, mgnrega 0.20.
- per-district mean: jjm 0.83, pmfby 0.59, pmksy 0.87, soil_health_card 0.51.

The models add real signal over these only for mgnrega and soil_health_card. pm_kisan, jjm and pmfby are essentially lookups. The full table, with every model × target (baselines, simple/multiple linear, tree, SVR, random forest, MLP), is in `ml/results/model_comparison.csv`.

## Robustness checks

- **Imputed soil rows:** retraining on real-soil rows only changes test R² on real-soil rows by ≤ 0.03.
- **New districts:** LODO is close to in-district CV for pm_kisan, jjm, pmfby and soil_health_card, but drops for **pmksy (0.90 → 0.67)** and **mgnrega (0.55 → 0.52)**. The linear climate models extrapolate along rainfall/groundwater, but with only 7 climate points nobody can verify that the line holds outside 850–2,100 mm and 30–65% stress.
- **MLP check:** a tuned MLP (64, 32), run over 5 seeds, never beats the chosen models by more than 0.02. It is clearly worse on soil_health_card (test 0.72 vs 0.89), because a smooth network approximates the rule's hard pH/OC steps with ramps.

## Known limitations

1. **Labels are rule-derived.** Accuracy here means "recovers `scheme_rules.py`". There is no real-world validation data.
2. **Only 7 districts.** Use only inside them. Climate inputs outside the training range (rainfall 850–2,100 mm, groundwater 30–65%) are extrapolation.
3. **Climate columns are district constants.** jjm, pmfby and most of pmksy are effectively district lookups, so present them as district-level indicators.
4. **Soil is imputed in Kandhamal and Koraput.** Most rows there carry the district mean, so soil-driven scores in those districts are district averages.
5. **pH and rainfall are confounded.** The wet districts are also the acidic ones, so the data can't separate a rainfall effect from a pH effect.
6. **The organic-carbon bands (1.5% / 2.0%) are constructed** from this data's thirds, not taken from the official Soil Health Card. Shifting them by ±0.25 changes 10–15% of soil scores (EDA F6).
7. **Feature importance can credit proxies.** Any district constant can stand in for another, so explanations should come from the rule's own inputs.
8. **Missing inputs at inference** must be filled the way the training data was: district means for soil, and the reference tables for climate. They must also be flagged as estimated. `feature_schema.json` lists the fallbacks.

## Intended use

Illustrative decision support inside the FRA Atlas prototype: ranking which schemes a plot's rule-based profile points toward, for the 7 covered districts. **Not for** eligibility decisions, benefit allocation, or any district outside the training set.
