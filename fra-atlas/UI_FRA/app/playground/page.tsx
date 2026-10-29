"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  getJSON, postJSON, type Claim, type ClaimType, type Inputs, type PredictResult, type ResolveResult, type SweepResult, type Target,
} from "@/lib/api";
import { CLAIM_TYPES, DISTRICT_FILES, FEATURE, FEATURES, MODEL_COLOR, MODEL_SHORT, MODELS, SCHEME, TARGETS, fmt } from "@/lib/meta";
import { ErrorBox, Loading, ModelDot, Note, PageHeader, Panel, SchemePicker, Segmented, Select } from "@/components/common/ui";

const AtlasMap = dynamic(() => import("@/components/map/AtlasMap"), { ssr: false, loading: () => <Loading what="Loading map" /> });

const DEFAULT_INPUTS: Inputs = {
  land_area_ha: 1.5, claim_type: "IFR", soil_ph: 6.9, soil_organic_carbon: 17,
  groundwater_stress_pct: 58, rainfall_mm_avg: 1150,
};

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** cell background: how far a model is from the noiseless rule */
function gapColor(gap: number) {
  const t = Math.min(1, Math.abs(gap) / 12);
  return `rgba(225, 29, 72, ${0.04 + 0.5 * t})`;
}

function Slider({ name, value, onChange }: { name: keyof Inputs; value: number; onChange: (v: number) => void }) {
  const f = FEATURE[name];
  return (
    <label className="block">
      <span className="flex justify-between text-xs text-slate-600">
        <span>{f.label}</span>
        <span className="font-semibold tabular-nums text-slate-900">{value}{f.unit ? ` ${f.unit}` : ""}</span>
      </span>
      <input
        type="range" min={f.min} max={f.max} step={f.step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-slate-900"
      />
    </label>
  );
}

function PlaygroundInner() {
  const params = useSearchParams();
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [district, setDistrict] = useState<string>("Chhindwara");
  const [sources, setSources] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<[number, number] | null>(null);
  const [context, setContext] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [pred, setPred] = useState<PredictResult | null>(null);
  const [sweep, setSweep] = useState<SweepResult | null>(null);
  const [sweepFeature, setSweepFeature] = useState<keyof Inputs>("soil_organic_carbon");
  const [scheme, setScheme] = useState<Target>("soil_health_card_score");

  const set = <K extends keyof Inputs>(k: K, v: Inputs[K]) => setInputs((p) => ({ ...p, [k]: v }));

  async function loadDistrict(d: string, keepPlot = true) {
    try {
      const r = await getJSON<{ state: string; district: string; values: Inputs }>(`/api/lab/district-defaults/${encodeURIComponent(d)}`);
      setDistrict(d);
      setInputs((p) => ({ ...r.values, ...(keepPlot ? { land_area_ha: p.land_area_ha, claim_type: p.claim_type } : {}) }));
      setSources({ soil_ph: `${d} mean of real SoilGrids readings`, soil_organic_carbon: `${d} mean of real SoilGrids readings`,
        groundwater_stress_pct: `${d} reference value`, rainfall_mm_avg: `${d} reference value` });
      setPicked(null);
      setError(null);
      setBlocked(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function pickPoint(lat: number, lon: number, reportErrors = true) {
    try {
      const r = await postJSON<ResolveResult>("/api/lab/resolve", { lat, lon });
      setDistrict(r.district);
      setInputs((p) => ({ ...p, ...r.values }));
      setSources(r.sources);
      setPicked([lat, lon]);
      setError(null);
      setBlocked(null);
      return r;
    } catch (e: any) {
      if (reportErrors) setError(e.message);
      return null;
    }
  }

  // Initial state from the URL: ?claim=ID or ?district=Name
  useEffect(() => {
    const claimId = params.get("claim");
    const d = params.get("district");
    (async () => {
      if (claimId) {
        try {
          const { claim } = await getJSON<{ claim: Claim }>(`/api/claims/${claimId}`);
          const notes: string[] = [];
          const resolved = claim.lat != null && claim.lon != null ? await pickPoint(claim.lat, claim.lon, false) : null;
          if (!resolved) {
            const known = claim.district && DISTRICT_FILES[claim.district];
            if (known) {
              await loadDistrict(claim.district as string);
              notes.push(claim.lat != null
                ? `its coordinates fall outside the ${claim.district} boundary the models use, so ${claim.district} district averages are shown`
                : `no coordinates, so ${claim.district} district averages are shown`);
            } else {
              setBlocked(`This claim is in ${claim.district ?? "an unknown district"}, outside the 7 districts the models were trained on, so it can't be scored reliably. The scores below are for the inputs on the left, not for this claim.`);
            }
          }
          setInputs((p) => ({
            ...p,
            land_area_ha: claim.land_area ? Math.min(4, Math.max(0.2, claim.land_area)) : p.land_area_ha,
            claim_type: (claim.claim_type as ClaimType) || p.claim_type,
          }));
          if (!claim.claim_type) notes.push("no claim type stored, IFR assumed: change it below");
          if (claim.land_area != null && (claim.land_area > 4 || claim.land_area < 0.2))
            notes.push(`its ${claim.land_area} ha is outside the 0.2–4 ha the models were trained on, so it is scored at ${Math.min(4, Math.max(0.2, claim.land_area))} ha`);
          if (claim.land_area == null) notes.push("no land area stored, 1.5 ha assumed");
          setContext(`Claim #${claim.id}: ${claim.patta_holder ?? ""} ${claim.village ? `· ${claim.village}` : ""}${notes.length ? ` (${notes.join("; ")})` : ""}`);
        } catch (e: any) {
          setError(e.message);
        }
      } else {
        await loadDistrict(d && DISTRICT_FILES[d] ? d : "Chhindwara", false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debounced = useDebounced(inputs);
  useEffect(() => {
    let cancelled = false;
    postJSON<PredictResult>("/api/lab/predict", debounced)
      .then((r) => !cancelled && setPred(r))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    let cancelled = false;
    postJSON<SweepResult>("/api/lab/sweep", { inputs: debounced, feature: sweepFeature, points: 41 })
      .then((r) => !cancelled && setSweep(r))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [debounced, sweepFeature]);

  const series = useMemo(() => ["rule", ...MODELS], []);
  const chartData = useMemo(() => {
    if (!sweep) return [];
    return sweep.grid.map((x, i) => {
      const row: Record<string, number | string> = { x };
      for (const m of series) row[m] = sweep.curves[scheme]?.[m]?.[i];
      return row;
    });
  }, [sweep, scheme, series]);

  const chosen = pred?.chosen ?? ({} as Record<Target, string>);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Playground"
        subtitle="Change a plot's inputs and watch all six models (and the rule they were trained to reproduce) respond. Pick a district, or click anywhere inside one on the map to use that spot's nearest real soil reading."
      />
      {context && <Note tone="blue">{context}</Note>}
      {blocked && <Note tone="amber">{blocked}</Note>}
      <ErrorBox error={error} />

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Inputs">
            <div className="space-y-4">
              <Select
                label="District"
                value={district}
                onChange={(d) => loadDistrict(d)}
                options={Object.keys(DISTRICT_FILES).map((d) => ({ value: d, label: d }))}
              />
              <div>
                <div className="mb-1 text-xs text-slate-600">Claim type</div>
                <Segmented
                  value={inputs.claim_type}
                  onChange={(v) => set("claim_type", v as ClaimType)}
                  options={CLAIM_TYPES.map((c) => ({ value: c.value, label: c.label, title: c.full }))}
                />
              </div>
              {(["land_area_ha", "soil_ph", "soil_organic_carbon", "groundwater_stress_pct", "rainfall_mm_avg"] as const).map((k) => (
                <div key={k}>
                  <Slider name={k} value={inputs[k] as number} onChange={(v) => set(k, v)} />
                  {sources[k] && <div className="mt-0.5 text-[10px] text-slate-400">from: {sources[k]}</div>}
                </div>
              ))}
              <Note>
                Groundwater and rainfall are one reference value per district in the training data, so moving them away from a
                district&apos;s value is a counterfactual the models only saw as 7 points.
              </Note>
            </div>
          </Panel>
          <Panel title="Pick a point" subtitle="Click inside a district to load that location">
            <AtlasMap height={260} onPick={pickPoint} picked={picked} />
          </Panel>
        </div>

        <div className="space-y-5 min-w-0">
          <Panel
            title="Every model's score"
            subtitle="Cell shade = distance from the noiseless rule (darker = further). Chosen = the model the DSS uses for that scheme."
          >
            {!pred ? <Loading what="Scoring" /> : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-xs">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="py-1 text-left font-normal">Scheme</th>
                        <th className="py-1 text-center font-normal"><ModelDot model="rule" /></th>
                        {MODELS.map((m) => <th key={m} className="py-1 text-center font-normal"><ModelDot model={m} /></th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {TARGETS.map((t) => {
                        const s = pred.scores[t];
                        return (
                          <tr key={t} className={`cursor-pointer ${t === scheme ? "bg-slate-50" : ""}`} onClick={() => setScheme(t)}>
                            <td className="py-1 pr-2 font-medium">{SCHEME[t].name}</td>
                            <td className="text-center font-semibold tabular-nums">{fmt(s.rule, 1)}</td>
                            {MODELS.map((m) => (
                              <td key={m} className="p-0.5">
                                <div
                                  className={`rounded py-1 text-center tabular-nums ${chosen[t] === m ? "ring-2 ring-emerald-600 font-semibold" : ""}`}
                                  style={{ background: gapColor(s[m] - s.rule) }}
                                  title={`${m}: ${fmt(s[m], 2)} (rule ${fmt(s.rule, 2)})`}
                                >
                                  {fmt(s[m], 1)}
                                </div>
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {pred.notes.map((n) => <div key={n} className="mt-2"><Note tone="amber">{n}</Note></div>)}
              </>
            )}
          </Panel>

          <Panel
            title={`Sweep: ${SCHEME[scheme].name} as ${FEATURE[sweepFeature].label} varies`}
            subtitle="Everything else stays fixed. Steps = the rule's bands; trees reproduce steps, smooth models (SVR, MLP) turn them into ramps, lines can only tilt."
            right={
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  label="Vary"
                  value={sweepFeature}
                  onChange={(v) => setSweepFeature(v as keyof Inputs)}
                  options={FEATURES.map((f) => ({ value: f, label: FEATURE[f].label }))}
                />
              </div>
            }
          >
            <div className="mb-3"><SchemePicker value={scheme} onChange={setScheme} /></div>
            {!sweep ? <Loading what="Sweeping" /> : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  {sweepFeature === "claim_type" ? (
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="x" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDataOverflow tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => fmt(v, 1)} />
                      <Legend formatter={(v: string) => MODEL_SHORT[v] ?? v} wrapperStyle={{ fontSize: 11 }} />
                      {series.map((m) => <Bar key={m} dataKey={m} fill={MODEL_COLOR[m]} />)}
                    </BarChart>
                  ) : (
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 11 }}
                        tickFormatter={(v: number) => fmt(v, sweepFeature === "soil_ph" ? 1 : 0)}
                        label={{ value: `${FEATURE[sweepFeature].label} ${FEATURE[sweepFeature].unit}`, position: "insideBottom", offset: -2, fontSize: 11 }} />
                      <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDataOverflow tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => fmt(v, 1)} labelFormatter={(v: number) => `${FEATURE[sweepFeature].label} = ${fmt(v, 2)}`} />
                      <Legend formatter={(v: string) => MODEL_SHORT[v] ?? v} wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine x={Number(sweep.current)} stroke="#64748b" strokeDasharray="4 4" />
                      {series.map((m) => (
                        <Line key={m} type="monotone" dataKey={m} stroke={MODEL_COLOR[m]} dot={false}
                          strokeWidth={m === "rule" ? 2.5 : chosen[scheme] === m ? 2.5 : 1.5}
                          strokeDasharray={m === "rule" ? "6 3" : undefined} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

export default function PlaygroundPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PlaygroundInner />
    </Suspense>
  );
}
