"""Structured logging for AjoAI (CLAUDE.md §8).

Every agent action logs {circle, round, action, txHash, pillarServed}. The demo depends
on action -> txHash links, so `action_log` is the canonical helper for that.
"""

from __future__ import annotations

import logging

import structlog

# The four judging pillars an action can serve (CLAUDE.md §0).
PILLARS = {
    "economic_agency",
    "onchain_integration",
    "real_world",
    "celo_infra",
}


def configure(level: str = "info") -> None:
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
    )


def get_logger(name: str = "ajoai"):
    return structlog.get_logger(name)


def action_log(
    log,
    *,
    circle: str,
    action: str,
    pillar: str,
    round_: int | None = None,
    tx_hash: str | None = None,
    **extra,
) -> None:
    """Canonical action->txHash log line the demo + judges read."""
    assert pillar in PILLARS, f"unknown pillar {pillar}"
    log.info(
        action,
        circle=circle,
        round=round_,
        action=action,
        txHash=tx_hash,
        pillarServed=pillar,
        **extra,
    )


# A loud banner for simulated subsystems (CLAUDE.md §1.9) — never silently fake.
def loud_sim(log, subsystem: str, detail: str) -> None:
    log.warning(
        "SIMULATED",
        subsystem=subsystem,
        detail=detail,
        notice=f"⚠️ {subsystem} is SIMULATED — not real on-chain value",
    )
