# `ml/data/labeled_dataset.csv` — data dictionary

1540 synthetic training plots, 220 in each of 7 districts across Madhya
Pradesh, Odisha, Telangana and Tripura. Each row is one sampled coordinate
with soil/elevation values (real API readings, ~25-29% replaced by district
averages — see below), static district-level reference values, and 6
rule-derived scheme-suitability scores used as training targets.

**The scores are rule-derived labels, not historical scheme allocations and
not eligibility determinations.** A model trained on them learns the rules in
`backend/services/scheme_rules.py`, plus noise.

Regenerate / re-check (from `fra-atlas/`):

```
python -m backend.services.generate_labels --in raw_features_backfilled.csv --out labeled_dataset.csv
python -m backend.services.check_labels --in labeled_dataset.csv
python -m backend.services.export_ml_dataset
```

`check_labels` must be re-run after any change to the rules or features.

## Before you train: what this dataset can and can't teach

**Ceiling = the best R² any model can reach** (`signal variance / (signal + noise variance)`), because each label is
a rule plus Gaussian noise. Scoring near the ceiling means the model recovered the rule — it is the benchmark, not 1.0.

| Label | Distinct noiseless values | Noise SD | R² ceiling | What it really is |
|---|---|---|---|---|
| `pm_kisan_score` | 2 | 5 | 0.975 | A lookup on `claim_type` (IFR ≈ 85, CR/CFR ≈ 22) |
| `soil_health_card_score` | 6 | 4 | 0.922 | pH band × organic-carbon band |
| `pmksy_score` | 41 | 4 | 0.917 | Multi-factor: district rainfall, groundwater, land area, claim type, soil |
| `jjm_score` | 7 | 6 | 0.846 | **A district lookup** (rainfall + groundwater are district constants) — a model can only learn which district a plot is in |
| `pmfby_score` | 7 | 6 | 0.627 | **A district lookup** on rainfall alone |
| `mgnrega_score` | 1088 | 5 | 0.583 | The only continuous multi-factor label: water-works share, soil need, holding size, claim type |

- `jjm_score`, `pmfby_score` and `pmksy_score` all depend on the district's climate, so they are strongly
  correlated (JJM~PMKSY +0.80, JJM~PMFBY −0.69, PMFBY~PMKSY −0.61). That is the shared district structure, not independent signal.
- Baselines worth beating: predict the mean; predict the per-district / per-`claim_type` mean.

### Feature roles

| Role | Columns |
|---|---|
| Used by at least one rule | `claim_type`, `land_area_ha`, `soil_ph`, `soil_organic_carbon`, `groundwater_stress_pct`, `rainfall_mm_avg` |
| In **no** rule (any signal from them is only via district structure) | `lat`, `lon`, `elevation_m`, `soil_clay_pct` |
| District identifiers in disguise (7 unique values each) | `groundwater_stress_pct`, `rainfall_mm_avg` |
| Not features | `plot_id`, `spatial_block`, the four `*_imputed` flags (use them to filter/stratify, not as predictors) |

### Splitting

Random splits leak: 36% of plots have another plot within 1 km. Use
`spatial_block` (district + 0.3° grid cell, ~33 km; 115 groups, 1-102 rows each, never spans two districts) with
GroupKFold / GroupShuffleSplit. About 7% of close pairs still straddle a block edge. For a harsher test group by
`district` — but leave-one-district-out is expected to fail on `jjm_score` and `pmfby_score`, because their
target is a function of that district's constants and trees cannot extrapolate to an unseen value.

## Columns

### Identity / geography

| Column | dtype | Meaning |
|---|---|---|
| `plot_id` | string | `SYN-00001` … `SYN-01540`, unique |
| `state`, `district` | string | 4 states, 7 districts (220 rows each) |
| `lat`, `lon` | float | Coordinates sampled inside real district boundary polygons — not real claim locations |
| `spatial_block` | string | Grouping key for splits (see above) |

### Claim-record fields (assigned when the dataset was built, not fetched)

| Column | dtype | Meaning |
|---|---|---|
| `land_area_ha` | float | Uniform in [0.2, 4.0] ha |
| `claim_type` | string | `IFR` 840 / `CFR` 390 / `CR` 310 (55 / 25 / 20% weights) |

### Soil / elevation — real API data, partly imputed

| Column | dtype | Meaning |
|---|---|---|
| `soil_ph` | float | pH, 0-5 cm (ISRIC SoilGrids). Real values span 5.2-7.6, so the `> 7.5` band is nearly empty |
| `soil_organic_carbon` | float | Organic carbon, 0-5 cm, **g/kg** (7-46). Percent = value ÷ 10 |
| `soil_clay_pct` | float | Clay %, 0-5 cm |
| `elevation_m` | float | Elevation in metres (open-elevation) |
| `soil_ph_imputed`, `soil_organic_carbon_imputed`, `soil_clay_pct_imputed`, `elevation_m_imputed` | bool | `True` = district-mean estimate, not a real reading |

**Imputation (read before EDA).** The original build had 25-29% API failures on these fields. A live re-fetch
was attempted but abandoned after 2.5+ hours (the API slowed from ~1-4 s to 60+ s per request). Every still-missing
cell was filled with the (state, district) mean of real values from the same district; all 7 districts had real data, so
no row used a dataset-wide fallback. Imputation is **concentrated, not random**: Kandhamal is 83% imputed and Koraput
65%, versus 1-18% elsewhere. In those two districts the soil columns are mostly one repeated value, and the labels were
computed *from* the imputed values. Compare results with and without imputed rows, per district.

### Static reference values (district-level constants)

| Column | dtype | Meaning |
|---|---|---|
| `groundwater_stress_pct` | float | Estimated stage-of-extraction %, 30-65. Every district falls in the CGWB "safe" category (< 70) |
| `rainfall_mm_avg` | float | Average annual rainfall, 850-2100 mm. Only Chhindwara is verified against a published source; the rest are regional estimates |

### Excluded from this copy (kept in the repo-root `labeled_dataset.csv`)

- `distance_to_water_km` — null for all rows; no water-body geometry file has been sourced.
- `is_scheduled_area` — `True` for all rows (all four states are Scheduled Areas), so it has no variance.

## Scheme-score labels (0-100)

Generated by `backend/services/scheme_rules.py`; each formula's docstring marks which numbers are `[anchor]`
(taken from a real scheme document/standard) and which are `[constructed]` (chosen by the authors; no scheme-native number exists).
`FRA_Atlas_Scoring_Methodology_Note.md` — cited by the first version — has never been in this repository.

| Column | Built from |
|---|---|
| `pm_kisan_score` | `claim_type` |
| `mgnrega_score` | groundwater water-works share (30/40/65% mandate, interpolated), soil-correction need, holding size, claim type + Scheduled Area |
| `jjm_score` | drought-proneness (rainfall), groundwater stress, Scheduled Area |
| `pmfby_score` | rainfall deviation from 1150 mm |
| `pmksy_score` | groundwater, rainfall band, Scheduled Area, land ≤ 2 ha, claim type, soil favourable |
| `soil_health_card_score` | pH band (6.5-7.5 official) and organic-carbon band |

**Label fixes already applied** (an audit found the first version's signal was broken):

| Label | Defect | Fix | R² ceiling before → after |
|---|---|---|---|
| `jjm_score` | Groundwater cutoffs (70/90) never reached → score was a constant plus noise | Rebuilt from drought-proneness, groundwater stress, SC/ST priority | 0.006 → 0.846 |
| `mgnrega_score` | Same dead groundwater term; only two clusters 4.5 points apart | Rebuilt as a multi-factor work-priority composite | 0.147 → 0.583 |
| `soil_health_card_score` | OC in g/kg vs thresholds in % → OC term constant | Convert to %; cutoffs set at the lower/upper thirds of real readings (1.5% / 2.0%), since SoilGrids topsoil OC sits above the official arable-soil bands | 0.950 → 0.922 |
| `pmksy_score` | Same groundwater/OC defects | Continuous groundwater mapping; OC in % | 0.915 → 0.917 |
| `pm_kisan_score`, `pmfby_score` | none | unchanged (byte-identical to the earlier run) | 0.975, 0.627 |

Each label has independent Gaussian noise (SD 4-6, table above), clipped to [0, 100].
