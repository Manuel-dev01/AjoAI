"use client";

import { isAddress } from "viem";
import { AppBar } from "@/components/ui";
import { ScoreCard } from "@/components/ScoreCard";
import { short } from "@/lib/format";

// Public, read-only score lookup — no wallet connection needed. Shared via the QR/link
// on /app/score so members can carry their score to lenders, landlords & bigger circles.
export default function PublicScorePage({ params }: { params: { address: string } }) {
  const { address } = params;
  if (!isAddress(address)) return <div className="appmain"><p className="banner">Invalid address.</p></div>;

  return (
    <>
      <AppBar title="Savings-Credit Score" back="/app" />
      <div className="appmain">
        <ScoreCard address={address} />
        <div className="note">
          {short(address)} · This is a portable, on-chain ERC-8004 reputation score — anyone with this link can verify it, no wallet required.
        </div>
      </div>
    </>
  );
}
