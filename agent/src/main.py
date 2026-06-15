"""AjoAI agent CLI.

  python -m src.main status [CIRCLE]      # perceive + print a circle snapshot
  python -m src.main run-once [CIRCLE]     # one perceive->reason->act->settle pass
  python -m src.main run [CIRCLE]          # scheduled loop (idempotent), one circle
  python -m src.main serve-all             # one sweep over EVERY factory circle
  python -m src.main run-all [SECONDS]     # scheduled sweep over every factory circle
  python -m src.main info                  # config + connectivity check

CIRCLE defaults to deployments.demoCircle in config/addresses.<chain>.json.
serve-all / run-all service every circle the factory deployed (each bakes our agent key),
so a circle created from the MiniPay app rotates autonomously without being named explicitly.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta

from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.schedulers.blocking import BlockingScheduler

from .chain import ChainClient
from .config import load_settings
from .logs import configure, get_logger
from .loop import Agent, decide


def _circle_arg(settings, argv) -> str:
    if len(argv) >= 3:
        return argv[2]
    if settings.demo_circle:
        return settings.demo_circle
    raise SystemExit("no circle address given and no demoCircle in config")


# Warn loudly before the agent runs out of gas (it pays gas in native CELO; top up the agent
# account). Threshold ~0.05 CELO — a few dozen triggers of headroom.
LOW_GAS_WEI = 50_000_000_000_000_000  # 0.05 CELO


def _sweep(agent, chain, log) -> None:
    """One pass over every factory circle: start full-Forming ones, trigger Active ones, skip
    terminal. Idempotent — each run_once re-reads chain state before acting (CLAUDE.md §8)."""
    bal = chain.gas_balance_wei()
    if bal < LOW_GAS_WEI:
        log.warning(
            "low_gas",
            agent=chain.address,
            balanceCELO=bal / 1e18,
            detail="top up the agent account with CELO or the agent cannot trigger payouts",
        )
    circles = chain.all_circles()
    log.info("serve_all_sweep", count=len(circles), gasBalanceCELO=round(bal / 1e18, 4))
    for addr in circles:
        try:
            v = chain.view_circle(addr)
            if v.state >= 2:  # Completed/Defaulted/Dissolved — nothing to do
                continue
            results = agent.run_once(addr)
            if results:
                log.info("serviced", circle=addr, state=v.state_name, results=results)
        except Exception as e:  # noqa: BLE001 — never let one circle stall the sweep
            log.warning("serve_all_error", circle=addr, error=str(e))


def _demo_rotation(chain, log) -> None:
    """Operate one full self-funded circle end to end (real USD₮, recovered each cycle; only CELO
    gas is spent). Runs on the SAME single worker thread as the sweep, so the two never send txs
    concurrently on the shared agent key. Any failure is logged, never fatal."""
    if chain.gas_balance_wei() < LOW_GAS_WEI:
        log.warning("demo_rotation_skip_low_gas", balanceCELO=round(chain.gas_balance_wei() / 1e18, 4))
        return
    try:
        from scripts.mainnet_seed import seed_once
        log.info("demo_rotation_start")
        summary = seed_once(log=log)
        log.info("demo_rotation_done", circle=summary.get("circle"), reconcile=summary.get("reconcile"))
    except Exception as e:  # noqa: BLE001 — a failed rotation must never crash the worker
        log.warning("demo_rotation_error", error=str(e))


def _schedule_demo_rotation(sched, settings, chain, log) -> None:
    """If enabled (mainnet + AJOAI_DEMO_ROTATION_HOURS > 0), run one live demonstration rotation
    every N hours so the agent's autonomous behaviour is continuously exercised, not only when an
    external circle happens to exist."""
    hours = float(os.getenv("AJOAI_DEMO_ROTATION_HOURS", "0"))
    if hours <= 0 or settings.chain != "mainnet":
        return
    log.info("demo_rotation_enabled", everyHours=hours)
    sched.add_job(
        lambda: _demo_rotation(chain, log),
        "interval",
        hours=hours,
        id="ajoai-demo-rotation",
        max_instances=1,
        coalesce=True,
        # Fire even if the single worker thread is briefly busy with a sweep at the scheduled
        # instant (APScheduler's default 1s grace would otherwise drop the run).
        misfire_grace_time=3600,
        next_run_time=datetime.now() + timedelta(seconds=90),
    )


def main() -> None:
    settings = load_settings()
    configure(settings.log_level)
    log = get_logger("ajoai.cli")
    chain = ChainClient(settings)

    cmd = sys.argv[1] if len(sys.argv) > 1 else "info"

    if cmd == "info":
        log.info(
            "info",
            chain=settings.chain,
            chainId=settings.chain_id,
            connected=chain.connected(),
            agent=chain.address,
            factory=settings.factory,
            reputation=settings.reputation_ledger,
            demoCircle=settings.demo_circle,
            simulate_self=settings.simulate_self,
            simulate_yield=settings.simulate_yield,
        )
        return

    if cmd == "serve-all":
        _sweep(Agent(settings, chain), chain, log)
        return

    if cmd == "run-all":
        interval = int(sys.argv[2]) if len(sys.argv) > 2 else 30
        agent = Agent(settings, chain)
        log.info("serve_all_start", intervalSeconds=interval, factory=settings.factory)
        # One worker thread so every job serialises and never sends two txs concurrently on the
        # shared agent key (nonce-safe). All jobs are single-instance.
        sched = BlockingScheduler(executors={"default": ThreadPoolExecutor(1)})
        sched.add_job(
            lambda: _sweep(agent, chain, log),
            "interval",
            seconds=interval,
            id="ajoai-serve-all",
            max_instances=1,
            coalesce=True,
        )
        _schedule_demo_rotation(sched, settings, chain, log)
        try:
            sched.start()
        except (KeyboardInterrupt, SystemExit):
            log.info("scheduler_stop")
        return

    addr = _circle_arg(settings, sys.argv)

    if cmd == "status":
        v = chain.view_circle(addr)
        now = chain.now()
        log.info(
            "status",
            circle=v.address,
            state=v.state_name,
            round=f"{v.current_round}/{v.slots}",
            roundsPaid=v.rounds_paid,
            intendedPot=str(v.intended_pot),
            penaltyPool=str(v.penalty_pool),
            parked=str(v.parked),
            members=len(v.members),
            recipient=v.recipient,
            recipientDelinquent=v.recipient_delinquent,
            plannedActions=[d.action for d in decide(v, now)],
        )
        return

    agent = Agent(settings, chain)

    if cmd == "run-once":
        results = agent.run_once(addr)
        log.info("run_once_done", circle=addr, results=results)
        return

    if cmd == "run":
        interval = int(sys.argv[3]) if len(sys.argv) > 3 else 30
        log.info("scheduler_start", circle=addr, intervalSeconds=interval)
        sched = BlockingScheduler()
        sched.add_job(
            lambda: agent.run_once(addr),
            "interval",
            seconds=interval,
            id="ajoai-loop",
            max_instances=1,
            coalesce=True,
        )
        try:
            sched.start()
        except (KeyboardInterrupt, SystemExit):
            log.info("scheduler_stop")
        return

    raise SystemExit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main()
