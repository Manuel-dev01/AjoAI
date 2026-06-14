import { getAddress, isAddress } from "viem";

// Friendly, reversible circle codes — abstract the raw hex address into an "AJO-…" code that's
// typo-resistant and shareable, while staying fully decodable to the on-chain address (no backend).
// Crockford base32 (no I/L/O/U) of the 20 address bytes → 32 chars, grouped in 4s.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford
const CROCKFORD_FIX: Record<string, string> = { I: "1", L: "1", O: "0", U: "V" };

function bytesToCrockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function crockfordToBytes(s: string, byteLen: number): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length < byteLen) return null;
  return new Uint8Array(out.slice(0, byteLen));
}

/** 0x-address → "AJO-XXXX-XXXX-…" (8 groups of 4). */
export function encodeCircle(addr: string): string {
  const hex = addr.replace(/^0x/, "");
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const code = bytesToCrockford(bytes); // 32 chars
  const groups = code.match(/.{1,4}/g) ?? [code];
  return `AJO-${groups.join("-")}`;
}

/** "AJO-…" (any spacing/case, I/L/O/U tolerated) → checksummed 0x address, or null. */
export function decodeCircle(code: string): `0x${string}` | null {
  const cleaned = code
    .trim()
    .toUpperCase()
    .replace(/^AJO[-\s]?/, "")
    .replace(/[-\s]/g, "")
    .split("")
    .map((c) => CROCKFORD_FIX[c] ?? c)
    .join("");
  if (cleaned.length < 32) return null;
  const bytes = crockfordToBytes(cleaned, 20);
  if (!bytes) return null;
  const hex = "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  try {
    return getAddress(hex);
  } catch {
    return null;
  }
}

const origin = () => (typeof window !== "undefined" ? window.location.origin : "");

/** Shareable deep link that prefills the join screen (and carries the circle name). */
export function inviteLink(addr: string, name?: string): string {
  const n = name ? `&n=${encodeURIComponent(name)}` : "";
  return `${origin()}/app/join?c=${addr}${n}`;
}

/** Shareable, read-only link to a member's portable savings-credit score — no wallet needed. */
export function scoreLink(addr: string): string {
  return `${origin()}/app/score/${addr}`;
}

/** Accept a raw address, an AJO-code, or a full invite link → {address?, name?}. */
export function parseInviteInput(input: string): { address?: `0x${string}`; name?: string } {
  const s = input.trim();
  if (!s) return {};
  // full invite link
  if (s.includes("/app/join") || s.includes("?c=")) {
    try {
      const url = new URL(s, origin() || "https://x");
      const c = url.searchParams.get("c");
      const name = url.searchParams.get("n") ?? undefined;
      if (c && isAddress(c)) return { address: getAddress(c), name };
    } catch {
      /* fall through */
    }
  }
  if (isAddress(s)) return { address: getAddress(s) };
  if (/^AJO/i.test(s)) {
    const a = decodeCircle(s);
    if (a) return { address: a };
  }
  return {};
}
