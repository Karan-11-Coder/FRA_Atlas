"use client";

import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { useApi, type ModelsView, type Target } from "@/lib/api";
import { DISTRICT_COLOR, MODEL_COLOR, MODEL_SHORT, MODELS, SCHEME, fmt } from "@/lib/meta";
import { Badge, ErrorBox, Loading, ModelDot, Note, PageHeader, Panel, SchemePicker, Segmented } from "@/components/common/ui";

interface PredictionsView {
  plot_id: string[];
  district: string[];
  soil_imputed: boolean[];
  y: Record<Target, number[]>;
  rule: Record<Target, number[]>;
  pred: Record<Target, Record<string, number[]>>;
}
interface CurvesView {
  depths: number[];
  depth: Record<Target, { train: number[]; cv: number[] }>;
  mlp_seed_sd: Record<string, { test: number; cv: number }>;
}

export default function ArenaPage() {
  const models = useApi<ModelsView>("/api/lab/views/models");
  const preds = useApi<PredictionsView>("/api/lab/views/predictions");
  const curves = useApi<CurvesView>("/api/lab/views/curves");
  const [scheme, setScheme] = useState<Target>("mgnrega_score");
  const [picked, setPicked] = useState<string | null>(null);

  const rows = useMemo(() => (models.data?.rows ?? []).filter((r) => r.target === scheme), [models.data, scheme]);
  const baselines = useMemo(() => (models.data?.baselines ?? []).filter((b) => b.target === scheme), [models.data, scheme]);
  const chosen = models.data?.chosen[scheme];
  const model = picked && MODELS.includes(picked) ? picked : chosen ?? "decision tree";
  const oracle = rows[0]?.test_oracle_R2;
  const ceiling = rows[0]?.ceiling;

  const barData = rows.map((r) => ({ model: MODEL_SHORT[r.model], cv: r.cv_R2, test: r.test_R2, lodo: Math.max(r.lodo_R2, -0.5), lodoRaw: r.lodo_R2 }));

  const scatter = useMemo(() => {
    if (!preds.data) return [];
    const p = preds.data;
    return p.y[scheme].map((y, i) => ({ y, pred: p.pred[scheme][model][i], district: p.district[i] }));
  }, [preds.data, scheme, model]);

  const errorBy = useMemo(() => {
    if (!preds.data) return { district: [], imputed: [] as { group: string; mae: number; n: number }[] };
    const p = preds.data;
    const groups: Record<string, number[]> = {};
    const imp: Record<string, number[]> = { "real soil": [], "imputed soil": [] };
    p.y[scheme].forEach((y, i) => {
      const e = Math.abs(y - p.pred[scheme][model][i]);
      (groups[p.district[i]] ??= []).push(e);
      imp[p.soil_imputed[i] ? "imputed soil" : "real soil"].push(e);
    });
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    return {
      district: Object.entries(groups).map(([d, e]) => ({ group: d, mae: avg(e), n: e.length })).sort((a, b) => b.mae - a.mae),
      imputed: Object.entries(imp).map(([g, e]) => ({ group: g, mae: avg(e), n: e.length })),
    };
  }, [preds.data, scheme, model]);

  const depthData = curves.data
    ? curves.data.depths.map((d, i) => ({ depth: d, train: curves.data!.depth[scheme].train[i], cv: curves.data!.depth[scheme].cv[i] }))
    : [];
  const noise = models.data?.noise_sd[scheme];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Model arena"
        subtitle="Six model families trained on the same split, tuned the same way. Judge them against the oracle (the noiseless rule's own R² on the same test plots: the best any model can do), not against 1.0."
      >
        <SchemePicker value={scheme} onChange={(t) => { setScheme(t); setPicked(null); }} />
      </PageHeader>
      <ErrorBox error={models.error || preds.error || curves.error} />
      {!models.data ? <Loading /> : (
        <>
          <Panel
            title={`${SCHEME[scheme].name} leaderboard`}
            subtitle={`Test oracle R² ${fmt(oracle)} · population ceiling ${fmt(ceiling)} · label noise SD ${noise} points · ${models.data.train_rows} train / ${models.data.test_rows} test plots, split by spatial block`}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead className="text-slate-500">
                  <tr className="border-b">
                    <th className="py-1.5 text-left font-normal">Model</th>
                    <th className="text-right font-normal">Train R²</th>
                    <th className="text-right font-normal">CV R²</th>
                    <th className="text-right font-normal">Test R² (95% CI)</th>
                    <th className="pl-3 text-left font-normal">vs oracle</th>
                    <th className="text-right font-normal" title="Leave one district out: train on 6, predict the 7th">New-district R²</th>
                    <th className="text-right font-normal">Test MAE</th>
                    <th className="text-right font-normal" title="Mean |prediction − noiseless rule| on test plots">Gap to rule</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.model} onClick={() => setPicked(r.model)}
                      className={`cursor-pointer border-b last:border-0 hover:bg-slate-50 ${model === r.model ? "bg-slate-50" : ""}`}>
                      <td className="py-1.5"><ModelDot model={r.model} chosen={r.chosen} />
                        {r.source.startsWith("export") && <span className="ml-1"><Badge>extra</Badge></span>}</td>
                      <td className="text-right tabular-nums">{fmt(r.train_R2)}</td>
                      <td className="text-right tabular-nums">{fmt(r.cv_R2)}</td>
                      <td className="text-right tabular-nums">{fmt(r.test_R2)} <span className="text-slate-400">({fmt(r.test_R2_ci[0], 2)}–{fmt(r.test_R2_ci[1], 2)})</span></td>
                      <td className="pl-3">
                        <span className="inline-block h-2 rounded align-middle" style={{ width: Math.max(0, Math.min(1, r.test_R2 / r.test_oracle_R2)) * 90, background: MODEL_COLOR[r.model] }} />
                        <span className="ml-1 tabular-nums text-slate-500">{Math.round((r.test_R2 / r.test_oracle_R2) * 100)}%</span>
                      </td>
                      <td className={`text-right tabular-nums ${r.lodo_R2 < r.cv_R2 - 0.2 ? "font-semibold text-red-600" : ""}`}>{fmt(r.lodo_R2)}</td>
                      <td className="text-right tabular-nums">{fmt(r.test_MAE, 2)}</td>
                      <td className="text-right tabular-nums">{fmt(r.rule_gap_MAE, 2)}</td>
                    </tr>
                  ))}
                  {baselines.map((b) => (
                    <tr key={b.model} className="border-b text-slate-500 last:border-0">
                      <td className="py-1.5 italic">baseline: {b.model}</td>
                      <td />
                      <td className="text-right tabular-nums">{fmt(b.cv_R2)}</td>
                      <td className="text-right tabular-nums">{fmt(b.test_R2)}</td>
                      <td /><td />
                      <td className="text-right tabular-nums">{fmt(b.test_MAE, 2)}</td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <Note>Chosen = the simplest model whose CV R² is within 0.02 of the best. Train R² far above CV R² means the model fits label noise (overfitting).</Note>
              <Note tone="amber">New-district R² in red: the model collapses on a district it never saw. With only 7 districts, climate is 7 numbers, and trees and neural nets cannot extrapolate beyond them; lines sometimes can.</Note>
            </div>
          </Panel>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Three ways to test the same model" subtitle="CV = held-out spatial blocks inside training · Test = untouched blocks · New district = leave-one-district-out (clipped at −0.5)">
              <div className="h-72">
                <ResponsiveContainer>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="model" tick={{ fontSize: 11 }} />
                    <YAxis domain={[-0.5, 1]} ticks={[-0.5, 0, 0.25, 0.5, 0.75, 1]} allowDataOverflow tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number, n: string, p: any) => (n === "lodo" ? fmt(p.payload.lodoRaw) : fmt(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => ({ cv: "CV", test: "Test", lodo: "New district" } as Record<string, string>)[v]} />
                    <ReferenceLine y={oracle} stroke="#111827" strokeDasharray="5 3" label={{ value: "oracle", fontSize: 10, position: "right" }} />
                    <ReferenceLine y={0} stroke="#94a3b8" />
                    <Bar dataKey="cv" fill="#93c5fd" />
                    <Bar dataKey="test" fill="#2563eb" />
                    <Bar dataKey="lodo" fill="#f97316" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Bias–variance: decision-tree depth" subtitle="Deeper trees fit training data better (train R² climbs past the ceiling, which is fitting noise) while validation R² peaks and falls.">
              {!curves.data ? <Loading /> : (
                <div className="h-72">
                  <ResponsiveContainer>
                    <LineChart data={depthData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="depth" tick={{ fontSize: 11 }} label={{ value: "max_depth", position: "insideBottom", offset: -2, fontSize: 11 }} />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={ceiling} stroke="#111827" strokeDasharray="5 3" label={{ value: "ceiling", fontSize: 10, position: "right" }} />
                      <Line dataKey="train" name="train R²" stroke="#94a3b8" strokeWidth={2} />
                      <Line dataKey="cv" name="CV R²" stroke="#16a34a" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>
          </div>

          <Panel
            title={`Inspect a model on the test plots: ${model}`}
            right={<Segmented value={model} onChange={setPicked}
              options={MODELS.map((m) => ({ value: m, label: <span style={{ color: MODEL_COLOR[m] }}>{MODEL_SHORT[m]}</span> }))} size="xs" />}
          >
            {!preds.data ? <Loading /> : (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div>
                  <div className="mb-1 text-xs text-slate-500">Predicted vs actual label (points on the dashed line are perfect; vertical spread is mostly label noise)</div>
                  <div className="h-80">
                    <ResponsiveContainer>
                      <ScatterChart margin={{ bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis type="number" dataKey="pred" name="predicted" domain={[0, 100]} tick={{ fontSize: 11 }} label={{ value: "predicted", position: "insideBottom", offset: -4, fontSize: 11 }} />
                        <YAxis type="number" dataKey="y" name="actual" domain={[0, 100]} tick={{ fontSize: 11 }} />
                        <ZAxis range={[14, 14]} />
                        <Tooltip formatter={(v: number) => fmt(v, 1)} />
                        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="#111827" strokeDasharray="5 3" />
                        {Object.keys(DISTRICT_COLOR).map((d) => (
                          <Scatter key={d} name={d} data={scatter.filter((s) => s.district === d)} fill={DISTRICT_COLOR[d]} fillOpacity={0.6} />
                        ))}
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Mean absolute error by district (test)</div>
                    {errorBy.district.map((g) => (
                      <div key={g.group} className="flex items-center gap-2 text-xs">
                        <span className="w-24 truncate">{g.group}</span>
                        <span className="h-2.5 flex-1 rounded bg-slate-100"><span className="block h-2.5 rounded" style={{ width: `${Math.min(100, g.mae * 8)}%`, background: DISTRICT_COLOR[g.group] }} /></span>
                        <span className="w-16 text-right tabular-nums">{fmt(g.mae, 2)} <span className="text-slate-400">n={g.n}</span></span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-500">Real vs imputed soil readings</div>
                    {errorBy.imputed.map((g) => (
                      <div key={g.group} className="flex justify-between text-xs"><span>{g.group}</span><span className="tabular-nums">MAE {fmt(g.mae, 2)} <span className="text-slate-400">n={g.n}</span></span></div>
                    ))}
                  </div>
                  <Note>Label noise SD is {noise} points, so a MAE around {noise ? fmt(noise * 0.8, 1) : "—"} is as low as it can go. Koraput has very few test plots.</Note>
                  {curves.data?.mlp_seed_sd[scheme] && (
                    <Note>MLP across 5 random seeds: test R² SD {fmt(curves.data.mlp_seed_sd[scheme].test)}: the result isn&apos;t a lucky initialisation.</Note>
                  )}
                </div>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
