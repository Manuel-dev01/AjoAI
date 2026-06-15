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
  // Optional explicit gas limit. Celo RPCs (incl. MiniPay's) intermittently fail eth_estimateGas
  // by simulating against lagged state — the Python agent sets an explicit gas for the same reason
  // (agent/src/chain.py). Pass a sane limit on recurring money paths so they don't depend on it.
  gas?: bigint;
};

// Map known contract reverts / RPC quirks to short, honest, human copy for the UI banners.
// Falls back to a trimmed raw message. Keep these in sync with Circle.sol custom errors.
export function friendlyTxError(err?: { message?: string } | null): string | null {
  if (!err) return null;
  const m = (err.message ?? "").toString();
  if (/PastGrace/.test(m)) return "This round's window has closed — the agent now covers it from deposits.";
  if (/AlreadyContributed/.test(m)) return "You've already paid this round.";
  if (/WindowNotElapsed/.test(m)) return "Too early — the contribution window hasn't closed yet.";
  if (/NotDelinquent/.test(m)) return "You're in good standing — nothing to restore.";
  if (/NotMember/.test(m)) return "You're not a member of this circle.";
  if (/insufficient funds|gas required|fee|feeCurrency/i.test(m)) return "Couldn't pay gas — keep a little USDm in your wallet for fees.";
  if (/eth_estimateGas/.test(m)) return "Couldn't simulate the transaction — it may no longer be valid. Refresh and try again.";
  if (/User rejected|denied|rejected the request/i.test(m)) return "You cancelled the transaction.";
  return m.slice(0, 140);
}

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
    const { gas, ...rest } = req;
    return writeContractAsync({
      ...rest,
      ...(gas !== undefined ? { gas } : {}),
      chainId: activeChain.id,
      ...extra,
    } as unknown as Parameters<typeof writeContractAsync>[0]);
  };

  return { write, isPending, error, txHash: data };
}
