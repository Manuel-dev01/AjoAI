"""Unit tests for the pure decision logic (no chain needed).

Covers the reasoning that drives money actions — must match the contract's rules
(CLAUDE.md §8/§10): never authorize an action the contract wouldn't enforce.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.chain import CircleView  # noqa: E402
from src.loop import decide  # noqa: E402

MEMBERS = ["0xA", "0xB", "0xC", "0xD"]


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


def test_delinquent_recipient_withholds():
    v = _view(recipient_delinquent=True)
    now = v.round_start + v.period + v.grace + 1
    assert decide(v, now)[0].action == "wait"
    assert "withheld" in decide(v, now)[0].reason


def test_all_rounds_paid_finalizes():
    v = _view(rounds_paid=4)
    assert decide(v, now=9999)[0].action == "finalize"
