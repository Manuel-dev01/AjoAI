"""Register / update the AjoAI agent on the ERC-8004 Identity Registry.

The registry (`AgentIdentity`, symbol AGENT) is an ERC-721: `register()` mints an agent NFT to the
agent wallet and `setAgentURI()` re-points its tokenURI. That registry is also what the AIGORA
marketplace and 8004scan index — neither runs its own registry — so listing the agent is exactly
"publish a good card + point the tokenURI at it", with no web form and no second mint.

agentURI: a hosted HTTPS pointer to the agent card, served by the miniapp at
/.well-known/agent-card.json. Override with AJOAI_AGENT_URI. IPFS is not required — the registry
and both indexers accept https: and data: URIs.

Run (from agent/):
  ...python -m scripts.register_agent --validate            # card lint + sync, no network
  ...python -m scripts.register_agent --verify              # on-chain URI vs served card
  ...python -m scripts.register_agent --update-uri [URI]    # re-point + force a re-crawl
  ...python -m scripts.register_agent                       # mint (guarded; --force to override)
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

from web3 import Web3

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import REPO_ROOT, load_settings  # noqa: E402
from src.identity import registry_for  # noqa: E402
from src.logs import configure, get_logger  # noqa: E402

# Minimal ABI: register(string)->uint256 + setAgentURI + tokenURI (per Blockscout-verified registry).
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
        "name": "setAgentURI",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "agentId", "type": "uint256"},
            {"name": "newURI", "type": "string"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "tokenURI",
        "stateMutability": "view",
        "inputs": [{"name": "tokenId", "type": "uint256"}],
        "outputs": [{"name": "", "type": "string"}],
    },
]

CARD_SRC = REPO_ROOT / "config" / "agent-card.json"
CARD_SERVED = REPO_ROOT / "miniapp" / "public" / ".well-known" / "agent-card.json"


# ---------------------------------------------------------------------------------------------
# Card validation
#
# These limits are AIGORA's own serializer/validator constants. A card that breaks one still mints
# fine but cannot round-trip through AIGORA's editor and may render wrong, so we check BEFORE
# spending a transaction rather than discovering it on the listing page.
# ---------------------------------------------------------------------------------------------
MAX_CARD_BYTES = 32_768
MAX_NAME = 64
DESC_MIN, DESC_MAX = 50, 1024
MAX_SERVICES = 7
MAX_OASF_SKILLS, MAX_OASF_DOMAINS = 12, 8
MAX_CATEGORIES, MAX_LINKS = 8, 8
MAX_VERSION_LEN = 32
MAX_ENDPOINT_LEN = 2048

PRICE_RE = re.compile(r"^\d+(\.\d{1,6})?$")
MCP_VERSION_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
A2A_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+")
CATEGORIES = {"code", "design", "content", "data", "research", "automation", "trading", "hackathon"}
LINK_PLATFORMS = {"website", "x", "github", "youtube", "discord", "telegram", "linkedin", "farcaster"}
PRIVATE_HOST_RE = re.compile(
    r"^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|.*\.local)", re.I
)


def _check_endpoint(ep: str, where: str, errors: list[str]) -> None:
    if len(ep) > MAX_ENDPOINT_LEN:
        errors.append(f"{where}: endpoint longer than {MAX_ENDPOINT_LEN} chars")
    if not ep.lower().startswith(("http://", "https://")):
        return  # did: / email / other identifier endpoints are not URLs
    if ep.lower().startswith("http://"):
        errors.append(f"{where}: endpoint must be https, got http")
    host = ep.split("://", 1)[1].split("/", 1)[0]
    if "@" in host:
        errors.append(f"{where}: endpoint must not embed credentials")
    if PRIVATE_HOST_RE.match(host):
        errors.append(f"{where}: endpoint host {host!r} is private/loopback and unreachable by indexers")


def validate_card(card: dict) -> list[str]:
    """Return a list of problems; empty means the card is publishable."""
    errors: list[str] = []
    body = {k: v for k, v in card.items() if k != "_note"}

    size = len(json.dumps(body, ensure_ascii=False).encode("utf-8"))
    if size > MAX_CARD_BYTES:
        errors.append(f"card is {size} bytes, over the {MAX_CARD_BYTES} limit")

    name = body.get("name", "")
    if not name or len(name) > MAX_NAME:
        errors.append(f"name must be 1..{MAX_NAME} chars, got {len(name)}")

    desc = body.get("description", "")
    if not (DESC_MIN <= len(desc) <= DESC_MAX):
        errors.append(f"description must be {DESC_MIN}..{DESC_MAX} chars, got {len(desc)}")

    for key in ("image", "cover"):
        val = body.get(key)
        if val is not None and not str(val).startswith(("https://", "ipfs://")):
            errors.append(f"{key} must be an https:// or ipfs:// URL")

    services = body.get("services", [])
    if not 1 <= len(services) <= MAX_SERVICES:
        errors.append(f"services must be 1..{MAX_SERVICES}, got {len(services)}")
    names = [s.get("name") for s in services]
    if len(names) != len(set(names)):
        errors.append(f"duplicate service names {names} — indexers key services by name and will drop one")

    for s in services:
        n = s.get("name", "?")
        where = f"service {n!r}"
        if not s.get("endpoint"):
            errors.append(f"{where}: missing endpoint")
        else:
            _check_endpoint(str(s["endpoint"]), where, errors)

        version = s.get("version")
        if version is not None and len(str(version)) > MAX_VERSION_LEN:
            errors.append(f"{where}: version longer than {MAX_VERSION_LEN} chars")
        if n == "MCP" and version and not MCP_VERSION_RE.match(str(version)):
            errors.append(f"{where}: MCP version must be YYYY-MM-DD, got {version!r}")
        if n == "A2A" and version and not A2A_VERSION_RE.match(str(version)):
            errors.append(f"{where}: A2A version must be semver, got {version!r}")

        if "price" in s:
            price = str(s["price"])
            if not PRICE_RE.match(price):
                errors.append(f"{where}: price {price!r} must match ^\\d+(\\.\\d{{1,6}})?$")
            elif float(price) <= 0:
                errors.append(f"{where}: price must be > 0 or omitted entirely")

        if n == "OASF":
            skills, domains = s.get("skills", []), s.get("domains", [])
            if len(skills) > MAX_OASF_SKILLS:
                errors.append(f"{where}: {len(skills)} skills, max {MAX_OASF_SKILLS}")
            if len(domains) > MAX_OASF_DOMAINS:
                errors.append(f"{where}: {len(domains)} domains, max {MAX_OASF_DOMAINS}")
            if not skills and not domains:
                errors.append(f"{where}: entry is empty — omit it rather than declaring nothing")
            for slug in [*skills, *domains]:
                if not isinstance(slug, str) or "/" not in slug:
                    errors.append(f"{where}: {slug!r} is not a slash-delimited OASF slug")

    cats = body.get("categories", [])
    if len(cats) > MAX_CATEGORIES:
        errors.append(f"categories must be <= {MAX_CATEGORIES}, got {len(cats)}")
    for c in cats:
        if c not in CATEGORIES:
            errors.append(f"category {c!r} is not one of {sorted(CATEGORIES)}")

    links = body.get("external_links", [])
    if len(links) > MAX_LINKS:
        errors.append(f"external_links must be <= {MAX_LINKS}, got {len(links)}")
    for link in links:
        if link.get("platform") not in LINK_PLATFORMS:
            errors.append(f"link platform {link.get('platform')!r} is not one of {sorted(LINK_PLATFORMS)}")
        _check_endpoint(str(link.get("url", "")), f"link {link.get('platform')!r}", errors)

    # x402Support must not be advertised without a priced service actually enforcing payment (§1.9).
    priced = [s for s in services if "price" in s]
    if body.get("x402Support") and not priced:
        errors.append("x402Support is true but no service declares a price")

    return errors


def sync_served_copy() -> bool:
    """Mirror config/agent-card.json into the miniapp, minus the internal _note. True if changed."""
    card = json.loads(CARD_SRC.read_text(encoding="utf-8"))
    served = {k: v for k, v in card.items() if k != "_note"}
    text = json.dumps(served, indent=2, ensure_ascii=False) + "\n"
    before = CARD_SERVED.read_text(encoding="utf-8") if CARD_SERVED.exists() else None
    if before == text:
        return False
    CARD_SERVED.parent.mkdir(parents=True, exist_ok=True)
    CARD_SERVED.write_text(text, encoding="utf-8", newline="\n")
    return True


def validate(strict: bool = True) -> dict:
    """Lint the card and keep the served copy in sync. Exits non-zero on any problem."""
    card = json.loads(CARD_SRC.read_text(encoding="utf-8"))
    errors = validate_card(card)
    changed = sync_served_copy()
    out = {
        "card": str(CARD_SRC.relative_to(REPO_ROOT)),
        "bytes": len(json.dumps({k: v for k, v in card.items() if k != "_note"}, ensure_ascii=False).encode()),
        "services": [s.get("name") for s in card.get("services", [])],
        "servedCopyRewritten": changed,
        "errors": errors,
    }
    print(json.dumps(out, indent=2))
    if errors and strict:
        raise SystemExit(f"{len(errors)} card problem(s) — refusing to publish.")
    return out


def _agent_uri() -> str:
    # Short hosted-URL pointer (the ERC-8004 norm) — cheap to store, and re-pointing it is what
    # nudges 8004scan/AIGORA to re-crawl. The card is served by the miniapp from
    # miniapp/public/.well-known/agent-card.json. Set AJOAI_AGENT_URI to override.
    return os.getenv("AJOAI_AGENT_URI", "https://ajo-ai-tan.vercel.app/.well-known/agent-card.json")


def _load_agent_id(chain: str) -> int | None:
    """Load the previously-minted agentId from config/agent-id.<chain>.json."""
    path = REPO_ROOT / "config" / f"agent-id.{chain}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text()).get("agentId")


def _write_agent_id(chain: str, record: dict) -> None:
    (REPO_ROOT / "config" / f"agent-id.{chain}.json").write_text(
        json.dumps(record, indent=2), encoding="utf-8"
    )


def _scan_chain(chain: str) -> str:
    # 8004scan uses /agents/<chainName>/<agentId> (chain NAME, not chainId).
    return {"mainnet": "celo", "sepolia": "celo-sepolia"}.get(chain, chain)


def _registry(w3: Web3, chain: str):
    addr = Web3.to_checksum_address(registry_for(chain)["identity"])
    return w3.eth.contract(address=addr, abi=IDENTITY_ABI), addr


def verify() -> None:
    """Read the on-chain URI, fetch it, and diff it against the local card.

    This is the check that catches a card edited but never deployed — the failure mode where a
    setAgentURI nudge makes an indexer re-cache the OLD document.
    """
    s = load_settings()
    configure(s.log_level)
    log = get_logger("ajoai.register")
    w3 = Web3(Web3.HTTPProvider(s.rpc_url))
    agent_id = _load_agent_id(s.chain)
    if agent_id is None:
        raise SystemExit(f"No agentId in config/agent-id.{s.chain}.json.")

    registry, reg_addr = _registry(w3, s.chain)
    uri = registry.functions.tokenURI(agent_id).call()

    local = {k: v for k, v in json.loads(CARD_SRC.read_text(encoding="utf-8")).items() if k != "_note"}
    live: dict | None = None
    fetch_error = None
    if uri.startswith("http"):
        try:
            with urllib.request.urlopen(uri, timeout=20) as r:  # noqa: S310 - fixed, operator-supplied URI
                live = json.loads(r.read().decode("utf-8"))
        except Exception as exc:  # network/parse — reported, not raised
            fetch_error = str(exc)

    differing = sorted(
        k for k in set(local) | set(live or {}) if local.get(k) != (live or {}).get(k)
    ) if live is not None else []

    out = {
        "chain": s.chain,
        "agentId": agent_id,
        "identityRegistry": reg_addr,
        "tokenURI": uri,
        "fetched": live is not None,
        "fetchError": fetch_error,
        "inSync": live is not None and not differing,
        "differingKeys": differing,
        "explorer8004": f"https://8004scan.io/agents/{_scan_chain(s.chain)}/{agent_id}",
    }
    log.info("verified", **out)
    print(json.dumps(out, indent=2))
    if live is None:
        raise SystemExit(f"Could not fetch {uri}: {fetch_error}")
    if differing:
        raise SystemExit(
            f"Deployed card differs from config/agent-card.json in {differing}. "
            "Deploy the miniapp FROM THE REPO ROOT first — updating the URI now would re-cache the old card."
        )


def update_uri(new_uri: str | None = None) -> None:
    """setAgentURI on the Identity Registry: re-point the card and force indexers to re-crawl.

    Needed whenever the card changes. The agent wallet must own the NFT.
    """
    validate()

    s = load_settings()
    configure(s.log_level)
    log = get_logger("ajoai.register")
    w3 = Web3(Web3.HTTPProvider(s.rpc_url))
    acct = w3.eth.account.from_key(s.agent_key)

    agent_id = _load_agent_id(s.chain)
    if agent_id is None:
        raise SystemExit(
            f"No agentId found in config/agent-id.{s.chain}.json. "
            "Run register_agent first to mint an agent identity."
        )

    uri = new_uri or _agent_uri()
    registry, reg_addr = _registry(w3, s.chain)

    try:
        current_uri = registry.functions.tokenURI(agent_id).call()
        log.info("current_uri", agentId=agent_id, uri=current_uri)
    except Exception:
        current_uri = "(could not read)"

    log.info("updating_uri", registry=reg_addr, agentId=agent_id, newUri=uri)

    tx = registry.functions.setAgentURI(agent_id, uri).build_transaction(
        {
            "from": acct.address,
            "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
            "chainId": s.chain_id,
            "gas": 300_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    rcpt = w3.eth.wait_for_transaction_receipt(h)
    assert rcpt["status"] == 1, f"setAgentURI failed: {h.hex()}"

    tx_hash = h.hex()
    out = {
        "chain": s.chain,
        "identityRegistry": reg_addr,
        "agentId": agent_id,
        "agentWallet": acct.address,
        "oldUri": current_uri,
        "newUri": uri,
        "tx": tx_hash,
        "explorer8004": f"https://8004scan.io/agents/{_scan_chain(s.chain)}/{agent_id}",
        "explorerTx": f"{s.explorer}/tx/0x{tx_hash.removeprefix('0x')}",
    }
    # Keep the recorded identity current — this used to drift because only the mint path wrote it.
    _write_agent_id(s.chain, {k: v for k, v in out.items() if k != "oldUri"})
    log.info("uri_updated", **out)
    print(json.dumps(out, indent=2))


def main() -> None:
    argv = sys.argv[1:]

    if "--validate" in argv:
        validate()
        return
    if "--verify" in argv:
        verify()
        return
    if "--update-uri" in argv:
        idx = argv.index("--update-uri")
        new_uri = argv[idx + 1] if idx + 1 < len(argv) and not argv[idx + 1].startswith("-") else None
        update_uri(new_uri)
        return

    validate()

    s = load_settings()
    configure(s.log_level)
    log = get_logger("ajoai.register")

    # register() mints a NEW ERC-721 on every call, so an accidental re-run silently creates a
    # duplicate agent with zero reputation. Existing identity => refuse unless explicitly forced.
    existing = _load_agent_id(s.chain)
    if existing is not None and "--force" not in argv:
        raise SystemExit(
            f"agentId {existing} already registered on {s.chain} (config/agent-id.{s.chain}.json).\n"
            "To re-point its card at a new URI use --update-uri; that keeps the agent's reputation "
            "and feedback history. Pass --force only if you genuinely want a second agent NFT."
        )

    w3 = Web3(Web3.HTTPProvider(s.rpc_url))
    acct = w3.eth.account.from_key(s.agent_key)
    registry, reg_addr = _registry(w3, s.chain)
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
            "gasPrice": w3.eth.gas_price,
        }
    )
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    rcpt = w3.eth.wait_for_transaction_receipt(h)
    assert rcpt["status"] == 1, f"register failed: {h.hex()}"

    tx_hash = h.hex()
    out = {
        "chain": s.chain,
        "identityRegistry": reg_addr,
        "agentId": int(agent_id),
        "agentWallet": acct.address,
        "newUri": uri,
        "tx": tx_hash,
        "explorer8004": f"https://8004scan.io/agents/{_scan_chain(s.chain)}/{int(agent_id)}",
        "explorerTx": f"{s.explorer}/tx/0x{tx_hash.removeprefix('0x')}",
    }
    _write_agent_id(s.chain, out)
    log.info("registered", **out)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
