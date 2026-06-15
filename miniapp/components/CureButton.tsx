"use client";

import { useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { useEffect } from "react";
import { useCeloWrite, friendlyTxError } from "@/lib/tx";
import { circleAbi, erc20Abi } from "@/lib/abi";
import { FAUCETABLE } from "@/lib/chain";
import { fmtAmount } from "@/lib/format";
import { FaucetButton, useTokenBalance } from "@/components/Faucet";

// cure(): a delinquent member re-posts one deposit to clear their delinquency. This is the human
// unblock for the DELIBERATE recipient-withheld case (Circle.sol triggerPayout withholds a payout
// to a delinquent recipient). For a NON-recipient miss the agent already covers from the deposit
// and continues automatically — no cure needed there. Mirrors the join/pay approve→write flow.
export function CureButton({
  address, token, deposit, symbol, decimals, onCured,
}: {
  address: `0x${string}`;
  token?: `0x${string}`;
  deposit?: bigint;
  symbol: string;
  decimals: number;
  onCured: () => void;
}) {
  const { address: me } = useAccount();
  const { write, isPending, error } = useCeloWrite();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });
  const { data: allowance, refetch: refetchAllow } = useReadContract({
    address: token, abi: erc20Abi, functionName: "allowance",
    args: me && token ? [me, address] : undefined,
    query: { enabled: Boolean(me && token) },
  });
  const { balance, refetch: refetchBal } = useTokenBalance(token);
  useEffect(() => { if (receipt) onCured(); }, [receipt, onCured]);

  const lowBalance = deposit !== undefined && (balance === undefined || balance < deposit);
  const needsApproval = deposit !== undefined && (allowance === undefined || (allowance as bigint) < deposit);
  const busy = isPending || (!!txHash && !receipt);

  async function approve() {
    if (!token || deposit === undefined) return;
    const h = await write({ address: token, abi: erc20Abi, functionName: "approve", args: [address, deposit], gas: 120_000n });
    setTxHash(h); setTimeout(() => refetchAllow(), 4000);
  }
  async function cure() {
    const h = await write({ address, abi: circleAbi, functionName: "cure", args: [], gas: 400_000n });
    setTxHash(h);
  }

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 9 }}>
      {error && <p className="banner">{friendlyTxError(error)}</p>}
      {lowBalance ? (
        FAUCETABLE ? (
          <>
            <p className="muted">You need {fmtAmount(deposit, symbol, decimals)} to restore your deposit. Mint test tokens:</p>
            <FaucetButton token={token} need={deposit} symbol={symbol} decimals={decimals} onMinted={refetchBal} />
          </>
        ) : (
          <p className="muted">You need {fmtAmount(deposit, symbol, decimals)} to restore your deposit and clear your delinquency.</p>
        )
      ) : needsApproval ? (
        <button className="btn btn-block" disabled={busy} onClick={approve}>{busy ? "Approving…" : `1. Approve deposit (${fmtAmount(deposit, symbol, decimals)})`}</button>
      ) : (
        <button className="btn btn-ochre btn-block" disabled={busy} onClick={cure}>{busy ? "Restoring…" : `Restore deposit & continue (${fmtAmount(deposit, symbol, decimals)})`}</button>
      )}
    </div>
  );
}
