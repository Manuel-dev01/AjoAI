"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { RingMark } from "@/components/RingMark";
import { AppBar, Avatar, Lrow, Pill, ConnectButton } from "@/components/ui";
import { InvitePanel } from "@/components/InvitePanel";
import { FaucetButton, useTokenBalance } from "@/components/Faucet";
import { useCeloWrite } from "@/lib/tx";
import { circleAbi, erc20Abi, STATE_NAMES } from "@/lib/abi";
import { useCircle, useToken, useMembers, useMyStatus, useCircleActivity, type ActivityEvent } from "@/lib/circle";
import { fmtAmount, short } from "@/lib/format";
import { explorerAddr, FAUCETABLE, EXPLORER_NAME } from "@/lib/chain";
import { getName } from "@/lib/names";

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
  const { members, refetch: refetchMembers } = useMembers(address, c.membersLength, c.round);
  // Prefetch activity in the background at mount, so the Activity tab opens instantly.
  const { events: activityEvents, isLoading: activityLoading } = useCircleActivity(address, c.roundsPaid);
  const name = getName(address) || `Circle ${short(address)}`;
  const forming = c.state === 0;
  const active = c.state === 1;
  const yourTurn = active && Boolean(my.me && c.recipient && my.me.toLowerCase() === c.recipient.toLowerCase());
  const anyLate = active && members.some((m) => m.isDelinquent);

  return (
    <>
      <AppBar title={name} mini={active ? "Live" : STATE_NAMES[c.state ?? 0]} back="/app" />
      <div className="appmain">
        <div className="tabs">
          <span className={`t${tab === "circle" ? " on" : ""}`} onClick={() => setTab("circle")}>Circle</span>
          <span className={`t${tab === "pay" ? " on" : ""}`} onClick={() => setTab("pay")}>Pay</span>
          <span className={`t${tab === "activity" ? " on" : ""}`} onClick={() => setTab("activity")}>Activity</span>
        </div>

        {tab === "circle" && forming && (
          <FormingView address={address} c={c} my={my} members={members} name={getName(address)} symbol={symbol} decimals={decimals} refetch={() => { c.refetch(); my.refetch(); refetchMembers(); }} />
        )}

        {tab === "circle" && active && (
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

        {tab === "circle" && !forming && !active && (
          <div className="empty">
            <RingMark variant="full" />
            <div style={{ fontWeight: 700, marginTop: 4 }}>Circle {STATE_NAMES[c.state ?? 0]}</div>
            <div className="muted" style={{ marginTop: 4 }}>
              {c.state === 4
                ? "This circle was deleted before it started. All deposits were refunded."
                : "This circle has finished its rounds. Deposits returned; reputation written."}
            </div>
          </div>
        )}

        {tab === "pay" && (
          <PayTab address={address} c={c} symbol={symbol} decimals={decimals} my={my} />
        )}

        {tab === "activity" && (
          <Activity address={address} symbol={symbol} decimals={decimals} events={activityEvents} isLoading={activityLoading} />
        )}
      </div>
    </>
  );
}

// Forming: invite + join + start.
function FormingView({ address, c, my, members, name, symbol, decimals, refetch }: {
  address: `0x${string}`; c: CircleData; my: MyStatus; members: { address: `0x${string}` }[];
  name?: string; symbol: string; decimals: number; refetch: () => void;
}) {
  const { address: me, isConnected } = useAccount();
  const { write, isPending, error } = useCeloWrite();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });
  const { data: allowance, refetch: refetchAllow } = useReadContract({
    address: c.token, abi: erc20Abi, functionName: "allowance",
    args: me && c.token ? [me, address] : undefined,
    query: { enabled: Boolean(me && c.token) },
  });
  const { balance, refetch: refetchBal } = useTokenBalance(c.token);
  useEffect(() => { if (receipt) refetch(); }, [receipt, refetch]);

  const full = c.membersLength !== undefined && c.slots !== undefined && Number(c.membersLength) >= c.slots;
  const isOrganizer = Boolean(me && c.organizer && me.toLowerCase() === c.organizer.toLowerCase());
  const lowBalance = c.deposit !== undefined && (balance === undefined || balance < c.deposit);
  const needsApproval = c.deposit !== undefined && (allowance === undefined || (allowance as bigint) < c.deposit);
  const busy = isPending || (!!txHash && !receipt);

  async function approve() {
    if (!c.token || c.deposit === undefined) return;
    const h = await write({ address: c.token, abi: erc20Abi, functionName: "approve", args: [address, c.deposit] });
    setTxHash(h); setTimeout(() => refetchAllow(), 4000);
  }
  async function join() {
    const h = await write({ address, abi: circleAbi, functionName: "join", args: ["0x"] });
    setTxHash(h);
  }
  async function start() {
    const h = await write({ address, abi: circleAbi, functionName: "start", args: [] });
    setTxHash(h);
  }
  async function deleteCircle() {
    const h = await write({ address, abi: circleAbi, functionName: "dissolve", args: [] });
    setTxHash(h);
  }

  return (
    <>
      <InvitePanel address={address} name={name} slots={c.slots} members={members} />

      <Lrow k="Members" v={`${c.membersLength?.toString() ?? "…"} / ${c.slots ?? "…"}`} />
      <Lrow k="Contribution" v={fmtAmount(c.contribution, symbol, decimals)} />
      <Lrow k="Security deposit" v={fmtAmount(c.deposit, symbol, decimals)} />
      {error && <p className="banner">{error.message.slice(0, 140)}</p>}

      <div style={{ marginTop: 14, display: "grid", gap: 9 }}>
        {!isConnected ? (
          <ConnectButton />
        ) : my.isMember ? (
          isOrganizer && full ? (
            <button className="btn btn-ochre btn-block" disabled={busy} onClick={start}>{busy ? "Starting…" : "Start circle →"}</button>
          ) : (
            <div className="banner" style={{ background: "var(--green)", color: "var(--cream)", border: "none" }}>
              You&rsquo;re in ✓ {full ? "Waiting for the organiser to start." : `Waiting for members (${c.membersLength?.toString()}/${c.slots}).`}
            </div>
          )
        ) : full ? (
          <div className="muted">This circle is full.</div>
        ) : lowBalance ? (
          FAUCETABLE ? (
            <>
              <p className="muted">You need {fmtAmount(c.deposit, symbol, decimals)} to post the deposit. Mint test tokens:</p>
              <FaucetButton token={c.token} need={c.deposit} symbol={symbol} decimals={decimals} onMinted={refetchBal} />
            </>
          ) : (
            <p className="muted">You need {fmtAmount(c.deposit, symbol, decimals)} in your wallet to post the deposit.</p>
          )
        ) : needsApproval ? (
          <button className="btn btn-block" disabled={busy} onClick={approve}>{busy ? "Approving…" : `1. Approve deposit (${fmtAmount(c.deposit, symbol, decimals)})`}</button>
        ) : (
          <button className="btn btn-ochre btn-block" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join this circle"}</button>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        {members.map((m) => (
          <div className="mrow" key={m.address}>
            <Avatar addr={m.address} size={28} />
            <span className="nm">{m.address.toLowerCase() === me?.toLowerCase() ? "You" : short(m.address)}</span>
            <Pill kind="paid">Joined</Pill>
          </div>
        ))}
      </div>

      {isOrganizer && (
        <div style={{ marginTop: 16 }}>
          {confirmDelete ? (
            <div className="banner" style={{ background: "var(--clay)", color: "#fff", borderColor: "var(--clay-d)" }}>
              <p style={{ margin: "0 0 10px" }}>
                This refunds every member&rsquo;s deposit and permanently dissolves the circle. This can&rsquo;t be undone.
              </p>
              <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr 1fr" }}>
                <button className="btn-ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button className="btn btn-ink" disabled={busy} onClick={deleteCircle}>{busy ? "Deleting…" : "Yes, delete circle"}</button>
              </div>
            </div>
          ) : (
            <button className="btn-ghost btn-block" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete circle
            </button>
          )}
        </div>
      )}
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
  const { balance, refetch: refetchBal } = useTokenBalance(c.token);
  const lowBalance = c.contribution !== undefined && (balance === undefined || balance < c.contribution);
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

  if (c.state !== undefined && c.state !== 1) {
    return (
      <div className="empty">
        <RingMark variant="full" />
        <div style={{ fontWeight: 700, marginTop: 4 }}>{c.state === 0 ? "Not started yet" : "Circle ended"}</div>
        <div className="muted" style={{ marginTop: 4 }}>{c.state === 0 ? "Contributions open once the circle is full and started." : "No more contributions for this circle."}</div>
      </div>
    );
  }
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
        {!isConnected ? <ConnectButton /> : lowBalance ? (
          FAUCETABLE ? (
            <>
              <p className="muted">You need {fmtAmount(c.contribution, symbol, decimals)}. Mint test tokens:</p>
              <FaucetButton token={c.token} need={c.contribution} symbol={symbol} decimals={decimals} onMinted={refetchBal} />
            </>
          ) : (
            <p className="muted">You need {fmtAmount(c.contribution, symbol, decimals)} in your wallet to pay this round.</p>
          )
        ) : needsApproval ? (
          <button className="btn btn-block" disabled={busy} onClick={approve}>{busy ? "Approving…" : "1. Approve"}</button>
        ) : (
          <button className="btn btn-ochre btn-block" disabled={busy} onClick={pay}>{busy ? "Paying…" : `Pay ${fmtAmount(c.contribution, symbol, decimals)}`}</button>
        )}
      </div>
    </>
  );
}

// Presentational: events are prefetched at page mount by useCircleActivity (see CircleView),
// so opening this tab is instant. Formatting (token decimals) happens here.
function Activity({ address, symbol, decimals, events, isLoading }: { address: `0x${string}`; symbol: string; decimals: number; events?: ActivityEvent[]; isLoading: boolean }) {
  if (!events && isLoading) return <div className="muted" style={{ padding: "20px 2px" }}>Loading activity…</div>;
  const evs = events ?? [];
  const line = (e: ActivityEvent) => {
    if (e.eventName === "Contributed") return { tx: `Contribution · ${short(e.member)}`, sub: e.late ? "late" : "on-time", amt: `+${fmtAmount(e.amount, "", decimals)}` };
    if (e.eventName === "PaidOut") return { tx: `Payout → ${short(e.member)}`, sub: "agent · same day", amt: `−${fmtAmount(e.amount, "", decimals)}` };
    if (e.eventName === "Delinquent") return { tx: `Deposit covered ${short(e.member)}`, sub: "auto", amt: fmtAmount(e.amount, "", decimals) };
    return { tx: `Penalty · ${short(e.member)}`, sub: "late fee", amt: fmtAmount(e.amount, "", decimals) };
  };
  return (
    <>
      {evs.length === 0 && <div className="muted" style={{ padding: "10px 2px" }}>No on-chain activity yet.</div>}
      {evs.map((e, i) => {
        const l = line(e);
        return (
          <div className="act" key={i}>
            <span className={`ic ${e.kind}`}>{e.kind === "in" ? "↓" : e.kind === "out" ? "↑" : "⛨"}</span>
            <div className="tx">{l.tx}<span>Round {e.round} · {l.sub}</span></div>
            <span className={`amt ${e.kind === "in" ? "in" : e.kind === "out" ? "out" : ""}`}>{l.amt} {symbol}</span>
          </div>
        );
      })}
      <a className="txlink" href={explorerAddr(address)} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", padding: "16px 0" }}>See all on {EXPLORER_NAME} ↗</a>
    </>
  );
}
