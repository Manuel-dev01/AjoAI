"""Unit tests for the STATE-BASED metrics collector (no real chain).

Guards the fix for the event-scan undercount: the collector must tally circle states,
contributions and payouts from CircleView state (not events), derive reputation from
scoreOf, and flag an implausible all-zero result so a failed read never overwrites a good
snapshot (CLAUDE.md §10).
"""

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.chain import CircleView  # noqa: E402
from src.metrics import MetricsCollector, MetricsSnapshot  # noqa: E402

AGENT = "0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7"


def _caddr(n: int) -> str:
    """A valid checksum-able circle address (the yield scan checksums circle addrs)."""
    return "0x" + f"{n:040x}"


def _view(addr, state, slots, rounds_paid, intended_pot, members) -> CircleView:
    return CircleView(
        address=addr, state=state, slots=slots, current_round=0, rounds_paid=rounds_paid,
        intended_pot=intended_pot, penalty_pool=0, parked=0, round_start=0, period=300,
        grace=60, members=members, rotation=[], recipient=None, recipient_delinquent=False,
        contributed_this_round={}, yield_adapter="0x0", balance=0,
    )


class _FakeScoreOf:
    def __init__(self, tup):
        self._tup = tup

    def call(self):
        return self._tup


class _FakeRep:
    def __init__(self, tup):
        self.functions = SimpleNamespace(scoreOf=lambda _addr: _FakeScoreOf(tup))


class _FakeEth:
    block_number = 0  # < mainnet deploy block → the yield scan loop is skipped

    def get_transaction_count(self, _addr, _blk):
        return 427

    def get_logs(self, _filter):
        return []


class _FakeChain:
    """Stand-in for ChainClient: canned circles, views and reputation."""

    def __init__(self, views, score_tuple):
        self._views = {v.address: v for v in views}
        self._score = score_tuple
        self.address = AGENT
        self.w3 = SimpleNamespace(eth=_FakeEth())

    def all_circles(self):
        return list(self._views.keys())

    def view_circle(self, addr):
        return self._views[addr]

    def reputation(self):
        return _FakeRep(self._score)


def _settings():
    return SimpleNamespace(
        chain="mainnet", chain_id=42220, explorer="https://celo.blockscout.com",
        factory="0xFACTORY", reputation_ledger="0xREP",
    )


def _collect(views, score_tuple=(5, 3, 1, 0, 1)):
    chain = _FakeChain(views, score_tuple)
    return MetricsCollector(_settings(), chain).collect()


def test_state_tally_and_activity():
    # 1 completed (2 rounds × 2 slots, pot 200), 1 forming, 1 dissolved.
    snap = _collect([
        _view(_caddr(1), state=2, slots=2, rounds_paid=2, intended_pot=200, members=["0xA", "0xB"]),
        _view(_caddr(2), state=0, slots=4, rounds_paid=0, intended_pot=400, members=["0xA"]),
        _view(_caddr(3), state=4, slots=3, rounds_paid=0, intended_pot=300, members=["0xC"]),
    ])
    assert snap.circles_created == 3
    assert snap.circles_completed == 1
    assert snap.circles_forming == 1
    assert snap.circles_dissolved == 1
    assert snap.circles_active == 0
    # only the completed circle had paid rounds: 2 rounds × 2 slots = 4 contributions
    assert snap.contribution_count == 4
    assert snap.total_contributions_wei == 2 * 200
    assert snap.payout_count == 2
    assert snap.total_payouts_wei == 2 * 200
    assert snap.unique_members == 3  # C1[A,B] ∪ C2[A] ∪ C3[C] = {A,B,C}


def test_unique_members_dedup_across_circles():
    snap = _collect([
        _view(_caddr(1), state=2, slots=2, rounds_paid=1, intended_pot=200, members=["0xA", "0xB"]),
        _view(_caddr(2), state=0, slots=2, rounds_paid=0, intended_pot=200, members=["0xA", "0xC"]),
    ])
    assert snap.unique_members == 3  # A, B, C (A deduped)


def test_reputation_from_scoreof():
    snap = _collect(
        [_view(_caddr(1), state=2, slots=2, rounds_paid=1, intended_pot=200, members=["0xA"])],
        score_tuple=(7, 5, 2, 1, 1),  # score, onTime, late, defaults, completions
    )
    assert snap.reputation_signals == 5 + 2 + 1
    assert snap.positive_signals == 5
    assert snap.negative_signals == 2 + 1
    assert snap.agent_tx_count == 427


def test_looks_zeroed_fires_on_all_forming():
    # Circles exist but nothing has been paid → implausible zero → guard must fire.
    snap = _collect([
        _view(_caddr(1), state=0, slots=2, rounds_paid=0, intended_pot=200, members=["0xA"]),
        _view(_caddr(2), state=0, slots=2, rounds_paid=0, intended_pot=200, members=["0xB"]),
    ])
    assert snap.contribution_count == 0
    assert snap.payout_count == 0
    assert snap.looks_zeroed() is True


def test_looks_zeroed_false_when_activity_present():
    snap = _collect([
        _view(_caddr(1), state=2, slots=2, rounds_paid=2, intended_pot=200, members=["0xA", "0xB"]),
    ])
    assert snap.looks_zeroed() is False


def test_empty_factory_not_flagged():
    # No circles at all → not a failed read, just an empty system → guard stays quiet.
    snap = MetricsSnapshot(chain="mainnet", chain_id=42220, explorer="x", factory="0xF")
    assert snap.looks_zeroed() is False
