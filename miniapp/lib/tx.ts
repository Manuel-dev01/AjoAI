"use client";

import { useWriteContract } from "wagmi";
import type { Abi } from "viem";
import { FEE_CURRENCY, activeChain } from "./chain";

type WriteReq = {
  address: `0x${string}`;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

// Wraps wagmi's writeContract to always pay gas in a stablecoin (CIP-64 feeCurrency=USDm) and
// pin the chain — MiniPay's required pattern (no CELO needed, legacy tx). viem's Celo chain
// accepts the feeCurrency field; we cast since wagmi's generic types don't surface it here.
export function useCeloWrite() {
  const { writeContractAsync, isPending, error, data } = useWriteContract();
  const write = (req: WriteReq): Promise<`0x${string}`> =>
    writeContractAsync({
      ...req,
      chainId: activeChain.id,
      feeCurrency: FEE_CURRENCY,
    } as unknown as Parameters<typeof writeContractAsync>[0]);
  return { write, isPending, error, txHash: data };
}
