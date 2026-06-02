"""AjoAI agent CLI.

  python -m src.main status [CIRCLE]      # perceive + print a circle snapshot
  python -m src.main run-once [CIRCLE]     # one perceive->reason->act->settle pass
  python -m src.main run [CIRCLE]          # scheduled loop (idempotent)
  python -m src.main info                  # config + connectivity check

CIRCLE defaults to deployments.demoCircle in config/addresses.<chain>.json.
"""

from __future__ import annotations

import sys

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
