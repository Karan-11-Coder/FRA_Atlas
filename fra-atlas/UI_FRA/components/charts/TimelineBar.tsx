"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

export default function TimelineBar({ data }: { data: any[] }) {
  return (
    <BarChart width={500} height={250} data={data}>
      <XAxis dataKey="date" />
      <YAxis />
      <Tooltip />
      <Bar dataKey="count" fill="#2563eb" />
    </BarChart>
  );
}
