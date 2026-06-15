"use client";

import { createPublicClient, http, type Address } from "viem";
import { activeChain, MENTO_BROKER } from "./chain";

// In-app cross-currency swap via the Mento Protocol Broker (mainnet). Used only for the FX leg the
// MiniPay Pockets stable-swap can't do (e.g. USDm -> NGNm). The user must already hold a little USDm
// for gas (Pockets bootstraps that) before this can run. Reads route via the Broker's exchange
// providers; the swap itself is approve(broker, amountIn) + broker.swapIn(...) with a slippage bound.

export const mentoBrokerAbi = [
  { type: "function", name: "getExchangeProviders", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [
    { name: "exchangeProvider", type: "address" }, { name: "exchangeId", type: "bytes32" },
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
  ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getAmountIn", stateMutability: "view", inputs: [
    { name: "exchangeProvider", type: "address" }, { name: "exchangeId", type: "bytes32" },
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "amountOut", type: "uint256" },
  ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "swapIn", stateMutability: "nonpayable", inputs: [
    { name: "exchangeProvider", type: "address" }, { name: "exchangeId", type: "bytes32" },
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" },
  ], outputs: [{ type: "uint256" }] },
] as const;

const providerAbi = [
  { type: "function", name: "getExchanges", stateMutability: "view", inputs: [], outputs: [
    { type: "tuple[]", components: [{ name: "exchangeId", type: "bytes32" }, { name: "assets", type: "address[]" }] },
  ] },
] as const;

const client = () => createPublicClient({ chain: activeChain, transport: http() });

export type MentoExchange = { provider: Address; id: `0x${string}` };

// Find the (exchangeProvider, exchangeId) whose asset pair contains BOTH tokens. Null if none
// (e.g. the pair isn't listed / illiquid) — callers should fall back to a clear notice.
export async function findExchange(tokenIn: Address, tokenOut: Address): Promise<MentoExchange | null> {
  const c = client();
  const a = tokenIn.toLowerCase();
  const b = tokenOut.toLowerCase();
  try {
    const providers = await c.readContract({ address: MENTO_BROKER, abi: mentoBrokerAbi, functionName: "getExchangeProviders" }) as Address[];
    for (const provider of providers) {
      const exchanges = await c.readContract({ address: provider, abi: providerAbi, functionName: "getExchanges" }) as { exchangeId: `0x${string}`; assets: Address[] }[];
      for (const ex of exchanges) {
        const assets = ex.assets.map((x) => x.toLowerCase());
        if (assets.includes(a) && assets.includes(b)) return { provider, id: ex.exchangeId };
      }
    }
  } catch { /* network / shape error → treat as not swappable */ }
  return null;
}

export async function quoteAmountOut(ex: MentoExchange, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint> {
  return client().readContract({
    address: MENTO_BROKER, abi: mentoBrokerAbi, functionName: "getAmountOut",
    args: [ex.provider, ex.id, tokenIn, tokenOut, amountIn],
  }) as Promise<bigint>;
}

// USDm (tokenIn) needed to receive `amountOut` of tokenOut (e.g. the NGNm deposit). Used to target
// the exact amount a join/contribute requires.
export async function quoteAmountIn(ex: MentoExchange, tokenIn: Address, tokenOut: Address, amountOut: bigint): Promise<bigint> {
  return client().readContract({
    address: MENTO_BROKER, abi: mentoBrokerAbi, functionName: "getAmountIn",
    args: [ex.provider, ex.id, tokenIn, tokenOut, amountOut],
  }) as Promise<bigint>;
}

// amountOutMin with a bps slippage tolerance (default 1%).
export function minOut(quoted: bigint, slippageBps = 100): bigint {
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
}
