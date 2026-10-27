import { apiFetch } from "@/lib/api";

// These previously used a bare `fetch()` with no Authorization header, which
// worked only because GET /api/officers and friends had no auth requirement.
// Now that they do (correctly — that data was fully open before), route
// through apiFetch so the token gets attached and a 401 redirects to
// /login like everywhere else in the app, instead of reinventing that
// handling here.

export async function fetchOfficers() {
  return apiFetch<any[]>("/api/officers");
}

export async function fetchOfficerDashboard(officerId: string) {
  return apiFetch<any>(`/api/officers/${officerId}/dashboard`);
}

export async function fetchOfficerBreakdown(id: string) {
  return apiFetch<any>(`/api/officers/${id}/breakdown`);
}

export async function fetchOfficerTimeline(id: string) {
  return apiFetch<any>(`/api/officers/${id}/timeline`);
}
