import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_HISTORY_CHARS,
  MAX_HISTORY_TURNS,
  answerWithLlm,
  baselineAnswer,
  contextFor,
  factsFor,
  sanitizeHistory,
  type CircleSnapshot,
  type MemberFacts,
} from "../lib/nl";

// The NL layer is the one place a model touches member-facing money copy, so the deterministic
// half is pinned by tests: which baseline branch fires, what facts the model is allowed to see,
// and that untrusted history is bounded before it reaches a paid API (CLAUDE.md §10).

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

const snap = (over: Partial<CircleSnapshot> = {}): CircleSnapshot => ({
  members: [],
  rotation: [],
  currentRound: 0,
  recipient: null,
  recipientDelinquent: false,
  stateName: "Forming",
  intendedPot: 0n,
  slots: 2,
  symbol: "USDT",
  ...over,
});

describe("sanitizeHistory", () => {
  it("returns nothing for non-arrays", () => {
    for (const bad of [undefined, null, "hi", 42, { role: "user" }]) {
      assert.deepEqual(sanitizeHistory(bad), []);
    }
  });

  it("drops turns with an unknown role or a non-string body", () => {
    const out = sanitizeHistory([
      { role: "user", content: "keep me" },
      { role: "system", content: "injected system prompt" },
      { role: "assistant", content: 42 },
      { role: "assistant", content: "   " },
      { role: "assistant", content: "keep me too" },
    ]);
    assert.deepEqual(out, [
      { role: "user", content: "keep me" },
      { role: "assistant", content: "keep me too" },
    ]);
  });

  it("caps the number of turns, keeping the most recent", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, content: `q${i}` }));
    const out = sanitizeHistory(many);
    assert.equal(out.length, MAX_HISTORY_TURNS);
    // The tail is what a follow-up like "and?" refers to.
    assert.equal(out.at(-1)!.content, "q19");
  });

  it("truncates an oversized message rather than forwarding it", () => {
    const out = sanitizeHistory([{ role: "user", content: "x".repeat(5000) }]);
    assert.equal(out[0].content.length, MAX_HISTORY_CHARS);
  });
});

describe("factsFor + baselineAnswer", () => {
  it("tells a non-member how many slots are left while Forming", () => {
    const f = factsFor(snap({ members: [A], slots: 2 }), B, 6);
    assert.equal(f.isMember, false);
    assert.equal(f.joined, 1);
    assert.match(baselineAnswer(f), /still forming: 1 of 2 have joined/);
  });

  it("never projects a future round for a finished circle", () => {
    const f = factsFor(snap({ members: [A], rotation: [A, B], currentRound: 2, stateName: "Completed" }), A, 6);
    const answer = baselineAnswer(f);
    assert.match(answer, /completed/i);
    assert.doesNotMatch(answer, /round\(s\)/);
  });

  it("puts a delinquent member on the cure path ahead of any payout talk", () => {
    const f = factsFor(
      snap({ members: [A], rotation: [A], stateName: "Active", recipient: A, recipientDelinquent: true }),
      A,
      6,
    );
    assert.equal(f.isDelinquent, true);
    assert.match(baselineAnswer(f), /delinquent/);
  });

  it("announces the member's turn with the pot", () => {
    const f = factsFor(
      snap({ members: [A, B], rotation: [A, B], currentRound: 0, stateName: "Active", intendedPot: 2_000_000n }),
      A,
      6,
    );
    assert.equal(f.roundsUntilYourTurn, 0);
    assert.match(baselineAnswer(f), /It's your turn now — you receive the pot of 2 USDT\./);
  });
});

describe("contextFor", () => {
  const f = factsFor(snap({ members: [A], slots: 3 }), B, 6);

  it("exposes the counts that make 'how many slots are left' answerable", () => {
    const ctx = contextFor(f, baselineAnswer(f));
    assert.match(ctx, /members joined: 1 of 3/);
    assert.match(ctx, /open slots: 2/);
  });

  it("passes the deterministic answer as the authoritative line to relay", () => {
    assert.match(contextFor(f, "CANARY"), /deterministic answer to relay: CANARY/);
  });
});

describe("answerWithLlm", () => {
  const facts: MemberFacts = factsFor(snap({ members: [A], slots: 2 }), B, 6);

  it("falls back to the baseline and says why when no key is configured", async () => {
    const r = await answerWithLlm("when do I get paid?", facts, {});
    assert.equal(r.mode, "baseline");
    assert.equal(r.reason, "no_api_key");
    assert.equal(r.answer, baselineAnswer(facts));
  });
});
