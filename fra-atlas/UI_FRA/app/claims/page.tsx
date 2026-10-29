"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Download, FileUp, Loader2, Plus, Trash2 } from "lucide-react";
import { API_BASE, del, postJSON, putJSON, upload, useApi, type Claim } from "@/lib/api";
import { STATUS_COLOR, fmt } from "@/lib/meta";
import { Badge, ErrorBox, Loading, Note, PageHeader, Panel, Segmented } from "@/components/common/ui";
import ClaimFields, { toPayload, type ClaimFieldValues } from "@/components/claims/ClaimFields";
import HighlightedText, { SpanLegend, type Span } from "@/components/claims/HighlightedText";

const AtlasMap = dynamic(() => import("@/components/map/AtlasMap"), { ssr: false, loading: () => <Loading what="Loading map" /> });

type Tab = "document" | "sheet" | "table" | "quality";

interface ParseResult {
  filename: string;
  original_name: string;
  extracted_text: string;
  spans: Span[];
  entities: Record<string, unknown>;
  fields: ClaimFieldValues;
  timing_ms: { ocr: number; ner: number };
  text_found: boolean;
}

interface Village { state: string; district: string; village: string; lat: number | null; lon: number | null }

// ---------------------------------------------------------------------------
// Document intake: upload -> OCR -> NER -> review -> save -> score
// ---------------------------------------------------------------------------
function DocumentIntake({ onSaved }: { onSaved: () => void }) {
  const villages = useApi<Village[]>("/api/villages");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "parsing" | "saving">("");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [values, setValues] = useState<ClaimFieldValues>({});
  const [coordNote, setCoordNote] = useState<string>("");
  const [saved, setSaved] = useState<Claim | null>(null);

  async function analyse(file: File) {
    setBusy("parsing");
    setError(null);
    setSaved(null);
    try {
      const r = await upload<ParseResult>("/api/claims/parse-fra", file);
      setParsed(r);
      const v: ClaimFieldValues = { status: "Pending", ...r.fields };
      const match = (villages.data ?? []).find(
        (x) => x.village.toLowerCase() === String(r.fields.village ?? "").toLowerCase() && x.lat != null,
      );
      if (match && v.lat == null) {
        v.lat = match.lat;
        v.lon = match.lon;
        setCoordNote(`Coordinates filled from the villages table (${match.village}, ${match.district}).`);
      } else {
        setCoordNote(v.lat == null ? "No coordinates in the document: click the map to place the claim (needed to score it)." : "");
      }
      setValues(v);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!parsed) return;
    setBusy("saving");
    setError(null);
    try {
      const r = await postJSON<{ claim: Claim }>("/api/claims/commit-parsed", { tmp_filename: parsed.filename, fields: toPayload(values) });
      setSaved(r.claim);
      setParsed(null);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  async function discard() {
    if (parsed) await del(`/api/claims/temp/${parsed.filename}`).catch(() => undefined);
    setParsed(null);
    setValues({});
  }

  const extractedKeys = useMemo(
    () => new Set(Object.entries(parsed?.fields ?? {}).filter(([, v]) => v !== null && v !== "").map(([k]) => k)),
    [parsed],
  );
  const counts = useMemo(() => {
    const s = parsed?.spans ?? [];
    return { regex: s.filter((x) => x.source === "regex").length, spacy: s.filter((x) => x.source === "spacy").length };
  }, [parsed]);

  return (
    <div className="space-y-5">
      <Panel title="1 · Upload a claim document" subtitle="PDF with a text layer is read directly (pdfplumber); scanned pages go through Tesseract OCR. Nothing is saved until you review it.">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept="application/pdf" className="text-sm"
            onChange={(e) => e.target.files?.[0] && analyse(e.target.files[0])} />
          {busy === "parsing" && <span className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Running OCR + NER…</span>}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          No document handy? The repo has three samples in <code>fra-atlas/backend/mock_data/</code>.
        </p>
      </Panel>
      <ErrorBox error={error} />

      {saved && (
        <Note tone="blue">
          Saved claim #{saved.id} ({saved.patta_holder ?? "unnamed"}, {saved.village}).{" "}
          {saved.lat != null ? (
            <Link href={`/playground?claim=${saved.id}`} className="font-semibold underline">Score it with every model →</Link>
          ) : "Add coordinates in the claims table to score it."}{" "}
          <Link href="/" className="underline">See it on the Atlas</Link>
        </Note>
      )}

      {parsed && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel
            title="2 · What the models found"
            subtitle={`${parsed.original_name} · OCR ${parsed.timing_ms.ocr} ms · NER ${parsed.timing_ms.ner} ms · ${counts.regex} rule spans, ${counts.spacy} spaCy entities`}
          >
            {!parsed.text_found ? <Note tone="amber">No text could be extracted from this document.</Note> : (
              <>
                <SpanLegend />
                <div className="mt-2"><HighlightedText text={parsed.extracted_text} spans={parsed.spans} /></div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Hover a highlight to see which extractor found it. Rules read labelled lines (&quot;Village: …&quot;); spaCy&apos;s
                  pretrained English model tags people, places and dates anywhere in the text. Where they disagree, the
                  labelled-field rule wins in the suggested fields.
                </p>
              </>
            )}
          </Panel>

          <Panel title="3 · Review and save" subtitle="Edit anything the extraction got wrong. What you see here is exactly what's saved.">
            <ClaimFields values={values} onChange={setValues} highlight={extractedKeys} />
            {coordNote && <div className="mt-3"><Note tone={values.lat == null ? "amber" : "slate"}>{coordNote}</Note></div>}
            <div className="mt-3">
              <AtlasMap height={220}
                picked={values.lat != null && values.lon != null ? [Number(values.lat), Number(values.lon)] : null}
                onPick={(lat, lon) => { setValues((v) => ({ ...v, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) })); setCoordNote("Location set from the map."); }} />
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={save} disabled={busy === "saving"}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                {busy === "saving" ? "Saving…" : "Save claim"}
              </button>
              <button onClick={discard} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Discard</button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spreadsheet import
// ---------------------------------------------------------------------------
function SheetImport({ onSaved }: { onSaved: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number; errors: { row: number; error: string }[] } | null>(null);
  const cols = ["state", "district", "village", "patta_holder", "land_area", "claim_type", "status", "lat", "lon"];

  async function parse(file: File) {
    setError(null);
    setResult(null);
    try {
      setRows((await upload<{ rows: Record<string, unknown>[] }>("/api/claims/parse-excel", file)).rows);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function doImport() {
    try {
      const r = await postJSON<{ count: number; errors: { row: number; error: string }[] }>("/api/claims/import-json", { rows });
      setResult(r);
      setRows(null);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Panel title="Import claims from a spreadsheet" subtitle="Excel (.xlsx) or CSV, one claim per row. Recognised columns: state, district, village, patta holder / name, land area / area (ha), claim type, status, date, lat, lon.">
      <input type="file" accept=".csv,.xlsx,.xls" className="text-sm" onChange={(e) => e.target.files?.[0] && parse(e.target.files[0])} />
      <div className="mt-3"><ErrorBox error={error} /></div>
      {result && (
        <Note tone="blue">
          Imported {result.count} claim(s).{result.errors.length > 0 && ` ${result.errors.length} row(s) rejected: ` +
            result.errors.map((e) => `row ${e.row}: ${e.error}`).join("; ")}
        </Note>
      )}
      {rows && (
        <>
          <div className="mt-3 max-h-80 overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-100"><tr>{cols.map((c) => <th key={c} className="px-2 py-1 text-left font-medium">{c}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">{cols.map((c) => <td key={c} className="px-2 py-1">{String(r[c] ?? "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={doImport} className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Import {rows.length} row(s)
          </button>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Claims table
// ---------------------------------------------------------------------------
function ClaimsTable({ claims, reload, loading }: { claims: Claim[]; reload: () => void; loading: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ClaimFieldValues>({ status: "Pending" });
  const [error, setError] = useState<string | null>(null);

  const rows = claims.filter((c) =>
    (status === "all" || c.status === status) &&
    (!q || [c.patta_holder, c.village, c.district, c.state].some((v) => (v ?? "").toLowerCase().includes(q.toLowerCase()))));

  async function patch(id: number, body: Record<string, unknown>) {
    try {
      await putJSON(`/api/claims/${id}`, body);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function remove(c: Claim) {
    if (!window.confirm(`Delete claim #${c.id} (${c.patta_holder ?? c.village})? This can't be undone.`)) return;
    try {
      await del(`/api/claims/${c.id}`);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function create() {
    try {
      await postJSON("/api/claims", toPayload(draft));
      setAdding(false);
      setDraft({ status: "Pending" });
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Panel
      title={`Claims (${rows.length} of ${claims.length})`}
      right={
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, village, district…"
            className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
          <Segmented value={status} onChange={setStatus} size="xs"
            options={[{ value: "all", label: "All" }, { value: "Pending", label: "Pending" }, { value: "Granted", label: "Granted" }, { value: "Rejected", label: "Rejected" }]} />
          <a href={`${API_BASE}/api/export/claims.csv`} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs">
            <Download className="h-3 w-3" /> CSV
          </a>
          <button onClick={() => setAdding((a) => !a)} className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs text-white">
            <Plus className="h-3 w-3" /> New claim
          </button>
        </div>
      }
    >
      <ErrorBox error={error} />
      {adding && (
        <div className="mb-4 rounded-lg border border-slate-200 p-3">
          <ClaimFields values={draft} onChange={setDraft} />
          <button onClick={create} className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">Create claim</button>
        </div>
      )}
      {loading ? <Loading /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="text-slate-500">
              <tr className="border-b">
                {["#", "Claimant", "Village / district", "Area (ha)", "Type", "Status", "Source", ""].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="px-2 py-1.5 text-slate-400">{c.id}</td>
                  <td className="px-2 py-1.5 font-medium">{c.patta_holder ?? "—"}</td>
                  <td className="px-2 py-1.5">{c.village ?? "—"}<span className="block text-slate-400">{c.district}, {c.state}</span></td>
                  <td className="px-2 py-1.5 tabular-nums">{c.land_area != null ? fmt(c.land_area, 2) : "—"}</td>
                  <td className="px-2 py-1.5">
                    <select value={c.claim_type ?? ""} onChange={(e) => patch(c.id, { claim_type: e.target.value || null })}
                      className="rounded border border-slate-200 bg-white px-1 py-0.5">
                      <option value="">—</option><option>IFR</option><option>CFR</option><option>CR</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={c.status ?? "Pending"} onChange={(e) => patch(c.id, { status: e.target.value })}
                      className="rounded border px-1 py-0.5" style={{ borderColor: STATUS_COLOR[c.status ?? ""] ?? "#cbd5e1" }}>
                      <option>Pending</option><option>Granted</option><option>Rejected</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5"><Badge>{c.source ?? "manual"}</Badge></td>
                  <td className="px-2 py-1.5 text-right">
                    {c.lat != null ? (
                      <Link href={`/playground?claim=${c.id}`} className="mr-3 font-medium text-blue-700">Score</Link>
                    ) : <span className="mr-3 text-slate-400" title="No coordinates">no coords</span>}
                    <button onClick={() => remove(c)} className="text-slate-400 hover:text-red-600" title="Delete">
                      <Trash2 className="inline h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Extraction quality
// ---------------------------------------------------------------------------
interface Quality {
  documents: { document: string; chars: number; ocr_ms: number; ner_ms: number;
    fields: Record<string, { expected: unknown; pipeline: unknown; pipeline_ok: boolean }>;
    spacy_only: Record<string, boolean | null> }[];
  per_field: Record<string, { pipeline: number; spacy_only: number | null }>;
  pipeline_accuracy: number;
  note: string;
}

function ExtractionQuality() {
  const q = useApi<Quality>("/api/lab/extraction-quality");
  if (q.loading) return <Loading what="Running OCR + NER on the sample documents" />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const d = q.data;
  const pct = (v: number | null) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
  return (
    <div className="space-y-5">
      <Note tone="amber">{d.note}</Note>
      <Panel title="Field accuracy: full pipeline vs spaCy alone"
        subtitle="Pipeline = labelled-line rules + normaliser (what the app saves). spaCy alone = would its pretrained PERSON / GPE / DATE entities have found the right value? n/a = not something a generic NER model tags.">
        <table className="w-full max-w-2xl text-xs">
          <thead className="text-slate-500"><tr><th className="py-1 text-left font-normal">Field</th><th className="text-left font-normal">Pipeline</th><th className="text-left font-normal">spaCy only</th></tr></thead>
          <tbody>
            {Object.entries(d.per_field).map(([f, v]) => (
              <tr key={f} className="border-t">
                <td className="py-1.5 font-medium">{f}</td>
                <td><span className="inline-block h-2 rounded bg-emerald-500 align-middle" style={{ width: v.pipeline * 120 }} /> {pct(v.pipeline)}</td>
                <td>{v.spacy_only == null ? <span className="text-slate-400">n/a</span> : <><span className="inline-block h-2 rounded bg-violet-500 align-middle" style={{ width: v.spacy_only * 120 }} /> {pct(v.spacy_only)}</>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-600">
          Overall pipeline field accuracy: <b>{pct(d.pipeline_accuracy)}</b>. On structured forms like these, labelled-line rules beat a
          general-purpose NER model; spaCy earns its place on free text where there are no labels.
        </p>
      </Panel>
      <Panel title="Per document">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="text-slate-500"><tr><th className="py-1 text-left font-normal">Document</th><th className="text-right font-normal">Chars</th><th className="text-right font-normal">OCR ms</th><th className="text-right font-normal">NER ms</th><th className="pl-4 text-left font-normal">Fields (✓ correct · ✗ wrong)</th></tr></thead>
            <tbody>
              {d.documents.map((doc) => (
                <tr key={doc.document} className="border-t align-top">
                  <td className="py-1.5 font-medium">{doc.document}</td>
                  <td className="text-right tabular-nums">{doc.chars}</td>
                  <td className="text-right tabular-nums">{doc.ocr_ms}</td>
                  <td className="text-right tabular-nums">{doc.ner_ms}</td>
                  <td className="pl-4">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(doc.fields).map(([f, v]) => (
                        <span key={f} title={`expected ${String(v.expected)} · got ${String(v.pipeline)}`}
                          className={`rounded px-1.5 py-0.5 ${v.pipeline_ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
                          {v.pipeline_ok ? "✓" : "✗"} {f}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default function ClaimsPage() {
  const [tab, setTab] = useState<Tab>("document");
  const claims = useApi<Claim[]>("/api/claims");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Claims & documents"
        subtitle="Document AI for FRA claims: OCR reads the form, rule-based extraction and spaCy NER pull out the fields, you review them, and the saved claim can be scored by every model."
      >
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: "document", label: <span className="inline-flex items-center gap-1"><FileUp className="h-3 w-3" /> Document intake</span> },
          { value: "sheet", label: "Spreadsheet import" },
          { value: "table", label: `Claims${claims.data ? ` (${claims.data.length})` : ""}` },
          { value: "quality", label: "Extraction quality" },
        ]} />
      </PageHeader>
      {tab === "document" && <DocumentIntake onSaved={claims.reload} />}
      {tab === "sheet" && <SheetImport onSaved={claims.reload} />}
      {tab === "table" && <ClaimsTable claims={claims.data ?? []} reload={claims.reload} loading={claims.loading} />}
      {tab === "quality" && <ExtractionQuality />}
      <ErrorBox error={claims.error} />
    </div>
  );
}
