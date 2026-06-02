"""End-to-end demo driver: a full autonomous rotation on Celo Sepolia.

Deploys a MockERC20 (mirrors NGNm: 18 decimals; LOUDLY logged as a mock, CLAUDE.md §1.9),
creates a circle via the deployed factory, seeds 4 ephemeral members, then lets the AGENT
drive every payout. Produces real Sepolia tx hashes — the demo centerpiece and a feeder for
the "Most On-chain Transactions" track. Members contribute (their own keys); the agent only
triggers the legal transitions (non-custodial, CLAUDE.md §1.1).

Run:  agent/.venv/Scripts/python -m scripts.demo_rotation
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from web3 import Web3

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.chain import ChainClient  # noqa: E402
from src.config import REPO_ROOT, load_settings  # noqa: E402
from src.logs import configure, get_logger, loud_sim  # noqa: E402
from src.loop import Agent  # noqa: E402

CONTRIB = 100 * 10**18
PERIOD = 300
GRACE = 120
PENALTY_BPS = 500
# Tunable for budget: AJOAI_DEMO_SLOTS members, optional AJOAI_DEMO_TOKEN to reuse a mock token.
SLOTS = int(os.getenv("AJOAI_DEMO_SLOTS", "4"))
REUSE_TOKEN = os.getenv("AJOAI_DEMO_TOKEN")
# Per-member gas budget: approve + join + SLOTS contributions, with headroom.
GAS_TOPUP = Web3.to_wei(0.03 + 0.012 * SLOTS, "ether")


def _wait(cond, what: str, log, tries: int = 20, delay: float = 2.0) -> None:
    """Poll a chain read until it reflects a prior write (the RPC lags read-after-write)."""
    for _ in range(tries):
        try:
            if cond():
                return
        except Exception:  # noqa: BLE001 — transient RPC hiccup, retry
            pass
        time.sleep(delay)
    raise TimeoutError(f"condition not met in time: {what}")


def _artifact(name: str) -> tuple[list, str]:
    p = REPO_ROOT / "contracts" / "out" / f"{name}.sol" / f"{name}.json"
    j = json.loads(p.read_text(encoding="utf-8"))
    return j["abi"], j["bytecode"]["object"]


def main() -> None:
    s = load_settings()
    configure(s.log_level)
    log = get_logger("ajoai.demo")
    chain = ChainClient(s)
    w3 = chain.w3
    agent_acct = chain.acct
    assert agent_acct, "need AGENT_PRIVATE_KEY"

    def send(acct, fn, value=0, gas=300_000):
        tx = fn.build_transaction(
            {
                "from": acct.address,
                "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
                "chainId": s.chain_id,
                "value": value,
                "gas": gas,
            }
        )
        signed = acct.sign_transaction(tx)
        h = w3.eth.send_raw_transaction(signed.raw_transaction)
        r = w3.eth.wait_for_transaction_receipt(h)
        assert r["status"] == 1, f"tx failed: {h.hex()}"
        return h.hex()

    def send_value(acct, to, value):
        tx = {
            "from": acct.address,
            "to": to,
            "value": value,
            "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
            "chainId": s.chain_id,
            "gas": 21000,
            "gasPrice": w3.eth.gas_price,
        }
        signed = acct.sign_transaction(tx)
        h = w3.eth.send_raw_transaction(signed.raw_transaction)
        w3.eth.wait_for_transaction_receipt(h)
        return h.hex()

    # ── 1. Deploy (or reuse) MockERC20 (loud mock) ──
    loud_sim(log, "token", "demo uses a MockERC20 mirroring NGNm (18 decimals) — NOT real Mento NGNm")
    erc_abi, erc_bytecode = _artifact("MockERC20")
    if REUSE_TOKEN:
        token_addr = Web3.to_checksum_address(REUSE_TOKEN)
        token = w3.eth.contract(address=token_addr, abi=erc_abi)
        log.info("mock_token_reused", token=token_addr)
    else:
        Mock = w3.eth.contract(abi=erc_abi, bytecode=erc_bytecode)
        tx = Mock.constructor("Mock Mento Naira", "mNGNm").build_transaction(
            {
                "from": agent_acct.address,
                "nonce": w3.eth.get_transaction_count(agent_acct.address, "pending"),
                "chainId": s.chain_id,
                "gas": 1_500_000,
            }
        )
        signed = agent_acct.sign_transaction(tx)
        h = w3.eth.send_raw_transaction(signed.raw_transaction)
        rcpt = w3.eth.wait_for_transaction_receipt(h)
        token_addr = rcpt["contractAddress"]
        token = w3.eth.contract(address=token_addr, abi=erc_abi)
        log.info("mock_token_deployed", token=token_addr, tx=h.hex())

    # ── 2. Create circle via the deployed factory ──
    # Read the new circle address from the CircleCreated EVENT in the receipt — never from a
    # lagged allCircles() call (the RPC's read-after-write lag returns a stale prior circle).
    factory = chain.factory()
    ctx = factory.functions.createCircle(
        token_addr, CONTRIB, PERIOD, GRACE, PENALTY_BPS, SLOTS
    ).build_transaction(
        {
            "from": agent_acct.address,
            "nonce": w3.eth.get_transaction_count(agent_acct.address, "pending"),
            "chainId": s.chain_id,
            "gas": 3_500_000,
        }
    )
    signed = agent_acct.sign_transaction(ctx)
    create_h = w3.eth.send_raw_transaction(signed.raw_transaction).hex()
    crcpt = w3.eth.wait_for_transaction_receipt(bytes.fromhex(create_h.removeprefix("0x")))
    assert crcpt["status"] == 1, f"createCircle failed: {create_h}"
    evt = factory.events.CircleCreated().process_receipt(crcpt)
    circle_addr = evt[0]["args"]["circle"]
    log.info("circle_created", circle=circle_addr, tx=create_h)
    circle = chain.circle(circle_addr)

    # ── 3. Seed 4 ephemeral members ──
    members = [w3.eth.account.create() for _ in range(SLOTS)]
    for i, m in enumerate(members):
        send_value(agent_acct, m.address, GAS_TOPUP)  # gas
        send(agent_acct, token.functions.mint(m.address, 1000 * 10**18), gas=120_000)  # tokens
        send(m, token.functions.approve(circle_addr, 2**256 - 1), gas=80_000)
        send(m, circle.functions.join(b""), gas=450_000)  # OPEN mode (selfVerifier=0)
        log.info("member_joined", index=i, member=m.address)

    # ── 4. Agent drives the rotation (poll reads to beat RPC read-after-write lag) ──
    ag = Agent(s, chain)
    payouts = []

    # Ensure chain reflects all joins, then let the agent START the circle.
    _wait(lambda: circle.functions.membersLength().call() == SLOTS, "all members joined", log)
    for _ in range(8):
        ag.run_once(circle_addr)
        if circle.functions.state().call() == 1:  # Active
            break
        time.sleep(2)
    assert circle.functions.state().call() == 1, "circle did not start"
    log.info("circle_started", circle=circle_addr)

    for r in range(SLOTS):
        for m in members:  # everyone contributes on-time -> all_in -> immediate payout
            send(m, circle.functions.contribute(), gas=200_000)
        _wait(
            lambda: all(circle.functions.contributedInRound(r, m.address).call() for m in members),
            f"round {r} all contributed",
            log,
        )
        recip = circle.functions.recipientOf(r).call()
        # Agent perceives all_in -> triggers payout; retry until the round advances.
        pr = None
        for _ in range(8):
            res = ag.run_once(circle_addr)
            pr = next(
                (x for x in res if x.get("action") == "trigger_payout" and x.get("ok")), pr
            )
            if circle.functions.currentRound().call() > r:
                break
            time.sleep(2)
        assert circle.functions.currentRound().call() > r, f"round {r} did not advance"
        payouts.append({"round": r, "recipient": recip, "tx": pr.get("txHash") if pr else None})
        log.info("autonomous_payout", round=r, recipient=recip, tx=payouts[-1]["tx"])

    # ── 5. Finalize + report ──
    fr = None
    for _ in range(8):
        fin = ag.run_once(circle_addr)
        fr = next((x for x in fin if x.get("action") == "finalize"), fr)
        if circle.functions.state().call() == 2:  # Completed
            break
        time.sleep(2)
    in_sum, out_sum = circle.functions.reconcile().call()
    rep = chain.reputation()
    scores = {m.address: rep.functions.getScore(m.address).call() for m in members}

    summary = {
        "token": token_addr,
        "circle": circle_addr,
        "createTx": create_h,
        "payouts": payouts,
        "finalizeTx": fr.get("txHash") if fr else None,
        "reconcile": {"in": str(in_sum), "out": str(out_sum), "balanced": in_sum == out_sum},
        "scores": {a: s_ for a, s_ in scores.items()},
        "explorer": f"{s.explorer}/address/{circle_addr}",
    }
    out_path = REPO_ROOT / "config" / "demo_run.sepolia.json"
    out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    log.info("demo_complete", **summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
