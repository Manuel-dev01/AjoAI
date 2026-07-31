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
//
// NEVER returns raw error text. viem's ContractFunctionExecutionError message embeds a
// "Contract Call:\n  address: 0x…\n  sender: 0x…" block, so echoing any slice of it leaks raw
// addresses into the UI — which is exactly what the old `m.slice(0, 140)` fallback did on the
// create-circle path (none of the mapped cases below covered it). The full error still reaches
// the console for debugging.
//
// Keep these in sync with Circle.sol's custom errors AND its constructor requires.
export function friendlyTxError(err?: { message?: string } | null): string | null {
  if (!err) return null;
  const m = (err.message ?? "").toString();

  // User-initiated — check first; a cancel is not a failure worth explaining.
  if (/User rejected|denied|rejected the request|User denied/i.test(m)) return "You cancelled the transaction.";

  // Circle.sol runtime errors (contribute / cure / payout).
  if (/PastGrace/.test(m)) return "This round's window has closed — the agent now covers it from deposits.";
  if (/AlreadyContributed/.test(m)) return "You've already paid this round.";
  if (/WindowNotElapsed/.test(m)) return "Too early — the contribution window hasn't closed yet.";
  if (/NotDelinquent/.test(m)) return "You're in good standing — nothing to restore.";
  if (/NotMember/.test(m)) return "You're not a member of this circle.";

  // Circle.sol constructor requires — reachable via CircleFactory.createCircle.
  if (/contribution=0/.test(m)) return "Enter an amount greater than zero for each round.";
  if (/slots<2/.test(m)) return "A circle needs at least 2 members.";
  if (/token=0/.test(m)) return "That currency isn't available on this network. Pick another.";
  if (/penalty>100%/.test(m)) return "That late fee is out of range.";
  if (/agent=0/.test(m)) return "This network's factory isn't fully configured yet — please report this.";

  // Wallet / network.
  if (/ChainMismatch|chain .*does not match|Switch your wallet/i.test(m)) {
    return `Switch your wallet to ${activeChain.name} and try again.`;
  }
  if (/insufficient funds|insufficient balance|transfer amount exceeds balance/i.test(m)) {
    return "Not enough balance to cover this — top up and try again.";
  }
  // Narrower than the old /fee/i, which also matched "feeCurrency" in unrelated serializer errors.
  if (/gas required|out of gas|intrinsic gas|feeCurrency/i.test(m)) {
    return "Couldn't cover the network fee right now — please try again in a moment.";
  }
  // viem writes "Estimate Gas Arguments:"; the old /eth_estimateGas/ was case-sensitive and missed it.
  if (/estimate ?gas|eth_estimateGas|unknown reason/i.test(m)) {
    return "Couldn't simulate the transaction — it may no longer be valid. Refresh and try again.";
  }
  if (/returned no data|no contract|address is not a contract/i.test(m)) {
    return "No contract found at that address on this network — check you're on the right chain.";
  }

  // Unmapped: say something honest and keep the detail in the console, never in the banner.
  console.error("[tx] unmapped error:", err);
  return "Something went wrong with that transaction. Please try again — details are in the browser console.";
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
