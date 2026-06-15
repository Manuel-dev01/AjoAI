"""Register the AjoAI agent on the ERC-8004 Identity Registry (track #3: 8004scan rank).

Mints an ERC-721 agent identity to the agent wallet, with an agentURI pointing at the agent
card. One cheap tx. The registry exposes register(string) -> uint256 agentId (verified on
Blockscout). We simulate first to capture the agentId, then broadcast.

agentURI: a compact data: URI carrying the card inline (self-contained; can be re-pointed to a
hosted URL later via the registry's setAgentURI). Use AJOAI_AGENT_URI to override.

Run:  agent/.venv/Scripts/python -m scripts.register_agent
"""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

from web3 import Web3

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import REPO_ROOT, load_settings  # noqa: E402
from src.identity import registry_for  # noqa: E402
from src.logs import configure, get_logger  # noqa: E402

# Minimal ABI: register(string)->uint256 + Registered event (per Blockscout-verified registry).
IDENTITY_ABI = [
    {
        "type": "function",
        "name": "register",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "agentURI", "type": "string"}],
        "outputs": [{"name": "agentId", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "tokenURI",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "string"}],
    },
]


def _agent_uri() -> str:
    # Short hosted-URL pointer (the ERC-8004 norm) — cheap to store. The card is served by the
    # miniapp at /.well-known/agent-card.json (miniapp/public/.well-known/agent-card.json).
    # IMPORTANT: set AJOAI_AGENT_URI to the DEPLOYED miniapp URL (e.g. your Vercel domain) before
    # registering, so 8004scan can fetch + render the agent. Re-run this script to mint a fresh
    # agentId pointing at the live URL (the registry mints a new ERC-721 per register() call).
    return os.getenv("AJOAI_AGENT_URI", "https://ajo-ai-tan.vercel.app/.well-known/agent-card.json")


def main() -> None:
    s = load_settings()
    configure(s.log_level)
    log = get_logger("ajoai.register")
    w3 = Web3(Web3.HTTPProvider(s.rpc_url))
    acct = w3.eth.account.from_key(s.agent_key)

    reg_addr = Web3.to_checksum_address(registry_for(s.chain)["identity"])
    registry = w3.eth.contract(address=reg_addr, abi=IDENTITY_ABI)
    uri = _agent_uri()
    log.info("registering", registry=reg_addr, agent=acct.address, uriLen=len(uri))

    # Simulate to capture the agentId, then broadcast.
    agent_id = registry.functions.register(uri).call({"from": acct.address})
    tx = registry.functions.register(uri).build_transaction(
        {
            "from": acct.address,
            "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
            "chainId": s.chain_id,
            "gas": 600_000,
        }
    )
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    rcpt = w3.eth.wait_for_transaction_receipt(h)
    assert rcpt["status"] == 1, f"register failed: {h.hex()}"

    # 8004scan uses /agents/<chainName>/<agentId> (chain NAME, not chainId).
    scan_chain = {"mainnet": "celo", "sepolia": "celo-sepolia"}.get(s.chain, s.chain)
    out = {
        "chain": s.chain,
        "identityRegistry": reg_addr,
        "agentId": int(agent_id),
        "agentWallet": acct.address,
        "tx": h.hex(),
        "explorer8004": f"https://8004scan.io/agents/{scan_chain}/{int(agent_id)}",
        "explorerTx": f"{s.explorer}/tx/0x{h.hex().removeprefix('0x')}",
    }
    (REPO_ROOT / "config" / f"agent-id.{s.chain}.json").write_text(
        json.dumps(out, indent=2), encoding="utf-8"
    )
    log.info("registered", **out)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
