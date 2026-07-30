"""Agent-card validation (no network, no key).

The validator is what makes the on-chain step safe to run unattended: setAgentURI costs a tx and
a bad card cannot be un-published, only re-published. So the shipped card must stay publishable and
every constraint must actually reject.
"""

import json
import sys
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.register_agent import (  # noqa: E402
    CARD_SERVED,
    CARD_SRC,
    MAX_CARD_BYTES,
    validate_card,
)


def _card() -> dict:
    return json.loads(CARD_SRC.read_text(encoding="utf-8"))


def _errors(mutate) -> list[str]:
    card = deepcopy(_card())
    mutate(card)
    return validate_card(card)


def _service(card: dict, name: str) -> dict:
    return next(s for s in card["services"] if s["name"] == name)


# --- the shipped card ------------------------------------------------------------------------


def test_shipped_card_is_publishable():
    assert validate_card(_card()) == []


def test_shipped_card_is_well_under_the_size_cap():
    body = {k: v for k, v in _card().items() if k != "_note"}
    assert len(json.dumps(body, ensure_ascii=False).encode()) < MAX_CARD_BYTES


def test_served_copy_matches_canonical_except_the_internal_note():
    src = _card()
    served = json.loads(CARD_SERVED.read_text(encoding="utf-8"))
    assert "_note" in src and "_note" not in served
    assert {k: v for k, v in src.items() if k != "_note"} == served


def test_registrations_point_at_the_existing_agent_ids():
    # A mint would create a second agent; these ids are the ones with the reputation history.
    ids = {r["agentId"] for r in _card()["registrations"]}
    assert ids == {9339, 307}


# --- constraints that must reject ---------------------------------------------------------------


def test_rejects_more_than_seven_services():
    errs = _errors(lambda c: c["services"].append({"name": "extra", "endpoint": "https://example.com"}))
    assert any("services must be 1..7" in e for e in errs)


def test_rejects_duplicate_service_names():
    # Indexers key services by name, so a duplicate silently drops one of them.
    def mutate(c):
        c["services"] = c["services"][:6]
        c["services"].append({"name": "web", "endpoint": "https://ajo-ai-tan.vercel.app"})

    assert any("duplicate service names" in e for e in _errors(mutate))


def test_rejects_short_description():
    assert any("description must be" in e for e in _errors(lambda c: c.__setitem__("description", "too short")))


def test_rejects_non_https_and_private_endpoints():
    assert any("must be https" in e for e in _errors(lambda c: _service(c, "web").__setitem__("endpoint", "http://x.co/a")))
    assert any("private/loopback" in e for e in _errors(lambda c: _service(c, "web").__setitem__("endpoint", "https://localhost:3000/a")))
    assert any("credentials" in e for e in _errors(lambda c: _service(c, "web").__setitem__("endpoint", "https://u:p@x.co/a")))


def test_rejects_malformed_price():
    assert any("price" in e for e in _errors(lambda c: _service(c, "web").__setitem__("price", "0.0500001")))
    assert any("price" in e for e in _errors(lambda c: _service(c, "web").__setitem__("price", "free")))
    assert any("must be > 0" in e for e in _errors(lambda c: _service(c, "web").__setitem__("price", "0")))


def test_rejects_wrong_shaped_protocol_versions():
    assert any("MCP version" in e for e in _errors(lambda c: _service(c, "MCP").__setitem__("version", "2025.06.18")))
    assert any("A2A version" in e for e in _errors(lambda c: _service(c, "A2A").__setitem__("version", "0.3")))


def test_rejects_oversized_or_empty_oasf():
    assert any("max 12" in e for e in _errors(lambda c: _service(c, "OASF").__setitem__("skills", ["a/b"] * 13)))
    assert any("max 8" in e for e in _errors(lambda c: _service(c, "OASF").__setitem__("domains", ["a/b"] * 9)))

    def empty(c):
        _service(c, "OASF")["skills"] = []
        _service(c, "OASF")["domains"] = []

    assert any("empty" in e for e in _errors(empty))


def test_rejects_non_slug_oasf_entries():
    assert any("OASF slug" in e for e in _errors(lambda c: _service(c, "OASF").__setitem__("domains", ["banking"])))


def test_rejects_unknown_categories_and_link_platforms():
    assert any("category" in e for e in _errors(lambda c: c.__setitem__("categories", ["finance"])))
    assert any("platform" in e for e in _errors(lambda c: c.__setitem__("external_links", [{"platform": "myspace", "url": "https://x.co"}])))


def test_rejects_advertising_x402_without_a_priced_service():
    # §1.9: never advertise behaviour the code does not enforce.
    def mutate(c):
        for s in c["services"]:
            s.pop("price", None)

    assert any("x402Support is true but no service declares a price" in e for e in _errors(mutate))


def test_rejects_non_url_image_and_cover():
    assert any("image must be" in e for e in _errors(lambda c: c.__setitem__("image", "/icon.png")))
    assert any("cover must be" in e for e in _errors(lambda c: c.__setitem__("cover", "cover.png")))
