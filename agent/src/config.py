"""Config loader for the AjoAI agent.

Reads .env + config/addresses.<chain>.json + ABIs from config/abi/. The agent NEVER
inlines an address or key (CLAUDE.md §1.5); everything comes from here.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# repo root = two levels up from this file (agent/src/config.py -> repo)
REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "config"
ABI_DIR = CONFIG_DIR / "abi"


def _truthy(v: str | None) -> bool:
    return str(v).strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    chain: str
    rpc_url: str
    chain_id: int
    explorer: str
    agent_key: str | None
    fee_currency: str
    llm_api_key: str | None
    simulate_yield: bool
    simulate_self: bool
    simulate_defaults: bool
    log_level: str
    addresses: dict = field(default_factory=dict)

    # ── convenience accessors ──
    @property
    def factory(self) -> str | None:
        return self.addresses.get("deployments", {}).get("circleFactory")

    @property
    def reputation_ledger(self) -> str | None:
        return self.addresses.get("deployments", {}).get("reputationLedger")

    @property
    def yield_adapter(self) -> str | None:
        return self.addresses.get("deployments", {}).get("yieldAdapter")

    @property
    def demo_circle(self) -> str | None:
        return self.addresses.get("deployments", {}).get("demoCircle")

    def token(self, symbol: str) -> str | None:
        return self.addresses.get("tokens", {}).get(symbol)


def load_settings() -> Settings:
    load_dotenv(REPO_ROOT / ".env")
    chain = os.getenv("CHAIN", "sepolia").strip()

    addr_path = CONFIG_DIR / f"addresses.{chain}.json"
    addresses = json.loads(addr_path.read_text(encoding="utf-8"))

    rpc_url = os.getenv("RPC_URL") or addresses.get("rpcUrl", "")
    return Settings(
        chain=chain,
        rpc_url=rpc_url,
        chain_id=int(addresses.get("chainId") or 0),
        explorer=addresses.get("explorer", ""),
        agent_key=os.getenv("AGENT_PRIVATE_KEY")
        if chain == "sepolia"
        else os.getenv("AGENT_PRIVATE_KEY_MAINNET"),
        fee_currency=os.getenv("FEE_CURRENCY", addresses.get("feeCurrencyDefault", "USDm")),
        llm_api_key=os.getenv("LLM_API_KEY"),
        simulate_yield=_truthy(os.getenv("SIMULATE_YIELD", "true")),
        simulate_self=_truthy(os.getenv("SIMULATE_SELF", "false")),
        simulate_defaults=_truthy(os.getenv("SIMULATE_DEFAULTS", "false")),
        log_level=os.getenv("LOG_LEVEL", "info"),
        addresses=addresses,
    )


def load_abi(name: str) -> list:
    """Load a contract ABI exported by Foundry to config/abi/<name>.json."""
    return json.loads((ABI_DIR / f"{name}.json").read_text(encoding="utf-8"))
