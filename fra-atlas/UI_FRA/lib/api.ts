// UI_FRA/lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const TOKEN_KEY = "fra_atlas_token";

interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  status: number;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// Simple loginRequest (matches your requested lightweight function)
export async function loginRequest(username: string, password: string) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail || "Login failed");
  }
  return res.json();
}

// Token helpers
export function setToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("fra_atlas_token", token);
  }
}
export function getToken(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem(TOKEN_KEY);
  }
  return null;
}
export function clearToken(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
  }
}

// Base fetch wrapper with JWT auth
export const apiFetch = async <T = any>(endpoint: string, options: RequestInit = {}): Promise<T> => {
  const token = getToken();
  const url = `${API_BASE}${endpoint}`;

  const config: RequestInit = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(options.headers || {}),
    },
  };

  try {
    const response = await fetch(url, config);

    // Handle 401 - redirect to login
    if (response.status === 401) {
      clearToken();
      if (typeof window !== "undefined") {
        window.location.href = "/login?message=Session expired - please sign in again";
      }
      throw new ApiError(401, "Session expired");
    }

    // If no JSON body (204, etc.) return empty
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new ApiError(response.status, data?.detail || data?.message || "API request failed");
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    // Network / parsing error
    throw new ApiError(0, "Unable to reach FRA Atlas server. Check your network.");
  }
};

// Multipart upload wrapper — apiFetch always forces Content-Type: application/json,
// which breaks FormData bodies (the browser needs to set its own boundary).
export const apiUpload = async <T = any>(endpoint: string, form: FormData): Promise<T> => {
  const token = getToken();
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  if (response.status === 401) {
    clearToken();
    if (typeof window !== "undefined") {
      window.location.href = "/login?message=Session expired - please sign in again";
    }
    throw new ApiError(401, "Session expired");
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new ApiError(response.status, data?.detail || data?.message || "Upload failed");
  }
  return data as T;
};

export type Claim = { id: number | string } & Record<string, any>;

// API endpoints
export const api = {
  // Authentication — uses the robust apiFetch (returns same shape as your backend)
  login: (credentials: { username: string; password: string }) =>
    apiFetch<{ access_token: string; token_type?: string; expires_in?: number; user?: any }>("/api/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    }),

  // Villages data
  getVillages: () =>
    apiFetch<
      Array<{ id: string; state: string; district: string; block: string | null; village: string; lat: number | null; lon: number | null }>
    >("/api/villages"),

  // Claims data
  getClaims: (params: { state?: string; district?: string; village?: string; status?: string } = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) searchParams.append(key, value);
    });
    const qs = searchParams.toString();
    return apiFetch<Claim[]>(`/api/claims${qs ? `?${qs}` : ""}`);
  },

  getClaimsCount: (village: string) =>
    apiFetch<{ count: number }>(`/api/claims/count?village=${encodeURIComponent(village)}`),

  // Single claim details
  getClaim: (id: string | number) =>
    apiFetch<{ claim: Claim }>(`/api/claims/${id}`),

  createClaim: (payload: Partial<Claim>) =>
    apiFetch<{ success: boolean; claim: Claim }>("/api/claims", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateClaim: (id: string | number, payload: Partial<Claim>) =>
    apiFetch<Claim>(`/api/claims/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteClaim: (id: string | number) =>
    apiFetch<void>(`/api/claims/${id}`, { method: "DELETE" }),

  bulkDeleteClaims: (ids: Array<string | number>) =>
    apiFetch<{ deleted: number }>("/api/claims?confirm=true", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),

  // Document upload → OCR → NER → claim creation
  uploadFra: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiUpload<{ message: string; claim: Claim }>("/api/upload-fra", form);
  },

  // Preview-only parsing (doesn't write to the DB) — used for the review-before-save flow
  parseFra: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiUpload<{ filename: string; extracted_text: string; entities: Record<string, any> }>(
      "/api/claims/parse-fra",
      form
    );
  },

  parseExcel: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiUpload<{ filename: string; rows: Record<string, any>[]; errors: any[] }>(
      "/api/claims/parse-excel",
      form
    );
  },

  commitParsed: (tmpFilename: string) =>
    apiFetch<{ claim: Claim }>(`/api/claims/commit-parsed?tmp_filename=${encodeURIComponent(tmpFilename)}`, {
      method: "POST",
    }),

  deleteTempFile: (tmpFilename: string) =>
    apiFetch<{ ok: boolean }>(`/api/claims/temp/${encodeURIComponent(tmpFilename)}`, { method: "DELETE" }),

  // Direct bulk import (skips the preview step) — used for .xlsx/.csv uploads
  importExcel: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiUpload<{ success: boolean; count: number; claims: Claim[]; errors: any[] }>(
      "/api/claims/import-excel",
      form
    );
  },

  importJson: (rows: Record<string, any>[]) =>
    apiFetch<{ success: boolean; count: number; claims: Claim[]; errors: any[] }>("/api/claims/import-json", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),

  // DSS diagnostics for a claim/coordinate. Note: the scoring behind this
  // endpoint is currently a placeholder (see backend/routes/diagnostics.py) —
  // not real soil/water/groundwater data yet.
  getDiagnostics: (payload: { claim_id?: number; lat?: number; lon?: number; land_area?: number }) =>
    apiFetch<{ metrics: Record<string, any>; recommendations: Array<{ name: string; score: number; reasons: string[] }> }>(
      "/api/diagnostics",
      { method: "POST", body: JSON.stringify(payload) }
    ),

  // Current authenticated officer (validated server-side from the bearer token)
  getMe: () => apiFetch<{ user: { id: string; username: string; full_name: string; role: string } }>("/api/me"),

  // Claim actions — the backend only exposes a generic PUT for status changes,
  // there's no dedicated /verify or /reject route. `comment`/`reason` aren't
  // persisted anywhere server-side yet, so they're accepted here but dropped.
  verifyClaim: (id: string, _comment?: string) =>
    apiFetch(`/api/claims/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "Granted" }),
    }),

  rejectClaim: (id: string, _reason: string) =>
    apiFetch(`/api/claims/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "Rejected" }),
    }),

  // Export
  exportCsv: (params: { state?: string; district?: string } = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) searchParams.append(key, value);
    });
    return `${API_BASE}/api/export/claims.csv?${searchParams.toString()}`;
  },
};

// Backwards-compat: keep default export if other parts import it
export default api;
