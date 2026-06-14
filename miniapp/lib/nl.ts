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

export function fmtUnits(amountWei: bigint, decimals: number): string {
  const whole = amountWei / 10n ** BigInt(decimals);
  return whole.toLocaleString("en-US");
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
    intendedPotStr: `${fmtUnits(view.intendedPot, tokenDecimals)} units`,
  };
}

/** Deterministic, money-safe answer derived purely from chain facts. */
export function baselineAnswer(f: MemberFacts): string {
  if (!f.isMember) return "You are not a member of this circle.";
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
