"""Natural-language member Q&A (CLAUDE.md §8) — EN / Nigerian Pidgin / Swahili.

HARD RULE (CLAUDE.md §1.3): the LLM NEVER moves money and never authorizes an action the
contract wouldn't enforce. It only *explains* facts read from chain. Money actions come from
the rule-based `decide()` in loop.py. This module: (1) extracts factual answers from a
CircleView deterministically, (2) optionally phrases them via an LLM in the member's language.
If no LLM key is set, the deterministic answer is returned as-is (still correct, just terser).
"""

from __future__ import annotations

from dataclasses import dataclass

from .chain import CircleView

# NL handler model — small + fast, explanation only (docs/STACK.md). Never tool-enabled.
# DeepSeek (OpenAI-compatible) so the rephrasing runs on the key the deployment holds.
NL_MODEL = "deepseek-chat"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

SYSTEM_PROMPT = """You are AjoAI's member assistant for a rotating savings circle \
(ajo/esusu/chama/stokvel) on Celo. You ONLY explain facts you are given about the circle. \
You NEVER promise to move money, change anyone's turn, waive a penalty, or take any action — \
the smart contract enforces all of that, not you. If asked to do something money-moving, \
explain what the contract rules are instead.

Answer in the SAME language the member used: English, Nigerian Pidgin, or Swahili. Keep it \
short (1-3 sentences), concrete, and money-accurate. Use the exact figures provided. Never \
invent numbers; if a fact is not in the context, say you don't have it."""


def _fmt(amount_wei: int, decimals: int = 18, symbol: str = "units") -> str:
    base = 10**decimals
    whole = amount_wei // base
    frac = amount_wei % base
    s = f"{whole:,}"
    if frac > 0:
        two = (frac * 100) // base  # up to 2 fractional digits
        if two > 0:
            s += "." + f"{two:02d}".rstrip("0")
    return f"{s} {symbol}"


@dataclass
class MemberFacts:
    """Deterministic, chain-derived answer scaffold for one member's common questions."""

    is_member: bool
    has_received: bool
    is_delinquent: bool
    your_round: int | None  # the round index where this member receives
    rounds_until_your_turn: int | None
    current_recipient: str | None
    state: str
    intended_pot_str: str
    joined: int
    slots: int

    def baseline_answer(self) -> str:
        # Non-member: explain the circle's state instead of a flat rejection (the organizer who has
        # not joined yet, an invitee browsing, or someone viewing a finished circle all land here).
        if not is_member_guard(self):
            if self.state == "Forming":
                return (
                    f"This circle is still forming: {self.joined} of {self.slots} have joined. "
                    "You are not in it yet. Tap Join to take a slot (you post a one-round security "
                    "deposit, returned on clean completion)."
                )
            if self.state == "Completed":
                return "This circle has finished. Every member received their payout once and it is now complete."
            if self.state == "Defaulted":
                return "This circle has ended in default. Remaining funds were distributed to members who had not yet received."
            if self.state == "Dissolved":
                return "This circle was dissolved while still forming and all deposits were refunded."
            return f"This circle is active with {self.slots} members; you are not a member of it."
        # Terminal state (member): NEVER project a future round — the rotation is over. `current_round`
        # is stale here, so the round arithmetic below would mis-tell a member "your payout is in N
        # rounds" for a circle that already ended (money-inaccurate, CLAUDE.md §8). State the outcome.
        if self.state == "Completed":
            return "This circle has completed — every member received the pot once, and clean-completion security deposits were returned."
        if self.state == "Defaulted":
            return (
                "This circle ended in default. Remaining funds and deposits were distributed pro-rata "
                "to members who had not yet received; the rotation did not finish normally."
            )
        if self.state == "Dissolved":
            return "This circle was dissolved before it started and every deposit was refunded in full."
        if self.is_delinquent:
            return (
                "You are currently marked delinquent (a missed contribution past grace). "
                "You must cure (re-deposit) before you can receive your payout."
            )
        if self.has_received:
            return "You have already received your payout for this circle."
        if self.rounds_until_your_turn == 0:
            return f"It's your turn now — you receive the pot of {self.intended_pot_str}."
        if self.rounds_until_your_turn is not None:
            return (
                f"Your payout is in {self.rounds_until_your_turn} round(s); "
                f"you'll receive {self.intended_pot_str}."
            )
        return f"Circle state is {self.state}; the pot is {self.intended_pot_str}."


def is_member_guard(f: MemberFacts) -> bool:
    return f.is_member


def facts_for(view: CircleView, member: str, token_decimals: int = 18) -> MemberFacts:
    """Pure: derive a member's situation from a chain snapshot (no LLM, no tx)."""
    member = member.lower()
    members_lc = [m.lower() for m in view.members]
    is_member = member in members_lc

    your_round = None
    if view.rotation:
        rot_lc = [r.lower() for r in view.rotation]
        if member in rot_lc:
            your_round = rot_lc.index(member)

    rounds_until = None
    if your_round is not None:
        rounds_until = max(your_round - view.current_round, 0)

    # has_received: we don't have it on the view per-member; infer for the common case.
    has_received = your_round is not None and view.current_round > your_round

    return MemberFacts(
        is_member=is_member,
        has_received=has_received,
        is_delinquent=(view.recipient is not None and view.recipient.lower() == member and view.recipient_delinquent),
        your_round=your_round,
        rounds_until_your_turn=rounds_until,
        current_recipient=view.recipient,
        state=view.state_name,
        intended_pot_str=_fmt(view.intended_pot, token_decimals),
        joined=len(view.members),
        slots=view.slots,
    )


def answer(question: str, facts: MemberFacts, api_key: str | None) -> str:
    """Phrase the deterministic answer in the member's language via an LLM (optional).

    Uses DeepSeek's OpenAI-compatible chat-completions endpoint. The deterministic baseline is
    passed as authoritative, so the model can only rephrase (never invent a money fact, §1.3).
    Any failure falls back to the baseline, so a missing/invalid key never breaks the answer.
    """
    baseline = facts.baseline_answer()
    if not api_key:
        return baseline

    try:
        import requests

        context = (
            f"FACTS (authoritative, from chain):\n"
            f"- circle state: {facts.state}\n"
            f"- is member: {facts.is_member}\n"
            f"- has received payout: {facts.has_received}\n"
            f"- delinquent: {facts.is_delinquent}\n"
            f"- rounds until your turn: {facts.rounds_until_your_turn}\n"
            f"- pot: {facts.intended_pot_str}\n"
            f"- deterministic answer to relay: {baseline}\n"
        )
        res = requests.post(
            DEEPSEEK_URL,
            headers={"content-type": "application/json", "authorization": f"Bearer {api_key}"},
            json={
                "model": NL_MODEL,
                "max_tokens": 200,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"{context}\nMember asks: {question}"},
                ],
            },
            timeout=20,
        )
        if not res.ok:
            return baseline
        text = (res.json().get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
        return text or baseline
    except Exception:  # noqa: BLE001 — any LLM/transport error -> safe deterministic baseline
        return baseline
