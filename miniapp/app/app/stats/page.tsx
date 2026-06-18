"use client";

import Link from "next/link";
import { AppBar } from "@/components/ui";
import { RingMark } from "@/components/RingMark";
import { Avatar } from "@/components/ui";
import { short } from "@/lib/format";
import { useMyStats } from "@/lib/circle";
import { Hero, StatCard, Section, Row, grid, fmt } from "@/components/stats";

// Per-connected-address cumulative stats across every circle you CREATED or JOINED.
export default function MyStatsPage() {
  const { me, stats, score, isLoading } = useMyStats();

  return (
    <>
      <AppBar title="Your Stats" back="/app" />
      <div className="appmain">
        {!me && (
          <div className="empty">
            <div style={{ fontSize: 32 }}>👛</div>
            <div style={{ fontWeight: 700, marginTop: 8 }}>Connect your wallet</div>
            <div className="muted" style={{ marginTop: 4 }}>
              Your cumulative on-chain stats appear here once you create or join a circle.
            </div>
            <Link href="/dashboard" className="btn btn-ochre" style={{ marginTop: 14 }}>
              View global dashboard →
            </Link>
          </div>
        )}

        {me && isLoading && stats.circles === 0 && (
          <div className="empty">
            <RingMark variant="full" />
            <div className="muted" style={{ marginTop: 8 }}>
              Reading your circles…
            </div>
          </div>
        )}

        {me && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Avatar addr={me} size={34} />
              <div>
                <div style={{ fontWeight: 800, fontFamily: "var(--display)" }}>You</div>
                <div className="muted" style={{ fontSize: 12 }}>{short(me)}</div>
              </div>
            </div>

            <Hero
              label="Circles you're in"
              value={stats.circles}
              sub={`${stats.created} created · ${stats.joined} joined`}
            />

            <div style={grid}>
              <StatCard label="Created" value={stats.created} color="var(--green)" />
              <StatCard label="Joined" value={stats.joined} color="var(--clay)" />
              <StatCard label="Contributions" value={stats.contributions} color="var(--ochre)" />
              <StatCard label="Payouts" value={stats.payouts} color="var(--ink)" />
            </div>

            <Section title="Your circle lifecycle">
              <Row k="Active" v={stats.active} color="var(--green)" />
              <Row k="Completed" v={stats.completed} color="var(--green)" />
              <Row k="Defaulted" v={stats.defaulted} color={stats.defaulted > 0 ? "var(--clay)" : undefined} />
              <Row k="Forming" v={stats.forming} />
            </Section>

            <Section title="Your activity">
              <Row k="Total contributed" v={`${fmt(stats.totalContributed)} tokens`} />
              <Row k="Contributions made" v={stats.contributions} />
              <Row k="Payouts in your circles" v={stats.payouts} />
              <Row k="Member seats across your circles" v={stats.seats} />
            </Section>

            <Section title="Your savings-credit (ERC-8004)">
              <Row k="Score" v={Number(score?.score ?? 0)} color="var(--green)" />
              <Row k="On-time payments" v={Number(score?.onTime ?? 0)} color="var(--green)" />
              <Row k="Late payments" v={Number(score?.late ?? 0)} color={Number(score?.late ?? 0) > 0 ? "var(--ochre)" : undefined} />
              <Row k="Defaults" v={Number(score?.defaults ?? 0)} color={Number(score?.defaults ?? 0) > 0 ? "var(--clay)" : undefined} />
              <Row k="Circles completed" v={Number(score?.completed ?? 0)} />
            </Section>

            <Link
              href="/dashboard"
              className="btn btn-block"
              style={{ marginTop: 4, textAlign: "center", display: "block" }}
            >
              📊 View global dashboard
            </Link>
          </>
        )}

        <div style={{ marginTop: 16 }}>
          <Link href="/app" className="btn-ghost" style={{ display: "block", textAlign: "center" }}>
            ← Back to home
          </Link>
        </div>
      </div>
    </>
  );
}
