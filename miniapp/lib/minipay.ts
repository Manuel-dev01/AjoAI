// MiniPay deeplinks (host: link.minipay.xyz — HTTPS only, no minipay:// scheme).
// Docs: https://docs.minipay.xyz/technical-references/deeplinks.html
// These resolve only when the user has MiniPay installed + is logged in. We gate every
// call on isMiniPay() so a desktop browser keeps the existing in-app fallback (text/Mento swap).
//
// SAFE pre-listing (used here): add_cash (funding), receipt (tx celebration), balance (Pockets).
// NOT used until AjoAI is an APPROVED MiniPay mini app: browse?url=, invite_friends, discover —
// those only resolve for listed apps and would dead-end an unlisted invite link.
import { isMiniPay } from "./wagmi";

const BASE = "https://link.minipay.xyz";

// Add Cash screen, optionally pre-filtered to the token(s) the user needs to fund.
// Supported tokens per docs: USDm, USDT, USDC. (NGNm isn't an Add-Cash token — fund via Mento swap.)
export function addCashLink(tokens?: string[]): string {
  const t = (tokens ?? []).filter((s) => ["USDm", "USDT", "USDC"].includes(s));
  return t.length ? `${BASE}/add_cash?tokens=${t.join(",")}` : `${BASE}/add_cash`;
}

// Native transaction-receipt screen for a given tx hash; &celebrate plays the success animation.
export function receiptLink(tx: string, celebrate = true): string {
  return `${BASE}/receipt?tx=${tx}${celebrate ? "&celebrate" : ""}`;
}

// Pockets (balances) screen — where the 1:1 stable-trio swaps live.
export function pocketsLink(): string {
  return `${BASE}/balance`;
}

// Navigate the MiniPay webview to a deeplink (top-level nav; MiniPay intercepts link.minipay.xyz).
// No-op outside MiniPay so callers can wire it unconditionally and keep their web fallback.
export function openDeeplink(url: string): void {
  if (typeof window === "undefined" || !isMiniPay()) return;
  window.location.href = url;
}

export { isMiniPay };
