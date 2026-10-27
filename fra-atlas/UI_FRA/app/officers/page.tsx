"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/protected-route";
import { fetchOfficers } from "@/lib/officers";

export default function OfficersPage() {
  const [officers, setOfficers] = useState<any[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchOfficers()
      .then(setOfficers)
      .catch((err) => setError(err?.message || "Failed to load officers"));
  }, []);

  return (
    <ProtectedRoute>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Officer Dashboard</h1>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-4">{error}</div>}
        {!officers && !error && <div className="text-sm text-muted-foreground">Loading officers…</div>}

        {officers && (
          <table className="w-full border">
            <thead className="bg-gray-100">
              <tr>
                <th>Name</th>
                <th>District</th>
                <th>Credibility</th>
                <th>Assigned</th>
                <th>Pending</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {officers.map((o: any) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td>
                    <Link href={`/officers/${o.id}`} className="text-blue-600 underline">
                      {o.full_name}
                    </Link>
                  </td>
                  <td>{o.district}</td>
                  <td>{o.credibility_score}</td>
                  <td>{o.total_assigned}</td>
                  <td>{o.pending}</td>
                  <td>{o.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ProtectedRoute>
  );
}
