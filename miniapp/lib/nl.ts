// Natural-language member Q&A — TypeScript port of agent/src/nl.py's deterministic layer.
//
// HARD RULE (CLAUDE.md §1.3): this never moves money and never authorizes an action the
// contract wouldn't enforce. It only explains facts read from chain. Keep this file's
// logic in sync with agent/src/nl.py — that module remains the source of truth for the
// Python agent and its tests.

// NL handler model — small + fast, explanation only (docs/STACK.md). Never tool-enabled.
// DeepSeek (OpenAI-compatible) so the rephrasing runs on the key the deployment holds.
export const NL_MODEL = "deepseek-chat";

export const SYSTEM_PROMPT = `You are AjoAI's member assistant for a rotating savings circle \
(ajo/esusu/chama/stokvel) on Celo. You ONLY explain facts you are given about the circle. \
You NEVER promise to move money, change anyone's turn, waive a penalty, or take any action — \
the smart contract enforces all of that, not you. If asked to do something money-moving, \
explain what the contract rules are instead.

Answer in the SAME language the member used: English, Nigerian Pidgin, or Swahili. Keep it \
short (1-3 sentences), concrete, and money-accurate. Use the exact figures provided. Never \
invent numbers; if a fact is not in the context, say you don't have it.`;

/** Format a token amount with up to 2 decimals + symbol, e.g. "0.6 USDT" (not "0 units"). */
export function fmtUnits(amountWei: bigint, decimals: number, symbol = "units"): string {
  const base = 10n ** BigInt(decimals);
  const whole = amountWei / base;
  const frac = amountWei % base;
  let s = whole.toLocaleString("en-US");
  if (frac > 0n) {
    // two significant fractional digits
    const twoDp = (frac * 100n) / base;
    if (twoDp > 0n) s += "." + twoDp.toString().padStart(2, "0").replace(/0+$/, "");
  }
  return `${s} ${symbol}`;
}

/** Chain snapshot shape needed to derive a member's situation (mirrors CircleView). */
export type CircleSnapshot = {
  members: readonly string[];
  rotation: readonly string[];
  currentRound: number;
  recipient: string | null;
  recipientDelinquent: boolean;
  stateName: string;
  intendedPot: bigint;
  slots: number;
  symbol: string;
};

export type MemberFacts = {
  isMember: boolean;
  hasReceived: boolean;
  isDelinquent: boolean;
  yourRound: number | null;
  roundsUntilYourTurn: number | null;
  currentRecipient: string | null;
  state: string;
  intendedPotStr: string;
  joined: number;
  slots: number;
};

/** Pure: derive a member's situation from a chain snapshot (no LLM, no tx). */
export function factsFor(view: CircleSnapshot, member: string, tokenDecimals = 18): MemberFacts {
  const m = member.toLowerCase();
  const membersLc = view.members.map((a) => a.toLowerCase());
  const isMember = membersLc.includes(m);

  let yourRound: number | null = null;
  if (view.rotation.length) {
    const rotLc = view.rotation.map((a) => a.toLowerCase());
    const idx = rotLc.indexOf(m);
    if (idx !== -1) yourRound = idx;
  }

  const roundsUntilYourTurn = yourRound !== null ? Math.max(yourRound - view.currentRound, 0) : null;

  // hasReceived: not tracked per-member on the snapshot; infer for the common case.
  const hasReceived = yourRound !== null && view.currentRound > yourRound;

  return {
    isMember,
    hasReceived,
    isDelinquent: Boolean(view.recipient && view.recipient.toLowerCase() === m && view.recipientDelinquent),
    yourRound,
    roundsUntilYourTurn,
    currentRecipient: view.recipient,
    state: view.stateName,
    intendedPotStr: fmtUnits(view.intendedPot, tokenDecimals, view.symbol),
    joined: view.members.length,
    slots: view.slots,
  };
}

/** Deterministic, money-safe answer derived purely from chain facts. */
export function baselineAnswer(f: MemberFacts): string {
  // Non-member: answer about the circle's state instead of a flat rejection (the organizer who
  // has not joined yet, an invitee browsing, or someone viewing a finished circle all land here).
  if (!f.isMember) {
    if (f.state === "Forming") {
      return `This circle is still forming: ${f.joined} of ${f.slots} have joined. You are not in it yet. Tap Join to take a slot (you post a one-round security deposit, returned on clean completion).`;
    }
    if (f.state === "Completed") return "This circle has finished. Every member received their payout once and it is now complete.";
    if (f.state === "Defaulted") return "This circle has ended in default. Remaining funds were distributed to members who had not yet received.";
    if (f.state === "Dissolved") return "This circle was dissolved while still forming and all deposits were refunded.";
    return `This circle is active with ${f.slots} members; you are not a member of it.`;
  }
  if (f.isDelinquent) {
    return (
      "You are currently marked delinquent (a missed contribution past grace). " +
      "You must cure (re-deposit) before you can receive your payout."
    );
  }
  if (f.hasReceived) return "You have already received your payout for this circle.";
  if (f.roundsUntilYourTurn === 0) {
    return `It's your turn now — you receive the pot of ${f.intendedPotStr}.`;
  }
  if (f.roundsUntilYourTurn !== null) {
    return `Your payout is in ${f.roundsUntilYourTurn} round(s); you'll receive ${f.intendedPotStr}.`;
  }
  return `Circle state is ${f.state}; the pot is ${f.intendedPotStr}.`;
}
