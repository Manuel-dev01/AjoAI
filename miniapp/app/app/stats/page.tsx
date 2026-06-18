"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AppBar } from "@/components/ui";
import { RingMark } from "@/components/RingMark";

// ── types ────────────────────────────────────────────────────────────────

interface Metrics {
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
  stale?: boolean; // served from a snapshot (live read unavailable)
}

// ── helpers ──────────────────────────────────────────────────────────────

function fmt(weiStr: string, decimals = 18): string {
  const n = Number(weiStr) / 10 ** decimals;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(n < 10 ? 2 : 0);
}

function timeAgo(ts: string): string {
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ── page ─────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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

  const tweet = data
    ? [
        `AjoAI on-chain stats (${data.chain})`,
        "",
        `🏦 ${data.circlesCreated} circles created`,
        `✅ ${data.circlesCreated - data.completed - data.defaulted - data.dissolved} active`,
        `👥 ${data.uniqueMembers} unique members`,
        `💰 ${fmt(data.totalContributions)} contributed across ${data.contributionCount} payments`,
        `📤 ${fmt(data.totalPayouts)} distributed in ${data.payoutCount} payouts`,
        `🛡️ ${data.defaultsTriggered} defaults recovered autonomously`,
        `⭐ ${data.reputationSignals} reputation signals (+${data.positiveSignals} / -${data.negativeSignals})`,
        `🤖 ${data.agentTxCount} agent transactions`,
        "",
        "An ajo savings circle that runs itself. No human in the loop.",
        "ajo-ai-tan.vercel.app",
      ].join("\n")
    : "";

  const copyTweet = async () => {
    try {
      await navigator.clipboard.writeText(tweet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* blocked */
    }
  };

  return (
    <>
      <AppBar title="On-Chain Stats" back="/app" />
      <div className="appmain">
        {loading && (
          <div className="empty">
            <RingMark variant="full" />
            <div className="muted" style={{ marginTop: 8 }}>
              Querying the chain…
            </div>
          </div>
        )}

        {error && (
          <div className="empty">
            <div style={{ fontSize: 32 }}>⚠️</div>
            <div style={{ fontWeight: 700, marginTop: 8 }}>Could not load metrics</div>
            <div className="muted" style={{ marginTop: 4 }}>{error}</div>
            <button className="btn btn-ochre" style={{ marginTop: 14 }} onClick={load}>
              Try again
            </button>
          </div>
        )}

        {data && <MetricsDashboard data={data} />}

        {data && (
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-block" onClick={copyTweet}>
              {copied ? "Copied ✓" : "Copy stats for tweet"}
            </button>
            <div className="muted" style={{ marginTop: 8, textAlign: "center" }}>
              {data.stale ? "Snapshot · " : "Updated "}{timeAgo(data.timestamp)} ·{" "}
              <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={load}>
                refresh
              </span>
            </div>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <Link href="/app" className="btn-ghost" style={{ display: "block", textAlign: "center" }}>
            ← Back to home
          </Link>
        </div>
      </div>
    </>
  );
}

// ── sub-components ───────────────────────────────────────────────────────

function MetricsDashboard({ data }: { data: Metrics }) {
  return (
    <>
      {/* Hero stat */}
      <div style={heroCard}>
        <div style={heroLabel}>Total value processed</div>
        <div style={heroValue}>
          {fmt(data.totalContributions)} <span style={{ fontSize: 14, opacity: 0.6 }}>tokens</span>
        </div>
        <div style={heroSub}>
          {data.contributionCount} contributions · {data.payoutCount} payouts
        </div>
      </div>

      {/* Grid of key numbers */}
      <div style={grid}>
        <StatCard label="Circles" value={data.circlesCreated} color="var(--green)" />
        <StatCard label="Members" value={data.uniqueMembers} color="var(--clay)" />
        <StatCard label="Agent txs" value={data.agentTxCount} color="var(--ochre)" />
        <StatCard label="Defaults recovered" value={data.defaultsTriggered} color="var(--ink)" />
      </div>

      {/* Circle breakdown */}
      <Section title="Circle lifecycle">
        <Row k="Active" v={data.active} color="var(--green)" />
        <Row k="Completed" v={data.completed} color="var(--green)" />
        <Row k="Defaulted" v={data.defaulted} color="var(--clay)" />
        <Row k="Dissolved" v={data.dissolved} />
        <Row k="Forming" v={data.forming} />
      </Section>

      {/* Financials */}
      <Section title="Financial activity">
        <Row k="Total contributed" v={`${fmt(data.totalContributions)} tokens`} />
        <Row k="Contributions" v={data.contributionCount} />
        <Row k="Late payments" v={data.lateContributions} color={data.lateContributions > 0 ? "var(--ochre)" : undefined} />
        <Row k="Total distributed" v={`${fmt(data.totalPayouts)} tokens`} />
        <Row k="Payouts" v={data.payoutCount} />
      </Section>

      {/* Reputation */}
      <Section title="ERC-8004 Reputation">
        <Row k="Total signals" v={data.reputationSignals} />
        <Row k="Positive" v={`+${data.positiveSignals}`} color="var(--green)" />
        <Row k="Negative" v={`-${data.negativeSignals}`} color="var(--clay)" />
      </Section>

      {/* Idle-fund yield — only shown once there is simulated yield activity */}
      {Number(data.totalYield ?? 0) > 0 && (
        <Section title="Idle-fund yield (simulated)">
          <Row k="Total yield accrued" v={`${fmt(data.totalYield!)} tokens`} color="var(--green)" />
          <Row k="Deposits" v={data.yieldDeposits ?? 0} />
          <Row k="Withdrawals" v={data.yieldWithdrawals ?? 0} />
        </Section>
      )}
    </>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ ...cardBase, borderTopColor: color }}>
      <div style={cardValue}>{value}</div>
      <div style={cardLabel}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v, color }: { k: string; v: string | number; color?: string }) {
  return (
    <div className="lrow">
      <span>{k}</span>
      <span className="v" style={color ? { color } : undefined}>{v}</span>
    </div>
  );
}

// ── inline styles (Market Blocks aesthetic) ──────────────────────────────

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

const heroSub: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.7,
  fontWeight: 600,
  marginTop: 4,
};

const grid: React.CSSProperties = {
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
