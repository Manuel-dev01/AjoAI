"use client";

import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import type { Abi } from "viem";
import { FEE_CURRENCY, activeChain } from "./chain";
import { isMiniPay } from "./wagmi";

type WriteReq = {
  address: `0x${string}`;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

// Wraps wagmi's writeContract so every write:
//  1. switches the wallet to the target Celo chain first (avoids the "chain does not match"
//     error — desktop MetaMask and MiniPay don't start on our chain), and
//  2. pays gas in a stablecoin (CIP-64 feeCurrency=USDm) ONLY inside MiniPay; desktop wallets
//     (MetaMask) can't serialize a feeCurrency tx, so there we let gas pay in CELO.
export function useCeloWrite() {
  const { writeContractAsync, isPending, error, data } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const { chainId } = useAccount();

  const write = async (req: WriteReq): Promise<`0x${string}`> => {
    if (chainId !== activeChain.id) {
      try {
        await switchChainAsync({ chainId: activeChain.id });
      } catch {
        throw new Error(`Switch your wallet to ${activeChain.name} (chain ${activeChain.id}) and try again.`);
      }
    }
    const extra = isMiniPay() ? { feeCurrency: FEE_CURRENCY } : {};
    return writeContractAsync({
      ...req,
      chainId: activeChain.id,
      ...extra,
    } as unknown as Parameters<typeof writeContractAsync>[0]);
  };

  return { write, isPending, error, txHash: data };
}
