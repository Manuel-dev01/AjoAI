"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { type Address } from "viem";
import { useCeloWrite, friendlyTxError } from "@/lib/tx";
import { erc20Abi } from "@/lib/abi";
import { TOKENS, POCKETS_STABLES, MENTO_BROKER } from "@/lib/chain";
import { fmtAmount, fmtCompact } from "@/lib/format";
import { useTokenBalance } from "@/components/Faucet";
import { findExchange, quoteAmountIn, mentoBrokerAbi, type MentoExchange } from "@/lib/mento";
import { addCashLink, openDeeplink, isMiniPay } from "@/lib/minipay";

// Rendered inside the convert bottom-sheet when a member lacks the circle's token. Two paths:
//  • Stable trio (USDm/USDT/USDC): MiniPay Pockets does a native 1:1 swap — guide there.
//  • NGNm (real FX): an in-app Mento Broker swap USDm→NGNm (USDm here is swap INPUT to fund the
//    deposit — NOT gas; MiniPay covers gas automatically via its own background swap).
export function ConvertPanel({
  needToken, needSymbol, needDecimals, need, onConverted,
}: {
  needToken?: Address;
  needSymbol: string;
  needDecimals: number;
  need?: bigint;
  onConverted: () => void;
}) {
  const isStable = (POCKETS_STABLES as readonly string[]).includes(needSymbol);
  if (isStable) {
    return (
      <div className="banner" style={{ background: "var(--cream-d)", color: "var(--ink)", borderColor: "var(--ink)" }}>
        <p style={{ margin: "0 0 6px", fontWeight: 700 }}>Get {needSymbol} in MiniPay</p>
        {isMiniPay() ? (
          <>
            <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
              Add {needSymbol} to your wallet — instant, 1:1, no fee. Then come back and join.
            </p>
            <button className="btn btn-block" onClick={() => openDeeplink(addCashLink([needSymbol]))}>
              Add {needSymbol} in MiniPay
            </button>
          </>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            One tap in MiniPay <b>Pockets</b>: swap USDT → {needSymbol}. Instant, 1:1, no fee — then come back and join.
          </p>
        )}
      </div>
    );
  }
  return <MentoSwap needToken={needToken} needSymbol={needSymbol} needDecimals={needDecimals} need={need} onConverted={onConverted} />;
}

function MentoSwap({
  needToken, needSymbol, needDecimals, need, onConverted,
}: {
  needToken?: Address; needSymbol: string; needDecimals: number; need?: bigint; onConverted: () => void;
}) {
  const { address: me } = useAccount();
  const usdm = TOKENS.USDm as Address | undefined;
  const { write, isPending, error } = useCeloWrite();
  const [ex, setEx] = useState<MentoExchange | null>(null);
  const [usdmIn, setUsdmIn] = useState<bigint | undefined>();
  const [loading, setLoading] = useState(true);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [phase, setPhase] = useState<"idle" | "approving" | "swapping">("idle");
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });
  const { balance: usdmBal, refetch: refetchUsdm } = useTokenBalance(usdm);
  const { data: allowance, refetch: refetchAllow } = useReadContract({
    address: usdm, abi: erc20Abi, functionName: "allowance",
    args: me && usdm ? [me, MENTO_BROKER] : undefined,
    query: { enabled: Boolean(me && usdm) },
  });

  // Discover the USDm↔needToken exchange and quote the USDm needed for `need` out (+2% headroom so
  // normal slippage still clears the amountOutMin=need floor below).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!usdm || !needToken || need === undefined) return;
      setLoading(true);
      const found = await findExchange(usdm, needToken);
      if (!alive) return;
      setEx(found);
      if (found) {
        try {
          const inAmt = await quoteAmountIn(found, usdm, needToken, need);
          if (alive) setUsdmIn((inAmt * 102n) / 100n);
        } catch { if (alive) setUsdmIn(undefined); }
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [usdm, needToken, need]);

  // Only the SWAP receipt should finish/close the sheet. The APPROVE receipt just refreshes the
  // allowance so the Swap button appears (shared txHash would otherwise close the sheet after approve).
  useEffect(() => {
    if (!receipt) return;
    if (phase === "approving") { refetchAllow(); setPhase("idle"); }
    else if (phase === "swapping") { refetchUsdm(); onConverted(); setPhase("idle"); }
  }, [receipt, phase, refetchAllow, refetchUsdm, onConverted]);

  const busy = isPending || (!!txHash && !receipt);
  const lowUsdm = usdmIn !== undefined && (usdmBal === undefined || usdmBal < usdmIn);
  const needsApproval = usdmIn !== undefined && (allowance === undefined || (allowance as bigint) < usdmIn);

  async function approve() {
    if (!usdm || usdmIn === undefined) return;
    setPhase("approving");
    const h = await write({ address: usdm, abi: erc20Abi, functionName: "approve", args: [MENTO_BROKER, usdmIn], gas: 120_000n });
    setTxHash(h);
  }
  async function swap() {
    if (!ex || !usdm || !needToken || usdmIn === undefined || need === undefined) return;
    setPhase("swapping");
    // amountOutMin = need: deliver at least the deposit amount, or revert cleanly (never under-fill).
    const h = await write({
      address: MENTO_BROKER, abi: mentoBrokerAbi, functionName: "swapIn",
      args: [ex.provider, ex.id, usdm, needToken, usdmIn, need], gas: 600_000n,
    });
    setTxHash(h);
  }

  if (loading) return <p className="muted">Finding the best swap route…</p>;
  if (!ex || usdmIn === undefined) {
    return (
      <div className="banner" style={{ background: "var(--cream-d)", color: "var(--ink)", borderColor: "var(--ink)" }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          {needSymbol} isn’t swappable in-app right now. Pick a USDm circle instead, or fund {needSymbol} another way.
        </p>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="contrib" style={{ background: "var(--cream-d)", color: "var(--ink)" }}>
        <div className="a" style={{ fontSize: 22 }}>{fmtCompact(usdmIn, "USDm", 18)} → {fmtAmount(need, needSymbol, needDecimals)}</div>
        <div className="l">via Mento · rate updates live</div>
      </div>
      {error && <p className="banner">{friendlyTxError(error)}</p>}
      {lowUsdm ? (
        isMiniPay() ? (
          <>
            <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
              First add ~{fmtCompact(usdmIn, "USDm", 18)} to your wallet (instant &amp; free), then reopen this to finish the swap to {needSymbol}.
            </p>
            <button className="btn btn-block" onClick={() => openDeeplink(addCashLink(["USDm"]))}>
              Add USDm in MiniPay
            </button>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>
            First get ~{fmtCompact(usdmIn, "USDm", 18)} in MiniPay <b>Pockets</b> (swap USDT → USDm, instant &amp; free), then reopen this to finish the swap to {needSymbol}.
          </p>
        )
      ) : needsApproval ? (
        <button className="btn btn-block" disabled={busy} onClick={approve}>{busy ? "Approving…" : `1. Approve ${fmtCompact(usdmIn, "USDm", 18)}`}</button>
      ) : (
        <button className="btn btn-ochre btn-block" disabled={busy} onClick={swap}>{busy ? "Swapping…" : `Swap to ${needSymbol}`}</button>
      )}
    </div>
  );
}
