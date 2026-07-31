"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { parseEventLogs, parseUnits } from "viem";
import { useAccount, useWaitForTransactionReceipt } from "wagmi";
import { AppBar, ConnectButton } from "@/components/ui";
import { useCeloWrite, friendlyTxError } from "@/lib/tx";
import { factoryAbi } from "@/lib/abi";
import { FACTORY } from "@/lib/circle";
import { TOKEN_LIST, activeChain } from "@/lib/chain";
import { setName } from "@/lib/names";
import { frequencyLabel, durationLabel } from "@/lib/format";

const FREQS = [
  { label: "10 min", period: 600 }, // test: agent rotates within minutes
  { label: "15 min", period: 900 }, // test
  { label: "Weekly", period: 604_800 },
  { label: "Monthly", period: 2_592_000 },
];
const SIZES = [2, 3, 4, 6, 8, 10];
// Token options (with on-chain decimals) for the active chain — USDT is 6-decimal, not 18.
const TOKEN_OPTS = TOKEN_LIST;

// createCircle deploys a Circle, so it is well above a plain call. Celo RPCs intermittently fail
// eth_estimateGas against lagged state (see lib/tx.ts), and this path has no retry — so give it an
// explicit limit rather than depending on estimation. Measured deploys land around 2.6M.
const CREATE_GAS = 4_000_000n;

export default function CreateCircle() {
  const router = useRouter();
  const { isConnected, chainId } = useAccount();
  const { write, isPending, error } = useCeloWrite();
  const [localError, setLocalError] = useState<string | null>(null);
  const [name, setNameInput] = useState("");
  const [amount, setAmount] = useState("10");
  const [tok, setTok] = useState(0);
  const [freq, setFreq] = useState(0); // default 10 min (fast testing)
  const [size, setSize] = useState(0); // default 2 members (fast testing)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!receipt) return;
    const logs = parseEventLogs({ abi: factoryAbi, eventName: "CircleCreated", logs: receipt.logs });
    const created = (logs[0]?.args as { circle?: string } | undefined)?.circle;
    if (created) {
      if (name.trim()) setName(created, name);
      router.push(`/app/circle/${created}`);
    }
  }, [receipt, router, name]);

  async function submit() {
    setLocalError(null);
    const period = FREQS[freq].period;
    const contribution = parseUnits(amount || "0", TOKEN_OPTS[tok].decimals);
    // Caught client-side so the wallet never round-trips to a guaranteed `contribution=0` revert.
    if (contribution <= 0n) {
      setLocalError("Enter an amount greater than zero for each round.");
      return;
    }
    try {
      const h = await write({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "createCircle",
        args: [TOKEN_OPTS[tok].addr, contribution, BigInt(period), BigInt(Math.floor(period / 7)), 500, SIZES[size]],
        gas: CREATE_GAS,
      });
      setTxHash(h);
    } catch (err) {
      // Without this catch the promise rejected unhandled and the user saw nothing at all —
      // notably for the "switch your wallet" error thrown before writeContract is ever called.
      setLocalError(friendlyTxError(err as { message?: string }));
    }
  }

  const busy = isPending || (!!txHash && !receipt);
  const amountValid = Number(amount || 0) > 0;
  const wrongNetwork = isConnected && chainId !== undefined && chainId !== activeChain.id;
  const banner = localError ?? friendlyTxError(error);

  // Live, plain-language recap so the form is a confirmable summary, not a silent set of toggles.
  const sym = TOKEN_OPTS[tok].sym;
  const members = SIZES[size];
  const amt = Number(amount || 0);
  const periodBig = BigInt(FREQS[freq].period);
  const recap = `Everyone pays ${amt.toLocaleString()} ${sym} ${frequencyLabel(periodBig)} · ${members} members · runs ${durationLabel(periodBig, members)} · you receive ${(amt * members).toLocaleString()} ${sym} on your turn · late fee 5%.`;

  return (
    <>
      <AppBar title="Start a circle" back="/app" />
      <div className="appmain">
        <div className="fld">
          <div className="fl">Circle name</div>
          <input
            className="fi"
            placeholder="e.g. Lagos Market Traders"
            value={name}
            onChange={(e) => setNameInput(e.target.value)}
            style={{ fontSize: 14 }}
          />
        </div>

        <div className="fld">
          <div className="fl">Amount each round</div>
          <div className="fi">
            <input
              className="fi"
              style={{ border: "none", padding: 0, background: "transparent", width: "70%" }}
              value={amount}
              inputMode="numeric"
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            />
            <span className="cur">{TOKEN_OPTS[tok].sym}</span>
          </div>
        </div>

        <div className="fld">
          <div className="fl">Currency</div>
          <div className="seg">
            {TOKEN_OPTS.map((t, i) => (
              <span key={t.sym} className={`s${i === tok ? " on" : ""}`} onClick={() => setTok(i)}>{t.sym}</span>
            ))}
          </div>
        </div>

        <div className="fld">
          <div className="fl">How often</div>
          <div className="seg">
            {FREQS.map((f, i) => (
              <span key={f.label} className={`s${i === freq ? " on" : ""}`} onClick={() => setFreq(i)}>{f.label}</span>
            ))}
          </div>
        </div>

        <div className="fld">
          <div className="fl">Members</div>
          <div className="seg">
            {SIZES.map((s, i) => (
              <span key={s} className={`s${i === size ? " on" : ""}`} onClick={() => setSize(i)}>{s}</span>
            ))}
          </div>
        </div>

        <div className="fld">
          <div className="fl">Payout order</div>
          <div className="fi" style={{ fontSize: 13 }}>Join order · locked<span className="cur">first in, first paid</span></div>
        </div>

        <div className="invite" style={{ marginTop: 4 }}>
          <div className="meta" style={{ fontWeight: 600, lineHeight: 1.5 }}>{recap}</div>
        </div>
        <p className="muted">A one-round security deposit ({amount || 0} {TOKEN_OPTS[tok].sym}) is posted by each member on joining. It covers a missed round and is returned on clean completion.</p>
        {wrongNetwork && <p className="banner">Your wallet is on another network. Switch to {activeChain.name} to create a circle.</p>}
        {banner && <p className="banner">{banner}</p>}
      </div>

      <div className="fixbtn">
        {isConnected ? (
          <button className="btn btn-ochre btn-block" disabled={busy || !amountValid} onClick={submit}>
            {busy ? "Creating…" : "Create & join →"}
          </button>
        ) : (
          <ConnectButton />
        )}
      </div>
    </>
  );
}
