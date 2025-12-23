// frontend/src/libs/apiClient.js
import { API_BASE } from "../config";

// -----------------------------
// Normalize API base
// -----------------------------
function normalizeBase(b) {
  const s = String(b || "").replace(/\/$/, "");
  if (!s) return "/api";
  if (s.endsWith("/api")) return s;
  if (s.includes("/api/")) return s.replace(/\/$/, "");
  return s + "/api";
}
const API = normalizeBase(API_BASE);

// -----------------------------
// Custom Error with status
// -----------------------------
export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

// -----------------------------
// Token helpers
// -----------------------------
export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fra_token");
}

export function removeToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("fra_token");
  }
}

// -----------------------------
// Auth fetch wrapper
// -----------------------------
export async function authFetch(urlOrPath, options = {}) {
  let finalUrl = urlOrPath;

  if (typeof urlOrPath === "string") {
    if (urlOrPath.startsWith("/")) {
      finalUrl = API + urlOrPath;
    } else if (!/^https?:\/\//i.test(urlOrPath) && !urlOrPath.startsWith(API)) {
      finalUrl = API + (urlOrPath.startsWith("/") ? urlOrPath : "/" + urlOrPath);
    }
  }

  const headers = options.headers ? { ...options.headers } : {};
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (!headers["Content-Type"] && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(finalUrl, { ...options, headers });
}

// -----------------------------
// Current user fetch
// -----------------------------
export async function fetchCurrentUser() {
  const res = await authFetch("/api/me");

  if (!res.ok) {
    // Don’t attach status directly to Error, just throw an object
    throw {
      message: `Failed to fetch current user: ${res.status}`,
      status: res.status
    };
  }

  const json = await res.json().catch(() => null);
  return json?.user ?? json ?? null;
}


