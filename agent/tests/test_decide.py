"""Unit tests for the pure decision logic (no chain needed).

Covers the reasoning that drives money actions — must match the contract's rules
(CLAUDE.md §8/§10): never authorize an action the contract wouldn't enforce.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.chain import CircleView  # noqa: E402
from src.loop import ZERO_ADDRESS, decide  # noqa: E402

MEMBERS = ["0xA", "0xB", "0xC", "0xD"]
YIELD_ADAPTER = "0x000000000000000000000000000000000000Ad42"


def _view(**kw) -> CircleView:
    base = dict(
        address="0xCIRCLE",
        state=1,
        slots=4,
        current_round=0,
        rounds_paid=0,
        intended_pot=400,
        penalty_pool=0,
        parked=0,
        round_start=1000,
        period=300,
        grace=120,
        members=MEMBERS,
        rotation=MEMBERS,
        recipient="0xA",
        recipient_delinquent=False,
        contributed_this_round={m: False for m in MEMBERS},
        yield_adapter=ZERO_ADDRESS,
        balance=0,
    )
    base.update(kw)
    return CircleView(**base)


def test_forming_waits_until_full():
    v = _view(state=0, members=MEMBERS[:2])
    assert [d.action for d in decide(v, now=1000)] == ["wait"]


def test_forming_full_starts():
    v = _view(state=0)
    assert decide(v, now=1000)[0].action == "start"


def test_all_contributed_pays_immediately():
    v = _view(contributed_this_round={m: True for m in MEMBERS})
    # even before the window closes
    assert decide(v, now=1100)[0].action == "trigger_payout"


def test_waits_within_window_when_not_all_in():
    v = _view(contributed_this_round={"0xA": True, "0xB": True, "0xC": False, "0xD": False})
    assert decide(v, now=1100)[0].action == "wait"


def test_grace_elapsed_marks_then_pays():
    v = _view(contributed_this_round={"0xA": True, "0xB": True, "0xC": False, "0xD": False})
    now = v.round_start + v.period + v.grace + 1
    actions = [d.action for d in decide(v, now)]
    assert actions == ["mark_delinquent", "mark_delinquent", "trigger_payout"]


def test_recipient_self_default_triggers_withholding_payout():
    # Recipient 0xA misses their OWN round past grace. The FIXED contract's triggerPayout withholds
    # them safely (never pays from their own forfeited deposit), so the agent marks + triggers.
    v = _view(contributed_this_round={"0xA": False, "0xB": True, "0xC": True, "0xD": True})
    now = v.round_start + v.period + v.grace + 1
    actions = [d.action for d in decide(v, now)]
    assert actions == ["mark_delinquent", "trigger_payout"]


def test_delinquent_recipient_stamps_timer_first():
    # Recipient delinquent, timer not yet started -> a safe no-pay triggerPayout stamps withheldSince.
    v = _view(recipient_delinquent=True, withheld_since=0)
    assert decide(v, now=9999)[0].action == "trigger_payout"


def test_delinquent_recipient_waits_within_timeout():
    v = _view(recipient_delinquent=True, withheld_since=1000, withhold_timeout=500)
    assert decide(v, now=1200)[0].action == "wait"  # 1200 < 1000+500


def test_delinquent_recipient_force_defaults_after_timeout():
    # Never cured; timeout elapsed -> recover funds via force_default (Bug #2).
    v = _view(recipient_delinquent=True, withheld_since=1000, withhold_timeout=500)
    assert [d.action for d in decide(v, now=1600)] == ["force_default"]  # 1600 >= 1000+500


def test_all_rounds_paid_finalizes():
    v = _view(rounds_paid=4)
    assert decide(v, now=9999)[0].action == "finalize"


def test_idle_funds_get_parked_when_adapter_set():
    v = _view(yield_adapter=YIELD_ADAPTER, balance=1000)
    assert decide(v, now=1100)[0].action == "park_idle"


def test_no_park_without_adapter():
    v = _view(yield_adapter=ZERO_ADDRESS, balance=1000)
    assert decide(v, now=1100)[0].action == "wait"


def test_parked_funds_withdrawn_before_payout():
    v = _view(contributed_this_round={m: True for m in MEMBERS}, parked=500)
    assert [d.action for d in decide(v, now=1100)] == ["withdraw_idle", "trigger_payout"]


def test_parked_funds_withdrawn_before_finalize():
    v = _view(rounds_paid=4, parked=500)
    assert [d.action for d in decide(v, now=9999)] == ["withdraw_idle", "finalize"]


def test_grace_elapsed_withdraws_before_payout():
    v = _view(
        contributed_this_round={"0xA": True, "0xB": True, "0xC": False, "0xD": False},
        parked=500,
    )
    now = v.round_start + v.period + v.grace + 1
    actions = [d.action for d in decide(v, now)]
    assert actions == ["mark_delinquent", "mark_delinquent", "withdraw_idle", "trigger_payout"]
