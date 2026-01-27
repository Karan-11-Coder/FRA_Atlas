"use client";

import { PieChart, Pie, Cell, Tooltip } from "recharts";

const COLORS = ["#16a34a", "#f59e0b", "#ef4444"];

export default function StatusPie({ data }: { data: any }) {
  const chartData = [
    { name: "Granted", value: data.granted },
    { name: "Pending", value: data.pending },
    { name: "Reopened", value: data.reopened },
  ];

  return (
    <PieChart width={300} height={250}>
      <Pie data={chartData} dataKey="value" nameKey="name" outerRadius={90}>
        {chartData.map((_, i) => (
          <Cell key={i} fill={COLORS[i]} />
        ))}
      </Pie>
      <Tooltip />
    </PieChart>
  );
}
