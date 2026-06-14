"use client";

import { useAccount } from "wagmi";
import { AppBar, Lrow, ConnectButton } from "@/components/ui";
import { RingMark } from "@/components/RingMark";
import { useScore } from "@/lib/circle";

export default function ScorePage() {
  const { address, isConnected } = useAccount();
  const s = useScore(address);

  if (!isConnected) {
    return (
      <>
        <AppBar title="Your Trust Score" back="/app" />
        <div className="appmain"><div className="empty"><RingMark variant="full" /><div className="muted" style={{ marginTop: 8 }}>Connect to see your portable savings-credit score.</div><div style={{ marginTop: 14 }}><ConnectButton /></div></div></div>
      </>
    );
  }

  const score = s ? Number(s.score) : 0;
  const interactions = s ? Number(s.onTime + s.late + s.defaults) : 0;
  const onTimeRate = s && interactions > 0 ? Math.round((Number(s.onTime) / interactions) * 100) : 0;
  const bars = 9;
  const filled = Math.max(0, Math.min(bars, Math.round((score / 10) * bars)));
  const tier = score >= 7 ? "Strong" : score >= 3 ? "Building" : "New";

  return (
    <>
      <AppBar title="Your Trust Score" back="/app" />
      <div className="appmain">
        <div className="score">
          <div className="num">{s ? score : "—"}</div>
          <div className="of">portable savings-credit · ERC-8004</div>
          <div className="bars">
            {Array.from({ length: bars }, (_, i) => (
              <i key={i} className={i < filled ? "on" : ""} />
            ))}
          </div>
          <div className="tg"><b style={{ color: "var(--cream)" }}>{tier}.</b> Built by finishing circles on time.</div>
        </div>
        <Lrow k="Circles finished" v={s ? s.completed.toString() : "…"} />
        <Lrow k="On-time rate" v={`${onTimeRate}%`} vColor="var(--green)" />
        <Lrow k="On-time contributions" v={s ? s.onTime.toString() : "…"} />
        <Lrow k="Defaults" v={s ? s.defaults.toString() : "…"} />
        <div className="note">Carry this score to lenders, landlords &amp; bigger circles. It&rsquo;s an on-chain ERC-8004 reputation bound to your wallet, yours to keep.</div>
      </div>
    </>
  );
}
