"use client";

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// Recharts passes these to a custom tooltip at runtime; type locally to stay version-agnostic.
type TipProps = {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string; value?: number | string }>;
};

// Market-Blocks palette — flat fills, hard ink strokes, no gradients (matches globals.css).
const INK = "#231b12";
const GREEN = "#15694E";
const GREEN_D = "#0E4838";
const CLAY = "#C9542A";
const OCHRE = "#E0A52F";
const CREAM = "#F6ECD9";
const SAND = "#9a8c74";

const card: React.CSSProperties = {
  border: "2.5px solid var(--ink)",
  background: "var(--cream)",
  padding: "14px 12px 8px",
  marginBottom: 14,
  boxShadow: "5px 5px 0 var(--ink)",
};
const title: React.CSSProperties = {
  fontFamily: "var(--display)",
  fontWeight: 800,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: ".08em",
  color: "var(--clay)",
  marginBottom: 10,
};

function BrandTooltip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: INK, color: CREAM, border: `2px solid ${INK}`, padding: "6px 9px", fontSize: 12, fontWeight: 700 }}>
      {label && <div style={{ opacity: 0.7, fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
}

export function StateDonut(props: {
  active: number;
  completed: number;
  defaulted: number;
  dissolved: number;
  forming: number;
}) {
  const data = [
    { name: "Active", value: props.active, fill: GREEN },
    { name: "Completed", value: props.completed, fill: GREEN_D },
    { name: "Forming", value: props.forming, fill: OCHRE },
    { name: "Defaulted", value: props.defaulted, fill: CLAY },
    { name: "Dissolved", value: props.dissolved, fill: SAND },
  ].filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return null;
  return (
    <div style={card}>
      <div style={title}>Circle lifecycle</div>
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={52}
            outerRadius={88}
            paddingAngle={2}
            stroke={INK}
            strokeWidth={2.5}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip content={<BrandTooltip />} />
          <Legend
            iconType="square"
            wrapperStyle={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CountBars(props: {
  title?: string;
  data: { name: string; value: number }[];
  color?: string;
}) {
  const fills = [GREEN, CLAY, OCHRE, INK, GREEN_D];
  return (
    <div style={card}>
      <div style={title}>{props.title ?? "Activity"}</div>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={props.data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fontWeight: 700, fill: INK }}
            axisLine={{ stroke: INK }}
            tickLine={false}
            interval={0}
          />
          <YAxis tick={{ fontSize: 10, fill: INK }} axisLine={{ stroke: INK }} tickLine={false} allowDecimals={false} width={40} />
          <Tooltip content={<BrandTooltip />} cursor={{ fill: "rgba(35,27,18,0.06)" }} />
          <Bar dataKey="value" stroke={INK} strokeWidth={2} isAnimationActive={false}>
            {props.data.map((_, i) => (
              <Cell key={i} fill={props.color ?? fills[i % fills.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ReputationSplit(props: { positive: number; negative: number }) {
  const data = [
    { name: "Positive", value: props.positive, fill: GREEN },
    { name: "Negative", value: props.negative, fill: CLAY },
  ].filter((d) => d.value > 0);
  if (!data.length) return null;
  return (
    <div style={card}>
      <div style={title}>ERC-8004 reputation signals</div>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            outerRadius={80}
            stroke={INK}
            strokeWidth={2.5}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip content={<BrandTooltip />} />
          <Legend iconType="square" wrapperStyle={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
