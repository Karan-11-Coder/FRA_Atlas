"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi, type ModelsView, type Target } from "@/lib/api";
import { FEATURE, FEATURES, MODEL_COLOR, MODEL_SHORT, MODELS, SCHEME, fmt } from "@/lib/meta";
import { ErrorBox, Loading, ModelDot, Note, PageHeader, Panel, SchemePicker, Select } from "@/components/common/ui";

interface ExplainView {
  importance: Record<Target, Record<string, Record<string, number>>>;
  pdp: Record<Target, Record<string, Record<string, number[]>>>;
  grids: Record<string, number[]>;
  claim_types: string[];
  ablation: Record<Target, { importance: Record<string, number>; test_R2: number; lodo_R2: number }>;
  rule_inputs: Record<Target, string[]>;
  ablation_extra: string[];
}

export default function ExplainPage() {
  const ex = useApi<ExplainView>("/api/lab/views/explain");
  const models = useApi<ModelsView>("/api/lab/views/models");
  const [scheme, setScheme] = useState<Target>("pmfby_score");
  const [feature, setFeature] = useState<string>("rainfall_mm_avg");

  const ruleInputs = new Set(ex.data?.rule_inputs[scheme] ?? []);
  const imp = ex.data?.importance[scheme];
  const maxImp = useMemo(() => Math.max(0.0001, ...Object.values(imp ?? {}).flatMap((r) => Object.values(r))), [imp]);

  const pdpData = useMemo(() => {
    if (!ex.data) return [];
    const curves = ex.data.pdp[scheme];
    const xs = feature === "claim_type" ? ex.data.claim_types : ex.data.grids[feature];
    return xs.map((x, i) => {
      const row: Record<string, number | string> = { x };
      for (const m of [...MODELS, "rule"]) row[m] = curves[m]?.[feature]?.[i];
      return row;
    });
  }, [ex.data, scheme, feature]);

  const abl = ex.data?.ablation[scheme];
  const rfRow = models.data?.rows.find((r) => r.target === scheme && r.model === "random forest");
  const ablData = abl ? Object.entries(abl.importance).map(([f, v]) => ({
    feature: FEATURE[f]?.label ?? f, value: Math.max(0, v), extra: ex.data!.ablation_extra.includes(f),
  })).sort((a, b) => b.value - a.value) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Explainability"
        subtitle="What each model actually relies on, compared with what the rule really reads. Outlined cells are the rule's true inputs; importance anywhere else is a model leaning on a proxy."
      >
        <SchemePicker value={scheme} onChange={setScheme} />
      </PageHeader>
      <ErrorBox error={ex.error || models.error} />
      {!ex.data || !imp ? <Loading /> : (
        <>
          <Panel title={`Permutation importance: ${SCHEME[scheme].name}`}
            subtitle="How much test R² drops when one input is shuffled. Computed on the held-out test plots for each model.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 text-left font-normal">Model</th>
                    {FEATURES.map((f) => (
                      <th key={f} className="py-1 text-center font-normal">
                        {FEATURE[f].label}{ruleInputs.has(f) && <span className="ml-1 text-emerald-700">●</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODELS.map((m) => (
                    <tr key={m}>
                      <td className="py-0.5 pr-2"><ModelDot model={m} chosen={models.data?.chosen[scheme] === m} /></td>
                      {FEATURES.map((f) => {
                        const v = Math.max(0, imp[m]?.[f] ?? 0);
                        return (
                          <td key={f} className="p-0.5">
                            <div className={`rounded py-1.5 text-center tabular-nums ${ruleInputs.has(f) ? "ring-2 ring-emerald-600" : ""}`}
                              style={{ background: `rgba(37, 99, 235, ${0.04 + 0.85 * (v / maxImp)})`, color: v / maxImp > 0.55 ? "white" : undefined }}>
                              {fmt(v, 2)}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <Note>● and outline = an input the scheme&apos;s rule really uses. Rainfall and groundwater are both one value per district, so a model can credit either for the same district effect.</Note>
              <Note tone="amber">Try PMFBY: its rule reads only rainfall. Any importance a model gives to soil pH or groundwater there is that input standing in for &quot;which district&quot;, because pH and climate move together across these 7 districts. An explanation built on it would mislead an officer.</Note>
            </div>
          </Panel>

          <Panel title={`Partial dependence: ${SCHEME[scheme].name} vs ${FEATURE[feature].label}`}
            subtitle="Average prediction over the test plots as one input is set to each value (others left as they are). The black dashed line is the rule itself."
            right={<Select label="Input" value={feature} onChange={setFeature} options={FEATURES.map((f) => ({ value: f, label: FEATURE[f].label }))} />}>
            <div className="h-80">
              <ResponsiveContainer>
                {feature === "claim_type" ? (
                  <BarChart data={pdpData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="x" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => fmt(v, 1)} />
                    <Legend formatter={(v: string) => MODEL_SHORT[v] ?? v} wrapperStyle={{ fontSize: 11 }} />
                    {["rule", ...MODELS].map((m) => <Bar key={m} dataKey={m} fill={MODEL_COLOR[m]} />)}
                  </BarChart>
                ) : (
                  <LineChart data={pdpData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmt(v, feature === "soil_ph" ? 1 : 0)} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => fmt(v, 1)} labelFormatter={(v: number) => `${FEATURE[feature].label} = ${fmt(v, 2)}`} />
                    <Legend formatter={(v: string) => MODEL_SHORT[v] ?? v} wrapperStyle={{ fontSize: 11 }} />
                    {["rule", ...MODELS].map((m) => (
                      <Line key={m} dataKey={m} stroke={MODEL_COLOR[m]} dot={false} strokeWidth={m === "rule" ? 2.5 : 1.6}
                        strokeDasharray={m === "rule" ? "6 3" : undefined} isAnimationActive={false} />
                    ))}
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Rainfall and groundwater only take 7 values in training (one per district), so between and beyond those points each
              model&apos;s curve is pure interpolation or extrapolation.
            </p>
          </Panel>

          <Panel title="Ablation: what happens if lat / lon / elevation / clay go back in?"
            subtitle="Random forest retrained with four inputs no rule uses. They soak up importance as district proxies and usually hurt transfer to a new district.">
            {abl && rfRow && (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="h-72">
                  <ResponsiveContainer>
                    <BarChart data={ablData} layout="vertical" margin={{ left: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="feature" tick={{ fontSize: 11 }} width={120} />
                      <Tooltip formatter={(v: number) => fmt(v, 3)} />
                      <Bar dataKey="value" name="importance" fill="#0d9488" shape={(p: any) => (
                        <rect x={p.x} y={p.y} width={Math.max(0, p.width)} height={p.height} fill={p.payload.extra ? "#f97316" : "#0d9488"} rx={2} />
                      )} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 text-xs">
                  <table className="w-full">
                    <thead className="text-slate-500"><tr><th className="text-left font-normal">Random forest</th><th className="text-right font-normal">Test R²</th><th className="text-right font-normal">New district</th></tr></thead>
                    <tbody>
                      <tr><td>rule inputs only</td><td className="text-right tabular-nums">{fmt(rfRow.test_R2)}</td><td className="text-right tabular-nums">{fmt(rfRow.lodo_R2)}</td></tr>
                      <tr><td>+ lat/lon/elev/clay</td><td className="text-right tabular-nums">{fmt(abl.test_R2)}</td><td className="text-right tabular-nums">{fmt(abl.lodo_R2)}</td></tr>
                    </tbody>
                  </table>
                  <Note><span className="font-semibold text-orange-600">Orange</span> = inputs no rule reads. Any importance they get is the model memorising where a plot is rather than learning why it scores.</Note>
                </div>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
