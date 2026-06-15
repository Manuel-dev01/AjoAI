"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { type Address } from "viem";
import { useCeloWrite, friendlyTxError } from "@/lib/tx";
import { erc20Abi } from "@/lib/abi";
import { TOKENS, POCKETS_STABLES, MENTO_BROKER } from "@/lib/chain";
import { fmtAmount } from "@/lib/format";
import { useTokenBalance } from "@/components/Faucet";
import { findExchange, quoteAmountIn, minOut, mentoBrokerAbi, type MentoExchange } from "@/lib/mento";

// Shown (mainnet only) when a member lacks the circle's token to join/contribute. Two paths:
//  • Stable trio (USDm/USDT/USDC): MiniPay Pockets does a native 1:1 swap AND is the only way to
//    bootstrap the first USDm for gas — so we guide to Pockets rather than a dApp swap.
//  • NGNm (real FX): an in-app Mento Broker swap USDm→NGNm (needs a little USDm for gas already).
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
        <p style={{ margin: "0 0 6px", fontWeight: 700 }}>Top up {needSymbol} in your MiniPay wallet</p>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Open <b>Pockets</b> in MiniPay and swap your USDT/USDC → {needSymbol} (1:1, no gas needed).
          {needSymbol === "USDm" ? " You also need a little USDm to pay gas." : ""} Then come back and join.
        </p>
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
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });
  const { balance: usdmBal, refetch: refetchUsdm } = useTokenBalance(usdm);
  const { data: allowance, refetch: refetchAllow } = useReadContract({
    address: usdm, abi: erc20Abi, functionName: "allowance",
    args: me && usdm ? [me, MENTO_BROKER] : undefined,
    query: { enabled: Boolean(me && usdm) },
  });

  // Discover the USDm↔needToken exchange and quote the USDm needed for `need` out.
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
          if (alive) setUsdmIn((inAmt * 102n) / 100n); // +2% headroom for slippage/price drift
        } catch { if (alive) setUsdmIn(undefined); }
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [usdm, needToken, need]);

  useEffect(() => { if (receipt) { refetchUsdm(); onConverted(); } }, [receipt, refetchUsdm, onConverted]);

  const busy = isPending || (!!txHash && !receipt);
  const lowUsdm = usdmIn !== undefined && (usdmBal === undefined || usdmBal < usdmIn);
  const needsApproval = usdmIn !== undefined && (allowance === undefined || (allowance as bigint) < usdmIn);

  async function approve() {
    if (!usdm || usdmIn === undefined) return;
    const h = await write({ address: usdm, abi: erc20Abi, functionName: "approve", args: [MENTO_BROKER, usdmIn], gas: 120_000n });
    setTxHash(h); setTimeout(() => refetchAllow(), 4000);
  }
  async function swap() {
    if (!ex || !usdm || !needToken || usdmIn === undefined || need === undefined) return;
    const h = await write({
      address: MENTO_BROKER, abi: mentoBrokerAbi, functionName: "swapIn",
      args: [ex.provider, ex.id, usdm, needToken, usdmIn, minOut(need)], gas: 600_000n,
    });
    setTxHash(h);
  }

  if (loading) return <p className="muted">Checking swap route…</p>;
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
    <div style={{ marginTop: 6, display: "grid", gap: 9 }}>
      <p className="muted" style={{ fontSize: 13 }}>
        Swap ≈ {fmtAmount(usdmIn, "USDm", 18)} → {fmtAmount(need, needSymbol, needDecimals)} via Mento.
      </p>
      {error && <p className="banner">{friendlyTxError(error)}</p>}
      {lowUsdm ? (
        <p className="muted">You need ≈ {fmtAmount(usdmIn, "USDm", 18)}. Top up USDm via your MiniPay Pockets (swap USDT→USDm), then retry.</p>
      ) : needsApproval ? (
        <button className="btn btn-block" disabled={busy} onClick={approve}>{busy ? "Approving…" : `1. Approve ${fmtAmount(usdmIn, "USDm", 18)}`}</button>
      ) : (
        <button className="btn btn-ochre btn-block" disabled={busy} onClick={swap}>{busy ? "Swapping…" : `Swap to ${needSymbol}`}</button>
      )}
    </div>
  );
}
