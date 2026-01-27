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
      throw new ApiError(response.status, data?.message || "API request failed");
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    // Network / parsing error
    throw new ApiError(0, "Unable to reach FRA Atlas server. Check your network.");
  }
};

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
  getClaims: (params: { state?: string; district?: string; village?: string } = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) searchParams.append(key, value);
    });
    const qs = searchParams.toString();
    return apiFetch<Array<any>>(`/api/claims${qs ? `?${qs}` : ""}`);
  },

  // Single claim details
  getClaim: (id: string) =>
    apiFetch<any>(`/api/claims/${id}`),

  // Claim actions (adjust endpoints to your backend naming)
  verifyClaim: (id: string, comment?: string) =>
    apiFetch(`/api/claims/${id}/verify`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),

  rejectClaim: (id: string, reason: string) =>
    apiFetch(`/api/claims/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  // Export
  exportCsv: (params: { state?: string; district?: string } = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) searchParams.append(key, value);
    });
    return `${API_BASE}/api/export/claims.csv?${searchParams.toString()}`;
  },

  // Debug (development only)
  getDebugInfo: () => apiFetch("/api/_debug_db_info"),
};

// Backwards-compat: keep default export if other parts import it
export default api;
