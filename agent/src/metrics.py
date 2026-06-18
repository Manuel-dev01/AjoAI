"""On-chain metrics aggregator for AjoAI.

Queries event logs from the CircleFactory and ReputationLedger contracts to produce
a snapshot of all circles, contributions, payouts, and reputation activity.  Used for:
  CLI        python -m src.main metrics
  JSON       optionally writes a snapshot file for the miniapp stats page

Chain is the source of truth (CLAUDE.md §1.2) — this module reads events, never memory.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from web3 import Web3

from .config import Settings

# Factory deployment blocks (avoids scanning from genesis).
_DEPLOY_BLOCK: dict[str, int] = {
    "sepolia": 27_135_283,
    "mainnet": 69_477_069,
}


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


class MetricsCollector:
    """Reads event logs and aggregates them into a ``MetricsSnapshot``."""

    def __init__(self, settings: Settings):
        self.s = settings
        self.w3 = Web3(Web3.HTTPProvider(settings.rpc_url))
        self._from_block = _DEPLOY_BLOCK.get(settings.chain, 0)

    # ── public ──

    def collect(self) -> MetricsSnapshot:
        """Aggregate every event into a single snapshot."""
        snap = MetricsSnapshot(
            chain=self.s.chain,
            chain_id=self.s.chain_id,
            explorer=self.s.explorer,
            factory=self.s.factory or "",
        )
        if not self.s.factory:
            return snap

        factory = Web3.to_checksum_address(self.s.factory)
        rep_addr = Web3.to_checksum_address(self.s.reputation_ledger) if self.s.reputation_ledger else None

        circles = self._collect_factory(factory, snap)
        self._collect_circles(circles, snap)

        if rep_addr:
            self._collect_reputation(rep_addr, snap)

        if self.s.agent_key:
            from web3 import Account
            agent = Account.from_key(self.s.agent_key).address
            snap.agent_tx_count = self._count_from(agent)

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

    def _logs(self, address: str, topics: list, from_block: int = 0) -> list:
        """Fetch event logs in 1 000-block chunks (thirdweb/Ankr getLogs cap is 1 000
        blocks; larger ranges fail with "Maximum allowed number of requested blocks is
        1000", which silently dropped late-payment/yield events)."""
        start = from_block or self._from_block
        end = self.w3.eth.block_number
        chunk = 1_000
        all_logs: list = []
        while start <= end:
            to = min(start + chunk - 1, end)
            try:
                batch = self.w3.eth.get_logs(
                    {
                        "address": Web3.to_checksum_address(address),
                        "fromBlock": start,
                        "toBlock": to,
                        "topics": topics,
                    }
                )
                all_logs.extend(batch)
            except Exception:
                pass  # skip chunk on error (rate-limit, etc.)
            start = to + 1
        return all_logs

    @staticmethod
    def _topic(sig: str) -> str:
        return Web3.keccak(text=sig).hex()

    @staticmethod
    def _uint256(data: bytes, offset: int = 0) -> int:
        return int.from_bytes(data[offset : offset + 32], "big")

    def _collect_factory(self, factory: str, snap: MetricsSnapshot) -> list[str]:
        created_topic = self._topic("CircleCreated(address,address)")
        logs = self._logs(factory, [created_topic])

        snap.circles_created = len(logs)
        circles = []
        for log in logs:
            addr = "0x" + log["topics"][1].hex()[-40:]
            circles.append(Web3.to_checksum_address(addr))
        return circles

    def _collect_circles(self, circles: list[str], snap: MetricsSnapshot) -> None:
        if not circles:
            return

        joined_topic = self._topic("MemberJoined(address,uint256,uint256)")
        contrib_topic = self._topic("Contributed(address,uint256,uint256,bool)")
        late_topic = self._topic("LatePaid(address,uint256,uint256)")
        payout_topic = self._topic("PaidOut(address,uint256,uint256)")
        delinq_topic = self._topic("Delinquent(address,uint256,uint256)")
        completed_topic = self._topic("CircleCompleted()")
        defaulted_topic = self._topic("CircleDefaulted(uint256)")
        dissolved_topic = self._topic("CircleDissolved()")
        active_topic = self._topic("CircleStarted(uint256,uint256)")
        deposit_topic = self._topic("SimulatedDeposit(address,address,uint256)")
        withdraw_topic = self._topic("SimulatedWithdraw(address,address,uint256,uint256)")

        members: set[str] = set()

        for addr in circles:
            try:
                joined = self._logs(addr, [joined_topic])
                for log in joined:
                    m = "0x" + log["topics"][1].hex()[-40:]
                    members.add(m.lower())

                for log in self._logs(addr, [contrib_topic]):
                    # data layout: amount (0..32), late (32..64) — member+round are indexed (topics)
                    snap.total_contributions_wei += self._uint256(log["data"], 0)
                    snap.contribution_count += 1

                for log in self._logs(addr, [late_topic]):
                    snap.late_contributions += 1

                for log in self._logs(addr, [payout_topic]):
                    # data layout: pot (0..32) — recipient+round are indexed (topics)
                    snap.total_payouts_wei += self._uint256(log["data"], 0)
                    snap.payout_count += 1

                for log in self._logs(addr, [delinq_topic]):
                    snap.defaults_triggered += 1

                completed = self._logs(addr, [completed_topic])
                if completed:
                    snap.circles_completed += 1

                defaulted = self._logs(addr, [defaulted_topic])
                if defaulted:
                    snap.circles_defaulted += 1

                dissolved = self._logs(addr, [dissolved_topic])
                if dissolved:
                    snap.circles_dissolved += 1

                if not completed and not defaulted and not dissolved:
                    started = self._logs(addr, [active_topic])
                    if started:
                        snap.circles_active += 1
                    else:
                        snap.circles_forming += 1

                for log in self._logs(addr, [deposit_topic]):
                    snap.yield_deposits += 1
                for log in self._logs(addr, [withdraw_topic]):
                    snap.yield_withdrawals += 1
                    # data layout: principal (0..32), yieldAccrued (32..64) — token+circle are indexed
                    snap.total_yield_wei += self._uint256(log["data"], 32)

            except Exception:
                continue  # never let one circle stall the whole collection

        snap.unique_members = len(members)

    def _collect_reputation(self, rep_addr: str, snap: MetricsSnapshot) -> None:
        signal_topic = self._topic("Signal(address,int256,int256,string)")
        try:
            logs = self._logs(rep_addr, [signal_topic])
            snap.reputation_signals = len(logs)
            for log in logs:
                delta = int.from_bytes(log["data"][:32], "big", signed=True)
                if delta > 0:
                    snap.positive_signals += 1
                elif delta < 0:
                    snap.negative_signals += 1
        except Exception:
            pass

    def _count_from(self, sender: str) -> int:
        """Count transactions sent by *sender* (agent address)."""
        try:
            return self.w3.eth.get_transaction_count(
                Web3.to_checksum_address(sender), "latest"
            )
        except Exception:
            return 0
