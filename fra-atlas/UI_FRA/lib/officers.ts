export async function fetchOfficers() {
  const res = await fetch("http://127.0.0.1:8000/api/officers", {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch officers");
  }

  return res.json();
}

export async function fetchOfficerDashboard(officerId: string) {
  const res = await fetch(
    `http://127.0.0.1:8000/api/officers/${officerId}/dashboard`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("Failed to fetch officer dashboard");
  return res.json();
}

export async function fetchOfficerBreakdown(id: string) {
  const res = await fetch(`http://127.0.0.1:8000/api/officers/${id}/breakdown`);
  return res.json();
}

export async function fetchOfficerTimeline(id: string) {
  const res = await fetch(`http://127.0.0.1:8000/api/officers/${id}/timeline`);
  return res.json();
}

