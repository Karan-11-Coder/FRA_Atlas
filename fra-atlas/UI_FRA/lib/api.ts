// UI_FRA/lib/api.ts: thin client for the FRA Atlas backend (no auth: the dashboard is open by design).
"use client";

import { useCallback, useEffect, useState } from "react";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, `Can't reach the backend at ${API_BASE}. Is it running?`);
  }
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail ?? data);
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return data as T;
}

export const getJSON = <T,>(path: string) => request<T>(path);
export const postJSON = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const putJSON = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });
export function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return request<T>(path, { method: "POST", body: form });
}

/** GET with loading/error state; pass null to skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getJSON<T>(path)
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  return { data, error, loading, reload };
}

// ---------------------------------------------------------------------------
// Types for the lab views (ml/export_dashboard.py) and live endpoints
// ---------------------------------------------------------------------------
export type Target =
  | "pm_kisan_score"
  | "mgnrega_score"
  | "jjm_score"
  | "pmfby_score"
  | "pmksy_score"
  | "soil_health_card_score";

export type ClaimType = "IFR" | "CFR" | "CR";

export interface Inputs {
  land_area_ha: number;
  claim_type: ClaimType;
  soil_ph: number;
  soil_organic_carbon: number;
  groundwater_stress_pct: number;
  rainfall_mm_avg: number;
}

export interface ModelRow {
  target: Target;
  model: string;
  params: Record<string, unknown>;
  train_R2: number;
  cv_R2: number;
  test_R2: number;
  test_MAE: number;
  test_RMSE: number;
  test_R2_ci: [number, number];
  lodo_R2: number;
  test_oracle_R2: number;
  ceiling: number;
  rule_gap_MAE: number;
  chosen: boolean;
  source: string;
}

export interface ModelsView {
  targets: Target[];
  short: Record<Target, string>;
  models: string[];
  chosen: Record<Target, string>;
  raw_features: (keyof Inputs)[];
  rows: ModelRow[];
  baselines: { target: Target; model: string; cv_R2: number; test_R2: number; test_MAE: number }[];
  noise_sd: Record<Target, number>;
  train_rows: number;
  test_rows: number;
}

export interface DistrictSummary {
  state: string;
  district: string;
  plots: number;
  rainfall_mm_avg: number;
  groundwater_stress_pct: number;
  soil_ph_mean: number;
  soil_oc_mean: number;
  imputed_share: number;
  label_mean: Record<Target, number>;
  pred_mean: Record<Target, number>;
  rule_mean: Record<Target, number>;
}

export interface Claim {
  id: number;
  state: string | null;
  district: string | null;
  block?: string | null;
  village: string | null;
  patta_holder: string | null;
  address?: string | null;
  land_area: number | null;
  claim_type: ClaimType | null;
  status: string | null;
  date?: string | null;
  lat: number | null;
  lon: number | null;
  source?: string | null;
  created_at?: string | null;
}

export interface PredictResult {
  inputs: Inputs;
  scores: Record<Target, Record<string, number>>;
  models: string[];
  chosen: Record<Target, string>;
  notes: string[];
  disclaimer: string;
}

export interface SweepResult {
  feature: keyof Inputs;
  grid: (number | string)[];
  curves: Record<Target, Record<string, number[]>>;
  current: number | string;
  models: string[];
  chosen: Record<Target, string>;
}

export interface ResolveResult {
  state: string;
  district: string;
  values: Pick<Inputs, "soil_ph" | "soil_organic_carbon" | "groundwater_stress_pct" | "rainfall_mm_avg">;
  sources: Record<string, string>;
}
