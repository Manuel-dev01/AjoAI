"""Submit feedback for AjoAI agent (9339) on 8004scan.

Creates fresh wallets, funds them from a provided key, submits feedback,
then sweeps remaining CELO back. NOT linked to the agent wallet.

Run:
  agent/.venv/Scripts/python -m scripts.submit_feedback --key <PRIVATE_KEY>

The key just needs CELO for gas (~0.25 CELO total for 8 feedbacks).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ── Reputation Registry (Celo mainnet) ──
REP_REGISTRY = Web3.to_checksum_address("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63")
AGENT_ID = 9339
CHAIN_ID = 42220
RPC = "https://42220.rpc.thirdweb.com"

ABI = [
    {
        "type": "function",
        "name": "giveFeedback",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "agentId", "type": "uint256"},
            {"name": "value", "type": "int128"},
            {"name": "valueDecimals", "type": "uint8"},
            {"name": "tag1", "type": "string"},
            {"name": "tag2", "type": "string"},
            {"name": "endpoint", "type": "string"},
            {"name": "feedbackURI", "type": "string"},
            {"name": "feedbackHash", "type": "bytes32"},
        ],
        "outputs": [],
    },
]

# Each feedback: (tag1, tag2, score)
FEEDBACKS = [
    ("service", "ajo", 100),
    ("quality", "roscas", 95),
    ("reliability", "autonomous", 100),
    ("innovation", "financial-inclusion", 100),
    ("service", "stablecoins", 90),
    ("quality", "celo", 100),
    ("reliability", "savings", 95),
    ("innovation", "agent", 100),
]

FUND_PER_WALLET = Web3.to_wei(0.03, "ether")
GAS_LIMIT = 200_000


def main():
    parser = argparse.ArgumentParser(description="Submit 8004scan feedback for AjoAI")
    parser.add_argument("--key", required=True, help="Private key with CELO for gas (NOT the agent key)")
    parser.add_argument("--rpc", default=RPC, help="RPC URL")
    parser.add_argument("--agent-id", type=int, default=AGENT_ID, help="Agent token ID")
    parser.add_argument("--dry-run", action="store_true", help="Print txs without sending")
    args = parser.parse_args()

    w3 = Web3(Web3.HTTPProvider(args.rpc, request_kwargs={"verify": False}))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    assert w3.is_connected(), "RPC not connected"

    funder = w3.eth.account.from_key(args.key)
    registry = w3.eth.contract(address=REP_REGISTRY, abi=ABI)

    print(f"Funder: {funder.address}")
    print(f"Balance: {Web3.from_wei(w3.eth.get_balance(funder.address), 'ether'):.4f} CELO")
    print(f"Agent ID: {args.agent_id}")
    print(f"Feedbacks to submit: {len(FEEDBACKS)}")
    print()

    if args.dry_run:
        print("[dry-run] Would create", len(FEEDBACKS), "wallets and submit feedback.")
        return

    # 1. Create wallets
    wallets = [w3.eth.account.create() for _ in range(len(FEEDBACKS))]
    print("--- Created wallets ---")
    for i, acct in enumerate(wallets):
        print(f"  [{i}] {acct.address}")
    print()

    # 2. Fund wallets
    print("--- Funding wallets ---")
    for i, acct in enumerate(wallets):
        nonce = w3.eth.get_transaction_count(funder.address, "pending")
        tx = {
            "from": funder.address,
            "to": acct.address,
            "value": FUND_PER_WALLET,
            "nonce": nonce,
            "chainId": CHAIN_ID,
            "gas": 21000,
            "gasPrice": w3.eth.gas_price,
        }
        signed = funder.sign_transaction(tx)
        h = w3.eth.send_raw_transaction(signed.raw_transaction)
        w3.eth.wait_for_transaction_receipt(h, timeout=120)
        print(f"  [{i}] funded: 0x{h.hex()}")
        time.sleep(1)
    print()

    # 3. Submit feedback
    print("--- Submitting feedback ---")
    tx_hashes = []
    for i, (acct, (tag1, tag2, score)) in enumerate(zip(wallets, FEEDBACKS)):
        nonce = w3.eth.get_transaction_count(acct.address, "pending")
        fn = registry.functions.giveFeedback(
            args.agent_id,
            score,
            0,
            tag1,
            tag2,
            "",
            "https://ajo-ai-tan.vercel.app",
            b"\x00" * 32,
        )
        tx = fn.build_transaction({
            "from": acct.address,
            "nonce": nonce,
            "chainId": CHAIN_ID,
            "gas": GAS_LIMIT,
            "gasPrice": w3.eth.gas_price,
        })
        signed = acct.sign_transaction(tx)
        h = w3.eth.send_raw_transaction(signed.raw_transaction)
        rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=120)
        status = "OK" if rcpt["status"] == 1 else "FAIL"
        print(f"  [{i}] {tag1}:{tag2} score={score} -> {status} | 0x{h.hex()}")
        tx_hashes.append(h.hex())
        time.sleep(1)
    print()

    # 4. Sweep remaining CELO back
    print("--- Sweeping CELO back ---")
    total_swept = 0
    for i, acct in enumerate(wallets):
        bal = w3.eth.get_balance(acct.address)
        buffer = Web3.to_wei(0.003, "ether")
        if bal > buffer:
            send_amt = bal - buffer
            gp = int(w3.eth.gas_price * 1.5)
            nonce = w3.eth.get_transaction_count(acct.address, "pending")
            tx = {
                "from": acct.address,
                "to": funder.address,
                "value": send_amt,
                "nonce": nonce,
                "chainId": CHAIN_ID,
                "gas": 21000,
                "gasPrice": gp,
            }
            signed = acct.sign_transaction(tx)
            h = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(h, timeout=120)
            total_swept += send_amt
            print(f"  [{i}] swept {Web3.from_wei(send_amt, 'ether'):.4f} CELO")
    print(f"  Total swept back: {Web3.from_wei(total_swept, 'ether'):.4f} CELO")
    print()

    print(f"Done! {len(tx_hashes)} feedbacks submitted.")
    print(f"View: https://8004scan.io/agents/celo/{args.agent_id}")


if __name__ == "__main__":
    main()
