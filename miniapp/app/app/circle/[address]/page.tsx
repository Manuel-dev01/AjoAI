"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import { useAccount, usePublicClient, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { RingMark } from "@/components/RingMark";
import { AppBar, Avatar, Lrow, Pill, ConnectButton } from "@/components/ui";
import { useCeloWrite } from "@/lib/tx";
import { circleAbi, erc20Abi, STATE_NAMES } from "@/lib/abi";
import { useCircle, useToken, useMembers, useMyStatus } from "@/lib/circle";
import { fmtAmount, short } from "@/lib/format";
import { explorerAddr } from "@/lib/chain";

type Tab = "circle" | "pay" | "activity";
type CircleData = ReturnType<typeof useCircle>;
type MyStatus = ReturnType<typeof useMyStatus>;

export default function CirclePage({ params }: { params: { address: string } }) {
  const address = params.address;
  if (!isAddress(address)) return <div className="appmain"><p className="banner">Invalid circle address.</p></div>;
  return <CircleView address={address as `0x${string}`} />;
}

function CircleView({ address }: { address: `0x${string}` }) {
  const [tab, setTab] = useState<Tab>("circle");
  const c = useCircle(address);
  const { symbol, decimals } = useToken(c.token);
  const my = useMyStatus(address, c.round);
  const { members } = useMembers(address, c.membersLength, c.round);
  const yourTurn = Boolean(my.me && c.recipient && my.me.toLowerCase() === c.recipient.toLowerCase());
  const anyLate = members.some((m) => m.isDelinquent);

  return (
    <>
      <AppBar title={`Circle ${short(address)}`} mini={c.state === 1 ? "Live" : STATE_NAMES[c.state ?? 0]} back="/app" />
      <div className="appmain">
        <div className="tabs">
          <span className={`t${tab === "circle" ? " on" : ""}`} onClick={() => setTab("circle")}>Circle</span>
          <span className={`t${tab === "pay" ? " on" : ""}`} onClick={() => setTab("pay")}>Pay</span>
          <span className={`t${tab === "activity" ? " on" : ""}`} onClick={() => setTab("activity")}>Activity</span>
        </div>

        {tab === "circle" && (
          <>
            {yourTurn && (
              <div className="invite" style={{ background: "var(--clay)" }}>
                <RingMark variant="static" />
                <div className="nm">It&rsquo;s your turn!</div>
                <div className="meta">The agent pays you {fmtAmount(c.pot, symbol, decimals)} once everyone&rsquo;s in.</div>
              </div>
            )}
            {anyLate && (
              <div className="notice">
                <div className="shield">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2 4 5v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V5l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
                </div>
                <h3>We&rsquo;ve got this round</h3>
                <p>A contribution is late. The security deposit covers it, so the payout still ships on time, in full.</p>
              </div>
            )}

            <div className="dash-top">
              <RingMark variant="full" />
              <div className="rnd">Round {c.round?.toString() ?? "…"} of {c.slots ?? "…"}</div>
              <div className="nx">{c.recipient ? `Next payout · ${short(c.recipient)}` : "—"}</div>
            </div>

            {members.length === 0 && <div className="muted" style={{ padding: "8px 2px" }}>No members yet.</div>}
            {members.map((m) => {
              const isRecipient = c.recipient && m.address.toLowerCase() === c.recipient.toLowerCase();
              const kind = isRecipient ? "turn" : m.isDelinquent ? "late" : m.contributed ? "paid" : "due";
              const label = isRecipient ? "Their turn" : m.isDelinquent ? "Late" : m.contributed ? "Paid" : "Due";
              return (
                <div className="mrow" key={m.address}>
                  <Avatar addr={m.address} size={28} />
                  <span className="nm">{m.address.toLowerCase() === my.me?.toLowerCase() ? "You" : short(m.address)}</span>
                  <Pill kind={kind as "paid" | "turn" | "due" | "late"}>{label}</Pill>
                </div>
              );
            })}
          </>
        )}

        {tab === "pay" && (
          <PayTab address={address} c={c} symbol={symbol} decimals={decimals} my={my} />
        )}

        {tab === "activity" && (
          <Activity address={address} symbol={symbol} decimals={decimals} />
        )}
      </div>
    </>
  );
}

function PayTab({ address, c, symbol, decimals, my }: { address: `0x${string}`; c: CircleData; symbol: string; decimals: number; my: MyStatus }) {
  const { address: me, isConnected } = useAccount();
  const { write, isPending, error } = useCeloWrite();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });
  const { data: allowance, refetch } = useReadContract({
    address: c.token, abi: erc20Abi, functionName: "allowance",
    args: me && c.token ? [me, address] : undefined,
    query: { enabled: Boolean(me && c.token) },
  });
  const needsApproval = c.contribution !== undefined && (allowance === undefined || (allowance as bigint) < c.contribution);

  async function approve() {
    if (!c.token || c.contribution === undefined) return;
    const h = await write({ address: c.token, abi: erc20Abi, functionName: "approve", args: [address, c.contribution] });
    setTxHash(h); setTimeout(() => refetch(), 4000);
  }
  async function pay() {
    const h = await write({ address, abi: circleAbi, functionName: "contribute", args: [] });
    setTxHash(h); setTimeout(() => my.refetch(), 4000);
  }
  const busy = isPending || (!!txHash && !receipt);

  if (!my.isMember) {
    return (
      <div className="empty">
        <RingMark variant="full" />
        <div style={{ fontWeight: 700, marginTop: 4 }}>You&rsquo;re not in this circle</div>
        <Link href="/app/join" className="btn-ghost" style={{ display: "inline-block", marginTop: 12 }}>Join it →</Link>
      </div>
    );
  }
  if (my.contributed) {
    return (
      <>
        <div className="contrib" style={{ background: "var(--green)", color: "var(--cream)" }}>
          <div className="a"><small>{symbol}</small>{fmtAmount(c.contribution, "", decimals)}</div>
          <div className="l">Paid this round ✓</div>
        </div>
        <Lrow k="Round" v={c.round?.toString()} />
        <Lrow k="Goes to" v={short(c.recipient)} vColor="var(--clay-d)" />
      </>
    );
  }
  return (
    <>
      <div className="heading">Your circle is counting on you</div>
      <div className="subt">Pay your round · gas is covered in {symbol || "USDm"}</div>
      <div className="contrib"><div className="a"><small>{symbol}</small>{fmtAmount(c.contribution, "", decimals)}</div><div className="l">Your contribution</div></div>
      <Lrow k="From" v={`MiniPay · ${symbol}`} />
      <Lrow k="Goes to" v={`${short(c.recipient)}'s payout`} vColor="var(--clay-d)" />
      {error && <p className="banner">{error.message.slice(0, 120)}</p>}
      <div style={{ marginTop: 14, display: "grid", gap: 9 }}>
        {!isConnected ? <ConnectButton /> : needsApproval ? (
          <button className="btn btn-block" disabled={busy} onClick={approve}>{busy ? "Approving…" : "1. Approve"}</button>
        ) : (
          <button className="btn btn-ochre btn-block" disabled={busy} onClick={pay}>{busy ? "Paying…" : `Pay ${fmtAmount(c.contribution, symbol, decimals)}`}</button>
        )}
      </div>
    </>
  );
}

type Ev = { kind: "in" | "out" | "sys"; tx: string; sub: string; amt: string; round: number };

function Activity({ address, symbol, decimals }: { address: `0x${string}`; symbol: string; decimals: number }) {
  const client = usePublicClient();
  const [evs, setEvs] = useState<Ev[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!client) return;
      try {
        const latest = await client.getBlockNumber();
        const from = latest > 9000n ? latest - 9000n : 0n;
        const logs = await client.getLogs({ address, fromBlock: from, toBlock: "latest" });
        const parsed: Ev[] = [];
        const { decodeEventLog } = await import("viem");
        for (const log of logs) {
          try {
            const d = decodeEventLog({ abi: circleAbi, data: log.data, topics: log.topics });
            const a = d.args as Record<string, unknown>;
            const round = a.round !== undefined ? Number(a.round) : 0;
            if (d.eventName === "Contributed") parsed.push({ kind: "in", tx: `Contribution · ${short(a.member as string)}`, sub: a.late ? "late" : "on-time", amt: `+${fmtAmount(a.amount as bigint, "", decimals)}`, round });
            else if (d.eventName === "PaidOut") parsed.push({ kind: "out", tx: `Payout → ${short(a.recipient as string)}`, sub: "agent · same day", amt: `−${fmtAmount(a.pot as bigint, "", decimals)}`, round });
            else if (d.eventName === "Delinquent") parsed.push({ kind: "sys", tx: `Deposit covered ${short(a.member as string)}`, sub: "auto", amt: fmtAmount(a.depositConsumed as bigint, "", decimals), round });
            else if (d.eventName === "LatePaid") parsed.push({ kind: "sys", tx: `Penalty · ${short(a.member as string)}`, sub: "late fee", amt: fmtAmount(a.penalty as bigint, "", decimals), round });
          } catch { /* non-matching log */ }
        }
        if (alive) setEvs(parsed.reverse());
      } catch { if (alive) setEvs([]); }
    })();
    return () => { alive = false; };
  }, [client, address, decimals]);

  if (evs === null) return <div className="muted" style={{ padding: "20px 2px" }}>Loading activity…</div>;
  return (
    <>
      {evs.length === 0 && <div className="muted" style={{ padding: "10px 2px" }}>No recent on-chain activity in this window.</div>}
      {evs.map((e, i) => (
        <div className="act" key={i}>
          <span className={`ic ${e.kind}`}>{e.kind === "in" ? "↓" : e.kind === "out" ? "↑" : "⛨"}</span>
          <div className="tx">{e.tx}<span>Round {e.round} · {e.sub}</span></div>
          <span className={`amt ${e.kind === "in" ? "in" : e.kind === "out" ? "out" : ""}`}>{e.amt} {symbol}</span>
        </div>
      ))}
      <a className="txlink" href={explorerAddr(address)} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", padding: "16px 0" }}>See all on Blockscout ↗</a>
    </>
  );
}
