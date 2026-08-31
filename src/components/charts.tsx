"use client";

import { fmtCompact, fmtINR } from "@/lib/format";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,

  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const CHART_COLORS = [
  "rgb(var(--chart-1))",
  "rgb(var(--chart-2))",
  "rgb(var(--chart-3))",
  "rgb(var(--chart-4))",
  "rgb(var(--chart-5))",
  "rgb(var(--chart-6))",
  "rgb(var(--gold))",
  "rgb(var(--positive))",
];

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string; fill?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-md border border-border-strong/50 px-3 py-2 shadow-float"
      style={{ background: "var(--glass-bg)", backdropFilter: "blur(16px)" }}
    >
      {label && <p className="label-caps mb-1.5">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: p.color ?? p.fill }}
          />
          <span className="text-xs text-text-2">{p.name}</span>
          <span className="num ml-auto pl-4 text-xs font-semibold text-text">
            {fmtINR(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

const axisProps = {
  axisLine: false,
  tickLine: false,
  tick: { fontSize: 11 },
} as const;

export function CashFlowChart({
  data,
}: {
  data: { label: string; cashIn: number; cashOut: number; net: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--positive))" stopOpacity={0.3} />
            <stop offset="100%" stopColor="rgb(var(--positive))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--negative))" stopOpacity={0.28} />
            <stop offset="100%" stopColor="rgb(var(--negative))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={fmtCompact} width={52} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgb(var(--border-strong))" }} />
        <Area
          type="monotone"
          dataKey="cashIn"
          name="Cash In"
          stroke="rgb(var(--positive))"
          strokeWidth={2}
          fill="url(#gIn)"
        />
        <Area
          type="monotone"
          dataKey="cashOut"
          name="Cash Out"
          stroke="rgb(var(--negative))"
          strokeWidth={2}
          fill="url(#gOut)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RevenueExpenseBars({
  data,
  height = 280,
}: {
  data: { label: string; revenue: number; expenses: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={3}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={fmtCompact} width={52} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgb(var(--surface-3) / 0.4)" }} />
        <Bar dataKey="revenue" name="Revenue" fill="rgb(var(--chart-2))" radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Bar dataKey="expenses" name="Expenses" fill="rgb(var(--chart-4))" radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ProfitLine({
  data,
  height = 240,
}: {
  data: { label: string; profit: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={fmtCompact} width={52} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgb(var(--border-strong))" }} />
        <Line
          type="monotone"
          dataKey="profit"
          name="Profit"
          stroke="rgb(var(--chart-1))"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CategoryDonut({
  data,
  height = 240,
}: {
  data: { category: string; amount: number }[];
  height?: number;
}) {
  const top = data.slice(0, 6);
  const rest = data.slice(6).reduce((s, d) => s + d.amount, 0);
  const final = rest > 0 ? [...top, { category: "Other", amount: rest }] : top;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Tooltip content={<ChartTooltip />} />
        <Pie
          data={final}
          dataKey="amount"
          nameKey="category"
          innerRadius="62%"
          outerRadius="88%"
          paddingAngle={3}
          strokeWidth={0}
        >
          {final.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export function RevenueSourceBars({
  data,
  height = 280,
}: {
  data: { name: string; amount: number }[];
  height?: number;
}) {
  const trimmed = data.map((d) => ({
    ...d,
    label: d.name.length > 22 ? `${d.name.slice(0, 21)}…` : d.name,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={trimmed}
        layout="vertical"
        margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
        barCategoryGap={10}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" {...axisProps} tickFormatter={fmtCompact} />
        <YAxis
          type="category"
          dataKey="label"
          {...axisProps}
          width={140}
          tick={{ fontSize: 12 }}
        />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ fill: "rgb(var(--surface-3) / 0.4)" }}
        />
        <Bar dataKey="amount" name="Revenue" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {trimmed.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ForecastChart({
  data,
  height = 240,
}: {
  data: { label: string; projected: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gFc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--chart-5))" stopOpacity={0.3} />
            <stop offset="100%" stopColor="rgb(var(--chart-5))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={fmtCompact} width={52} />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="projected"
          name="Projected Balance"
          stroke="rgb(var(--chart-5))"
          strokeWidth={2}
          strokeDasharray="6 4"
          fill="url(#gFc)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
