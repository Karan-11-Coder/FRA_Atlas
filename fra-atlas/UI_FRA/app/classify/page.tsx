"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/lib/api";
import { fmt } from "@/lib/meta";
import { ErrorBox, Loading, Note, PageHeader, Panel, Segmented } from "@/components/common/ui";

interface ClfModel {
  model: string;
  params: Record<string, unknown>;
  cv_f1_macro: number;
  test_accuracy: number;
  test_acc_ci: [number, number];
  test_f1_macro: number;
  test_auc: number;
  confusion: number[][];
  roc: Record<string, { fpr: number[]; tpr: number[]; auc: number }>;
  p_high: number[];
}
interface ClfView {
  classes: string[];
  cuts: [number, number];
  y_test: string[];
  score_test: number[];
  models: ClfModel[];
  sanity: { model: string; test_accuracy: number; test_f1_macro: number; test_auc: number }[];
}

const CLF_COLOR: Record<string, string> = {
  "logistic regression": "#6366f1",
  KNN: "#f59e0b",
  "linear SVM": "#0ea5e9",
  "kernel SVM (RBF)": "#e11d48",
  "naive Bayes": "#94a3b8",
  "decision tree": "#16a34a",
};

function binaryAt(p: number[], truth: boolean[], t: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  p.forEach((v, i) => {
    const pred = v >= t;
    if (pred && truth[i]) tp++;
    else if (pred) fp++;
    else if (truth[i]) fn++;
    else tn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, tn, precision, recall, f1, accuracy: (tp + tn) / p.length };
}

export default function ClassifyPage() {
  const v = useApi<ClfView>("/api/lab/views/classification");
  const [modelName, setModelName] = useState("linear SVM");
  const [rocClass, setRocClass] = useState("high");
  const [threshold, setThreshold] = useState(0.5);

  const m = v.data?.models.find((x) => x.model === modelName);
  const truthHigh = useMemo(() => (v.data?.y_test ?? []).map((y) => y === "high"), [v.data]);
  const at = m ? binaryAt(m.p_high, truthHigh, threshold) : null;
  const prCurve = useMemo(() => {
    if (!m) return [];
    return Array.from({ length: 41 }, (_, i) => i / 40).map((t) => {
      const b = binaryAt(m.p_high, truthHigh, t);
      return { t, precision: b.precision, recall: b.recall, f1: b.f1 };
    });
  }, [m, truthHigh]);

  const rocData = useMemo(() => {
    if (!v.data) return [];
    const pts: Record<string, number | null>[] = [];
    v.data.models.forEach((mm) => {
      const r = mm.roc[rocClass];
      r.fpr.forEach((x, i) => pts.push({ fpr: x, [mm.model]: r.tpr[i] }));
    });
    return pts.sort((a, b) => Number(a.fpr) - Number(b.fpr));
  }, [v.data, rocClass]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Classification"
        subtitle={v.data ? `PMKSY score turned into low / medium / high terciles, with cut points ${v.data.cuts[0]} and ${v.data.cuts[1]} computed on the training plots only. Six classifiers, same features and split as the regression models.` : undefined}
      />
      <ErrorBox error={v.error} />
      {!v.data || !m || !at ? <Loading /> : (
        <>
          <Panel title="Classifier comparison (test set)" subtitle="Tuned by GroupKFold on macro-F1. Click a row to inspect it.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-slate-500">
                  <tr className="border-b"><th className="py-1.5 text-left font-normal">Classifier</th><th className="text-right font-normal">CV macro-F1</th><th className="text-right font-normal">Accuracy (95% CI)</th><th className="text-right font-normal">Macro-F1</th><th className="text-right font-normal">Macro AUC</th><th className="pl-4 text-left font-normal">Params</th></tr>
                </thead>
                <tbody>
                  {v.data.models.map((x) => (
                    <tr key={x.model} onClick={() => setModelName(x.model)}
                      className={`cursor-pointer border-b last:border-0 hover:bg-slate-50 ${x.model === modelName ? "bg-slate-50 font-semibold" : ""}`}>
                      <td className="py-1.5"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: CLF_COLOR[x.model] }} />{x.model}</td>
                      <td className="text-right tabular-nums">{fmt(x.cv_f1_macro)}</td>
                      <td className="text-right tabular-nums">{fmt(x.test_accuracy)} <span className="font-normal text-slate-400">({fmt(x.test_acc_ci[0], 2)}–{fmt(x.test_acc_ci[1], 2)})</span></td>
                      <td className="text-right tabular-nums">{fmt(x.test_f1_macro)}</td>
                      <td className="text-right tabular-nums">{fmt(x.test_auc)}</td>
                      <td className="pl-4 font-mono text-[10px] font-normal text-slate-500">{JSON.stringify(x.params)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3"><Note>Overlapping confidence intervals mean the classifiers are statistically tied. Naive Bayes trails because its &quot;features are independent&quot; assumption is badly wrong here (rainfall and groundwater are the same district fact).</Note></div>
          </Panel>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title={`Confusion matrix: ${m.model}`} subtitle="Rows = true class, columns = predicted class">
              <table className="mx-auto text-sm">
                <thead><tr><th /><th colSpan={3} className="pb-1 text-xs font-normal text-slate-500">predicted</th></tr>
                  <tr><th />{v.data.classes.map((c) => <th key={c} className="px-3 pb-1 text-xs font-medium">{c}</th>)}</tr></thead>
                <tbody>
                  {m.confusion.map((row, i) => {
                    const total = row.reduce((s, x) => s + x, 0);
                    return (
                      <tr key={i}>
                        <th className="pr-3 text-right text-xs font-medium">{v.data!.classes[i]}</th>
                        {row.map((n, j) => (
                          <td key={j} className="p-1">
                            <div className="flex h-16 w-20 flex-col items-center justify-center rounded"
                              style={{ background: i === j ? `rgba(22,163,74,${0.15 + 0.7 * n / Math.max(1, total)})` : `rgba(220,38,38,${0.05 + 0.7 * n / Math.max(1, total)})` }}>
                              <span className="text-lg font-semibold tabular-nums">{n}</span>
                              <span className="text-[10px] text-slate-600">{Math.round((100 * n) / Math.max(1, total))}%</span>
                            </div>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-500">&quot;Medium&quot; is hardest: it sits between two cut points, so label noise (SD 4) can push a plot out on either side.</p>
            </Panel>

            <Panel title="ROC curves (one class vs rest)" right={<Segmented value={rocClass} onChange={setRocClass} options={v.data.classes.map((c) => ({ value: c, label: c }))} size="xs" />}>
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={rocData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="fpr" type="number" domain={[0, 1]} tick={{ fontSize: 11 }} label={{ value: "false positive rate", position: "insideBottom", offset: -2, fontSize: 11 }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(x: number) => fmt(x, 3)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} formatter={(name: string) => `${name} (AUC ${fmt(v.data!.models.find((q) => q.model === name)?.roc[rocClass].auc, 3)})`} />
                    {v.data.models.map((x) => (
                      <Line key={x.model} dataKey={x.model} stroke={CLF_COLOR[x.model]} dot={false} connectNulls isAnimationActive={false}
                        strokeWidth={x.model === modelName ? 2.5 : 1.2} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <Panel title={`Decision threshold for "high": ${m.model}`}
            subtitle="Flag a plot as high-priority when the model's P(high) is above the threshold. Lower it to catch more truly-high plots (recall) at the cost of more false alarms (precision).">
            <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-3">
                <label className="block text-xs text-slate-600">
                  Threshold <b className="text-slate-900 tabular-nums">{threshold.toFixed(2)}</b>
                  <input type="range" min={0} max={1} step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-1 w-full accent-slate-900" />
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-emerald-50 p-2">True positives<b className="block text-base tabular-nums">{at.tp}</b></div>
                  <div className="rounded bg-red-50 p-2">False positives<b className="block text-base tabular-nums">{at.fp}</b></div>
                  <div className="rounded bg-amber-50 p-2">Missed (false negatives)<b className="block text-base tabular-nums">{at.fn}</b></div>
                  <div className="rounded bg-slate-50 p-2">True negatives<b className="block text-base tabular-nums">{at.tn}</b></div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>Precision<b className="block text-base tabular-nums">{fmt(at.precision, 2)}</b></div>
                  <div>Recall<b className="block text-base tabular-nums">{fmt(at.recall, 2)}</b></div>
                  <div>F1<b className="block text-base tabular-nums">{fmt(at.f1, 2)}</b></div>
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer>
                  <LineChart data={prCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="t" type="number" domain={[0, 1]} tick={{ fontSize: 11 }} label={{ value: "threshold", position: "insideBottom", offset: -2, fontSize: 11 }} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(x: number) => fmt(x, 2)} labelFormatter={(t: number) => `threshold ${fmt(t, 2)}`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line dataKey="precision" stroke="#dc2626" dot={false} isAnimationActive={false} />
                    <Line dataKey="recall" stroke="#16a34a" dot={false} isAnimationActive={false} />
                    <Line dataKey="f1" stroke="#111827" strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                    <ReferenceDot x={Math.round(threshold * 40) / 40} y={at.f1} r={4} fill="#111827" stroke="none" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Panel>

          <Panel title="Sanity check: PM-KISAN > 50" subtitle="This class is exactly 'claim type is IFR' in the data. Every classifier should be perfect; if one weren't, the pipeline would be broken.">
            <div className="flex flex-wrap gap-2">
              {v.data.sanity.map((s) => (
                <div key={s.model} className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs">
                  {s.model}: <b>{fmt(s.test_accuracy * 100, 0)}%</b> accuracy
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
