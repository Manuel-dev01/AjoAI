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
  // Terminal state (member): NEVER project a future round — the rotation is over. `currentRound` is
  // stale here, so the round arithmetic below would mis-tell a member "your payout is in N rounds"
  // for a circle that already ended (money-inaccurate, CLAUDE.md §8). State the outcome instead.
  if (f.state === "Completed") return "This circle has completed — every member received the pot once, and clean-completion security deposits were returned.";
  if (f.state === "Defaulted") return "This circle ended in default. Remaining funds and deposits were distributed pro-rata to members who had not yet received; the rotation did not finish normally.";
  if (f.state === "Dissolved") return "This circle was dissolved before it started and every deposit was refunded in full.";
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

// ---------------------------------------------------------------------------
// Shared LLM layer. Used by BOTH the HTTP route (app/app/api/ask) and the MCP
// `ask` tool, so an agent and a human get the same answer for the same question.
// ---------------------------------------------------------------------------

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Why an answer came back deterministic — surfaced to the caller instead of failing silently. */
export type AnswerMode = "llm" | "baseline";
export type AnswerResult = { answer: string; mode: AnswerMode; reason?: string };

// History is attacker-controlled input to a paid API, so it is bounded on both axes.
export const MAX_HISTORY_TURNS = 6;
export const MAX_HISTORY_CHARS = 400;

/**
 * Coerce untrusted `history` into at most MAX_HISTORY_TURNS well-formed turns.
 * Anything malformed is dropped rather than rejected — a bad history should degrade the answer,
 * never fail the request.
 */
export function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const t of raw) {
    const role = (t as ChatTurn)?.role;
    const content = (t as ChatTurn)?.content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    out.push({ role, content: trimmed.slice(0, MAX_HISTORY_CHARS) });
  }
  // Keep the MOST RECENT turns — the tail is what a follow-up like "and?" refers to.
  return out.slice(-MAX_HISTORY_TURNS);
}

/** The authoritative fact block handed to the model. Every figure comes from chain state. */
export function contextFor(f: MemberFacts, baseline: string): string {
  return `FACTS (authoritative, from chain):
- circle state: ${f.state}
- members joined: ${f.joined} of ${f.slots}
- open slots: ${Math.max(f.slots - f.joined, 0)}
- is member: ${f.isMember}
- has received payout: ${f.hasReceived}
- delinquent: ${f.isDelinquent}
- your payout round (0-indexed): ${f.yourRound ?? "not in the rotation yet"}
- rounds until your turn: ${f.roundsUntilYourTurn ?? "unknown"}
- current recipient: ${f.currentRecipient ?? "none"}
- pot: ${f.intendedPotStr}
- deterministic answer to relay: ${baseline}
`;
}

/**
 * Rephrase the deterministic baseline in the member's language, in context of the conversation.
 *
 * The baseline is passed as authoritative so the model can only explain it, never invent a figure
 * (CLAUDE.md §1.3). With no key — or on any failure — the baseline is returned unchanged, together
 * with a `reason` so a missing key is distinguishable from an expired one.
 */
export async function answerWithLlm(
  question: string,
  facts: MemberFacts,
  opts: { apiKey?: string; history?: ChatTurn[] } = {},
): Promise<AnswerResult> {
  const baseline = baselineAnswer(facts);
  const { apiKey, history = [] } = opts;
  if (!apiKey) return { answer: baseline, mode: "baseline", reason: "no_api_key" };

  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: NL_MODEL,
        max_tokens: 200,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: `${contextFor(facts, baseline)}\nMember asks: ${question}` },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn("[nl] llm_http_error", res.status, detail.slice(0, 300));
      return { answer: baseline, mode: "baseline", reason: `llm_http_${res.status}` };
    }
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      console.warn("[nl] llm_empty_response");
      return { answer: baseline, mode: "baseline", reason: "llm_empty" };
    }
    return { answer: text, mode: "llm" };
  } catch (err) {
    console.warn("[nl] llm_threw", err);
    return { answer: baseline, mode: "baseline", reason: "llm_threw" };
  }
}
