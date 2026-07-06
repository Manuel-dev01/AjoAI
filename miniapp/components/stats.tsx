"use client";

import { useCallback, useEffect, useState } from "react";
import { apyLabel } from "@/lib/yield";

// Shared on-chain metrics types, fetch hook, formatters and Market-Blocks stat components — used by
// the in-app stats page (/app/stats) and the public charts dashboard (/dashboard).

export interface Metrics {
  chain: string;
  chainId: number;
  timestamp: string;
  circlesCreated: number;
  completed: number;
  defaulted: number;
  dissolved: number;
  active: number;
  forming: number;
  uniqueMembers: number;
  contributionCount: number;
  lateContributions: number;
  totalContributions: string; // wei string
  payoutCount: number;
  totalPayouts: string; // wei string
  defaultsTriggered: number;
  reputationSignals: number;
  positiveSignals: number;
  negativeSignals: number;
  agentTxCount: number;
  yieldDeposits?: number;
  yieldWithdrawals?: number;
  totalYield?: string; // wei string (simulated)
  stale?: boolean; // served from a snapshot (live overlay unavailable)
  snapshotAt?: string; // when the snapshot itself was last written (agent ingest / cron)
}

// ── formatters ─────────────────────────────────────────────────────────────
export function fmt(weiStr: string, decimals = 18): string {
  const n = Number(weiStr) / 10 ** decimals;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(n < 10 ? 2 : 0);
}

export function timeAgo(ts: string): string {
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ── data hook ────────────────────────────────────────────────────────────────
export function useMetrics() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25_000);
      const res = await fetch("/api/metrics", { cache: "no-store", signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Request timed out — chain may be slow, try again");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load };
}

// ── presentational components (Market Blocks) ────────────────────────────────
export function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ ...cardBase, borderTopColor: color }}>
      <div style={cardValue}>{value}</div>
      <div style={cardLabel}>{label}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

export function Row({ k, v, color }: { k: string; v: string | number; color?: string }) {
  return (
    <div className="lrow">
      <span>{k}</span>
      <span className="v" style={color ? { color } : undefined}>
        {v}
      </span>
    </div>
  );
}

export function Hero({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={heroCard}>
      <div style={heroLabel}>{label}</div>
      <div style={heroValue}>{value}</div>
      {sub && <div style={heroSub}>{sub}</div>}
    </div>
  );
}

// Honest freshness signal: the snapshot's own write time (snapshotAt), not the request time.
// When the agent stops pushing, this stops advancing even though the headline numbers stay live —
// so a paused agent is visible instead of masquerading as fresh.
function Freshness({ at }: { at?: string }) {
  const ms = at ? Date.parse(at) : NaN;
  if (Number.isNaN(ms)) return null;
  const ageMin = Math.max(0, (Date.now() - ms) / 60_000);
  const stale = ageMin > 90; // agent sweeps every ~30s + daily cron backstop — >90m means it's down
  const rel =
    ageMin < 1 ? "just now" : ageMin < 60 ? `${Math.round(ageMin)}m ago`
      : ageMin < 1440 ? `${Math.round(ageMin / 60)}h ago` : `${Math.round(ageMin / 1440)}d ago`;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
      padding: "3px 9px", marginBottom: 10, border: "2px solid var(--ink)",
      color: stale ? "var(--ink)" : "var(--green)", background: stale ? "var(--ochre)" : "transparent",
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: stale ? "var(--ink)" : "var(--green)" }} />
      {stale ? `⚠ Last synced ${rel} — agent may be paused` : `Synced ${rel}`}
    </div>
  );
}

// The numbers-only dashboard (shared by /app/stats and the public dashboard's text panel).
export function MetricsDashboard({ data }: { data: Metrics }) {
  const activeNow = data.circlesCreated - data.completed - data.defaulted - data.dissolved;
  return (
    <>
      <Freshness at={data.snapshotAt} />
      <Hero
        label="Total value processed"
        value={
          <>
            {fmt(data.totalContributions)} <span style={{ fontSize: 14, opacity: 0.6 }}>tokens</span>
          </>
        }
        sub={`${data.contributionCount} contributions · ${data.payoutCount} payouts`}
      />

      <div style={grid}>
        <StatCard label="Circles" value={data.circlesCreated} color="var(--green)" />
        <StatCard label="Members" value={data.uniqueMembers} color="var(--clay)" />
        <StatCard label="Agent txs" value={data.agentTxCount} color="var(--ochre)" />
        <StatCard label="Circles defaulted" value={data.defaultsTriggered} color="var(--ink)" />
      </div>

      <Section title="Circle lifecycle">
        <Row k="Active" v={data.active || activeNow} color="var(--green)" />
        <Row k="Completed" v={data.completed} color="var(--green)" />
        <Row k="Defaulted" v={data.defaulted} color="var(--clay)" />
        <Row k="Dissolved" v={data.dissolved} />
        <Row k="Forming" v={data.forming} />
      </Section>

      <Section title="Financial activity">
        <Row k="Total contributed" v={`${fmt(data.totalContributions)} tokens`} />
        <Row k="Contributions" v={data.contributionCount} />
        <Row k="Late payments" v={data.lateContributions} color={data.lateContributions > 0 ? "var(--ochre)" : undefined} />
        <Row k="Total distributed" v={`${fmt(data.totalPayouts)} tokens`} />
        <Row k="Payouts" v={data.payoutCount} />
      </Section>

      <Section title="ERC-8004 Reputation">
        <Row k="Total signals" v={data.reputationSignals} />
        <Row k="Positive" v={`+${data.positiveSignals}`} color="var(--green)" />
        <Row k="Negative" v={`-${data.negativeSignals}`} color="var(--clay)" />
      </Section>

      <Section title="Capital efficiency — idle-fund yield">
        <Row k="Strategy" v={`${apyLabel()} · Aave V3 Celo (sim)`} color="var(--green)" />
        <Row
          k="Yield earned"
          v={`${fmt(data.totalYield ?? "0")} tokens`}
          color={Number(data.totalYield ?? 0) > 0 ? "var(--green)" : undefined}
        />
        <Row k="Idle-fund parks" v={data.yieldDeposits ?? 0} />
      </Section>
    </>
  );
}

// ── shared styles ────────────────────────────────────────────────────────────
const heroCard: React.CSSProperties = {
  background: "var(--ink)",
  color: "var(--cream)",
  padding: "20px 18px",
  border: "2.5px solid var(--ink)",
  marginBottom: 14,
  textAlign: "center",
};
const heroLabel: React.CSSProperties = {
  fontFamily: "var(--display)",
  fontWeight: 800,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: ".06em",
  opacity: 0.7,
  marginBottom: 4,
};
const heroValue: React.CSSProperties = {
  fontFamily: "var(--display)",
  fontWeight: 800,
  fontSize: 36,
  letterSpacing: "-.03em",
  color: "var(--ochre)",
};
const heroSub: React.CSSProperties = { fontSize: 12, opacity: 0.7, fontWeight: 600, marginTop: 4 };
export const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
  marginBottom: 16,
};
const cardBase: React.CSSProperties = {
  border: "2.5px solid var(--ink)",
  borderTopWidth: 4,
  padding: "14px 12px",
  textAlign: "center",
  background: "var(--cream)",
};
const cardValue: React.CSSProperties = {
  fontFamily: "var(--display)",
  fontWeight: 800,
  fontSize: 28,
  letterSpacing: "-.02em",
  lineHeight: 1,
};
const cardLabel: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: ".05em",
  opacity: 0.6,
  marginTop: 4,
};
const sectionTitle: React.CSSProperties = {
  fontFamily: "var(--display)",
  fontWeight: 800,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: ".08em",
  color: "var(--clay)",
  marginBottom: 8,
};
