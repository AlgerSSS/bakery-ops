"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Dot } from "recharts";

export function TrendChart({ data, productNames, colors, dayTypeColor }: {
  data: Record<string, unknown>[];
  productNames: string[];
  colors: string[];
  dayTypeColor: Record<string, string>;
}) {
  const renderDot = (props: { cx?: number; cy?: number; payload?: Record<string, unknown> }) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    const dt = payload.dayType as string;
    return <Dot cx={cx} cy={cy} r={4} fill={dayTypeColor[dt] || "#ccc"} stroke="#fff" strokeWidth={1} />;
  };

  const maxByProduct: Record<string, number> = {};
  for (const name of productNames) {
    let mx = 0;
    for (const row of data) {
      const v = Number(row[name]) || 0;
      if (v > mx) mx = v;
    }
    maxByProduct[name] = mx;
  }
  const allMaxes = Object.values(maxByProduct);
  const globalMax = Math.max(...allMaxes, 1);
  const sorted = [...allMaxes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const needDualAxis = productNames.length >= 2 && globalMax > median * 5;

  const rightAxisProducts = new Set<string>();
  if (needDualAxis) {
    for (const name of productNames) {
      if (maxByProduct[name] > median * 3) rightAxisProducts.add(name);
    }
    if (rightAxisProducts.size === productNames.length) rightAxisProducts.clear();
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={data} margin={{ top: 5, right: rightAxisProducts.size > 0 ? 60 : 30, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
        {rightAxisProducts.size > 0 && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="#86868b" />}
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
          labelFormatter={(label, payload) => {
            if (payload && payload.length > 0) {
              const p = payload[0]?.payload as Record<string, unknown> | undefined;
              const dt = p?.dayType as string;
              const dtLabels: Record<string, string> = { monThu: "周中", friday: "周五", weekend: "周末" };
              return `${p?.fullDate || label} (${dtLabels[dt] || ""})`;
            }
            return String(label);
          }}
        />
        <Legend />
        {productNames.map((name, i) => (
          <Line key={name} type="monotone" dataKey={name} yAxisId={rightAxisProducts.has(name) ? "right" : "left"} stroke={colors[i % colors.length]} strokeWidth={2} dot={renderDot} activeDot={{ r: 6 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
