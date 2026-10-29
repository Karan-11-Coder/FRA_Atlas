"use client";

import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { useApi, type Target } from "@/lib/api";
import { DISTRICT_COLOR, FEATURE, SCHEME, TARGETS, divergingColor, fmt, scoreColor } from "@/lib/meta";
import { Badge, ErrorBox, Loading, Note, PageHeader, Panel, Segmented, Select } from "@/components/common/ui";

type Tab = "explore" | "distribution" | "correlation" | "structure" | "rules";

interface DatasetView { columns: string[]; rows: (string | number | boolean | null)[][] }
interface EdaView { corr_columns: string[]; corr: number[][]; district_r2: Record<Target, number>; ceiling: Record<Target, number> }
interface StructureView {
  pca: [number, number][]; pca_var: [number, number]; tsne: [number, number][];
  kmeans: Record<"all" | "env", Record<string, { labels: number[]; silhouette: number; inertia: number; ari_district: number }>>;
  views: Record<"all" | "env", string[]>;
}
interface RulesView { score_items: string[]; rules: { if: string[]; then: string[]; support: number; confidence: number; lift: number }[] }

const NUMERIC = ["land_area_ha", "soil_ph", "soil_organic_carbon", "soil_clay_pct", "elevation_m", "groundwater_stress_pct", "rainfall_mm_avg", ...TARGETS];
const CLUSTER_COLORS = ["#2563eb", "#ea580c", "#16a34a", "#9333ea", "#dc2626", "#0891b2", "#ca8a04", "#db2777", "#4b5563", "#65a30d"];
const label = (c: string) => FEATURE[c]?.label ?? (SCHEME[c as Target]?.name ? `${SCHEME[c as Target].name} score` : c);

function useRecords(ds: DatasetView | null) {
  return useMemo(() => {
    if (!ds) return [];
    return ds.rows.map((r) => Object.fromEntries(ds.columns.map((c, i) => [c, r[i]]))) as Record<string, any>[];
  }, [ds]);
}

function Explorer({ records }: { records: Record<string, any>[] }) {
  const [district, setDistrict] = useState("all");
  const [ct, setCt] = useState("all");
  const [split, setSplit] = useState("all");
  const [imp, setImp] = useState("all");
  const [page, setPage] = useState(0);
  const rows = records.filter((r) =>
    (district === "all" || r.district === district) && (ct === "all" || r.claim_type === ct) &&
    (split === "all" || r.split === split) &&
    (imp === "all" || (imp === "imputed" ? r.soil_ph_imputed : !r.soil_ph_imputed)));
  const shown = rows.slice(page * 40, page * 40 + 40);
  const cols = ["plot_id", "district", "claim_type", "land_area_ha", "soil_ph", "soil_organic_carbon", "rainfall_mm_avg", "groundwater_stress_pct", ...TARGETS, "split"];
  return (
    <Panel title={`Synthetic plots (${rows.length} of ${records.length})`}
      subtitle="Each row is a sampled coordinate inside a real district boundary with SoilGrids soil readings; land area and claim type were assigned at random. Imputed soil values are marked."
      right={
        <div className="flex flex-wrap gap-2">
          <Select label="District" value={district} onChange={(v) => { setDistrict(v); setPage(0); }} options={[{ value: "all", label: "All" }, ...Object.keys(DISTRICT_COLOR).map((d) => ({ value: d, label: d }))]} />
          <Select label="Type" value={ct} onChange={(v) => { setCt(v); setPage(0); }} options={["all", "IFR", "CFR", "CR"].map((v) => ({ value: v, label: v === "all" ? "All" : v }))} />
          <Select label="Split" value={split} onChange={(v) => { setSplit(v); setPage(0); }} options={["all", "train", "test"].map((v) => ({ value: v, label: v }))} />
          <Select label="Soil" value={imp} onChange={(v) => { setImp(v); setPage(0); }} options={["all", "real", "imputed"].map((v) => ({ value: v, label: v }))} />
        </div>
      }>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-[11px]">
          <thead className="text-slate-500"><tr className="border-b">{cols.map((c) => <th key={c} className="px-1.5 py-1 text-left font-normal">{SCHEME[c as Target]?.name ?? FEATURE[c]?.label ?? c}</th>)}</tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.plot_id} className="border-b last:border-0">
                {cols.map((c) => {
                  const v = r[c];
                  const isScore = TARGETS.includes(c as Target);
                  return (
                    <td key={c} className="px-1.5 py-1 tabular-nums">
                      {isScore ? <span className="rounded px-1" style={{ background: scoreColor(v) }}>{fmt(v, 0)}</span>
                        : typeof v === "number" ? fmt(v, c.includes("ph") ? 2 : 1) : String(v ?? "")}
                      {(c === "soil_ph" && r.soil_ph_imputed) || (c === "soil_organic_carbon" && r.soil_organic_carbon_imputed) ? <span className="ml-0.5 text-amber-600" title="imputed (district mean)">*</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-0.5 disabled:opacity-40">Prev</button>
        <span>Page {page + 1} / {Math.max(1, Math.ceil(rows.length / 40))}</span>
        <button disabled={(page + 1) * 40 >= rows.length} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-0.5 disabled:opacity-40">Next</button>
        <span className="ml-auto text-slate-500"><span className="text-amber-600">*</span> imputed soil value (district mean)</span>
      </div>
    </Panel>
  );
}

function Distribution({ records }: { records: Record<string, any>[] }) {
  const [col, setCol] = useState("soil_organic_carbon");
  const [by, setBy] = useState<"none" | "district">("district");
  const data = useMemo(() => {
    const vals = records.map((r) => Number(r[col]));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const n = 30, w = (hi - lo) / n || 1;
    const bins = Array.from({ length: n }, (_, i) => ({ x: lo + w * (i + 0.5), all: 0 } as Record<string, number>));
    records.forEach((r) => {
      const i = Math.min(n - 1, Math.floor((Number(r[col]) - lo) / w));
      bins[i].all += 1;
      bins[i][r.district] = (bins[i][r.district] ?? 0) + 1;
    });
    return bins;
  }, [records, col]);
  return (
    <Panel title={`Distribution of ${label(col)}`}
      right={<div className="flex gap-2"><Select value={col} onChange={setCol} options={NUMERIC.map((c) => ({ value: c, label: label(c) }))} />
        <Segmented value={by} onChange={setBy} size="xs" options={[{ value: "district", label: "by district" }, { value: "none", label: "all" }]} /></div>}>
      <div className="h-80">
        <ResponsiveContainer>
          <BarChart data={data} barCategoryGap={0}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmt(v, col.includes("ph") ? 1 : 0)} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => v} labelFormatter={(v: number) => fmt(v, 2)} />
            {by === "district" ? <Legend wrapperStyle={{ fontSize: 10 }} /> : null}
            {by === "district"
              ? Object.keys(DISTRICT_COLOR).map((d) => <Bar key={d} dataKey={d} stackId="a" fill={DISTRICT_COLOR[d]} isAnimationActive={false} />)
              : <Bar dataKey="all" fill="#475569" isAnimationActive={false} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Note>Groundwater and rainfall show 7 spikes: they are one reference value per district. Kandhamal and Koraput soil values pile up on one value: imputed district means.</Note>
    </Panel>
  );
}

function Correlation({ eda }: { eda: EdaView }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Correlation matrix (Pearson)" subtitle="Across all plots. Across-district correlations mix plot effects with district effects; see the Explainability page for within-model views.">
        <div className="overflow-x-auto">
          <table className="text-[10px]">
            <thead><tr><th />{eda.corr_columns.map((c) => <th key={c} className="h-28 w-9 align-bottom font-normal"><div className="w-9 -rotate-45 whitespace-nowrap">{label(c)}</div></th>)}</tr></thead>
            <tbody>
              {eda.corr.map((row, i) => (
                <tr key={i}>
                  <th className="whitespace-nowrap pr-2 text-right font-normal">{label(eda.corr_columns[i])}</th>
                  {row.map((v, j) => (
                    <td key={j} className="h-8 w-9 text-center tabular-nums" style={{ background: divergingColor(v), color: Math.abs(v) > 0.6 ? "white" : undefined }}>{fmt(v, 2)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="How much is just 'which district'?" subtitle="Share of each score's variance explained by the district mean alone, against the best achievable (ceiling).">
        {TARGETS.map((t) => (
          <div key={t} className="mb-2 text-xs">
            <div className="flex justify-between"><span>{SCHEME[t].name}</span><span className="tabular-nums">{fmt(eda.district_r2[t], 2)} / {fmt(eda.ceiling[t], 2)}</span></div>
            <div className="relative h-2.5 rounded bg-slate-100">
              <div className="absolute h-2.5 rounded bg-slate-300" style={{ width: `${eda.ceiling[t] * 100}%` }} />
              <div className="absolute h-2.5 rounded bg-blue-600" style={{ width: `${Math.max(0, eda.district_r2[t]) * 100}%` }} />
            </div>
          </div>
        ))}
        <Note>When the blue bar reaches the grey one (JJM, PMFBY, PMKSY), the score is effectively a district lookup: a model has nothing left to learn about the individual plot.</Note>
      </Panel>
    </div>
  );
}

function Structure({ s, records }: { s: StructureView; records: Record<string, any>[] }) {
  const [proj, setProj] = useState<"pca" | "tsne">("tsne");
  const [color, setColor] = useState<string>("kmeans");
  const [view, setView] = useState<"all" | "env">("env");
  const [k, setK] = useState(3);
  const km = s.kmeans[view][String(k)];
  const coords = proj === "pca" ? s.pca : s.tsne;
  const groups = useMemo(() => {
    const out: Record<string, { x: number; y: number }[]> = {};
    coords.forEach(([x, y], i) => {
      const r = records[i];
      const key = color === "kmeans" ? `cluster ${km.labels[i] + 1}` : color === "district" ? r.district : color === "claim_type" ? r.claim_type
        : `${Math.floor(Number(r[color]) / 20) * 20}–${Math.floor(Number(r[color]) / 20) * 20 + 20}`;
      (out[key] ??= []).push({ x, y });
    });
    return out;
  }, [coords, records, color, km]);
  const keys = Object.keys(groups).sort();
  const groupColor = (key: string, i: number) =>
    color === "district" ? DISTRICT_COLOR[key] : TARGETS.includes(color as Target) ? scoreColor(Number(key.split("–")[0]) + 10) : CLUSTER_COLORS[i % CLUSTER_COLORS.length];
  const kCurve = Object.entries(s.kmeans[view]).map(([kk, v]) => ({ k: Number(kk), silhouette: v.silhouette, ari: v.ari_district }));
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title={`${proj === "pca" ? `PCA (PC1 ${Math.round(s.pca_var[0] * 100)}%, PC2 ${Math.round(s.pca_var[1] * 100)}%)` : "t-SNE (perplexity 30)"}: every plot as a point`}
        subtitle="Both maps use the 9 standardised model features. t-SNE keeps neighbours close; distances between its islands are not meaningful."
        right={<div className="flex flex-wrap gap-2">
          <Segmented value={proj} onChange={setProj} size="xs" options={[{ value: "tsne", label: "t-SNE" }, { value: "pca", label: "PCA" }]} />
          <Select label="Colour" value={color} onChange={setColor} options={[{ value: "kmeans", label: "k-means cluster" }, { value: "district", label: "district" }, { value: "claim_type", label: "claim type" }, ...TARGETS.map((t) => ({ value: t, label: `${SCHEME[t].name} score` }))]} />
        </div>}>
        <div className="h-[420px]">
          <ResponsiveContainer>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" dataKey="x" tick={false} />
              <YAxis type="number" dataKey="y" tick={false} />
              <ZAxis range={[10, 10]} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {keys.map((key, i) => <Scatter key={key} name={key} data={groups[key]} fill={groupColor(key, i)} isAnimationActive={false} />)}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title="k-means" subtitle="Cluster on all 9 features, or only where the plot is (soil + climate).">
        <div className="space-y-3">
          <Segmented value={view} onChange={setView} size="xs" options={[{ value: "env", label: "soil + climate" }, { value: "all", label: "all 9 features" }]} />
          <label className="block text-xs text-slate-600">k = <b className="text-slate-900">{k}</b>
            <input type="range" min={2} max={10} value={k} onChange={(e) => { setK(Number(e.target.value)); setColor("kmeans"); }} className="w-full accent-slate-900" /></label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-slate-50 p-2">Silhouette<b className="block text-base">{fmt(km.silhouette, 3)}</b></div>
            <div className="rounded bg-slate-50 p-2">ARI vs district<b className="block text-base">{fmt(km.ari_district, 3)}</b></div>
          </div>
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={kCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="k" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmt(v, 3)} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line dataKey="silhouette" stroke="#111827" isAnimationActive={false} />
                <Line dataKey="ari" name="ARI vs district" stroke="#2563eb" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Note>On soil + climate, k = 3 separates wet acidic West Tripura, the dry MP/Telangana districts and Odisha. Clusters found with no labels reproduce the scheme atlas.</Note>
        </div>
      </Panel>
    </div>
  );
}

function AssocRules({ r }: { r: RulesView }) {
  const [minConf, setMinConf] = useState(0.8);
  const [minLift, setMinLift] = useState(1.5);
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<"to_score" | "from_score" | "any">("to_score");
  const isScore = (x: string) => r.score_items.includes(x);
  const rows = r.rules.filter((x) =>
    x.confidence >= minConf && x.lift >= minLift &&
    (dir === "any" || (dir === "to_score" ? x.then.every(isScore) && !x.if.some(isScore) : x.if.every(isScore) && !x.then.some(isScore))) &&
    (!q || [...x.if, ...x.then].some((i) => i.toLowerCase().includes(q.toLowerCase()))));
  return (
    <Panel title={`Association rules (${rows.length})`}
      subtitle="Each plot is a basket of yes/no items (claim type, soil & climate bands, and whether each score is in its top or bottom third). Apriori finds 'if A then B' patterns. Support = how common, confidence = P(B | A), lift = how much A raises B's odds."
      right={<div className="flex flex-wrap items-center gap-3 text-xs">
        <Segmented value={dir} onChange={setDir} size="xs" options={[{ value: "to_score", label: "conditions → score" }, { value: "from_score", label: "score → conditions" }, { value: "any", label: "any" }]} />
        <label>conf ≥ <b>{minConf.toFixed(2)}</b><input type="range" min={0.6} max={1} step={0.01} value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} className="ml-1 w-20 align-middle accent-slate-900" /></label>
        <label>lift ≥ <b>{minLift.toFixed(1)}</b><input type="range" min={1.2} max={3} step={0.1} value={minLift} onChange={(e) => setMinLift(Number(e.target.value))} className="ml-1 w-20 align-middle accent-slate-900" /></label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter items…" className="rounded border px-2 py-0.5" />
      </div>}>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white text-slate-500"><tr className="border-b"><th className="py-1 text-left font-normal">If</th><th className="text-left font-normal">Then</th><th className="text-right font-normal">Support</th><th className="text-right font-normal">Confidence</th><th className="text-right font-normal">Lift</th></tr></thead>
          <tbody>
            {rows.slice(0, 200).map((x, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1">{x.if.map((s) => <span key={s} className="mr-1"><Badge tone={isScore(s) ? "blue" : "slate"}>{s}</Badge></span>)}</td>
                <td>{x.then.map((s) => <span key={s} className="mr-1"><Badge tone={isScore(s) ? "blue" : "slate"}>{s}</Badge></span>)}</td>
                <td className="text-right tabular-nums">{fmt(x.support, 3)}</td>
                <td className="text-right tabular-nums">{fmt(x.confidence, 3)}</td>
                <td className="text-right tabular-nums font-semibold">{fmt(x.lift, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2"><Note>The miner rediscovers the scoring rules without being shown them (PM-KISAN high ⇒ IFR; dry + low organic carbon ⇒ JJM high). That is a check on the generator, not evidence about real plots. Note how &quot;acidic soil&quot; and &quot;wet&quot; always travel together: the data can&apos;t separate them.</Note></div>
    </Panel>
  );
}

export default function DataPage() {
  const [tab, setTab] = useState<Tab>("explore");
  const ds = useApi<DatasetView>("/api/lab/views/dataset");
  const eda = useApi<EdaView>(tab === "correlation" ? "/api/lab/views/eda" : null);
  const st = useApi<StructureView>(tab === "structure" ? "/api/lab/views/structure" : null);
  const ar = useApi<RulesView>(tab === "rules" ? "/api/lab/views/assoc_rules" : null);
  const records = useRecords(ds.data);
  return (
    <div className="space-y-5">
      <PageHeader title="Data & structure" subtitle="The training data itself, and the structure unsupervised methods find in it without using any label.">
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: "explore", label: "Explorer" }, { value: "distribution", label: "Distributions" }, { value: "correlation", label: "Correlations" },
          { value: "structure", label: "Clusters & projections" }, { value: "rules", label: "Association rules" },
        ]} />
      </PageHeader>
      <ErrorBox error={ds.error || eda.error || st.error || ar.error} />
      {!ds.data ? <Loading what="Loading 1,540 plots" /> : (
        <>
          {tab === "explore" && <Explorer records={records} />}
          {tab === "distribution" && <Distribution records={records} />}
          {tab === "correlation" && (eda.data ? <Correlation eda={eda.data} /> : <Loading />)}
          {tab === "structure" && (st.data ? <Structure s={st.data} records={records} /> : <Loading what="Loading projections" />)}
          {tab === "rules" && (ar.data ? <AssocRules r={ar.data} /> : <Loading />)}
        </>
      )}
    </div>
  );
}
