"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import type { WorkspaceClaim } from "./types";

interface Recommendation {
  name: string;
  score: number;
  reasons: string[];
}

interface Props {
  claim: WorkspaceClaim;
  onClose: () => void;
}

function badgeColor(score: number) {
  if (score > 70) return "bg-green-600";
  if (score >= 40) return "bg-amber-500";
  return "bg-gray-400";
}

export default function DiagnosticsPanel({ claim, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metrics, setMetrics] = useState<Record<string, any> | null>(null);
  const [results, setResults] = useState<Recommendation[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setMetrics(null);
    setResults(null);

    const payload: Record<string, number> = {};
    if (claim.id != null) payload.claim_id = Number(claim.id);
    if (claim.lat != null) payload.lat = Number(claim.lat);
    if (claim.lon != null) payload.lon = Number(claim.lon);
    if (claim.land_area != null) payload.land_area = Number(claim.land_area);

    api
      .getDiagnostics(payload)
      .then((data) => {
        if (cancelled) return;
        setMetrics(data.metrics || null);
        setResults(
          (data.recommendations || []).map((r) => ({
            name: r.name,
            score: typeof r.score === "number" ? r.score : Number(r.score) || 0,
            reasons: r.reasons || [],
          }))
        );
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
  }, [claim]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const top = results && results.length > 0 ? results[0] : null;

  return (
    <div className="fixed top-0 right-0 h-screen w-full max-w-[460px] bg-white shadow-2xl z-[9999] flex flex-col border-l">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <div className="font-bold text-gray-900">Diagnostics</div>
          <div className="text-xs text-gray-500 mt-0.5">
            <span className="font-semibold">{claim.patta_holder || claim.village || `Claim #${claim.id}`}</span>
            {claim.village && <span className="ml-2">• {claim.village}</span>}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close diagnostics">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && <div className="text-sm text-gray-600">Running diagnostics…</div>}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
            Diagnostics API failed: {error}
          </div>
        )}

        {results && (
          <>
            <div>
              <div className="text-sm font-semibold mb-2">Recommendation</div>
              {top ? (
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1.5 rounded-full text-white font-bold text-sm ${badgeColor(top.score)}`}>{top.name}</span>
                  <span className="text-lg font-bold">{top.score}%</span>
                </div>
              ) : (
                <div className="text-sm text-gray-500">No recommendation available.</div>
              )}
            </div>

            <hr />

            <div>
              <div className="text-sm font-semibold mb-2">Ranked recommendations</div>
              <div className="space-y-2">
                {results.map((r, idx) => (
                  <div key={r.name} className="border rounded-lg p-3">
                    <div className="flex justify-between items-center font-semibold">
                      <span>
                        {idx + 1}. {r.name}
                      </span>
                      <span>{r.score}%</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {(r.reasons || []).slice(0, 3).map((reason, i) => (
                        <div key={i} className="text-sm text-gray-600">
                          • {reason}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {metrics && (
              <div>
                <div className="text-sm font-semibold mb-2">Numeric indicators</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-50 border rounded-lg p-2">
                    <div className="text-xs text-gray-500">Soil fertility index</div>
                    <div className="font-semibold">{Number(metrics.soilIndex ?? 0).toFixed(2)}</div>
                  </div>
                  <div className="bg-gray-50 border rounded-lg p-2">
                    <div className="text-xs text-gray-500">Groundwater index</div>
                    <div className="font-semibold">{Number(metrics.gwIndex ?? 0).toFixed(2)}</div>
                  </div>
                  <div className="bg-gray-50 border rounded-lg p-2">
                    <div className="text-xs text-gray-500">Distance to water (km)</div>
                    <div className="font-semibold">{metrics.distanceToWaterKm ?? "—"}</div>
                  </div>
                  <div className="bg-gray-50 border rounded-lg p-2">
                    <div className="text-xs text-gray-500">Land area (ha)</div>
                    <div className="font-semibold">{Number.isFinite(Number(claim.land_area)) ? Number(claim.land_area).toFixed(2) : "—"}</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t p-3 text-xs text-gray-500">
        Scoring is currently a placeholder pending real soil/water/groundwater data (see backend/routes/diagnostics.py).
      </div>
    </div>
  );
}
