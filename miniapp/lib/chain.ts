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

// Tokens used to CREATE/JOIN circles in the app.
// On TESTNET we use mintable mock stables (real Mento NGNm/USDm aren't faucetable on Sepolia,
// so members couldn't post the deposit) — an in-app faucet mints these. On MAINNET, swap these
// for the real Mento addresses (USDm 0x765DE8…, NGNm 0xE2702B…).
const TEST_TOKENS = {
  NGNm: "0x435917C839dFE442255B2E4D717DF7de1601E6f7", // AjoAI Test NGNm (mintable)
  USDm: "0x3019C211F3B664e18A58213d20482D4E658A7527", // AjoAI Test USDm (mintable)
} as const;
const MAINNET_TOKENS = {
  USDm: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  NGNm: "0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71",
} as const;
export const TOKENS = activeChain.testnet ? TEST_TOKENS : MAINNET_TOKENS;

// The app's tokens are mintable (faucet) on testnet only.
export const FAUCETABLE = Boolean(activeChain.testnet);

// CIP-64 gas-in-stablecoin: MiniPay only allows USDm as feeCurrency (docs §code-library).
export const FEE_CURRENCY = TOKENS.USDm as `0x${string}`;

export const demoCircle = (): `0x${string}` =>
  (process.env.NEXT_PUBLIC_CIRCLE as `0x${string}`) || (CONTRACTS.demoCircle as `0x${string}`);

export const explorerTx = (hash: string) =>
  `${activeChain.blockExplorers!.default.url}/tx/${hash}`;
export const explorerAddr = (addr: string) =>
  `${activeChain.blockExplorers!.default.url}/address/${addr}`;
