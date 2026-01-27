"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

import { fetchOfficerDashboard, fetchOfficerBreakdown, fetchOfficerTimeline } from "@/lib/officers"

import StatusPie from "@/components/charts/StatusPie"
import TimelineBar from "@/components/charts/TimelineBar"

export default function OfficerDashboardPage() {
  const params = useParams()
  const officerId = params.id as string

  const [dashboard, setDashboard] = useState<any>(null)
  const [breakdown, setBreakdown] = useState<any>(null)
  const [timeline, setTimeline] = useState<any>(null)

  async function loadAll() {
    try {
      const d = await fetchOfficerDashboard(officerId)
      const b = await fetchOfficerBreakdown(officerId)
      const t = await fetchOfficerTimeline(officerId)

      setDashboard(d)
      setBreakdown(b)
      setTimeline(t)
    } catch (e) {
      console.error("Dashboard load failed:", e)
    }
  }

  useEffect(() => {
    loadAll()

    // ✅ AUTO REFRESH EVERY 5 SECONDS
    const timer = setInterval(loadAll, 5000)
    return () => clearInterval(timer)
  }, [officerId])

  if (!dashboard) return <div className="p-6">Loading dashboard...</div>

  const { metrics, credibility, alerts } = dashboard

  return (
    <div className="p-6 space-y-8">
      {/* -------------------------
          Page Title
      -------------------------- */}
      <div>
        <h1 className="text-2xl font-bold">
          Officer Credibility Dashboard
        </h1>
        <p className="text-sm text-gray-500">
          Performance, workload & credibility overview
        </p>
      </div>

      {/* -------------------------
          KPI Cards
      -------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI
          title="Credibility Score"
          value={credibility?.score ?? "N/A"}
        />
        <KPI
          title="Cases Assigned"
          value={metrics?.total_assigned ?? 0}
        />
        <KPI
          title="Cases Granted"
          value={metrics?.granted ?? 0}
        />
        <KPI
          title="Avg Resolution (Days)"
          value={metrics?.avg_resolution_days ?? "N/A"}
        />
      </div>

      {/* -------------------------
          Alerts
      -------------------------- */}
      {alerts && alerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 p-4 rounded">
          <h2 className="font-semibold text-red-700 mb-2">
            ⚠ Alerts
          </h2>
          {alerts.map((alert: string, index: number) => (
            <p key={index} className="text-sm text-red-600">
              {alert}
            </p>
          ))}
        </div>
      )}

      {/* -------------------------
          Phase-5 Charts
      -------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Case Status Breakdown */}
        <div className="bg-white border rounded p-4 shadow-sm">
          <h3 className="font-semibold mb-3">
            Case Status Distribution
          </h3>
          <StatusPie data={breakdown} />
        </div>

        {/* Workload Timeline */}
        <div className="bg-white border rounded p-4 shadow-sm">
          <h3 className="font-semibold mb-3">
            Workload Over Time
          </h3>
          <TimelineBar data={timeline} />
        </div>
      </div>
    </div>
  );
}

/* -------------------------
   Reusable KPI Card
-------------------------- */
function KPI({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <div className="bg-white shadow rounded p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
