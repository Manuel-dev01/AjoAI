"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { RingMark } from "@/components/RingMark";
import { AppBar, Avatar, Lrow, Pill, ConnectButton } from "@/components/ui";
import { InvitePanel } from "@/components/InvitePanel";
import { AskAgent } from "@/components/AskAgent";
import { FaucetButton, useTokenBalance } from "@/components/Faucet";
import { CureButton } from "@/components/CureButton";
import { ConvertPanel } from "@/components/ConvertPanel";
import { Sheet } from "@/components/Sheet";
import { useCeloWrite, friendlyTxError } from "@/lib/tx";
import { circleAbi, erc20Abi, STATE_NAMES } from "@/lib/abi";
import { useCircle, useToken, useMembers, useMyStatus, useCircleActivity, type ActivityEvent } from "@/lib/circle";
import { fmtAmount, short } from "@/lib/format";
import { explorerAddr, FAUCETABLE, EXPLORER_NAME } from "@/lib/chain";
import { getName } from "@/lib/names";

type Tab = "circle" | "pay" | "activity" | "ask";
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
  // Prefetch activity in the background — but only once the circle has activity to find (past
  // Forming). On a brand-new Forming circle the deep log scan finds nothing and just wastes ~7s.
  const { events: activityEvents, isLoading: activityLoading } = useCircleActivity(address, c.roundsPaid, c.state !== undefined && c.state !== 0);
  const name = getName(address) || `Circle ${short(address)}`;
  const forming = c.state === 0;
  const active = c.state === 1;
  const yourTurn = active && Boolean(my.me && c.recipient && my.me.toLowerCase() === c.recipient.toLowerCase());
  // Split delinquency: the agent auto-covers a NON-recipient miss from its deposit and continues
  // (the "We've got this round" case). But a delinquent RECIPIENT means triggerPayout WITHHOLDS —
  // the circle is paused until they cure() (CLAUDE.md §4). These must read very differently.
  const recipientDelinquent = active && Boolean(c.recipient && members.some((m) => m.isDelinquent && m.address.toLowerCase() === c.recipient!.toLowerCase()));
  const nonRecipientLate = active && members.some((m) => m.isDelinquent && !(c.recipient && m.address.toLowerCase() === c.recipient!.toLowerCase()));
  const iAmDelinquent = active && Boolean(my.isDelinquent);
  const refetchAll = () => { c.refetch(); my.refetch(); refetchMembers(); };

  return (
    <>
      <AppBar title={name} mini={active ? "Live" : STATE_NAMES[c.state ?? 0]} back="/app" />
      <div className="appmain">
        <div className="tabs">
          <span className={`t${tab === "circle" ? " on" : ""}`} onClick={() => setTab("circle")}>Circle</span>
          <span className={`t${tab === "pay" ? " on" : ""}`} onClick={() => setTab("pay")}>Pay</span>
          <span className={`t${tab === "activity" ? " on" : ""}`} onClick={() => setTab("activity")}>Activity</span>
          <span className={`t${tab === "ask" ? " on" : ""}`} onClick={() => setTab("ask")}>Ask</span>
        </div>

        {/* Circle scalar state still loading → show a spinner, not a blank content area. */}
        {tab === "circle" && c.state === undefined && (
          <div className="empty">
            <RingMark variant="full" />
            <div className="muted" style={{ marginTop: 8 }}>Loading circle…</div>
          </div>
        )}

        {tab === "circle" && forming && (
          <FormingView address={address} c={c} my={my} members={members} name={getName(address)} symbol={symbol} decimals={decimals} refetch={() => { c.refetch(); my.refetch(); refetchMembers(); }} />
        )}

        {tab === "circle" && active && (
          <>
            {/* Recipient is delinquent → payout WITHHELD; the circle is paused until they cure. */}
            {recipientDelinquent && (
              <div className="notice" style={{ background: "var(--ink)", color: "var(--cream)" }}>
                <div className="shield">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                </div>
                <h3>Payout paused</h3>
                <p>Waiting for {yourTurn ? "you" : short(c.recipient)} to restore the security deposit. The full pot ships the moment it&rsquo;s back.</p>
              </div>
            )}

            {/* You are delinquent → cure to clear the flag (and release your payout if it&rsquo;s your turn). */}
            {iAmDelinquent && (
              <div className="banner" style={{ background: "var(--ochre)", color: "var(--ink)", borderColor: "var(--ink)" }}>
                <p style={{ margin: 0, fontWeight: 800 }}>{yourTurn ? "Restore your deposit to receive your payout" : "You’re marked delinquent"}</p>
                <p style={{ margin: "4px 0 0", fontSize: 13 }}>A missed contribution was covered from your deposit. Restore it to clear the flag{yourTurn ? " and release your payout." : " and keep your future payout."}</p>
                <CureButton address={address} token={c.token} deposit={c.deposit} symbol={symbol} decimals={decimals} onCured={refetchAll} />
              </div>
            )}

            {/* Cheerful your-turn hero — only when not withheld by your own delinquency. */}
            {yourTurn && !my.isDelinquent && (
              <div className="invite" style={{ background: "var(--clay)" }}>
                <RingMark variant="static" />
                <div className="nm">It&rsquo;s your turn!</div>
                <div className="meta">The agent pays you {fmtAmount(c.pot, symbol, decimals)} once everyone&rsquo;s in.</div>
              </div>
            )}

            {/* A NON-recipient is late → deposit covers it, circle continues. This is the autonomous path. */}
            {nonRecipientLate && !recipientDelinquent && (
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
              const isMe = m.address.toLowerCase() === my.me?.toLowerCase();
              const isRecipient = c.recipient && m.address.toLowerCase() === c.recipient.toLowerCase();
              // The recipient STILL contributes in their own round (CLAUDE.md §4), so the pay pill
              // is shown for EVERYONE — it flips Due→Paid when they pay. "Receiving" is a separate
              // marker, not a status that hides whether they've paid.
              const payKind = m.isDelinquent ? "late" : m.contributed ? "paid" : "due";
              const payLabel = m.isDelinquent ? "Late" : m.contributed ? "Paid" : "Due";
              return (
                <div className="mrow" key={m.address}>
                  <Avatar addr={m.address} size={28} />
                  <span className="nm">{isMe ? "You" : short(m.address)}</span>
                  <span className="pills">
                    {isRecipient && <Pill kind="turn">{isMe ? "Your turn" : "Receiving"}</Pill>}
                    <Pill kind={payKind as "paid" | "due" | "late"}>{payLabel}</Pill>
                  </span>
                </div>
              );
            })}
          </>
        )}

        {/* Dissolved (deleted in Forming) → simple refund note. */}
        {tab === "circle" && c.state === 4 && (
          <div className="empty">
            <RingMark variant="full" />
            <div style={{ fontWeight: 700, marginTop: 4 }}>Circle dissolved</div>
            <div className="muted" style={{ marginTop: 4 }}>This circle was deleted before it started. All deposits were refunded.</div>
          </div>
        )}

        {/* Completed / Defaulted → a real recap of the finished rotation, not a blank page. */}
        {tab === "circle" && (c.state === 2 || c.state === 3) && (
          <>
            <div className="dash-top" style={c.state === 3 ? { background: "var(--ink)" } : undefined}>
              <RingMark variant="full" />
              <div className="rnd">{c.state === 2 ? "Rotation complete" : "Circle closed early"}</div>
              <div className="nx">
                {c.state === 2
                  ? `All ${c.slots ?? "…"} members received the pot once · reconciled on-chain`
                  : "Remaining funds distributed pro-rata to members who hadn’t received"}
              </div>
            </div>

            <Lrow k="Payouts made" v={`${c.roundsPaid?.toString() ?? "…"} / ${c.slots ?? "…"}`} />
            <Lrow k="Pot each round" v={fmtAmount(c.pot, symbol, decimals)} />
            <Lrow k="Contribution" v={fmtAmount(c.contribution, symbol, decimals)} />

            <div style={{ marginTop: 14 }}>
              {members.map((m) => (
                <div className="mrow" key={m.address}>
                  <Avatar addr={m.address} size={28} />
                  <span className="nm">{m.address.toLowerCase() === my.me?.toLowerCase() ? "You" : short(m.address)}</span>
                  <Pill kind={m.hasReceived ? "paid" : "due"}>{m.hasReceived ? "Received ✓" : "Pro-rata"}</Pill>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
              <button className="btn btn-block" onClick={() => setTab("activity")}>See the on-chain activity →</button>
              <a className="txlink" href={explorerAddr(address)} target="_blank" rel="noreferrer" style={{ textAlign: "center", display: "block", padding: "4px 0" }}>View the circle on {EXPLORER_NAME} ↗</a>
            </div>
          </>
        )}

        {tab === "pay" && (
          <PayTab address={address} c={c} symbol={symbol} decimals={decimals} my={my} />
        )}

        {tab === "activity" && (
          <Activity address={address} symbol={symbol} decimals={decimals} events={activityEvents} isLoading={activityLoading} />
        )}

        {tab === "ask" && <AskAgent address={address} member={my.me} />}
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
  const [convertOpen, setConvertOpen] = useState(false);
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
    const h = await write({ address: c.token, abi: erc20Abi, functionName: "approve", args: [address, c.deposit], gas: 120_000n });
    setTxHash(h); setTimeout(() => refetchAllow(), 4000);
  }
  async function join() {
    const h = await write({ address, abi: circleAbi, functionName: "join", args: ["0x"], gas: 600_000n });
    setTxHash(h);
  }
  async function start() {
    const h = await write({ address, abi: circleAbi, functionName: "start", args: [], gas: 500_000n });
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
      {isOrganizer && my.isMember === false && !full && (
        <div className="banner" style={{ background: "var(--ochre)", color: "var(--ink)", borderColor: "var(--ink)", marginTop: 12 }}>
          You created this circle. Be the first member, join below to take your slot, then invite the rest.
        </div>
      )}
      {error && <p className="banner">{friendlyTxError(error)}</p>}

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
            <>
              <p className="muted">You need {fmtAmount(c.deposit, symbol, decimals)} to post the deposit.</p>
              <button className="btn btn-ochre btn-block" onClick={() => setConvertOpen(true)}>Get {symbol} →</button>
            </>
          )
        ) : needsApproval ? (
          <button className="btn btn-block" disabled={busy} onClick={approve}>{busy ? "Approving…" : `1. Approve deposit (${fmtAmount(c.deposit, symbol, decimals)})`}</button>
        ) : (
          <button className="btn btn-ochre btn-block" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join this circle"}</button>
        )}
      </div>
      <Sheet open={convertOpen} onClose={() => setConvertOpen(false)} title={`Get ${symbol}`}>
        <ConvertPanel needToken={c.token} needSymbol={symbol} needDecimals={decimals} need={c.deposit} onConverted={() => { refetchBal(); setConvertOpen(false); }} />
      </Sheet>

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
            <div style={{ display: "grid", gap: 10 }}>
              <p className="banner" style={{ background: "var(--clay)", color: "#fff", borderColor: "#3a1206", margin: 0 }}>
                This refunds every member&rsquo;s deposit and permanently dissolves the circle. It can&rsquo;t be undone.
              </p>
              <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr 1fr" }}>
                <button className="btn btn-cream" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button className="btn btn-clay" disabled={busy} onClick={deleteCircle}>{busy ? "Deleting…" : "Delete"}</button>
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
  // Window state from the contract's own deadlines: past grace, contribute() reverts PastGrace, so
  // never offer "Pay" (the UI is the gate; the contract is the real one). In grace = late + fee.
  const nowSec = Math.floor(Date.now() / 1000);
  const pastGrace = c.graceClose !== undefined && nowSec >= Number(c.graceClose);
  const inGrace = !pastGrace && c.windowClose !== undefined && nowSec >= Number(c.windowClose);

  async function approve() {
    if (!c.token || c.contribution === undefined) return;
    const h = await write({ address: c.token, abi: erc20Abi, functionName: "approve", args: [address, c.contribution], gas: 120_000n });
    setTxHash(h); setTimeout(() => refetch(), 4000);
  }
  async function pay() {
    const h = await write({ address, abi: circleAbi, functionName: "contribute", args: [], gas: 600_000n });
    setTxHash(h); setTimeout(() => my.refetch(), 4000);
  }
  const busy = isPending || (!!txHash && !receipt);
  const [convertOpen, setConvertOpen] = useState(false);

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
  // Past grace + unpaid: contribute() would revert PastGrace. Don't offer Pay — explain the cover.
  if (pastGrace) {
    return (
      <div className="empty">
        <RingMark variant="full" />
        <div style={{ fontWeight: 700, marginTop: 4 }}>This round&rsquo;s window has closed</div>
        <div className="muted" style={{ marginTop: 4 }}>
          The agent covers any miss from your security deposit — you keep your place, with a small reputation note.
          Restore your deposit any time from the Circle tab to clear it.
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="heading">{inGrace ? "Last chance this round" : "Your circle is counting on you"}</div>
      <div className="subt">{inGrace ? "Window closed — paying now is late (small fee), but you keep your place." : "Pay your contribution for this round."}</div>
      <div className="contrib"><div className="a"><small>{symbol}</small>{fmtAmount(c.contribution, "", decimals)}</div><div className="l">Your contribution</div></div>
      <Lrow k="From" v={`MiniPay · ${symbol}`} />
      <Lrow k="Goes to" v={`${short(c.recipient)}'s payout`} vColor="var(--clay-d)" />
      {error && <p className="banner">{friendlyTxError(error)}</p>}
      <div style={{ marginTop: 14, display: "grid", gap: 9 }}>
        {!isConnected ? <ConnectButton /> : lowBalance ? (
          FAUCETABLE ? (
            <>
              <p className="muted">You need {fmtAmount(c.contribution, symbol, decimals)}. Mint test tokens:</p>
              <FaucetButton token={c.token} need={c.contribution} symbol={symbol} decimals={decimals} onMinted={refetchBal} />
            </>
          ) : (
            <>
              <p className="muted">You need {fmtAmount(c.contribution, symbol, decimals)} to pay this round.</p>
              <button className="btn btn-ochre btn-block" onClick={() => setConvertOpen(true)}>Get {symbol} →</button>
            </>
          )
        ) : needsApproval ? (
          <button className="btn btn-block" disabled={busy} onClick={approve}>{busy ? "Approving…" : "1. Approve"}</button>
        ) : (
          <button className="btn btn-ochre btn-block" disabled={busy} onClick={pay}>{busy ? "Paying…" : inGrace ? `Pay ${fmtAmount(c.contribution, symbol, decimals)} · late` : `Pay ${fmtAmount(c.contribution, symbol, decimals)}`}</button>
        )}
      </div>
      <Sheet open={convertOpen} onClose={() => setConvertOpen(false)} title={`Get ${symbol}`}>
        <ConvertPanel needToken={c.token} needSymbol={symbol} needDecimals={decimals} need={c.contribution} onConverted={() => { refetchBal(); setConvertOpen(false); }} />
      </Sheet>
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
