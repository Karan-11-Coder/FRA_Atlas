"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, AlertTriangle, Info } from "lucide-react";
import { api, type ClaimType, type DiagnosticsResponse } from "@/lib/api";
import type { WorkspaceClaim } from "./types";

interface Props {
  claim: WorkspaceClaim;
  onClose: () => void;
}

const CLAIM_TYPES: Array<{ value: ClaimType; label: string }> = [
  { value: "IFR", label: "IFR (individual)" },
  { value: "CFR", label: "CFR (community forest resource)" },
  { value: "CR", label: "CR (community)" },
];

function barColor(score: number) {
  if (score > 70) return "bg-green-600";
  if (score >= 40) return "bg-amber-500";
  return "bg-gray-400";
}

function formatValue(v: number | string) {
  return typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
}

export default function DiagnosticsPanel({ claim, onClose }: Props) {
  // Claims don't store a claim type yet, so the officer picks it here rather
  // than the panel guessing one.
  const initialType = ["IFR", "CFR", "CR"].includes(String(claim.claim_type || "").toUpperCase())
    ? (String(claim.claim_type).toUpperCase() as ClaimType)
    : null;
  const [claimType, setClaimType] = useState<ClaimType | null>(initialType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [showEstimated, setShowEstimated] = useState(false);

  useEffect(() => {
    setData(null);
    setError("");
    if (!claimType) return;

    let cancelled = false;
    setLoading(true);
    const payload: Record<string, any> = { claim_type: claimType };
    if (claim.id != null) payload.claim_id = Number(claim.id);
    if (claim.lat != null) payload.lat = Number(claim.lat);
    if (claim.lon != null) payload.lon = Number(claim.lon);
    if (claim.land_area != null) payload.land_area = Number(claim.land_area);

    api
      .getDiagnostics(payload)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Diagnostics request failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [claim, claimType]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed top-0 right-0 h-screen w-full max-w-[460px] bg-white shadow-2xl z-[9999] flex flex-col border-l">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <div className="font-bold text-gray-900">Scheme suitability (DSS)</div>
          <div className="text-xs text-gray-500 mt-0.5">
            <span className="font-semibold">{claim.patta_holder || claim.village || `Claim #${claim.id}`}</span>
            {claim.village && <span className="ml-2">• {claim.village}</span>}
            {data && <span className="ml-2">• {data.district}, {data.state}</span>}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close diagnostics">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <div className="text-sm font-semibold mb-2">Claim type</div>
          <div className="flex flex-wrap gap-2">
            {CLAIM_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setClaimType(t.value)}
                className={`px-3 py-1.5 rounded-full border text-xs font-medium ${
                  claimType === t.value ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {!claimType && (
            <div className="text-xs text-gray-500 mt-2">
              This claim has no recorded claim type. Choose one to score it — several schemes depend on it.
            </div>
          )}
        </div>

        {loading && <div className="text-sm text-gray-600">Scoring…</div>}
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            Could not score this claim: {error}
          </div>
        )}

        {data && (
          <>
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <button
                type="button"
                onClick={() => setShowEstimated((s) => !s)}
                className="flex w-full items-center gap-2 text-left text-sm font-semibold text-amber-900"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {data.estimated_inputs.length} estimated inputs
                <span className="ml-auto text-xs font-normal underline">{showEstimated ? "hide" : "show sources"}</span>
              </button>
              {showEstimated && (
                <ul className="mt-2 space-y-1.5">
                  {data.estimated_inputs.map((e) => (
                    <li key={e.input} className="text-xs text-amber-900">
                      <span className="font-semibold">
                        {e.label}: {formatValue(e.value)}
                      </span>{" "}
                      — {e.source}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {data.notes.map((n, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-700 bg-gray-50 border rounded p-2">
                <Info className="w-4 h-4 shrink-0 text-gray-500" />
                {n}
              </div>
            ))}

            <div>
              <div className="text-sm font-semibold mb-2">All six schemes</div>
              <div className="space-y-2">
                {data.recommendations.map((r) => (
                  <div key={r.key} className="border rounded-lg p-3">
                    <div className="flex justify-between items-baseline font-semibold">
                      <span>{r.name}</span>
                      <span>
                        {r.score}
                        <span className="text-xs font-normal text-gray-500"> / 100 (±{r.typical_error})</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full rounded bg-gray-100" aria-hidden>
                      <div className={`h-2 rounded ${barColor(r.score)}`} style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }} />
                    </div>
                    <div className="mt-2 text-xs text-gray-500">Top contributing inputs</div>
                    <div className="mt-1 space-y-0.5">
                      {r.reasons.map((reason, i) => (
                        <div key={i} className="text-sm text-gray-600">
                          • {reason}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="border-t p-3 text-xs text-gray-600 space-y-1">
        <div className="font-semibold text-gray-800">Rule-derived suitability, not an eligibility decision.</div>
        <div>
          Scores come from models trained to reproduce rule-based labels on synthetic plots in 7 districts. ± is the
          model&apos;s typical error. They have not been validated against real scheme outcomes.
        </div>
      </div>
    </div>
  );
}
