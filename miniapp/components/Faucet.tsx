"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { useCeloWrite } from "@/lib/tx";
import { erc20Abi } from "@/lib/abi";
import { FAUCETABLE } from "@/lib/chain";
import { fmtAmount } from "@/lib/format";

// Read a member's token balance (for gating join/contribute).
export function useTokenBalance(token?: `0x${string}`) {
  const { address } = useAccount();
  const { data, refetch } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(token && address) },
  });
  return { balance: data as bigint | undefined, refetch };
}

// Testnet faucet: mint mock stables so a member can actually post the deposit / contribution.
// Hidden on mainnet (real Mento tokens aren't mintable). Mints ~100x the `need` (min 1,000,000).
export function FaucetButton({
  token,
  need,
  symbol,
  decimals,
  onMinted,
}: {
  token?: `0x${string}`;
  need?: bigint;
  symbol: string;
  decimals: number;
  onMinted: () => void;
}) {
  const { address } = useAccount();
  const { write, isPending } = useCeloWrite();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (receipt) onMinted();
  }, [receipt, onMinted]);

  if (!FAUCETABLE || !token || !address) return null;

  const floor = 1_000_000n * 10n ** BigInt(decimals);
  const want = need ? need * 100n : floor;
  const amount = want > floor ? want : floor;

  async function mint() {
    const h = await write({ address: token!, abi: erc20Abi, functionName: "mint", args: [address!, amount] });
    setTxHash(h);
  }
  const busy = isPending || (!!txHash && !receipt);

  return (
    <button className="btn btn-cream btn-block" disabled={busy} onClick={mint}>
      {busy ? "Minting…" : `Get test ${symbol || "tokens"} (${fmtAmount(amount, "", decimals)})`}
    </button>
  );
}
