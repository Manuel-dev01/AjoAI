"""On-chain metrics aggregator for AjoAI.

Reads CIRCLE STATE (not event history) and aggregates it into a snapshot. Used for:
  CLI        python -m src.main metrics
  JSON       optionally writes a snapshot file for the miniapp stats page

Chain is the source of truth (CLAUDE.md §1.2). This was previously event-based — it scanned
every event type for every circle from the factory deploy block to head in 1 000-block
chunks (~200k getLogs/sweep), which forno rate-limited into silent empty results, so every
event-derived count collapsed to 0 while circlesCreated (a single scan) survived. It now
mirrors the frontend's reliable state-based ``readCallState`` (miniapp/lib/metrics.ts): a few
hundred cheap ``eth_call``s via the shared ``ChainClient``, no full-history event scans.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from web3 import Web3

from .chain import ChainClient
from .config import Settings
from .logs import get_logger

log = get_logger("ajoai.metrics")


@dataclass
class MetricsSnapshot:
    """Point-in-time aggregate of every AjoAI circle on-chain."""

    chain: str
    chain_id: int
    explorer: str
    factory: str

    circles_created: int = 0
    circles_completed: int = 0
    circles_defaulted: int = 0
    circles_dissolved: int = 0
    circles_active: int = 0
    circles_forming: int = 0

    total_contributions_wei: int = 0
    contribution_count: int = 0
    late_contributions: int = 0

    total_payouts_wei: int = 0
    payout_count: int = 0

    unique_members: int = 0
    defaults_triggered: int = 0

    reputation_signals: int = 0
    positive_signals: int = 0
    negative_signals: int = 0

    yield_deposits: int = 0
    yield_withdrawals: int = 0
    total_yield_wei: int = 0

    agent_tx_count: int = 0

    def looks_zeroed(self) -> bool:
        """True when circles exist but every activity metric is 0 — an implausible result
        that means a failed read, not reality. The push path uses this to AVOID overwriting
        a known-good snapshot with zeros (anti-regression guard)."""
        return (
            self.circles_created > 0
            and self.circles_completed == 0
            and self.contribution_count == 0
            and self.payout_count == 0
        )


class MetricsCollector:
    """Reads circle STATE and aggregates it into a ``MetricsSnapshot``."""

    def __init__(self, settings: Settings, chain: ChainClient | None = None):
        self.s = settings
        # Reuse the shared ChainClient (POA middleware + Circle/Factory/Reputation ABIs +
        # all_circles()/view_circle()/reputation() helpers). Falls back to a fresh one for
        # the standalone CLI.
        self.chain = chain or ChainClient(settings)
        self.w3 = self.chain.w3

    # ── public ──

    def collect(self, views=None, circles_created: int | None = None) -> MetricsSnapshot:
        """Aggregate every circle's STATE into a single snapshot (no event-history scans).

        *views*: pre-fetched ``CircleView``s. The serve-all sweep ALREADY reads one per circle
        to decide actions, so it passes them here and the metrics pass costs ~0 extra RPC. When
        omitted (the standalone ``metrics`` CLI), we fetch them ourselves. *circles_created* is
        the authoritative factory count (the state tally is best-effort over readable circles)."""
        snap = MetricsSnapshot(
            chain=self.s.chain,
            chain_id=self.s.chain_id,
            explorer=self.s.explorer,
            factory=self.s.factory or "",
        )
        if not self.s.factory:
            return snap

        if views is None:
            circles = self.chain.all_circles()  # factory.allCirclesLength() + allCircles(i)
            snap.circles_created = len(circles)
            views = []
            for addr in circles:
                try:
                    views.append(self.chain.view_circle(addr))
                except Exception as e:  # noqa: BLE001 — loud, never silent; skip just this circle
                    log.warning("metrics_circle_read_error", circle=addr, error=str(e))
        else:
            snap.circles_created = circles_created if circles_created is not None else len(views)

        members: set[str] = set()
        for v in views:
            # State tally: 0 Forming · 1 Active · 2 Completed · 3 Defaulted · 4 Dissolved.
            if v.state == 0:
                snap.circles_forming += 1
            elif v.state == 1:
                snap.circles_active += 1
            elif v.state == 2:
                snap.circles_completed += 1
            elif v.state == 3:
                snap.circles_defaulted += 1
            elif v.state == 4:
                snap.circles_dissolved += 1

            # intended_pot == slots × contribution, so a paid round moves exactly one pot in
            # (all slots contribute) and one pot out (the recipient). Mirrors readCallState.
            if v.slots > 0 and v.intended_pot > 0:
                snap.contribution_count += v.rounds_paid * v.slots
                snap.total_contributions_wei += v.rounds_paid * v.intended_pot
                snap.payout_count += v.rounds_paid
                snap.total_payouts_wei += v.rounds_paid * v.intended_pot

            for m in v.members:
                members.add(m.lower())

        snap.unique_members = len(members)
        snap.defaults_triggered = snap.circles_defaulted  # mirror frontend (no separate event count)

        self._collect_reputation(snap)
        # NOTE: yield_deposits/withdrawals/total_yield_wei are genuinely event-only
        # (SimulatedYieldAdapter). A full-history getLogs scan over ~577k blocks with a 44-address
        # filter hangs/times-out on forno (web3.py has no read timeout), which is exactly the kind
        # of fragility this rewrite removes — so yield stays 0 here (DEFERRED, non-headline; the
        # committed snapshot historically had it 0/absent too). Revisit with a bounded, timed scan
        # or a dedicated indexer if the capital-efficiency panel needs live numbers.

        if self.chain.address:
            try:
                snap.agent_tx_count = self.w3.eth.get_transaction_count(
                    Web3.to_checksum_address(self.chain.address), "latest"
                )
            except Exception as e:  # noqa: BLE001
                log.warning("metrics_agent_tx_read_error", error=str(e))

        return snap

    # camelCase / wei-as-string key map — the shape the Next.js stats page + /api/metrics expect.
    _FRONTEND_KEY_MAP = {
        "chain": "chain", "chain_id": "chainId", "explorer": "explorer", "factory": "factory",
        "circles_created": "circlesCreated", "circles_completed": "completed",
        "circles_defaulted": "defaulted", "circles_dissolved": "dissolved",
        "circles_active": "active", "circles_forming": "forming",
        "total_contributions_wei": "totalContributions", "contribution_count": "contributionCount",
        "late_contributions": "lateContributions", "total_payouts_wei": "totalPayouts",
        "payout_count": "payoutCount", "unique_members": "uniqueMembers",
        "defaults_triggered": "defaultsTriggered", "reputation_signals": "reputationSignals",
        "positive_signals": "positiveSignals", "negative_signals": "negativeSignals",
        "yield_deposits": "yieldDeposits", "yield_withdrawals": "yieldWithdrawals",
        "total_yield_wei": "totalYield", "agent_tx_count": "agentTxCount",
    }
    _WEI_KEYS = {"total_contributions_wei", "total_payouts_wei", "total_yield_wei"}

    def frontend_payload(self, snap: MetricsSnapshot) -> dict:
        """camelCase, wei-as-strings dict — the shape the Next.js stats page + /api/metrics expect."""
        out: dict = {}
        for k, v in asdict(snap).items():
            if k == "looks_zeroed":  # method isn't in asdict, but guard against future fields
                continue
            out[self._FRONTEND_KEY_MAP.get(k, k)] = str(v) if k in self._WEI_KEYS else v
        out["timestamp"] = datetime.now(timezone.utc).isoformat()
        return out

    def export_json(self, snap: MetricsSnapshot, path: Path | str, *, frontend: bool = False) -> None:
        """Write a snapshot to a JSON file (camelCase frontend shape if *frontend*)."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        data = self.frontend_payload(snap) if frontend else asdict(snap)
        p.write_text(json.dumps(data, indent=2), encoding="utf-8")

    # ── internals ──

    def _collect_reputation(self, snap: MetricsSnapshot) -> None:
        """ERC-8004 signals from ReputationLedger.scoreOf(agent) — a single state call, not a
        Signal-event scan. scoreOf -> (score, onTime, late, defaults, completions)."""
        if not self.s.reputation_ledger or not self.chain.address:
            return
        try:
            rep = self.chain.reputation()
            _score, on_time, late, defaults, _completions = rep.functions.scoreOf(
                Web3.to_checksum_address(self.chain.address)
            ).call()
            snap.reputation_signals = on_time + late + defaults
            snap.positive_signals = on_time
            snap.negative_signals = late + defaults
        except Exception as e:  # noqa: BLE001 — loud, never silent
            log.warning("metrics_reputation_read_error", error=str(e))
