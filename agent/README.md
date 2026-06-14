# AjoAI Agent Runtime (Python)

The autonomous operator for AjoAI circles. **Non-custodial:** it only *triggers* the
legal state transitions the `Circle` contract allows and pays gas, it can never drain a
circle or pay an arbitrary address (CLAUDE.md §1). The contract is the source of truth;
the agent reads chain state and never trusts a cached view for a money decision.

## Loop
`perceive` (read chain) → `reason` (decide legal actions, rule-based, **never LLM**) →
`act` (submit txs) → `settle` (confirm + structured log). Every action emits a
`{circle, round, action, txHash, pillarServed}` line, the demo depends on action→txHash
links. The loop is idempotent: re-running re-checks chain state, so a retried payout is a
no-op (CLAUDE.md §1.8, §8).

`decide()` also manages idle pot funds around the yield adapter: it returns `park_idle`
when there's a spare token balance and nothing more urgent to do, and prepends
`withdraw_idle` ahead of `trigger_payout`/`finalize` whenever funds are parked (the
contract requires `parkedAmount == 0` for both, `MustWithdrawIdleFirst`).

## Setup
```bash
cd agent
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # (Scripts on Windows, bin on *nix)
```
Config is read from the repo `.env` + `config/addresses.<chain>.json` + `config/abi/`
(addresses are never inlined, CLAUDE.md §1.5).

## Commands
```bash
python -m src.main info                 # config + connectivity
python -m src.main status   [CIRCLE]    # perceive a circle + show planned actions
python -m src.main run-once [CIRCLE]    # one perceive→reason→act→settle pass
python -m src.main run      [CIRCLE] [INTERVAL_SECONDS]   # scheduled loop
```
`CIRCLE` defaults to `deployments.demoCircle` in the chain's address config.

## Tests
```bash
.venv/Scripts/python -m pytest tests/ -q
```
`tests/test_decide.py` covers the pure decision logic (no chain), it must match the
contract's enforced rules: the agent never plans an action the contract would reject.

## Money safety
- **LLM never moves money** (CLAUDE.md §1.3). The NL handler (Phase 4) only explains
  chain state; money actions come from `decide()`, which mirrors the contract guards.
  `src/nl.py` is the source of truth for this logic; `miniapp/lib/nl.ts` is a TypeScript
  port that powers the MiniPay app's **Ask** tab (`miniapp/app/app/api/ask/route.ts`),
  kept in sync by hand and cross-referenced in both files.
- **Gas in stablecoin** via CIP-64 `feeCurrency` is the target (CLAUDE.md §8); the agent
  holds no CELO in the steady state.
- **Loud simulation** (`SIMULATE_*` flags): simulated subsystems log a `SIMULATED` banner
 , never silently faked (CLAUDE.md §1.9).
