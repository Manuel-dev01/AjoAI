"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { parseEventLogs, parseUnits } from "viem";
import { useAccount, useWaitForTransactionReceipt } from "wagmi";
import { AppBar, ConnectButton } from "@/components/ui";
import { useCeloWrite, friendlyTxError } from "@/lib/tx";
import { factoryAbi } from "@/lib/abi";
import { FACTORY } from "@/lib/circle";
import { TOKEN_LIST } from "@/lib/chain";
import { setName } from "@/lib/names";

const FREQS = [
  { label: "10 min", period: 600 }, // test: agent rotates within minutes
  { label: "15 min", period: 900 }, // test
  { label: "Weekly", period: 604_800 },
  { label: "Monthly", period: 2_592_000 },
];
const SIZES = [2, 3, 4, 6, 8, 10];
// Token options (with on-chain decimals) for the active chain — USDT is 6-decimal, not 18.
const TOKEN_OPTS = TOKEN_LIST;

export default function CreateCircle() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { write, isPending, error } = useCeloWrite();
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
    const period = FREQS[freq].period;
    const contribution = parseUnits(amount || "0", TOKEN_OPTS[tok].decimals);
    const h = await write({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "createCircle",
      args: [TOKEN_OPTS[tok].addr, contribution, BigInt(period), BigInt(Math.floor(period / 7)), 500, SIZES[size]],
    });
    setTxHash(h);
  }

  const busy = isPending || (!!txHash && !receipt);

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
          <div className="fi" style={{ fontSize: 13 }}>Random &amp; locked<span className="cur">fair</span></div>
        </div>

        <p className="muted">A one-round security deposit ({amount || 0} {TOKEN_OPTS[tok].sym}) is posted by each member on joining. It covers a missed round and is returned on clean completion.</p>
        {error && <p className="banner">{friendlyTxError(error)}</p>}
      </div>

      <div className="fixbtn">
        {isConnected ? (
          <button className="btn btn-ochre btn-block" disabled={busy} onClick={submit}>
            {busy ? "Creating…" : "Create & join →"}
          </button>
        ) : (
          <ConnectButton />
        )}
      </div>
    </>
  );
}
