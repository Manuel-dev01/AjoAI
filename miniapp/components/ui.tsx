"use client";

import Link from "next/link";
import { useConnect } from "wagmi";
import { avatarColor, initials } from "@/lib/format";
import { useInMiniPay } from "@/app/providers";
import { RingMark } from "@/components/RingMark";

export function Avatar({ addr, size = 28 }: { addr?: string; size?: number }) {
  return (
    <span
      className="av"
      style={{ width: size, height: size, fontSize: size * 0.42, background: avatarColor(addr) }}
    >
      {initials(addr)}
    </span>
  );
}

export function Pill({ kind, children }: { kind: "paid" | "turn" | "due" | "late"; children: React.ReactNode }) {
  return <span className={`pill ${kind}`}>{children}</span>;
}

export function Lrow({ k, v, vColor }: { k: React.ReactNode; v: React.ReactNode; vColor?: string }) {
  return (
    <div className="lrow">
      <span>{k}</span>
      <span className="v" style={vColor ? { color: vColor } : undefined}>{v}</span>
    </div>
  );
}

export function AppBar({ title, mini, back }: { title: string; mini?: string; back?: string }) {
  return (
    <div className="appbar">
      {back && (
        <Link href={back} className="bk" aria-label="Back">
          ‹
        </Link>
      )}
      <Link href="/app" aria-label="Home" style={{ flexShrink: 0 }}>
        <RingMark variant="static" size={28} />
      </Link>
      <span className="tt">{title}</span>
      {mini && <span className="mini">{mini}</span>}
    </div>
  );
}

// On desktop: always visible. Inside MiniPay: hidden (auto-connect handles it),
// but shown as fallback if auto-connect errors out.
export function ConnectButton() {
  const inMiniPay = useInMiniPay();
  const { connect, connectors, isPending, error } = useConnect();
  // In MiniPay without error — auto-connect is handling it, hide button
  if (inMiniPay && !error) return null;
  const injected = connectors.find((c) => c.id === "injected");
  return (
    <button className="btn btn-ochre btn-block" disabled={isPending} onClick={() => injected && connect({ connector: injected })}>
      {isPending ? "Connecting…" : inMiniPay ? "Retry connection" : "Connect wallet"}
    </button>
  );
}
