// UI_FRA/lib/meta.ts: labels, colours and ranges shared by every dashboard view.
import type { Inputs, Target } from "./api";

export const TARGETS: Target[] = [
  "pm_kisan_score",
  "mgnrega_score",
  "jjm_score",
  "pmfby_score",
  "pmksy_score",
  "soil_health_card_score",
];

export const SCHEME: Record<Target, { name: string; full: string }> = {
  pm_kisan_score: { name: "PM-KISAN", full: "PM Kisan Samman Nidhi (income support)" },
  mgnrega_score: { name: "MGNREGA", full: "Rural employment & land works" },
  jjm_score: { name: "JJM", full: "Jal Jeevan Mission (drinking water)" },
  pmfby_score: { name: "PMFBY", full: "Crop insurance" },
  pmksy_score: { name: "PMKSY", full: "Irrigation (Krishi Sinchayee)" },
  soil_health_card_score: { name: "Soil Health Card", full: "Soil testing & correction" },
};

export const MODELS = ["simple linear", "multiple linear", "decision tree", "SVR (RBF)", "random forest", "MLP"];

export const MODEL_COLOR: Record<string, string> = {
  rule: "#111827",
  "simple linear": "#94a3b8",
  "multiple linear": "#6366f1",
  "decision tree": "#16a34a",
  "SVR (RBF)": "#f59e0b",
  "random forest": "#0d9488",
  MLP: "#e11d48",
};

export const MODEL_SHORT: Record<string, string> = {
  rule: "Rule",
  "simple linear": "Simple lin.",
  "multiple linear": "Multi lin.",
  "decision tree": "Tree",
  "SVR (RBF)": "SVR",
  "random forest": "Forest",
  MLP: "MLP",
};

export const FEATURES: (keyof Inputs)[] = [
  "land_area_ha",
  "claim_type",
  "soil_ph",
  "soil_organic_carbon",
  "groundwater_stress_pct",
  "rainfall_mm_avg",
];

export const FEATURE: Record<string, { label: string; unit: string; min?: number; max?: number; step?: number }> = {
  land_area_ha: { label: "Land area", unit: "ha", min: 0.2, max: 4, step: 0.05 },
  claim_type: { label: "Claim type", unit: "" },
  soil_ph: { label: "Soil pH", unit: "", min: 5.2, max: 7.6, step: 0.05 },
  soil_organic_carbon: { label: "Soil organic carbon", unit: "g/kg", min: 7.5, max: 46.1, step: 0.5 },
  groundwater_stress_pct: { label: "Groundwater stress", unit: "%", min: 30, max: 65, step: 1 },
  rainfall_mm_avg: { label: "Rainfall", unit: "mm/yr", min: 850, max: 2100, step: 10 },
  lat: { label: "Latitude", unit: "°" },
  lon: { label: "Longitude", unit: "°" },
  elevation_m: { label: "Elevation", unit: "m" },
  soil_clay_pct: { label: "Soil clay", unit: "%" },
};

export const CLAIM_TYPES = [
  { value: "IFR", label: "IFR", full: "Individual Forest Rights" },
  { value: "CFR", label: "CFR", full: "Community Forest Resource" },
  { value: "CR", label: "CR", full: "Community Rights" },
] as const;

export const DISTRICT_FILES: Record<string, string> = {
  Chhindwara: "mp_chhindwara.json",
  Shivpuri: "mp_shivpuri.json",
  Kandhamal: "odisha_kandhamal.json",
  Koraput: "odisha_koraput.json",
  Adilabad: "telangana_adilabad.json",
  Warangal: "telangana_warangal.json",
  "West Tripura": "tripura_west.json",
};

export const DISTRICT_COLOR: Record<string, string> = {
  Adilabad: "#2563eb",
  Chhindwara: "#ea580c",
  Kandhamal: "#16a34a",
  Koraput: "#9333ea",
  Shivpuri: "#dc2626",
  Warangal: "#0891b2",
  "West Tripura": "#ca8a04",
};

export const STATUS_COLOR: Record<string, string> = {
  Pending: "#f59e0b",
  Granted: "#16a34a",
  Rejected: "#dc2626",
};

export const DISCLAIMER = "Rule-derived suitability on synthetic plots, not an eligibility decision.";

export const fmt = (v: number | null | undefined, d = 3) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(d);

/** 0-100 score -> colour from pale to deep green. */
export function scoreColor(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "#e5e7eb";
  const t = Math.max(0, Math.min(1, (v - 20) / 70));
  const r = Math.round(240 - t * (240 - 21));
  const g = Math.round(249 - t * (249 - 128));
  const b = Math.round(240 - t * (240 - 61));
  return `rgb(${r},${g},${b})`;
}

/** Diverging colour for correlations / signed effects in [-1, 1]. */
export function divergingColor(v: number) {
  const t = Math.max(-1, Math.min(1, v));
  if (t >= 0) return `rgba(37, 99, 235, ${0.08 + 0.8 * t})`;
  return `rgba(220, 38, 38, ${0.08 + 0.8 * -t})`;
}
