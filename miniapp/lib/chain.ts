import { celo, celoSepolia } from "viem/chains";

// Use viem's built-in Celo chains — they carry the CIP-64 / feeCurrency serializers MiniPay
// needs. celoSepolia = 11142220 (dev), celo = 42220 (mainnet).
export const activeChain = celoSepolia;
export { celo, celoSepolia };

// Deployed AjoAI addresses (config/addresses.sepolia.json). Read here; never hardcoded elsewhere.
export const CONTRACTS = {
  circleFactory: "0x032fEE1776508fE59bA715120Bc190b682162191",
  reputationLedger: "0x12Ac76Fd85500fd1dF47D6bF15B6B275eA3FB3Ce",
  // A live example circle (real Mento NGNm). Override with NEXT_PUBLIC_CIRCLE.
  demoCircle: "0xc578127F2978896ef1b4995CE44D780C89676cb4",
} as const;

// Mento stablecoins (rebrand: cUSD→USDm, cNGN→NGNm). MiniPay feeCurrency uses USDm only.
export const TOKENS = {
  USDm: "0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b",
  NGNm: "0x3d5ae86F34E2a82771496D140daFAEf3789dF888",
} as const;

// CIP-64 gas-in-stablecoin: MiniPay only allows USDm as feeCurrency (docs §code-library).
export const FEE_CURRENCY = TOKENS.USDm as `0x${string}`;

export const demoCircle = (): `0x${string}` =>
  (process.env.NEXT_PUBLIC_CIRCLE as `0x${string}`) || (CONTRACTS.demoCircle as `0x${string}`);

export const explorerTx = (hash: string) =>
  `${activeChain.blockExplorers!.default.url}/tx/${hash}`;
export const explorerAddr = (addr: string) =>
  `${activeChain.blockExplorers!.default.url}/address/${addr}`;
