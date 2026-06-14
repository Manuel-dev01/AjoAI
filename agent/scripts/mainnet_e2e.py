"""Live mainnet end-to-end, driven by real USD₮ and serviced by the HOSTED (Railway) agent.

Validates the product on Celo mainnet exactly as the UI buttons would, then lets the deployed
agent do the autonomous work (no local agent driving, to avoid nonce races on the shared key):

  create (factory.createCircle) -> distribute USD₮ + CELO to helper member wallets ->
  approve + join + contribute (the UI's calls) -> HOSTED agent auto-starts + pays round 0 ->
  round 1 DEFAULT (a member who already received skips) -> HOSTED agent covers the deposit,
  pays the recipient in full, writes negative reputation, finalizes -> verify reconcile + scores
  -> sweep all residual USD₮ + CELO back to the funded key.

Short period (120s) + 60s grace so the default round resolves in ~3 min. Fund-safe: member keys
persisted to gitignored agent/.mainnet_e2e.json; recover with the sweep at the end (or re-run).

Run: CHAIN=mainnet agent/.venv/Scripts/python -m scripts.mainnet_e2e
"""

from __future__ import annotations

import json
import sys
import time
from decimal import Decimal
from pathlib import Path

from web3 import Web3

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.chain import ChainClient  # noqa: E402
from src.config import REPO_ROOT, load_settings  # noqa: E402
from src.logs import configure, get_logger  # noqa: E402

ERC20_ABI = [
    {"type": "function", "name": "transfer", "stateMutability": "nonpayable", "inputs": [{"name": "to", "type": "address"}, {"name": "v", "type": "uint256"}], "outputs": [{"type": "bool"}]},
    {"type": "function", "name": "approve", "stateMutability": "nonpayable", "inputs": [{"name": "s", "type": "address"}, {"name": "v", "type": "uint256"}], "outputs": [{"type": "bool"}]},
    {"type": "function", "name": "allowance", "stateMutability": "view", "inputs": [{"name": "o", "type": "address"}, {"name": "s", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "balanceOf", "stateMutability": "view", "inputs": [{"name": "a", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint8"}]},
    {"type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
]

SLOTS = 2
PERIOD = 120
GRACE = 60
PENALTY_BPS = 500
CONTRIB_HUMAN = "0.3"
GAS_TOPUP = Web3.to_wei("0.6", "ether")
STATE = REPO_ROOT / "agent" / ".mainnet_e2e.json"
MAXUINT = 2**256 - 1


def main() -> None:
    s = load_settings()
    assert s.chain == "mainnet", "run with CHAIN=mainnet"
    configure(s.log_level)
    log = get_logger("ajoai.e2e")
    chain = ChainClient(s)
    w3, agent = chain.w3, chain.acct
    assert agent, "need AGENT_PRIVATE_KEY_MAINNET"
    token = w3.eth.contract(address=Web3.to_checksum_address(s.token("USDT")), abi=ERC20_ABI)
    dec = token.functions.decimals().call()
    sym = token.functions.symbol().call()
    contribution = int(Decimal(CONTRIB_HUMAN) * (10**dec))

    def gp() -> int:
        return w3.eth.gas_price

    def send(acct, fn, gas, value=0) -> str:
        tx = fn.build_transaction({"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address, "pending"), "chainId": s.chain_id, "gas": gas, "gasPrice": gp(), "value": value})
        h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)
        r = w3.eth.wait_for_transaction_receipt(h)
        assert r["status"] == 1, f"tx failed 0x{h.hex().removeprefix('0x')}"
        return "0x" + h.hex().removeprefix("0x")

    def send_value(acct, to, value, gas_price=None) -> str:
        g = gas_price if gas_price is not None else gp()
        tx = {"from": acct.address, "to": Web3.to_checksum_address(to), "value": value, "nonce": w3.eth.get_transaction_count(acct.address, "pending"), "chainId": s.chain_id, "gas": 21000, "gasPrice": g}
        h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)
        w3.eth.wait_for_transaction_receipt(h)
        return "0x" + h.hex().removeprefix("0x")

    def usdt(a) -> int:
        return token.functions.balanceOf(Web3.to_checksum_address(a)).call()

    def wait(cond, what, tries=30, delay=15) -> bool:
        for _ in range(tries):
            try:
                if cond():
                    return True
            except Exception:  # noqa: BLE001
                pass
            log.info("waiting_for_hosted_agent", what=what)
            time.sleep(delay)
        return False

    agent_usdt_before = usdt(agent.address)

    # ── members + circle (persisted) ──
    st = json.loads(STATE.read_text()) if STATE.exists() else {}
    if "members" not in st:
        accs = [w3.eth.account.create() for _ in range(SLOTS)]
        st["members"] = [{"priv": a.key.hex(), "addr": a.address} for a in accs]
        STATE.write_text(json.dumps(st, indent=2))
        log.info("members_created", n=SLOTS)
    members = [w3.eth.account.from_key(m["priv"]) for m in st["members"]]

    factory = chain.factory()
    if not st.get("circle"):
        tx = factory.functions.createCircle(token.address, contribution, PERIOD, GRACE, PENALTY_BPS, SLOTS).build_transaction({"from": agent.address, "nonce": w3.eth.get_transaction_count(agent.address, "pending"), "chainId": s.chain_id, "gas": 4_000_000, "gasPrice": gp()})
        h = w3.eth.send_raw_transaction(agent.sign_transaction(tx).raw_transaction)
        rc = w3.eth.wait_for_transaction_receipt(h)
        assert rc["status"] == 1, "createCircle failed"
        st["circle"] = factory.events.CircleCreated().process_receipt(rc)[0]["args"]["circle"]
        st["createTx"] = "0x" + h.hex().removeprefix("0x")
        STATE.write_text(json.dumps(st, indent=2))
        log.info("circle_created", circle=st["circle"], tx=st["createTx"])
    circle = chain.circle(st["circle"])

    # ── fund + join (USD₮ + CELO from the funded key; member keys join) ──
    need = (SLOTS + 1) * contribution
    for i, m in enumerate(members):
        if w3.eth.get_balance(m.address) < GAS_TOPUP // 2:
            send_value(agent, m.address, GAS_TOPUP)
        if usdt(m.address) < need:
            send(agent, token.functions.transfer(m.address, need), 120_000)
        if token.functions.allowance(m.address, st["circle"]).call() < need:
            send(m, token.functions.approve(st["circle"], MAXUINT), 120_000)
        if not circle.functions.isMember(m.address).call() and circle.functions.membersLength().call() < SLOTS:
            send(m, circle.functions.join(b""), 500_000)
            log.info("member_joined", index=i, member=m.address)

    # ── HOSTED agent auto-starts the full circle ──
    assert wait(lambda: circle.functions.state().call() == 1, "auto-start (full circle)"), "hosted agent did not start the circle"
    log.info("hosted_agent_started_circle", circle=st["circle"])

    # ── round 0: everyone contributes -> hosted agent pays ──
    for m in members:
        if not circle.functions.contributedInRound(0, m.address).call():
            send(m, circle.functions.contribute(), 260_000)
    assert wait(lambda: circle.functions.currentRound().call() >= 1, "payout round 0 (all-in)"), "round 0 not paid"
    log.info("round0_paid_by_agent", recipient=circle.functions.recipientOf(0).call())

    # ── round 1: DEFAULT — member[0] (already received) skips; only recipient member[1] pays ──
    send(members[1], circle.functions.contribute(), 260_000)
    log.info("round1_default_setup", skipping=members[0].address)
    # hosted agent waits out the grace window, then markDelinquent + cover + pay + finalize
    assert wait(lambda: circle.functions.state().call() == 2, "default cover + finalize", tries=34, delay=15), "circle did not complete"
    log.info("circle_completed")

    # ── verify ──
    ins, out = circle.functions.reconcile().call()
    rep = chain.reputation()
    m0_default = circle.functions.everDelinquent(members[0].address).call()
    scores = {m.address: rep.functions.scoreOf(m.address).call()[0] for m in members}
    report = {
        "chain": "mainnet", "circle": st["circle"], "createTx": st.get("createTx"),
        "token": token.address, "symbol": sym, "decimals": dec,
        "state": circle.functions.state().call(), "roundsPaid": circle.functions.roundsPaid().call(),
        "reconcile": {"in": str(ins), "out": str(out), "balanced": ins == out},
        "round1_default_member": members[0].address, "member0_marked_delinquent": m0_default,
        "scores": {a: int(v) for a, v in scores.items()},
        "explorer": f"{s.explorer}/address/{st['circle']}",
    }

    # ── sweep residual USD₮ + CELO back to the funded key ──
    for m in members:
        b = usdt(m.address)
        if b > 0:
            send(m, token.functions.transfer(agent.address, b), 120_000)
        try:
            g = int(gp() * 1.5)
            buf = Web3.to_wei("0.03", "ether")
            bal = w3.eth.get_balance(m.address)
            if bal > buf * 2:
                send_value(m, agent.address, bal - buf, gas_price=g)
        except Exception as e:  # noqa: BLE001
            log.warning("celo_sweep_skip", member=m.address, err=type(e).__name__)

    report["agentUsdtBefore"] = str(agent_usdt_before)
    report["agentUsdtAfter"] = str(usdt(agent.address))
    (REPO_ROOT / "config" / "e2e_run.mainnet.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    log.info("e2e_complete", **{k: report[k] for k in ("circle", "reconcile", "member0_marked_delinquent", "scores", "agentUsdtAfter")})
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
