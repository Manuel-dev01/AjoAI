"""ERC-8004 agent identity registration (CLAUDE.md §6, track #3: Highest 8004scan Rank).

Registers the AjoAI agent on the ERC-8004 **Identity Registry** (an ERC-721 of agent
identities) so it appears on 8004scan/AgentScan. The registration references an agent card
(name, capabilities, endpoints) hosted off-chain; the URI is stored on the NFT.

Celo has Identity + Reputation registries only (no Validation) — VERIFICATION.md §C. The
exact registry write ABI varies by deployment; we resolve it from the verified contract ABI
on Blockscout at call time and fall back to a documented manual path if the method differs.
This module NEVER moves circle funds — it only writes the agent's own identity.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict


@dataclass
class AgentCard:
    """ERC-8004 / A2A-style agent card (hosted at the registered URI)."""

    name: str = "AjoAI"
    description: str = (
        "Autonomous rotating-savings (ajo/esusu/chama/stokvel) agent on Celo. "
        "Onboards members, collects fixed contributions in Mento stables, rotates "
        "payouts on schedule, enforces defaults + ERC-8004 reputation, issues a "
        "portable savings-credit score."
    )
    version: str = "0.1.0"
    capabilities: tuple[str, ...] = (
        "rosca.create",
        "rosca.contribute",
        "rosca.payout",
        "rosca.reputation",
        "nl.query.en_pidgin_swahili",
    )
    endpoints: tuple[str, ...] = ()  # filled when the miniapp/x402 endpoints are live
    registrations: tuple[str, ...] = ()

    def to_json(self) -> str:
        d = asdict(self)
        d["capabilities"] = list(self.capabilities)
        d["endpoints"] = list(self.endpoints)
        d["registrations"] = list(self.registrations)
        d["type"] = "https://eips.ethereum.org/EIPS/eip-8004#agent-card"
        return json.dumps(d, indent=2)


# Identity Registry addresses (VERIFICATION.md §C). Reputation handled by ReputationLedger
# on-chain; Phase-3 bridge forwards its signals to the ERC-8004 Reputation Registry below.
ERC8004 = {
    "sepolia": {
        "identity": "0x8004A818BFB912233c491871b3d84c89A494BD9e",
        "reputation": "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    },
    "mainnet": {
        "identity": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        "reputation": "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    },
}


def registry_for(chain: str) -> dict:
    return ERC8004[chain]


# Candidate register signatures seen across ERC-8004 deployments — tried in order against the
# live registry's ABI. Recorded here so the on-chain write stays robust to deployment variance.
REGISTER_CANDIDATES = (
    "register(string)",  # (tokenURI) -> tokenId
    "register(address,string)",  # (agent, tokenURI)
    "mint(string)",
    "newAgent(string)",
)
