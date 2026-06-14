"use client";

import { Lrow } from "@/components/ui";
import { useScore } from "@/lib/circle";

// Shared score display for both the self-view (/app/score) and the public, read-only
// view (/app/score/[address]) — anyone can look up anyone's portable score.
export function ScoreCard({ address }: { address: `0x${string}` }) {
  const s = useScore(address);

  const score = s ? Number(s.score) : 0;
  const interactions = s ? Number(s.onTime + s.late + s.defaults) : 0;
  const onTimeRate = s && interactions > 0 ? Math.round((Number(s.onTime) / interactions) * 100) : 0;
  const bars = 9;
  const filled = Math.max(0, Math.min(bars, Math.round((score / 10) * bars)));
  const tier = score >= 7 ? "Strong" : score >= 3 ? "Building" : "New";

  return (
    <>
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
    </>
  );
}
