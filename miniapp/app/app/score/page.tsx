"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAccount } from "wagmi";
import { AppBar, ConnectButton } from "@/components/ui";
import { RingMark } from "@/components/RingMark";
import { ScoreCard } from "@/components/ScoreCard";
import { scoreLink } from "@/lib/code";

export default function ScorePage() {
  const { address, isConnected } = useAccount();

  if (!isConnected) {
    return (
      <>
        <AppBar title="Your Trust Score" back="/app" />
        <div className="appmain"><div className="empty"><RingMark variant="full" /><div className="muted" style={{ marginTop: 8 }}>Connect to see your portable savings-credit score.</div><div style={{ marginTop: 14 }}><ConnectButton /></div></div></div>
      </>
    );
  }

  return (
    <>
      <AppBar title="Your Trust Score" back="/app" />
      <div className="appmain">
        <ScoreCard address={address!} />
        <div className="note">Carry this score to lenders, landlords &amp; bigger circles. It&rsquo;s an on-chain ERC-8004 reputation bound to your wallet, yours to keep.</div>
        <ShareScorePanel address={address!} />
      </div>
    </>
  );
}

function ShareScorePanel({ address }: { address: `0x${string}` }) {
  const link = scoreLink(address);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the value is still visible to copy manually */
    }
  };

  return (
    <div className="invite" style={{ background: "var(--cream)", color: "var(--ink)", marginTop: 12 }}>
      <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 18, letterSpacing: "-.02em" }}>
        Share your score
      </div>
      <div className="muted" style={{ marginBottom: 12 }}>Anyone with this link can verify your score — no wallet needed.</div>
      <div style={{ background: "#fff", border: "2.5px solid var(--ink)", padding: 12, display: "inline-block", marginBottom: 12 }}>
        <QRCodeSVG value={link} size={148} bgColor="#ffffff" fgColor="#231b12" level="M" />
      </div>
      <button className="btn btn-block" onClick={copy}>
        {copied ? "Link copied ✓" : "Copy score link"}
      </button>
    </div>
  );
}
