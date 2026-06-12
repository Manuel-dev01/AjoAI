"""Chain client for the AjoAI agent (web3.py).

PERCEIVE: read circle state from chain (the source of truth — never a cached view for a
money decision, CLAUDE.md §1.2). ACT: submit the minimal legal transitions the agent is
allowed to trigger (CLAUDE.md §1.1). The agent can never drain a circle or pay an arbitrary
address — every money rule is enforced by the contract.
"""

from __future__ import annotations

from dataclasses import dataclass

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

from .config import Settings, load_abi


@dataclass
class CircleView:
    address: str
    state: int  # 0 Forming,1 Active,2 Completed,3 Defaulted,4 Dissolved
    slots: int
    current_round: int
    rounds_paid: int
    intended_pot: int
    penalty_pool: int
    parked: int
    round_start: int
    period: int
    grace: int
    members: list[str]
    rotation: list[str]
    recipient: str | None
    recipient_delinquent: bool
    contributed_this_round: dict  # member -> bool

    STATE_NAMES = ["Forming", "Active", "Completed", "Defaulted", "Dissolved"]

    @property
    def state_name(self) -> str:
        return self.STATE_NAMES[self.state]


class ChainClient:
    def __init__(self, settings: Settings):
        self.s = settings
        self.w3 = Web3(Web3.HTTPProvider(settings.rpc_url))
        # Celo is OP-stack; inject POA middleware for extraData tolerance.
        self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        self.circle_abi = load_abi("Circle")
        self.factory_abi = load_abi("CircleFactory")
        self.rep_abi = load_abi("ReputationLedger")
        self.acct = (
            self.w3.eth.account.from_key(settings.agent_key) if settings.agent_key else None
        )

    # ── identity ──
    @property
    def address(self) -> str | None:
        return self.acct.address if self.acct else None

    def connected(self) -> bool:
        return self.w3.is_connected()

    # ── contract handles ──
    def circle(self, addr: str):
        return self.w3.eth.contract(address=Web3.to_checksum_address(addr), abi=self.circle_abi)

    def factory(self):
        return self.w3.eth.contract(
            address=Web3.to_checksum_address(self.s.factory), abi=self.factory_abi
        )

    def reputation(self):
        return self.w3.eth.contract(
            address=Web3.to_checksum_address(self.s.reputation_ledger), abi=self.rep_abi
        )

    def all_circles(self) -> list[str]:
        """Every circle the factory has deployed (for the serve-all sweep)."""
        f = self.factory()
        n = f.functions.allCirclesLength().call()
        return [Web3.to_checksum_address(f.functions.allCircles(i).call()) for i in range(n)]

    # ── PERCEIVE ──
    def view_circle(self, addr: str) -> CircleView:
        c = self.circle(addr)
        slots = c.functions.slots().call()
        members = [c.functions.members(i).call() for i in range(c.functions.membersLength().call())]
        state = c.functions.state().call()
        cr = c.functions.currentRound().call()

        rotation, recipient, recip_delq, contributed = [], None, False, {}
        if state == 1:  # Active -> rotation is set
            rotation = [c.functions.rotation(i).call() for i in range(slots)]
            if cr < slots:
                recipient = c.functions.recipientOf(cr).call()
                recip_delq = c.functions.isDelinquent(recipient).call()
            for m in members:
                contributed[m] = c.functions.contributedInRound(cr, m).call()

        return CircleView(
            address=Web3.to_checksum_address(addr),
            state=state,
            slots=slots,
            current_round=cr,
            rounds_paid=c.functions.roundsPaid().call(),
            intended_pot=c.functions.intendedPot().call(),
            penalty_pool=c.functions.penaltyPool().call(),
            parked=c.functions.parkedAmount().call(),
            round_start=c.functions.roundStartTime().call(),
            period=c.functions.period().call(),
            grace=c.functions.graceWindow().call(),
            members=members,
            rotation=rotation,
            recipient=recipient,
            recipient_delinquent=recip_delq,
            contributed_this_round=contributed,
        )

    def now(self) -> int:
        return self.w3.eth.get_block("latest")["timestamp"]

    def gas_balance_wei(self) -> int:
        """Native (CELO) balance of the agent account — gas runway for triggering txs."""
        if not self.acct:
            return 0
        return self.w3.eth.get_balance(self.acct.address)

    # ── ACT (agent-only triggers) ──
    def _send(self, fn, gas: int = 700_000) -> dict:
        """Build, sign, send a tx from the agent key; wait for the receipt.

        An explicit gas limit skips eth_estimateGas, which on some Celo Sepolia RPCs
        simulates against lagged state and spuriously reverts right after a dependent tx.
        """
        if not self.acct:
            raise RuntimeError("no agent key configured (AGENT_PRIVATE_KEY)")
        tx = fn.build_transaction(
            {
                "from": self.acct.address,
                "nonce": self.w3.eth.get_transaction_count(self.acct.address, "pending"),
                "chainId": self.s.chain_id,
                "gas": gas,
            }
        )
        signed = self.acct.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
        return {
            "txHash": tx_hash.hex(),
            "status": receipt["status"],
            "gasUsed": receipt["gasUsed"],
            "block": receipt["blockNumber"],
        }

    def trigger_payout(self, addr: str) -> dict:
        return self._send(self.circle(addr).functions.triggerPayout())

    def mark_delinquent(self, addr: str, member: str) -> dict:
        return self._send(self.circle(addr).functions.markDelinquent(member))

    def park_idle(self, addr: str) -> dict:
        return self._send(self.circle(addr).functions.parkIdleFunds())

    def withdraw_idle(self, addr: str) -> dict:
        return self._send(self.circle(addr).functions.withdrawIdleFunds())

    def start(self, addr: str) -> dict:
        return self._send(self.circle(addr).functions.start())

    def finalize(self, addr: str) -> dict:
        return self._send(self.circle(addr).functions.finalize())
