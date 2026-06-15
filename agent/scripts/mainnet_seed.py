"""Fund-safe REAL-USDT autonomous rotation on Celo mainnet (Phase-6 mainnet-early).

Drives a full rotating-savings circle on mainnet with real Tether USD₮ (6 decimals), the AGENT
triggering every payout (economic-agency proof, CLAUDE.md §1.1). Designed for a ~$4 budget:

  * member keys are PERSISTED to agent/.mainnet_members.json BEFORE any funding, so a crash never
    strands real funds (recover with `... mainnet_seed sweep`);
  * every step is idempotent (re-checks chain state), safe to re-run;
  * at the end it SWEEPS residual USDT + CELO from every member back to the agent — the USDT is
    recovered, only CELO gas is spent.

Run:    CHAIN=mainnet agent/.venv/Scripts/python -m scripts.mainnet_seed
Sweep:  CHAIN=mainnet agent/.venv/Scripts/python -m scripts.mainnet_seed sweep

Tunables (env): AJOAI_SEED_SLOTS (default 3), AJOAI_SEED_CONTRIB (human units, default "0.3"),
AJOAI_SEED_PERIOD (s, default 300), AJOAI_SEED_GRACE (s, default 120).
"""

from __future__ import annotations

import json
import os
import sys
import time
from decimal import Decimal
from pathlib import Path

from web3 import Web3

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.chain import ChainClient  # noqa: E402
from src.config import REPO_ROOT, load_settings  # noqa: E402
from src.logs import configure, get_logger, loud_sim  # noqa: E402
from src.loop import Agent  # noqa: E402

ERC20_ABI = [
    {"type": "function", "name": "transfer", "stateMutability": "nonpayable", "inputs": [{"name": "to", "type": "address"}, {"name": "v", "type": "uint256"}], "outputs": [{"type": "bool"}]},
    {"type": "function", "name": "approve", "stateMutability": "nonpayable", "inputs": [{"name": "s", "type": "address"}, {"name": "v", "type": "uint256"}], "outputs": [{"type": "bool"}]},
    {"type": "function", "name": "allowance", "stateMutability": "view", "inputs": [{"name": "o", "type": "address"}, {"name": "s", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "balanceOf", "stateMutability": "view", "inputs": [{"name": "a", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint8"}]},
    {"type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
]

SLOTS = int(os.getenv("AJOAI_SEED_SLOTS", "3"))
PERIOD = int(os.getenv("AJOAI_SEED_PERIOD", "300"))
GRACE = int(os.getenv("AJOAI_SEED_GRACE", "120"))
PENALTY_BPS = 500
CONTRIB_HUMAN = os.getenv("AJOAI_SEED_CONTRIB", "0.3")
GAS_TOPUP = Web3.to_wei(os.getenv("AJOAI_SEED_GAS_CELO", "0.6"), "ether")  # CELO per member
STATE_FILE = REPO_ROOT / "agent" / ".mainnet_members.json"
MAX_UINT = 2**256 - 1


def _load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {}


def _save_state(st: dict) -> None:
    STATE_FILE.write_text(json.dumps(st, indent=2), encoding="utf-8")


def _wait(cond, what: str, log, tries: int = 30, delay: float = 2.0) -> None:
    for _ in range(tries):
        try:
            if cond():
                return
        except Exception:  # noqa: BLE001 — transient RPC, retry
            pass
        time.sleep(delay)
    raise TimeoutError(f"condition not met: {what}")


class Seeder:
    def __init__(self):
        self.s = load_settings()
        assert self.s.chain == "mainnet", f"run with CHAIN=mainnet (got {self.s.chain})"
        configure(self.s.log_level)
        self.log = get_logger("ajoai.mainnet_seed")
        self.chain = ChainClient(self.s)
        self.w3 = self.chain.w3
        self.agent = self.chain.acct
        assert self.agent, "need AGENT_PRIVATE_KEY_MAINNET"
        token_addr = self.s.token("USDT")
        assert token_addr, "USDT not in addresses.mainnet.json tokens"
        self.token = self.w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=ERC20_ABI)
        self.dec = self.token.functions.decimals().call()
        self.sym = self.token.functions.symbol().call()
        self.contribution = int(Decimal(CONTRIB_HUMAN) * (10**self.dec))
        self.st = _load_state()

    # ── tx helpers ──
    def _gas_price(self) -> int:
        return self.w3.eth.gas_price

    def _send(self, acct, fn, gas: int, value: int = 0) -> str:
        tx = fn.build_transaction({
            "from": acct.address,
            "nonce": self.w3.eth.get_transaction_count(acct.address, "pending"),
            "chainId": self.s.chain_id,
            "gas": gas,
            "gasPrice": self._gas_price(),
            "value": value,
        })
        signed = acct.sign_transaction(tx)
        h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        r = self.w3.eth.wait_for_transaction_receipt(h)
        assert r["status"] == 1, f"tx failed: 0x{h.hex().removeprefix('0x')}"
        return "0x" + h.hex().removeprefix("0x")

    def _send_value(self, acct, to: str, value: int, gas_price: int | None = None) -> str:
        gp = gas_price if gas_price is not None else self._gas_price()
        tx = {
            "from": acct.address, "to": Web3.to_checksum_address(to), "value": value,
            "nonce": self.w3.eth.get_transaction_count(acct.address, "pending"),
            "chainId": self.s.chain_id, "gas": 21000, "gasPrice": gp,
        }
        signed = acct.sign_transaction(tx)
        h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        self.w3.eth.wait_for_transaction_receipt(h)
        return "0x" + h.hex().removeprefix("0x")

    def usdt(self, addr: str) -> int:
        return self.token.functions.balanceOf(Web3.to_checksum_address(addr)).call()

    def _members(self) -> list:
        return [self.w3.eth.account.from_key(m["priv"]) for m in self.st["members"]]

    # ── setup ──
    def ensure_members(self) -> None:
        if "members" not in self.st:
            accs = [self.w3.eth.account.create() for _ in range(SLOTS)]
            self.st["members"] = [{"priv": a.key.hex(), "addr": a.address} for a in accs]
            self.st["token"] = self.token.address
            self.st["contribution"] = self.contribution
            self.st["slots"] = SLOTS
            _save_state(self.st)  # PERSIST before any funding (crash-safe)
            self.log.info("members_created", n=SLOTS, file=str(STATE_FILE))

    def ensure_circle(self) -> str:
        if self.st.get("circle"):
            return self.st["circle"]
        factory = self.chain.factory()
        loud_sim(self.log, "token", f"mainnet seed uses REAL {self.sym} ({self.dec} dec) at {self.token.address}")
        tx = factory.functions.createCircle(
            self.token.address, self.contribution, PERIOD, GRACE, PENALTY_BPS, SLOTS
        ).build_transaction({
            "from": self.agent.address,
            "nonce": self.w3.eth.get_transaction_count(self.agent.address, "pending"),
            "chainId": self.s.chain_id, "gas": 4_000_000, "gasPrice": self._gas_price(),
        })
        signed = self.agent.sign_transaction(tx)
        h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        rcpt = self.w3.eth.wait_for_transaction_receipt(h)
        assert rcpt["status"] == 1, "createCircle failed"
        evt = factory.events.CircleCreated().process_receipt(rcpt)
        circle_addr = evt[0]["args"]["circle"]
        self.st["circle"] = circle_addr
        self.st["createTx"] = "0x" + h.hex().removeprefix("0x")
        _save_state(self.st)
        self.log.info("circle_created", circle=circle_addr, tx=self.st["createTx"])
        return circle_addr

    def fund_and_join(self, circle_addr: str) -> None:
        circle = self.chain.circle(circle_addr)
        need_usdt = (SLOTS + 1) * self.contribution  # deposit + one contribution per round
        for i, m in enumerate(self._members()):
            # gas top-up (idempotent)
            if self.w3.eth.get_balance(m.address) < GAS_TOPUP // 2:
                self._send_value(self.agent, m.address, GAS_TOPUP)
            # USDT top-up (idempotent)
            if self.usdt(m.address) < need_usdt:
                self._send(self.agent, self.token.functions.transfer(m.address, need_usdt), gas=120_000)
            # approve (idempotent)
            allow = self.token.functions.allowance(m.address, circle_addr).call()
            if allow < need_usdt:
                self._send(m, self.token.functions.approve(circle_addr, MAX_UINT), gas=120_000)
            # join (idempotent)
            if not circle.functions.isMember(m.address).call() and circle.functions.membersLength().call() < SLOTS:
                self._send(m, circle.functions.join(b""), gas=500_000)
                self.log.info("member_joined", index=i, member=m.address)
        _wait(lambda: circle.functions.membersLength().call() == SLOTS, "all joined", self.log)

    def run_rotation(self, circle_addr: str) -> list:
        circle = self.chain.circle(circle_addr)
        ag = Agent(self.s, self.chain)
        # start (agent) — run_once auto-starts a full Forming circle
        for _ in range(10):
            if circle.functions.state().call() == 1:
                break
            ag.run_once(circle_addr)
            time.sleep(2)
        assert circle.functions.state().call() == 1, "circle did not start"
        self.log.info("circle_started", circle=circle_addr)

        payouts = []
        for r in range(SLOTS):
            for m in self._members():  # everyone on-time -> all_in -> immediate payout
                if not circle.functions.contributedInRound(r, m.address).call():
                    self._send(m, circle.functions.contribute(), gas=260_000)
            _wait(lambda: all(circle.functions.contributedInRound(r, m.address).call() for m in self._members()),
                  f"round {r} contributed", self.log)
            recip = circle.functions.recipientOf(r).call()
            pr = None
            for _ in range(10):
                res = ag.run_once(circle_addr)
                pr = next((x for x in res if x.get("action") == "trigger_payout" and x.get("ok")), pr)
                if circle.functions.currentRound().call() > r:
                    break
                time.sleep(2)
            assert circle.functions.currentRound().call() > r, f"round {r} did not advance"
            payouts.append({"round": r, "recipient": recip, "tx": pr.get("txHash") if pr else None})
            self.log.info("autonomous_payout", round=r, recipient=recip, tx=payouts[-1]["tx"])

        # finalize (agent)
        fr = None
        for _ in range(10):
            fin = ag.run_once(circle_addr)
            fr = next((x for x in fin if x.get("action") == "finalize"), fr)
            if circle.functions.state().call() == 2:
                break
            time.sleep(2)
        self.st["payouts"] = payouts
        self.st["finalizeTx"] = fr.get("txHash") if fr else None
        _save_state(self.st)
        return payouts

    def sweep(self) -> dict:
        """Return all residual USDT + CELO from member wallets to the agent."""
        swept = {"usdt": 0, "txs": []}
        for m in self._members():
            bal = self.usdt(m.address)
            if bal > 0:
                tx = self._send(m, self.token.functions.transfer(self.agent.address, bal), gas=120_000)
                swept["usdt"] += bal
                swept["txs"].append(tx)
                self.log.info("swept_usdt", member=m.address, amount=bal, tx=tx)
            # sweep residual CELO; Celo is OP-stack so the real cost = L2 gas + an L1 data fee.
            # Leave a flat, generous buffer (covers both) rather than 21000*gasPrice. Best-effort.
            try:
                gp = int(self._gas_price() * 1.5)
                buffer = Web3.to_wei("0.03", "ether")  # > any L2+L1 fee for a 21k transfer
                celo = self.w3.eth.get_balance(m.address)
                if celo > buffer * 2:
                    self._send_value(m, self.agent.address, celo - buffer, gas_price=gp)
            except Exception as e:  # noqa: BLE001 — dust recovery is best-effort
                self.log.warning("celo_sweep_skip", member=m.address, err=type(e).__name__)
        self.log.info("sweep_done", usdt_returned=swept["usdt"])
        return swept

    def report(self, circle_addr: str, agent_usdt_before: int, swept: dict) -> dict:
        circle = self.chain.circle(circle_addr)
        in_sum, out_sum = circle.functions.reconcile().call()
        rep = self.chain.reputation()
        scores = {}
        for m in self._members():
            try:
                scores[m.address] = rep.functions.getScore(m.address).call()
            except Exception:  # noqa: BLE001
                scores[m.address] = None
        agent_usdt_after = self.usdt(self.agent.address)
        summary = {
            "chain": "mainnet", "chainId": self.s.chain_id,
            "token": self.token.address, "tokenSymbol": self.sym, "decimals": self.dec,
            "circle": circle_addr, "createTx": self.st.get("createTx"),
            "contribution": str(self.contribution), "slots": SLOTS,
            "payouts": self.st.get("payouts"), "finalizeTx": self.st.get("finalizeTx"),
            "state": circle.functions.state().call(),
            "roundsPaid": circle.functions.roundsPaid().call(),
            "reconcile": {"in": str(in_sum), "out": str(out_sum), "balanced": in_sum == out_sum},
            "scores": {a: s_ for a, s_ in scores.items()},
            "agentUsdtBefore": str(agent_usdt_before),
            "agentUsdtAfter": str(agent_usdt_after),
            "usdtSweptBack": str(swept["usdt"]),
            "explorer": f"{self.s.explorer}/address/{circle_addr}",
        }
        (REPO_ROOT / "config" / "demo_run.mainnet.json").write_text(
            json.dumps(summary, indent=2), encoding="utf-8")
        self.log.info("seed_complete", **{k: summary[k] for k in ("circle", "reconcile", "roundsPaid", "agentUsdtAfter")})
        print(json.dumps(summary, indent=2))
        return summary


def seed_once(log=None) -> dict:
    """Operate ONE complete rotating-savings circle end to end and return its summary.

    The agent creates a small self-funded circle in real USD₮, funds a set of reusable participant
    wallets, then drives every contribution, payout and the finalize itself (the economic-agency
    proof, CLAUDE.md §1.1). All USD₮ is swept back at the end, so only CELO gas is spent. Member
    wallets persist across calls; the per-circle state is cleared on a clean finish so the next
    call operates a fresh circle. Safe to invoke on a schedule from the hosted worker.
    """
    sd = Seeder()
    if log is not None:
        sd.log = log
    agent_usdt_before = sd.usdt(sd.agent.address)
    sd.ensure_members()
    circle_addr = sd.ensure_circle()
    sd.fund_and_join(circle_addr)
    sd.run_rotation(circle_addr)
    swept = sd.sweep()
    summary = sd.report(circle_addr, agent_usdt_before, swept)
    # Clear per-circle state on success so a subsequent call operates a fresh circle (reuse keys).
    # A crash mid-cycle leaves the state intact, so a retry resumes the same circle.
    for k in ("circle", "createTx", "payouts", "finalizeTx"):
        sd.st.pop(k, None)
    _save_state(sd.st)
    return summary


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "run"
    if mode == "sweep":
        Seeder().sweep()
        return
    seed_once()


if __name__ == "__main__":
    main()
