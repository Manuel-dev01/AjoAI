"""AjoAI agent CLI.

  python -m src.main status [CIRCLE]      # perceive + print a circle snapshot
  python -m src.main run-once [CIRCLE]     # one perceive->reason->act->settle pass
  python -m src.main run [CIRCLE]          # scheduled loop (idempotent), one circle
  python -m src.main serve-all             # one sweep over EVERY factory circle
  python -m src.main run-all [SECONDS]     # scheduled sweep over every factory circle
  python -m src.main info                  # config + connectivity check
  python -m src.main metrics [--json PATH] # on-chain metrics snapshot (socials + 8004scan)

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
from .metrics import MetricsCollector


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

    # Export an on-chain metrics snapshot to the miniapp's public dir. NOTE: in
    # production the agent (Render) and miniapp (Vercel) are SEPARATE deployments with
    # no shared filesystem, so this write only feeds a LOCAL/monorepo run — the deployed
    # /api/metrics reads live from chain. Harmless to keep; useful in dev (the route uses
    # this file only when its timestamp is fresh, else falls through to a live read).
    try:
        from .config import REPO_ROOT
        collector = MetricsCollector(agent.s)
        snap = collector.collect()
        payload = collector.frontend_payload(snap)
        out = REPO_ROOT / "miniapp" / "public" / "data" / "metrics.json"
        collector.export_json(snap, out, frontend=True)
        log.info("metrics_exported", path=str(out))
        # Push to the miniapp so the live /api/metrics snapshot (Vercel Blob) stays fresh —
        # the agent and miniapp are separate deployments, so an HTTP ingest is the bridge.
        _push_metrics(payload, log)
    except Exception as e:  # noqa: BLE001 — never let metrics stall the sweep
        log.warning("metrics_export_error", error=str(e))


# Consecutive metrics-push failures — so a SILENT ingest break (the exact failure that froze the
# dashboard Blob for days) escalates from a swallowed warning to a loud, counted error.
_push_fail_streak = 0
_PUSH_FAIL_LOUD_AT = 3


def _push_metrics(payload: dict, log) -> None:
    """Best-effort POST of the metrics snapshot to the miniapp's ingest endpoint. Never raises —
    but loudly surfaces misconfiguration and repeated failures so a frozen dashboard is noticed."""
    global _push_fail_streak
    url = os.getenv("AJOAI_METRICS_INGEST_URL")
    secret = os.getenv("CRON_SECRET")
    if not url or not secret:
        # Not a transient error — config is missing. The dashboard breakdown will silently freeze.
        log.warning(
            "metrics_push_disabled",
            detail="AJOAI_METRICS_INGEST_URL and/or CRON_SECRET unset — dashboard snapshot will not refresh",
            hasUrl=bool(url), hasSecret=bool(secret),
        )
        return
    try:
        import requests
        r = requests.post(
            url, json=payload, headers={"Authorization": f"Bearer {secret}"}, timeout=10
        )
        if 200 <= r.status_code < 300:
            # A 2xx with stored=false means auth passed but the Blob write was a no-op
            # (BLOB_READ_WRITE_TOKEN unset on Vercel) — the dashboard still freezes. Treat as failure.
            stored = None
            try:
                stored = r.json().get("stored")
            except Exception:  # noqa: BLE001 — body may not be JSON; fall through to "looks ok"
                pass
            if stored is False:
                _push_fail_streak += 1
                _log = log.error if _push_fail_streak >= _PUSH_FAIL_LOUD_AT else log.warning
                _log("metrics_push_not_stored", status=r.status_code, streak=_push_fail_streak,
                     detail="ingest returned 200 but did not persist — set BLOB_READ_WRITE_TOKEN on Vercel")
                return
            _push_fail_streak = 0
            log.info("metrics_pushed", status=r.status_code, stored=stored)
            return
        # A non-2xx (e.g. 401 secret mismatch) was previously logged as a "success" — treat as failure.
        _push_fail_streak += 1
        _log = log.error if _push_fail_streak >= _PUSH_FAIL_LOUD_AT else log.warning
        _log("metrics_push_rejected", status=r.status_code, streak=_push_fail_streak,
             body=r.text[:200])
    except Exception as e:  # noqa: BLE001 — the push is best-effort, but track the streak
        _push_fail_streak += 1
        _log = log.error if _push_fail_streak >= _PUSH_FAIL_LOUD_AT else log.warning
        _log("metrics_push_error", error=str(e), streak=_push_fail_streak)


def _demo_rotation(chain, log) -> None:
    """Operate one full self-funded circle end to end (real USD₮, recovered each cycle; only CELO
    gas is spent). Runs on the SAME single worker thread as the sweep, so the two never send txs
    concurrently on the shared agent key. Any failure is logged, never fatal."""
    # A full cycle funds each member's gas (GAS_TOPUP = 0.03 + 0.012*slots CELO) AND spends the
    # agent's own gas on create/start/contribute/payout/finalize. The old flat 0.05 CELO guard let
    # the agent START a ~0.6+ CELO cycle it couldn't finish — stranding half-formed "Forming 0/N"
    # circles and spamming insufficient-funds errors. Require enough for a WHOLE cycle (env-overridable).
    slots = int(os.getenv("AJOAI_DEMO_SLOTS", "4"))
    cycle_celo = (0.03 + 0.012 * slots) * slots + 0.35  # member top-ups + agent's own rotate/finalize gas
    min_gas_wei = int(float(os.getenv("AJOAI_DEMO_MIN_CELO", str(round(cycle_celo, 3)))) * 1e18)
    bal = chain.gas_balance_wei()
    if bal < min_gas_wei:
        log.warning(
            "demo_rotation_skip_low_gas",
            balanceCELO=round(bal / 1e18, 4),
            neededCELO=round(min_gas_wei / 1e18, 4),
            detail="top up the agent with CELO to resume demo rotations",
        )
        return
    try:
        from scripts.mainnet_seed import seed_once
        log.info("demo_rotation_start")
        summary = seed_once(log=log)
        if summary.get("skipped"):
            # e.g. low_usdt: the agent lacks the USD₮ to fund a fresh circle, so seed_once skipped
            # instead of stranding a half-formed circle. Top up the agent's USD₮ to resume.
            log.warning("demo_rotation_skipped", **{k: summary[k]
                        for k in ("skipped", "agentUsdt", "required", "symbol") if k in summary})
        else:
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


def _startup_recover(settings, log) -> None:
    """On a fresh container, sweep any residual USD₮/CELO from the previous cycle's persisted
    member wallets back to the agent and clear stale per-circle state, so a restart never strands
    funds or resumes a broken circle. Mainnet + demo-rotation only; best-effort, never blocks boot.
    Effective only when AJOAI_SEED_STATE points at a persistent volume (else the state is fresh)."""
    if settings.chain != "mainnet" or float(os.getenv("AJOAI_DEMO_ROTATION_HOURS", "0")) <= 0:
        return
    try:
        from scripts.mainnet_seed import Seeder
        sd = Seeder()
        sd.log = log
        swept = sd.recover_and_reset()
        if swept.get("txs"):
            log.info("startup_recover_done", usdtReturned=str(swept.get("usdt")))
    except Exception as e:  # noqa: BLE001 — recovery is best-effort, never block startup
        log.warning("startup_recover_error", error=str(e))


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

    if cmd == "metrics":
        collector = MetricsCollector(settings)
        log.info("metrics_start", chain=settings.chain, factory=settings.factory)
        snap = collector.collect()
        # Pretty-print to stdout
        print(f"\n{'='*50}")
        print(f"  AjoAI On-Chain Metrics — {snap.chain} (chainId {snap.chain_id})")
        print(f"{'='*50}")
        print(f"  Circles created:      {snap.circles_created}")
        print(f"    Active:             {snap.circles_active}")
        print(f"    Completed:          {snap.circles_completed}")
        print(f"    Defaulted:          {snap.circles_defaulted}")
        print(f"    Dissolved:          {snap.circles_dissolved}")
        print(f"    Forming:            {snap.circles_forming}")
        print(f"  Unique members:       {snap.unique_members}")
        print(f"  Contributions:        {snap.contribution_count} ({snap.late_contributions} late)")
        print(f"  Total contributed:    {snap.total_contributions_wei / 1e18:,.2f} tokens")
        print(f"  Payouts:              {snap.payout_count}")
        print(f"  Total distributed:    {snap.total_payouts_wei / 1e18:,.2f} tokens")
        print(f"  Defaults recovered:   {snap.defaults_triggered}")
        print(f"  Reputation signals:   {snap.reputation_signals} (+{snap.positive_signals} / -{snap.negative_signals})")
        print(f"  Yield deposits:       {snap.yield_deposits}")
        print(f"  Yield withdrawals:    {snap.yield_withdrawals}")
        print(f"  Agent tx count:       {snap.agent_tx_count}")
        print(f"{'='*50}\n")
        # Optional JSON export
        json_path = None
        for i, arg in enumerate(sys.argv):
            if arg == "--json" and i + 1 < len(sys.argv):
                json_path = sys.argv[i + 1]
        if json_path:
            collector.export_json(snap, json_path)
            log.info("metrics_exported", path=json_path)
        return

    if cmd == "serve-all":
        _sweep(Agent(settings, chain), chain, log)
        return

    if cmd == "run-all":
        # Interval: explicit arg wins, else env (AJOAI_SWEEP_SECONDS), else 120s. With many circles a
        # single sweep takes minutes, so a 30s tick just floods "max instances reached" skips — env-
        # tunable so the hosted cadence can be raised WITHOUT a rebuild.
        interval = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.getenv("AJOAI_SWEEP_SECONDS", "120"))
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
        _startup_recover(settings, log)
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
