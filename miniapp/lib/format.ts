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
