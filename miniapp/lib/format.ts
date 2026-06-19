import { formatUnits } from "viem";

// Deterministic avatar palette from the Market Blocks colours (no purple, no gradients).
const AV_COLORS = ["#15694E", "#C9542A", "#C4861a", "#0E4838", "#A23F1C", "#3E9577"];

export function short(addr?: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "…";
}

// A friendly two-char tag for an address — members have no on-chain names, so derive one.
export function initials(addr?: string): string {
  if (!addr) return "··";
  return addr.slice(2, 4).toUpperCase();
}

export function avatarColor(addr?: string): string {
  if (!addr) return AV_COLORS[0];
  let h = 0;
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

export function amount(v: bigint | undefined, decimals = 18): string {
  if (v === undefined) return "…";
  const s = formatUnits(v, decimals);
  // Trim trailing zeros, then group thousands.
  const [whole, frac] = s.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = frac ? frac.replace(/0+$/, "") : "";
  return f ? `${grouped}.${f}` : grouped;
}

export function fmtAmount(v: bigint | undefined, symbol: string, decimals = 18): string {
  return `${symbol} ${amount(v, decimals)}`;
}

// Compact display for swap/quote amounts: ≤ maxFrac fractional digits, trailing zeros trimmed,
// a "<0.0001" floor for dust, thousands-grouped. Use for approximate figures (e.g. a Mento quote);
// keep `amount`/`fmtAmount` for exact contribution/deposit values.
export function amountCompact(v: bigint | undefined, decimals = 18, maxFrac = 4): string {
  if (v === undefined) return "…";
  if (v === 0n) return "0";
  const num = Number(formatUnits(v, decimals));
  const floor = 1 / 10 ** maxFrac;
  if (num > 0 && num < floor) return `<${floor}`;
  const [whole, frac = ""] = num.toFixed(maxFrac).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = frac.replace(/0+$/, "");
  return f ? `${grouped}.${f}` : grouped;
}

export function fmtCompact(v: bigint | undefined, symbol: string, decimals = 18): string {
  return `${symbol} ${amountCompact(v, decimals)}`;
}

// seconds-from-epoch (bigint) → short relative label for "due"/"closes" copy.
export function whenLabel(ts?: bigint): string {
  if (!ts || ts === 0n) return "—";
  const ms = Number(ts) * 1000;
  const diff = ms - Date.now();
  const day = 86_400_000;
  if (diff <= 0) return "now";
  if (diff < day) return `${Math.max(1, Math.round(diff / 3_600_000))}h`;
  return `${Math.round(diff / day)}d`;
}

// A duration in seconds → a short human span ("10 min", "7 days", "8 weeks", "3 months").
// Picks the largest unit that divides cleanly-ish so a weekly circle reads "7 days"→"1 week".
export function secondsToHuman(s: number): string {
  if (!s || s <= 0) return "—";
  const min = 60, hour = 3_600, day = 86_400, week = 604_800, month = 2_592_000, year = 31_536_000;
  const plur = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (s >= year) return plur(Math.round(s / year), "year");
  if (s >= month) return plur(Math.round(s / month), "month");
  if (s >= week) return plur(Math.round(s / week), "week");
  if (s >= day) return plur(Math.round(s / day), "day");
  if (s >= hour) return plur(Math.round(s / hour), "hour");
  return plur(Math.max(1, Math.round(s / min)), "min");
}

// How often a member contributes, e.g. "every 10 min", "weekly", "monthly", "every 7 days".
// Maps the create-flow's known FREQS exactly; falls back to "every {secondsToHuman}".
export function frequencyLabel(period?: bigint): string {
  if (!period || period === 0n) return "each round";
  const s = Number(period);
  if (s === 600) return "every 10 min";
  if (s === 900) return "every 15 min";
  if (s === 604_800) return "weekly";
  if (s === 2_592_000) return "monthly";
  return `every ${secondsToHuman(s)}`;
}

// Total time a circle runs = period × slots (one round per member). e.g. "~8 weeks".
export function durationLabel(period?: bigint, slots?: number): string {
  if (!period || period === 0n || !slots || slots <= 0) return "—";
  return `~${secondsToHuman(Number(period) * slots)}`;
}
