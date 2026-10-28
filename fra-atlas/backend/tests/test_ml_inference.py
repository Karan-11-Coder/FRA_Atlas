"""
DSS model inference: agreement with the rules it was trained on, input
resolution, and the 503 path. Needs ml/artifacts/model.joblib.
"""
import numpy as np
import pandas as pd
import pytest
from sklearn.model_selection import GroupShuffleSplit

from backend.services import ml_inference, scheme_rules
from backend.services.ml_features import RAW_FEATURES

# A real dataset plot inside Chhindwara (SYN-00001) and a point in Delhi.
CHHINDWARA = (22.03435, 78.92785)
DELHI = (28.6139, 77.2090)


class _NoNoise:
    def gauss(self, mu, sd):
        return mu


@pytest.fixture(scope="module", autouse=True)
def loaded():
    assert ml_inference.load(force=True), ml_inference.status()
    yield
    ml_inference.load(force=True)


def _held_out_plots():
    """The exact test split used in ml/notebooks/02_regression.ipynb."""
    df = pd.read_csv(ml_inference.REFERENCE_DATA_PATH)
    _, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42).split(df, groups=df["spatial_block"]))
    return df.iloc[te].reset_index(drop=True)


def test_model_agrees_with_rules_on_held_out_plots():
    """
    On plots the model never trained on, its scores must sit close to the
    NOISELESS rule from scheme_rules.py: mean absolute gap below the label
    noise SD for every scheme. (The labels are rule + noise, so this is the
    right yardstick: the model should recover the rule, not the noise.)
    """
    test = _held_out_plots()
    rules = pd.DataFrame([{t: fn(r, _NoNoise()) for t, fn in scheme_rules.SCORERS.items()}
                          for r in test.assign(is_scheduled_area=True).to_dict("records")])
    bundle = ml_inference._state["bundle"]
    report = {}
    for target, model in bundle["models"].items():
        pred = model.predict(test[RAW_FEATURES])
        gap = np.abs(pred - rules[target]).mean()
        report[target] = round(float(gap), 2)
        assert gap < scheme_rules.NOISE_SD[target], (target, gap)
    print("\nmean |model - noiseless rule| on", len(test), "held-out plots:", report,
          "\nnoise SD:", scheme_rules.NOISE_SD)


def test_resolves_district_and_estimated_inputs():
    r = ml_inference.resolve_inputs(*CHHINDWARA, 1.5, "IFR")
    assert (r["state"], r["district"]) == ("Madhya Pradesh", "Chhindwara")
    assert r["values"]["rainfall_mm_avg"] == 1150 and r["values"]["groundwater_stress_pct"] == 58
    assert set(r["sources"]) == {"soil_ph", "soil_organic_carbon", "groundwater_stress_pct", "rainfall_mm_avg"}
    assert "nearest SoilGrids reading" in r["sources"]["soil_ph"]


def test_refuses_points_outside_training_districts():
    with pytest.raises(ml_inference.InputError, match="outside the 7 districts"):
        ml_inference.predict_schemes(*DELHI, 1.0, "IFR")


@pytest.mark.parametrize("args", [
    (None, 78.9, 1.0, "IFR"),
    (22.0, 78.9, None, "IFR"),
    (22.0, 78.9, 1.0, None),
    (22.0, 78.9, 1.0, "XYZ"),
])
def test_rejects_missing_or_bad_inputs(args):
    with pytest.raises(ml_inference.InputError):
        ml_inference.predict_schemes(*args)


def test_out_of_range_land_area_is_clipped_and_noted():
    r = ml_inference.predict_schemes(*CHHINDWARA, 12.0, "IFR")
    assert r["inputs"]["land_area_ha"] == 4.0
    assert any("outside the training range" in n for n in r["notes"])


def test_predict_returns_all_six_schemes():
    r = ml_inference.predict_schemes(*CHHINDWARA, 1.5, "IFR")
    assert len(r["recommendations"]) == 6
    assert {s["key"] for s in r["recommendations"]} == set(scheme_rules.SCORERS)
    assert all(0 <= s["score"] <= 100 for s in r["recommendations"])
    assert r["disclaimer"] == "Rule-derived suitability, not an eligibility decision."
    assert len(r["estimated_inputs"]) == 4
    # PM-KISAN is a claim-type rule: IFR high, CR low
    pk = lambda ct: next(s["score"] for s in ml_inference.predict_schemes(*CHHINDWARA, 1.5, ct)["recommendations"] if s["key"] == "pm_kisan_score")
    assert pk("IFR") > 70 > 40 > pk("CR")


def test_missing_model_raises_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(ml_inference, "MODEL_PATH", tmp_path / "nope.joblib")
    assert ml_inference.load(force=True) is False
    with pytest.raises(ml_inference.ModelUnavailable):
        ml_inference.predict_schemes(*CHHINDWARA, 1.5, "IFR")
