// Idle-funds yield math. AjoAI parks a circle's idle pot in a low-risk lending venue between
// payouts (modeled on Aave V3 on Celo, where stablecoin supply APY runs ~3–6%). The rate is a
// LOUD simulation (CLAUDE.md §1.9) until a real AaveYieldAdapter is wired — but it's framed
// ANNUALIZED and realistic: a short idle window shows the rate plus a correctly-small projection,
// never an inflated short-term number.

export const SIM_APY_BPS = 500; // 5.00% — Aave V3 Celo stablecoin midpoint
export const SECONDS_PER_YEAR = 365 * 24 * 60 * 60; // 31_536_000

/** APY as a percent number (e.g. 5). */
export function apyPercent(apyBps = SIM_APY_BPS): number {
  return apyBps / 100;
}

/** Short label, e.g. "~5% APY". */
export function apyLabel(apyBps = SIM_APY_BPS): string {
  const p = apyBps / 100;
  return `~${Number.isInteger(p) ? p : p.toFixed(1)}% APY`;
}

/** Projected (simple, non-compound) yield in token units (wei) on `parkedWei` held for
 *  `secondsParked` at `apyBps`. Returns 0 for non-positive inputs. */
export function projectedYield(parkedWei: bigint, secondsParked: number, apyBps = SIM_APY_BPS): bigint {
  if (parkedWei <= 0n || secondsParked <= 0) return 0n;
  const s = BigInt(Math.floor(secondsParked));
  return (parkedWei * BigInt(apyBps) * s) / (10_000n * BigInt(SECONDS_PER_YEAR));
}

/** Full-year (annualized) yield in token units (wei) on `parkedWei` at `apyBps`. */
export function annualizedYield(parkedWei: bigint, apyBps = SIM_APY_BPS): bigint {
  if (parkedWei <= 0n) return 0n;
  return (parkedWei * BigInt(apyBps)) / 10_000n;
}

/** Seconds from now until a future epoch-seconds deadline (bigint), clamped to >= 0. */
export function secondsUntil(epochSec?: bigint): number {
  if (!epochSec || epochSec === 0n) return 0;
  return Math.max(0, Number(epochSec) - Math.floor(Date.now() / 1000));
}

/** A human label for a round length in seconds (the parking window per round). */
export function periodLabel(seconds?: bigint): string {
  if (!seconds || seconds === 0n) return "round";
  const s = Number(seconds);
  if (s >= 86_400 * 28) return "month";
  if (s >= 86_400 * 7) return "week";
  if (s >= 86_400) return "day";
  if (s >= 3_600) return "hour";
  return "round";
}
