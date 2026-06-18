"use client";

import Link from "next/link";
import { RingMark } from "@/components/RingMark";
import { useMetrics, MetricsDashboard, timeAgo } from "@/components/stats";
import { StateDonut, CountBars, ReputationSplit } from "@/components/charts";

// Public on-chain dashboard — global metrics across ALL circles, with charts. Linked from the
// landing page. No wallet required; reads the (snapshot-backed) /api/metrics endpoint.
export default function DashboardPage() {
  const { data, error, loading, reload } = useMetrics();

  return (
    <div style={page}>
      <header style={header}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "var(--ink)" }}>
          <RingMark variant="static" />
          <span style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 18 }}>AjoAI</span>
        </Link>
        <Link href="/app" className="btn btn-ochre">
          Open app →
        </Link>
      </header>

      <main style={main}>
        <h1 style={h1}>On-Chain Dashboard</h1>
        <p className="muted" style={{ marginTop: -4, marginBottom: 16 }}>
          Every circle, contribution, payout and reputation signal — live across all of AjoAI.
        </p>

        {loading && (
          <div className="empty">
            <RingMark variant="full" />
            <div className="muted" style={{ marginTop: 8 }}>Loading metrics…</div>
          </div>
        )}

        {error && !data && (
          <div className="empty">
            <div style={{ fontSize: 32 }}>⚠️</div>
            <div style={{ fontWeight: 700, marginTop: 8 }}>Could not load metrics</div>
            <div className="muted" style={{ marginTop: 4 }}>{error}</div>
            <button className="btn btn-ochre" style={{ marginTop: 14 }} onClick={reload}>
              Try again
            </button>
          </div>
        )}

        {data && (
          <>
            {/* Charts */}
            <StateDonut
              active={data.active || data.circlesCreated - data.completed - data.defaulted - data.dissolved}
              completed={data.completed}
              defaulted={data.defaulted}
              dissolved={data.dissolved}
              forming={data.forming}
            />
            <CountBars
              title="Activity"
              data={[
                { name: "Contribs", value: data.contributionCount },
                { name: "Payouts", value: data.payoutCount },
                { name: "Late", value: data.lateContributions },
                { name: "Defaults", value: data.defaultsTriggered },
              ]}
            />
            <ReputationSplit positive={data.positiveSignals} negative={data.negativeSignals} />

            {/* Numbers */}
            <MetricsDashboard data={data} />

            <div className="muted" style={{ marginTop: 16, textAlign: "center" }}>
              {data.stale ? "Snapshot · " : "Updated "}
              {timeAgo(data.timestamp)} ·{" "}
              <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={reload}>
                refresh
              </span>
            </div>
          </>
        )}

        <div style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/" className="btn-ghost">← Home</Link>
          <Link href="/app/stats" className="btn-ghost">Your stats →</Link>
        </div>
      </main>
    </div>
  );
}

const page: React.CSSProperties = { minHeight: "100vh", background: "var(--cream)" };
const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 18px",
  borderBottom: "2.5px solid var(--ink)",
  position: "sticky",
  top: 0,
  background: "var(--cream)",
  zIndex: 10,
};
const main: React.CSSProperties = { maxWidth: 560, margin: "0 auto", padding: "20px 16px 60px" };
const h1: React.CSSProperties = {
  fontFamily: "var(--display)",
  fontWeight: 800,
  fontSize: 30,
  letterSpacing: "-.02em",
  margin: "8px 0 4px",
};
