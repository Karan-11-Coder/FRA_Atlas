// UI_FRA/components/workspace/types.ts
export interface WorkspaceClaim {
  id: number | string;
  state?: string | null;
  district?: string | null;
  block?: string | null;
  village?: string | null;
  patta_holder?: string | null;
  address?: string | null;
  land_area?: number | null;
  status?: string | null;
  date?: string | null;
  lat?: number | null;
  lon?: number | null;
  source?: string | null;
  created_at?: string | null;
  [key: string]: any;
}

export interface WorkspaceVillage {
  id: number | string;
  state: string;
  district: string;
  block?: string | null;
  village: string;
  lat: number | null;
  lon: number | null;
}

export const STATE_OPTIONS = ["Madhya Pradesh", "Odisha", "Telangana", "Tripura"];

export function normalizeForKey(raw: unknown): { key: string; display: string } {
  if (raw == null) return { key: "", display: "" };
  const s = String(raw).trim();
  if (!s) return { key: "", display: "" };
  const key = s.replace(/\s+/g, " ").toLowerCase();
  const display = s
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .map((word) => (word.length ? word[0].toUpperCase() + word.slice(1) : ""))
    .join(" ");
  return { key, display };
}

export function buildOptionsFromRows(
  rows: Array<Record<string, any>>,
  filterState: string,
  field: "district" | "village"
): string[] {
  const seen = new Map<string, string>();
  for (const r of rows || []) {
    if (!r) continue;
    if (filterState && (r.state || "").toString().toLowerCase() !== filterState.toLowerCase()) continue;
    const raw = r[field] || "";
    if (!raw) continue;
    const { key, display } = normalizeForKey(raw);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, display);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
