"""NL handler safety + correctness (no LLM key needed).

The deterministic layer must be money-accurate and must NEVER imply it can take an action.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.chain import CircleView  # noqa: E402
from src.nl import answer, facts_for  # noqa: E402

MEMBERS = ["0xA", "0xB", "0xC", "0xD"]


def _view(current_round=0, rotation=None, recipient="0xA", recip_delq=False):
    return CircleView(
        address="0xCIRCLE",
        state=1,
        slots=4,
        current_round=current_round,
        rounds_paid=current_round,
        intended_pot=400 * 10**18,
        penalty_pool=0,
        parked=0,
        round_start=1000,
        period=300,
        grace=120,
        members=MEMBERS,
        rotation=rotation if rotation is not None else MEMBERS,
        recipient=recipient,
        recipient_delinquent=recip_delq,
        contributed_this_round={m: False for m in MEMBERS},
        yield_adapter="0x0000000000000000000000000000000000000000",
        balance=0,
    )


def test_non_member():
    f = facts_for(_view(), "0xZ")
    assert not f.is_member
    assert "not a member" in f.baseline_answer().lower()


def test_your_turn_now():
    f = facts_for(_view(current_round=0), "0xA")
    assert f.rounds_until_your_turn == 0
    assert "your turn" in f.baseline_answer().lower()


def test_future_turn_counts_rounds():
    f = facts_for(_view(current_round=0), "0xC")  # C is index 2
    assert f.rounds_until_your_turn == 2
    assert "2 round" in f.baseline_answer()


def test_already_received():
    f = facts_for(_view(current_round=3), "0xA")  # A received in round 0
    assert f.has_received
    assert "already received" in f.baseline_answer().lower()


def test_delinquent_recipient_message():
    f = facts_for(_view(current_round=0, recipient="0xA", recip_delq=True), "0xA")
    assert f.is_delinquent
    assert "cure" in f.baseline_answer().lower()


def test_member_in_terminal_circle_does_not_project_future_round():
    # Money-accuracy edge: a member of a DEFAULTED circle whose slot never came up must NOT be told
    # "your payout is in N rounds" — the rotation is over. current_round is stale in terminal states.
    v = _view(current_round=1, recipient="0xB")  # 0xD's slot (index 3) never reached
    v.state = 3  # Defaulted
    f = facts_for(v, "0xD")
    a = f.baseline_answer().lower()
    assert "default" in a
    assert "round(s)" not in a and "your payout is in" not in a

    v.state = 2  # Completed
    assert "completed" in facts_for(v, "0xD").baseline_answer().lower()

    v.state = 4  # Dissolved
    assert "dissolved" in facts_for(v, "0xD").baseline_answer().lower()


def test_answer_without_key_returns_baseline():
    f = facts_for(_view(current_round=0), "0xB")
    # no api key -> deterministic baseline, no network
    assert answer("when do I get paid?", f, api_key=None) == f.baseline_answer()
