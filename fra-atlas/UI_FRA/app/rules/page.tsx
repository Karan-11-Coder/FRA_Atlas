"use client";

import { useEffect, useState } from "react";
import { postJSON, useApi, type Target } from "@/lib/api";
import { FEATURE, SCHEME, TARGETS, fmt } from "@/lib/meta";
import { Badge, ErrorBox, Loading, Note, PageHeader, Panel, Segmented } from "@/components/common/ui";

interface RulesInfo {
  module_doc: string;
  schemes: Record<Target, { name: string; doc: string; inputs: string[]; noise_sd: number }>;
  constants: Record<string, number>;
  constant_sources: Record<string, string>;
}
interface CutoffResult {
  cutoffs: { ph_low: number; ph_high: number; oc_low_pct: number; oc_high_pct: number };
  schemes: Record<string, { name: string; changed_share: number; mean_before: number; mean_after: number; mean_abs_shift: number;
    by_district: Record<string, { before: number; after: number; changed_share: number }> }>;
  plots: number;
  band_counts: { ph: Record<string, number>; oc: Record<string, number> };
  note: string;
}

const DEFAULTS = { ph_low: 6.5, ph_high: 7.5, oc_low_pct: 1.5, oc_high_pct: 2.0 };
const SLIDERS: { key: keyof typeof DEFAULTS; label: string; min: number; max: number; step: number; src: string }[] = [
  { key: "ph_low", label: "pH: acidic below", min: 5.5, max: 7.3, step: 0.05, src: "anchor: Soil Health Card band" },
  { key: "ph_high", label: "pH: alkaline above", min: 6.6, max: 8, step: 0.05, src: "anchor: Soil Health Card band" },
  { key: "oc_low_pct", label: "Organic carbon: low below (%)", min: 0.8, max: 2.4, step: 0.05, src: "constructed: lower third of this data" },
  { key: "oc_high_pct", label: "Organic carbon: high above (%)", min: 1.6, max: 3.5, step: 0.05, src: "constructed: upper third of this data" },
];

export default function RulesPage() {
  const info = useApi<RulesInfo>("/api/lab/rules");
  const [cut, setCut] = useState(DEFAULTS);
  const [res, setRes] = useState<CutoffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState("soil_health_card_score");

  useEffect(() => {
    const id = setTimeout(() => {
      postJSON<CutoffResult>("/api/lab/rules/cutoff", cut).then((r) => { setRes(r); setError(null); }).catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(id);
  }, [cut]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Scoring rules"
        subtitle="The models were trained to reproduce these formulas (plus Gaussian noise). Numbers marked anchor come from a scheme document or standard; constructed ones were chosen by the authors because no scheme-native number exists."
      />
      <ErrorBox error={info.error || error} />

      <Panel title="What if the soil bands were different?"
        subtitle="Re-score all 1,540 plots with the noiseless rules using different pH / organic-carbon cutoffs. No model is retrained; this shows how much the labels themselves depend on these choices.">
        <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-4">
            {SLIDERS.map((s) => (
              <label key={s.key} className="block text-xs text-slate-600">
                <span className="flex justify-between"><span>{s.label}</span><b className="tabular-nums text-slate-900">{cut[s.key].toFixed(2)}</b></span>
                <input type="range" min={s.min} max={s.max} step={s.step} value={cut[s.key]}
                  onChange={(e) => setCut((c) => ({ ...c, [s.key]: Number(e.target.value) }))} className="w-full accent-slate-900" />
                <span className="text-[10px] text-slate-400">{s.src}{cut[s.key] !== DEFAULTS[s.key] ? ` · default ${DEFAULTS[s.key]}` : ""}</span>
              </label>
            ))}
            <button onClick={() => setCut(DEFAULTS)} className="rounded border px-3 py-1 text-xs">Reset to defaults</button>
            {res && (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded bg-slate-50 p-2"><div className="font-semibold">pH bands</div>{Object.entries(res.band_counts.ph).map(([k, v]) => <div key={k}>{k}: {v}</div>)}</div>
                <div className="rounded bg-slate-50 p-2"><div className="font-semibold">OC bands</div>{Object.entries(res.band_counts.oc).map(([k, v]) => <div key={k}>{k}: {v}</div>)}</div>
              </div>
            )}
          </div>
          {!res ? <Loading /> : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {Object.entries(res.schemes).map(([t, s]) => (
                  <button key={t} onClick={() => setFocus(t)} className={`rounded-lg border p-3 text-left ${focus === t ? "border-slate-900" : "border-slate-200"}`}>
                    <div className="text-xs text-slate-500">{s.name}</div>
                    <div className="text-2xl font-semibold tabular-nums">{fmt(s.changed_share * 100, 1)}%</div>
                    <div className="text-[11px] text-slate-500">of plots change score · mean {fmt(s.mean_before, 1)} → {fmt(s.mean_after, 1)}</div>
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500"><tr className="border-b"><th className="py-1 text-left font-normal">District</th><th className="text-right font-normal">Mean before</th><th className="text-right font-normal">Mean after</th><th className="text-right font-normal">Plots changed</th></tr></thead>
                  <tbody>
                    {Object.entries(res.schemes[focus].by_district).map(([d, v]) => (
                      <tr key={d} className="border-b last:border-0">
                        <td className="py-1">{d}</td>
                        <td className="text-right tabular-nums">{fmt(v.before, 1)}</td>
                        <td className={`text-right tabular-nums ${Math.abs(v.after - v.before) > 2 ? "font-semibold" : ""}`}>{fmt(v.after, 1)}</td>
                        <td className="text-right tabular-nums">{fmt(v.changed_share * 100, 0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Note tone="amber">Moving the constructed organic-carbon cutoff by a quarter point changes far more plots than moving the official pH cutoff, because almost no plot sits near pH 6.5. The OC bands need a sourced justification before soil scores mean more than &quot;illustrative&quot;.</Note>
            </div>
          )}
        </div>
      </Panel>

      {!info.data ? <Loading /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {TARGETS.map((t) => {
            const s = info.data!.schemes[t];
            return (
              <Panel key={t} title={`${SCHEME[t].name}: ${SCHEME[t].full}`} subtitle={`Label noise SD ${s.noise_sd} points`}>
                <div className="mb-2 flex flex-wrap gap-1">
                  {s.inputs.map((i) => <Badge key={i} tone="blue">{FEATURE[i]?.label ?? (i === "is_scheduled_area" ? "Scheduled Area" : i)}</Badge>)}
                </div>
                <pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700">{s.doc || "Formula: see backend/services/scheme_rules.py"}</pre>
              </Panel>
            );
          })}
        </div>
      )}

      {info.data && (
        <Panel title="About these rules (from scheme_rules.py)">
          <details>
            <summary className="cursor-pointer text-xs text-slate-600">Show the module notes: changelog of label fixes and the honesty note</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-700">{info.data.module_doc}</pre>
          </details>
        </Panel>
      )}
    </div>
  );
}
