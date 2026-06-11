"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { RingMark } from "@/components/RingMark";
import { ConnectButton } from "@/components/ui";
import { useInMiniPay } from "@/app/providers";
import { useMyCircles, useCircle, useScore } from "@/lib/circle";
import { CONTRACTS } from "@/lib/chain";
import { short } from "@/lib/format";
import { STATE_NAMES } from "@/lib/abi";

export default function Home() {
  const { isConnected, address } = useAccount();
  if (!isConnected) return <Welcome />;
  return <Dashboard address={address!} />;
}

function Welcome() {
  const inMiniPay = useInMiniPay();
  return (
    <div className="welcome">
      <div />
      <div>
        <RingMark variant="full" className="ring" />
        <h2>Save together.<br /><span className="u">Win in turn.</span></h2>
        <p>An ajo savings circle, run by an agent that never forgets and never skips your turn.</p>
      </div>
      <div>
        <div className="phone-field">
          <span className="flag">🤝</span>
          <div>
            <div className="lab">Your MiniPay wallet</div>
            <div className="num">{inMiniPay ? "Connecting…" : "Connect to begin"}</div>
          </div>
        </div>
        <ConnectButton />
        {inMiniPay && <p style={{ marginTop: 10 }}>One moment — MiniPay is connecting your wallet.</p>}
      </div>
    </div>
  );
}

function Dashboard({ address }: { address: `0x${string}` }) {
  const { mine, isLoading } = useMyCircles();
  const score = useScore(address);
  return (
    <>
      <div className="appbar">
        <span className="tt">Your circles</span>
        <span className="mini">AjoAI</span>
      </div>
      <div className="appmain">
        <div className="greet">Sannu 👋</div>
        <div className="muted" style={{ margin: "2px 2px 0" }}>{short(address)}</div>

        <div className="savings">
          <div>
            <div className="l">Savings score · ERC-8004</div>
            <div className="a">{score ? score.score.toString() : "—"}</div>
          </div>
          <Link href="/app/score" className="delta">View ▸</Link>
        </div>

        {isLoading && <div className="muted" style={{ padding: "20px 2px" }}>Loading your circles…</div>}

        {!isLoading && mine.length === 0 && (
          <div className="empty">
            <RingMark variant="full" />
            <div style={{ fontWeight: 700, marginTop: 4 }}>No circles yet</div>
            <div className="muted" style={{ marginTop: 4 }}>Start one, join with a code, or peek at the live demo circle.</div>
            <Link href={`/app/circle/${CONTRACTS.demoCircle}`} className="btn-ghost" style={{ display: "inline-block", marginTop: 14 }}>
              View the demo circle →
            </Link>
          </div>
        )}

        {mine.map((c, i) => (
          <CircleCard key={c} address={c} alt={i % 2 === 1} />
        ))}

        <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
          <Link href="/app/create" className="btn btn-block">+ Start a circle</Link>
          <Link href="/app/join" className="btn-ghost" style={{ textAlign: "center", display: "block" }}>Join with a code</Link>
        </div>
      </div>
    </>
  );
}

function CircleCard({ address, alt }: { address: `0x${string}`; alt: boolean }) {
  const { state, round, slots, roundsPaid, recipient } = useCircle(address);
  const pct = slots ? (Number(roundsPaid ?? 0n) / slots) * 100 : 0;
  const stateName = state !== undefined ? STATE_NAMES[state] : "…";
  const live = state === 1;
  return (
    <Link href={`/app/circle/${address}`} className={`ccard${alt ? " alt" : ""}`} style={{ display: "block" }}>
      <div className="top">
        <RingMark variant="static" size={26} />
        <span className="nm">Circle {short(address)}</span>
        <span className={`pill ${live ? "turn" : "paid"}`} style={{ marginLeft: "auto" }}>{stateName}</span>
      </div>
      <div className="meta">
        <span>Round {round?.toString() ?? "…"} of {slots ?? "…"}</span>
        <span>{recipient ? `Next: ${short(recipient)}` : "—"}</span>
      </div>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
    </Link>
  );
}
