"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useConnect } from "wagmi";
import { RingMark } from "@/components/RingMark";
import { ConnectButton } from "@/components/ui";
import { useInMiniPay } from "@/app/providers";
import { useMyCircles, useCircle, useScore } from "@/lib/circle";
import { CONTRACTS } from "@/lib/chain";
import { short } from "@/lib/format";
import { STATE_NAMES } from "@/lib/abi";
import { getName, getUserName, setUserName } from "@/lib/names";

export default function Home() {
  const { isConnected, address } = useAccount();
  const [name, setName] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setName(address ? getUserName(address) : undefined);
    setLoaded(true);
  }, [address]);

  if (!isConnected) return <Welcome />;
  if (!loaded) return null; // wait for the localStorage read to avoid a flash
  if (!name) return <Onboarding address={address!} onDone={setName} />;
  return <Dashboard address={address!} name={name} onEdit={() => setName(undefined)} />;
}

// On-brand onboarding shown once per wallet (and on "edit name"): collect a display name before
// the dashboard, mirroring the Welcome screen's design language.
function Onboarding({ address, onDone }: { address: `0x${string}`; onDone: (n: string) => void }) {
  const [draft, setDraft] = useState(() => getUserName(address) ?? "");
  const save = () => {
    const v = draft.trim();
    if (!v) return;
    setUserName(address, v);
    onDone(v);
  };
  return (
    <div className="welcome">
      <div />
      <div>
        <RingMark variant="full" className="ring" />
        <h2>What should we<br /><span className="u">call you?</span></h2>
        <p>Your circle sees this name instead of a wallet address. You can change it anytime.</p>
      </div>
      <div>
        <div className="phone-field">
          <span className="flag">🪪</span>
          <div style={{ flex: 1 }}>
            <div className="lab">Your name</div>
            <input
              className="num"
              style={{ border: "none", background: "transparent", outline: "none", width: "100%", padding: 0 }}
              placeholder="e.g. Amaka"
              value={draft}
              maxLength={24}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            />
          </div>
        </div>
        <button className="btn btn-ochre btn-block" disabled={!draft.trim()} onClick={save}>
          Continue →
        </button>
      </div>
    </div>
  );
}

function Welcome() {
  const inMiniPay = useInMiniPay();
  const { connect, connectors, error, isPending } = useConnect();

  const handleRetry = () => {
    const injected = connectors.find((c) => c.id === "injected");
    if (injected) connect({ connector: injected });
  };

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
            <div className="num">
              {inMiniPay
                ? error
                  ? "Connection failed"
                  : "Connecting…"
                : "Connect to begin"}
            </div>
          </div>
        </div>
        <ConnectButton />
        {inMiniPay && !error && (
          <p style={{ marginTop: 10 }}>One moment. MiniPay is connecting your wallet.</p>
        )}
        {inMiniPay && error && (
          <div style={{ marginTop: 10 }}>
            <p style={{ color: "#c00", fontSize: 13 }}>
              Could not connect to MiniPay. Make sure you&apos;re opening this inside the MiniPay app.
            </p>
            <button
              className="btn btn-ochre btn-block"
              style={{ marginTop: 8 }}
              disabled={isPending}
              onClick={handleRetry}
            >
              {isPending ? "Retrying…" : "Try again"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const CIRCLES_PER_PAGE = 5;

function Dashboard({ address, name, onEdit }: { address: `0x${string}`; name: string; onEdit: () => void }) {
  const { mine, isLoading } = useMyCircles();
  const score = useScore(address);
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(mine.length / CIRCLES_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = mine.slice(safePage * CIRCLES_PER_PAGE, (safePage + 1) * CIRCLES_PER_PAGE);
  return (
    <>
      <div className="appbar">
        <RingMark variant="static" size={22} />
        <span className="tt">{name}</span>
        <span className="mini">AjoAI</span>
      </div>
      <div className="appmain">
        <div className="greet">Sannu, {name} 👋</div>
        <div className="muted" style={{ margin: "2px 2px 0" }}>
          {short(address)} · <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={onEdit}>edit name</span>
        </div>

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

        {paged.map((c, i) => (
          <CircleCard key={c.addr} address={c.addr} alt={i % 2 === 1} isOrganizer={c.isOrganizer} isMember={c.isMember} />
        ))}

        {totalPages > 1 && (
          <div className="pagination">
            <button className="btn-ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>‹ Prev</button>
            <span className="muted">Page {safePage + 1} of {totalPages}</span>
            <button className="btn-ghost" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Next ›</button>
          </div>
        )}

        <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
          <Link href="/app/create" className="btn btn-block">+ Start a circle</Link>
          <Link href="/app/join" className="btn-ghost" style={{ textAlign: "center", display: "block" }}>Join with a code</Link>
        </div>
      </div>
    </>
  );
}

function CircleCard({ address, alt, isOrganizer, isMember }: { address: `0x${string}`; alt: boolean; isOrganizer?: boolean; isMember?: boolean }) {
  const { state, round, slots, roundsPaid, recipient } = useCircle(address);
  const pct = slots ? (Number(roundsPaid ?? 0n) / slots) * 100 : 0;
  const stateName = state !== undefined ? STATE_NAMES[state] : "…";
  const live = state === 1;
  const forming = state === 0;
  const title = getName(address) || `Circle ${short(address)}`;
  const role = isOrganizer && !isMember ? "You organise" : isOrganizer ? "Organiser" : "Member";
  return (
    <Link href={`/app/circle/${address}`} className={`ccard${alt ? " alt" : ""}`} style={{ display: "block" }}>
      <div className="top">
        <RingMark variant="static" size={26} />
        <span className="nm">{title}</span>
        <span className={`pill ${live ? "turn" : forming ? "due" : "paid"}`} style={{ marginLeft: "auto" }}>{stateName}</span>
      </div>
      <div className="meta">
        <span>{forming ? "Forming · invite members" : `Round ${round?.toString() ?? "…"} of ${slots ?? "…"}`}</span>
        <span>{role}</span>
      </div>
      <div className="bar"><i style={{ width: `${forming ? 0 : pct}%` }} /></div>
    </Link>
  );
}
