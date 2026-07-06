"""The AjoAI agent loop: perceive -> reason -> act -> settle (CLAUDE.md §8).

Money decisions are rule/contract-driven, NOT LLM-driven (CLAUDE.md §1.3). Each action
re-checks chain state before acting, so the loop is idempotent and retry-safe (§1.8): if a
payout already happened, re-running simply finds nothing to do.
"""

from __future__ import annotations

from dataclasses import dataclass

from .chain import ChainClient, CircleView
from .config import Settings
from .logs import action_log, get_logger, loud_sim

ZERO_ADDRESS = "0x" + "0" * 40


@dataclass
class Decision:
    action: str  # start | mark_delinquent | trigger_payout | finalize | park_idle | withdraw_idle | wait
    member: str | None = None
    reason: str = ""


def decide(v: CircleView, now: int) -> list[Decision]:
    """Pure reasoning over a chain snapshot -> the legal actions to attempt."""
    # FORMING: start once full.
    if v.state == 0:
        if len(v.members) == v.slots:
            return [Decision("start", reason="circle full")]
        return [Decision("wait", reason=f"forming {len(v.members)}/{v.slots}")]

    if v.state != 1:  # not Active -> terminal/dissolved, nothing to trigger
        return [Decision("wait", reason=f"state={v.state_name}")]

    # ACTIVE
    if v.rounds_paid >= v.slots:
        actions = []
        if v.parked > 0:
            actions.append(Decision("withdraw_idle", reason="recall idle funds before finalize"))
        actions.append(Decision("finalize", reason="all rounds paid"))
        return actions

    # Recipient delinquent -> WITHHELD; wait for them to cure (CLAUDE.md §4).
    if v.recipient_delinquent:
        return [Decision("wait", reason="recipient delinquent -> payout withheld until cured")]

    window_close = v.round_start + v.period
    grace_close = window_close + v.grace
    all_in = all(v.contributed_this_round.get(m, False) for m in v.members)

    # (a) everyone paid -> pay now, even before the window closes.
    if all_in:
        actions = []
        if v.parked > 0:
            actions.append(Decision("withdraw_idle", reason="recall idle funds before payout"))
        actions.append(Decision("trigger_payout", reason="all contributions in"))
        return actions

    # (b) grace elapsed -> cover misses from deposits, then pay.
    if now >= grace_close:
        missers = [m for m in v.members if not v.contributed_this_round.get(m, False)]
        actions = [Decision("mark_delinquent", member=m, reason="missed past grace") for m in missers]
        # BUG-1 MITIGATION (no redeploy): if the RECIPIENT themselves missed their own round,
        # triggering payout now would let the contract's _coverRound mark them delinquent AND still
        # pay them the pot from their own forfeited deposit (the on-chain withhold check runs BEFORE
        # the cover). So mark them THIS pass and DEFER the payout — the next pass perceives
        # recipient_delinquent and returns `wait` (line 46), so a self-defaulting recipient is never
        # paid. (The permanent-lock case is Bug #2, fixed properly by the planned redeploy.)
        if v.recipient is not None and v.recipient in missers:
            return actions  # mark_delinquent only; no trigger_payout this pass
        if v.parked > 0:
            actions.append(Decision("withdraw_idle", reason="recall idle funds before payout"))
        actions.append(Decision("trigger_payout", reason="grace elapsed; shortfall covered"))
        return actions

    # (c) nothing due yet -> park spare funds in yield until they're needed.
    if v.yield_adapter.lower() != ZERO_ADDRESS and v.parked == 0 and v.balance > 0:
        return [Decision("park_idle", reason="idle funds available; parking for yield")]

    return [Decision("wait", reason="awaiting contributions / window")]


class Agent:
    def __init__(self, settings: Settings, chain: ChainClient):
        self.s = settings
        self.chain = chain
        self.log = get_logger("ajoai.agent")

    def run_once(self, circle_addr: str) -> list[dict]:
        """One perceive->reason->act->settle pass over a single circle."""
        v = self.chain.view_circle(circle_addr)  # PERCEIVE
        now = self.chain.now()
        decisions = decide(v, now)  # REASON
        results = []
        for d in decisions:  # ACT + SETTLE
            results.append(self._act(v, d))
        return results

    def _act(self, v: CircleView, d: Decision) -> dict:
        c = v.address
        if d.action == "wait":
            self.log.info("wait", circle=c, round=v.current_round, reason=d.reason)
            return {"action": "wait", "reason": d.reason}

        try:
            if d.action == "start":
                r = self.chain.start(c)
                pillar = "real_world"
            elif d.action == "mark_delinquent":
                r = self.chain.mark_delinquent(c, d.member)
                pillar = "economic_agency"
            elif d.action == "trigger_payout":
                r = self.chain.trigger_payout(c)
                pillar = "economic_agency"
            elif d.action == "finalize":
                r = self.chain.finalize(c)
                pillar = "onchain_integration"
            elif d.action == "park_idle":
                r = self.chain.park_idle(c)
                pillar = "onchain_integration"
            elif d.action == "withdraw_idle":
                r = self.chain.withdraw_idle(c)
                pillar = "onchain_integration"
            else:
                raise ValueError(f"unknown action {d.action}")
        except Exception as e:  # noqa: BLE001 — never crash the loop on one action
            self.log.error("action_failed", circle=c, action=d.action, error=str(e))
            return {"action": d.action, "ok": False, "error": str(e)}

        if d.action == "withdraw_idle" and self.s.simulate_yield:
            loud_sim(
                self.log,
                "yield",
                "idle-fund yield RATE is simulated; on-chain park/withdraw moved real principal only",
            )

        action_log(
            self.log,
            circle=c,
            action=d.action,
            pillar=pillar,
            round_=v.current_round,
            tx_hash=r.get("txHash"),
            member=d.member,
            gasUsed=r.get("gasUsed"),
            reason=d.reason,
        )
        return {"action": d.action, "ok": r.get("status") == 1, **r}
