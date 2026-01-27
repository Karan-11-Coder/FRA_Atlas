import { fetchOfficers } from "@/lib/officers";
import Link from "next/link";

export default async function OfficersPage() {
  const officers = await fetchOfficers();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Officer Dashboard</h1>

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
                <Link
                  href={`/officers/${o.id}`}
                  className="text-blue-600 underline"
                >
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
    </div>
  );
}
