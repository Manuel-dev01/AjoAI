import { celo, celoSepolia } from "viem/chains";

// Chain is env-selectable: NEXT_PUBLIC_CHAIN = "mainnet" (default) | "sepolia".
// viem's built-in Celo chains carry the CIP-64 / feeCurrency serializers MiniPay needs.
// celo = 42220 (mainnet, default), celoSepolia = 11142220 (dev).
const CHAIN = (process.env.NEXT_PUBLIC_CHAIN ?? "mainnet").toLowerCase();
export const activeChain = CHAIN === "sepolia" ? celoSepolia : celo;
export { celo, celoSepolia };

// Deployed AjoAI addresses per chain (config/addresses.<chain>.json). Never hardcoded elsewhere.
const MAINNET_CONTRACTS = {
  circleFactory: "0xE2401Ab2ea9E4c68cBA9946e4079cd7eF4d82186",
  reputationLedger: "0xd2f340Fe1616aB5190F326A6f127f852F5C5Ed04",
  yieldAdapter: "0xF9293905e64c39C5856CE4Aa895ab7c80F62014d", // emits SimulatedDeposit/Withdraw
  demoCircle: "0x4D03D887c3bB293623A8aF842DB80B4680a5E11F", // completed real-USDT rotation
} as const;
const SEPOLIA_CONTRACTS = {
  circleFactory: "0x032fEE1776508fE59bA715120Bc190b682162191",
  reputationLedger: "0x12Ac76Fd85500fd1dF47D6bF15B6B275eA3FB3Ce",
  yieldAdapter: "0x22b1AA6022AfE68F5F019229Bf785D8083cD3640",
  demoCircle: "0xc578127F2978896ef1b4995CE44D780C89676cb4",
} as const;
export const CONTRACTS = activeChain.testnet ? SEPOLIA_CONTRACTS : MAINNET_CONTRACTS;

// Tokens used to CREATE/JOIN circles, with their on-chain decimals (USDT on Celo is 6, not 18).
export type TokenInfo = { sym: string; addr: `0x${string}`; decimals: number };

// TESTNET: mintable mock stables (real Mento isn't faucetable on Sepolia, so members couldn't
// post the deposit). The in-app faucet mints these. MAINNET: real tokens MiniPay users hold.
const TEST_TOKEN_LIST: TokenInfo[] = [
  { sym: "NGNm", addr: "0x435917C839dFE442255B2E4D717DF7de1601E6f7", decimals: 18 },
  { sym: "USDm", addr: "0x3019C211F3B664e18A58213d20482D4E658A7527", decimals: 18 },
];
// USDT FIRST (the default): it's MiniPay's primary holding, so a member joins a USDT circle with
// ZERO swaps — and gas is auto-covered by MiniPay's background swap, so no USDm balance is needed
// either. USDm/USDC next (1:1 from USDT via native Pockets). NGNm is a real FX swap (Mento Broker),
// not in Pockets, so it's last.
const MAINNET_TOKEN_LIST: TokenInfo[] = [
  { sym: "USDT", addr: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6 },
  { sym: "USDm", addr: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 },
  { sym: "USDC", addr: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6 },
  { sym: "NGNm", addr: "0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71", decimals: 18 },
];
export const TOKEN_LIST = activeChain.testnet ? TEST_TOKEN_LIST : MAINNET_TOKEN_LIST;

// Back-compat: symbol -> address map (used by FEE_CURRENCY and any symbol lookups).
export const TOKENS = Object.fromEntries(
  TOKEN_LIST.map((t) => [t.sym, t.addr]),
) as Record<string, `0x${string}`>;

// The app's tokens are mintable (faucet) on testnet only.
export const FAUCETABLE = Boolean(activeChain.testnet);

// CIP-64 gas-in-stablecoin: MiniPay only allows USDm as feeCurrency (Mento Dollar on mainnet).
// So a MiniPay user MUST hold a little USDm for gas; USDT/USDC -> USDm is a 1:1 Pockets swap.
export const FEE_CURRENCY = TOKENS.USDm as `0x${string}`;

// Mento Protocol Broker (mainnet) for in-app cross-currency swaps (e.g. USDm -> NGNm). The
// USDT/USDC <-> USDm stable trio is 1:1 via MiniPay's native Pockets, which also bootstraps gas;
// the Broker is only needed for the real FX leg (NGNm) once the user has USDm for gas.
export const MENTO_BROKER = "0x777A8255cA72412f0d706dc03C9D1987306B4CaD" as `0x${string}`;
// Stablecoins that MiniPay Pockets swaps 1:1 (so we deep-link to Pockets instead of a dApp swap).
export const POCKETS_STABLES = ["USDm", "USDT", "USDC"] as const;

export const demoCircle = (): `0x${string}` =>
  (process.env.NEXT_PUBLIC_CIRCLE as `0x${string}`) || (CONTRACTS.demoCircle as `0x${string}`);

// Block explorer (viem's celoSepolia URL carries a trailing slash, so strip it to avoid "//").
const EXPLORER_BASE = activeChain.blockExplorers!.default.url.replace(/\/+$/, "");
export const EXPLORER_NAME = activeChain.testnet ? "Blockscout" : "Celoscan";
export const explorerTx = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const explorerAddr = (addr: string) => `${EXPLORER_BASE}/address/${addr}`;
