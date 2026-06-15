"use client";

import { useTokenBalance } from "@/components/Faucet";
import { TOKENS, FAUCETABLE } from "@/lib/chain";

// MiniPay pays gas only in USDm (CIP-64). A wallet with ~0 USDm can't pay gas for ANY write — so
// when that's the case on mainnet, nudge the user to top up USDm via their MiniPay Pockets (a 1:1
// USDT/USDC -> USDm swap). Silent on testnet (faucet covers it) and when they already hold USDm.
export function GasHint() {
  const usdm = TOKENS.USDm as `0x${string}` | undefined;
  const { balance } = useTokenBalance(usdm);
  if (FAUCETABLE) return null; // testnet: faucet path handles funding
  if (balance === undefined || balance > 0n) return null;
  return (
    <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
      ⛽ Gas is paid in USDm. Keep a little USDm in your wallet — swap USDT→USDm 1:1 in your MiniPay
      Pockets, then come back.
    </p>
  );
}
