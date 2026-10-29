"use client";

// Editable claim fields, shared by document review and manual entry.
export type ClaimFieldValues = Record<string, string | number | null | undefined>;

const STATES = ["Madhya Pradesh", "Odisha", "Telangana", "Tripura"];

export const FIELD_DEFS: { key: string; label: string; type?: "number" | "select"; options?: string[]; hint?: string }[] = [
  { key: "state", label: "State", type: "select", options: STATES },
  { key: "district", label: "District" },
  { key: "village", label: "Village" },
  { key: "patta_holder", label: "Patta holder / claimant" },
  { key: "land_area", label: "Land area (ha)", type: "number", hint: "hectares; acres in documents are converted" },
  { key: "claim_type", label: "Claim type", type: "select", options: ["IFR", "CFR", "CR"] },
  { key: "status", label: "Status", type: "select", options: ["Pending", "Granted", "Rejected"] },
  { key: "date", label: "Date" },
  { key: "lat", label: "Latitude", type: "number", hint: "needed to score the claim" },
  { key: "lon", label: "Longitude", type: "number" },
];

export default function ClaimFields({ values, onChange, highlight }: {
  values: ClaimFieldValues;
  onChange: (v: ClaimFieldValues) => void;
  /** keys that came from extraction (shown with a marker) */
  highlight?: Set<string>;
}) {
  const set = (k: string, v: string) => onChange({ ...values, [k]: v === "" ? null : v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {FIELD_DEFS.map((f) => {
        const v = values[f.key];
        const extracted = highlight?.has(f.key) && v !== null && v !== undefined && v !== "";
        return (
          <label key={f.key} className="block text-xs">
            <span className="flex items-center gap-1.5 text-slate-600">
              {f.label}
              {extracted && <span className="rounded bg-blue-100 px-1 text-[10px] text-blue-800">extracted</span>}
            </span>
            {f.type === "select" ? (
              <select
                value={v == null ? "" : String(v)}
                onChange={(e) => set(f.key, e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {(f.options ?? []).concat(v != null && v !== "" && !(f.options ?? []).includes(String(v)) ? [String(v)] : []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                step="any"
                value={v == null ? "" : String(v)}
                onChange={(e) => set(f.key, e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            )}
            {f.hint && <span className="mt-0.5 block text-[10px] text-slate-400">{f.hint}</span>}
          </label>
        );
      })}
    </div>
  );
}

/** Convert form values to the API's types (numbers for numeric fields, nulls dropped). */
export function toPayload(values: ClaimFieldValues) {
  const out: Record<string, string | number> = {};
  for (const f of FIELD_DEFS) {
    const v = values[f.key];
    if (v === null || v === undefined || v === "") continue;
    out[f.key] = f.type === "number" ? Number(v) : String(v);
  }
  return out;
}
