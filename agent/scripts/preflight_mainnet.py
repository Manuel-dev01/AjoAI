"""Read-only mainnet pre-flight for the AjoAI Phase-6 seed (no broadcast).

Confirms the funded mainnet key's CELO balance and locates the real USDT token it holds by
probing candidate Celo USDT addresses on-chain (symbol/decimals/balanceOf) — we NEVER trust a
hardcoded token address or decimals (CLAUDE.md §1.5). Prints a budget calc for the seed circle.

Run:  CHAIN=mainnet agent/.venv/Scripts/python -m scripts.preflight_mainnet
"""

from __future__ import annotations

import sys
from pathlib import Path

from web3 import Web3

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import load_settings  # noqa: E402

ERC20_MIN_ABI = [
    {"type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
    {"type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint8"}]},
    {"type": "function", "name": "balanceOf", "stateMutability": "view", "inputs": [{"name": "a", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "name", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
]

# Candidate USDT representations on Celo mainnet — probed, not trusted.
CANDIDATES = [
    "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",  # Tether USD₮ native on Celo (expected, 6 dec)
    "0x617f3112bf5397D0467D315cC709EF968D9ba546",  # USDT.e (bridged, if present)
    "0x88eeC49252c8cbc039DCdB394c0c2BA2f1637EA0",  # alt bridged USDT (if present)
]


def main() -> None:
    s = load_settings()
    assert s.chain == "mainnet", f"run with CHAIN=mainnet (got {s.chain})"
    w3 = Web3(Web3.HTTPProvider(s.rpc_url))
    assert w3.is_connected(), "not connected to forno"
    agent = w3.eth.account.from_key(s.agent_key).address
    print(f"chain={s.chain} chainId={s.chain_id} connected={w3.is_connected()}")
    print(f"agent={agent}")

    celo_wei = w3.eth.get_balance(agent)
    print(f"CELO balance: {w3.from_wei(celo_wei, 'ether')} CELO")

    found = []
    for addr in CANDIDATES:
        try:
            caddr = Web3.to_checksum_address(addr)
            c = w3.eth.contract(address=caddr, abi=ERC20_MIN_ABI)
            sym = c.functions.symbol().call()
            dec = c.functions.decimals().call()
            bal = c.functions.balanceOf(agent).call()
            human = bal / (10**dec)
            print(f"  token {caddr}  symbol={sym}  decimals={dec}  balance={human}")
            if bal > 0:
                found.append((caddr, sym, dec, bal, human))
        except Exception as e:  # noqa: BLE001 — candidate may not be a token here
            print(f"  token {addr}  (no ERC20 / not found: {type(e).__name__})")

    if not found:
        print("\nNO USDT BALANCE FOUND on the probed candidates. Provide the exact token address.")
        return

    caddr, sym, dec, bal, human = found[0]
    print(f"\nUSING: {sym} @ {caddr} ({dec} decimals), balance {human}")
    # Budget for a 2-slot circle: each member pre-funded (N+1)*contribution; total N*(N+1)*c.
    n = 2
    # pick contribution so peak total <= 3.5 of the held token, rounded to a clean unit
    cap = 3.5
    raw_c = cap / (n * (n + 1))  # per-contribution ceiling in token units
    contribution = round(raw_c, 2)
    peak = n * (n + 1) * contribution
    print(f"seed plan: slots={n}, contribution={contribution} {sym}, peak_need={peak} {sym} (have {human})")
    print(f"contribution_smallest_unit={int(contribution * (10**dec))}")
    assert peak <= human, "budget exceeds balance — lower contribution"
    print("OK: budget fits.")


if __name__ == "__main__":
    main()
