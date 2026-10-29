"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useApi, type Claim, type DistrictSummary, type ModelsView, type Target } from "@/lib/api";
import { DISTRICT_FILES, SCHEME, STATUS_COLOR, TARGETS, fmt, scoreColor } from "@/lib/meta";
import { Badge, ErrorBox, Loading, Note, PageHeader, Panel, SchemePicker, Stat } from "@/components/common/ui";

const AtlasMap = dynamic(() => import("@/components/map/AtlasMap"), { ssr: false, loading: () => <Loading what="Loading map" /> });

export default function AtlasPage() {
  const districts = useApi<{ districts: DistrictSummary[] }>("/api/lab/views/districts");
  const models = useApi<ModelsView>("/api/lab/views/models");
  const claims = useApi<Claim[]>("/api/claims");
  const [scheme, setScheme] = useState<Target>("jjm_score");
  const [selected, setSelected] = useState<string>("Chhindwara");

  const byName = useMemo(
    () => Object.fromEntries((districts.data?.districts ?? []).map((d) => [d.district, d])),
    [districts.data],
  );
  const fill = useMemo(
    () => Object.fromEntries(Object.keys(DISTRICT_FILES).map((d) => [d, scoreColor(byName[d]?.pred_mean[scheme])])),
    [byName, scheme],
  );
  const tooltip = useMemo(
    () => Object.fromEntries(Object.keys(DISTRICT_FILES).map((d) =>
      [d, `${d}: ${SCHEME[scheme].name} ${fmt(byName[d]?.pred_mean[scheme], 0)}/100`])),
    [byName, scheme],
  );
  const sel = byName[selected];
  const ranked = [...(districts.data?.districts ?? [])].sort((a, b) => b.pred_mean[scheme] - a.pred_mean[scheme]);
  const chosenRow = models.data?.rows.find((r) => r.target === scheme && r.chosen);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Atlas"
        subtitle="Where each scheme's rule-derived suitability is high, district by district. Colour = mean score from the chosen model over the district's 220 synthetic plots; dots are stored claims."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Synthetic plots" value="1,540" hint="220 per district" />
        <Stat label="Districts" value="7" hint="MP · Odisha · Telangana · Tripura" />
        <Stat label="Schemes scored" value="6" />
        <Stat label="Models compared" value={models.data ? models.data.models.length : "…"} hint="per scheme" />
        <Stat label="Stored claims" value={claims.data ? claims.data.length : "…"} hint="Claims & documents page" />
      </div>

      <ErrorBox error={districts.error || models.error} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title={`${SCHEME[scheme].name}: ${SCHEME[scheme].full}`}
          subtitle={chosenRow ? `Chosen model: ${chosenRow.model} · test R² ${fmt(chosenRow.test_R2)} (best possible here ${fmt(chosenRow.test_oracle_R2)})` : undefined}
          right={<SchemePicker value={scheme} onChange={setScheme} />}
        >
          <AtlasMap
            fill={fill}
            tooltip={tooltip}
            selected={selected}
            onSelectDistrict={setSelected}
            claims={claims.data ?? []}
            claimPopup={(c) => (
              <div className="space-y-1 text-xs">
                <div className="font-semibold">{c.patta_holder || `Claim #${c.id}`}</div>
                <div>{[c.village, c.district, c.state].filter(Boolean).join(", ")}</div>
                <div>
                  {c.claim_type ?? "no claim type"} · {c.land_area ?? "?"} ha · {c.status}
                </div>
                <Link href={`/playground?claim=${c.id}`} className="font-medium text-blue-700 underline">
                  Score with every model →
                </Link>
              </div>
            )}
          />
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <span className="flex items-center gap-2">
              Score
              <span className="h-2.5 w-28 rounded" style={{ background: `linear-gradient(90deg, ${scoreColor(20)}, ${scoreColor(55)}, ${scoreColor(90)})` }} />
              20 → 90
            </span>
            {Object.entries(STATUS_COLOR).map(([s, c]) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} /> {s} claim
              </span>
            ))}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel title="District ranking" subtitle={`Mean ${SCHEME[scheme].name} score (chosen model)`}>
            {districts.loading ? <Loading /> : (
              <div className="space-y-1.5">
                {ranked.map((d) => (
                  <button
                    key={d.district}
                    onClick={() => setSelected(d.district)}
                    className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-slate-50 ${selected === d.district ? "bg-slate-100" : ""}`}
                  >
                    <span className="w-24 truncate font-medium">{d.district}</span>
                    <span className="h-3 flex-1 rounded bg-slate-100">
                      <span className="block h-3 rounded" style={{ width: `${d.pred_mean[scheme]}%`, background: scoreColor(d.pred_mean[scheme]) }} />
                    </span>
                    <span className="w-8 text-right tabular-nums">{fmt(d.pred_mean[scheme], 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {sel && (
            <Panel
              title={`${sel.district}, ${sel.state}`}
              subtitle={`${sel.plots} synthetic plots`}
              right={
                <Link href={`/playground?district=${encodeURIComponent(sel.district)}`} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                  Playground <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-slate-50 p-2">Rainfall <b className="block text-sm">{sel.rainfall_mm_avg} mm</b></div>
                <div className="rounded bg-slate-50 p-2">Groundwater stress <b className="block text-sm">{sel.groundwater_stress_pct}%</b></div>
                <div className="rounded bg-slate-50 p-2">Mean soil pH <b className="block text-sm">{fmt(sel.soil_ph_mean, 2)}</b></div>
                <div className="rounded bg-slate-50 p-2">Mean organic C <b className="block text-sm">{fmt(sel.soil_oc_mean, 1)} g/kg</b></div>
              </div>
              {sel.imputed_share > 0.4 && (
                <div className="mt-2">
                  <Note tone="amber">{Math.round(sel.imputed_share * 100)}% of this district&apos;s soil readings are imputed district means: soil-driven scores here are close to a district average.</Note>
                </div>
              )}
              <table className="mt-3 w-full text-xs">
                <thead className="text-slate-500">
                  <tr><th className="text-left font-normal">Scheme</th><th className="text-right font-normal">Model</th><th className="text-right font-normal">Rule</th><th className="text-right font-normal">Label</th></tr>
                </thead>
                <tbody>
                  {TARGETS.map((t) => (
                    <tr key={t} className={t === scheme ? "font-semibold" : ""}>
                      <td className="py-0.5">{SCHEME[t].name}</td>
                      <td className="text-right tabular-nums"><span className="rounded px-1" style={{ background: scoreColor(sel.pred_mean[t]) }}>{fmt(sel.pred_mean[t], 0)}</span></td>
                      <td className="text-right tabular-nums">{fmt(sel.rule_mean[t], 0)}</td>
                      <td className="text-right tabular-nums">{fmt(sel.label_mean[t], 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-500">
                Model = chosen model&apos;s mean prediction; Rule = noiseless scheme_rules.py; Label = rule + noise (what models were trained on).
              </p>
            </Panel>
          )}
        </div>
      </div>

      <Panel title="All districts × all schemes" subtitle="Mean chosen-model score. Wide spreads (JJM, PMKSY, Soil Health Card) are where district climate and soil decide the score; narrow ones (PM-KISAN, MGNREGA) depend on the individual claim.">
        {districts.data && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1 text-left font-normal">District</th>
                  {TARGETS.map((t) => <th key={t} className="py-1 text-center font-normal">{SCHEME[t].name}</th>)}
                </tr>
              </thead>
              <tbody>
                {districts.data.districts.map((d) => (
                  <tr key={d.district}>
                    <td className="py-0.5 pr-2 font-medium">{d.district} <span className="text-slate-400">{d.state}</span></td>
                    {TARGETS.map((t) => (
                      <td key={t} className="p-0.5">
                        <div className={`rounded py-1.5 text-center tabular-nums ${t === scheme ? "ring-2 ring-slate-900" : ""}`} style={{ background: scoreColor(d.pred_mean[t]) }}>
                          {fmt(d.pred_mean[t], 0)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 flex gap-2"><Badge tone="amber">Synthetic data</Badge><Badge>Climate = 1 reference value per district</Badge></div>
      </Panel>
    </div>
  );
}
