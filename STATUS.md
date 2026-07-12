# AjoAI Project Status

Last updated: 2026-07-12.

AjoAI is an autonomous rotating-savings (ajo / esusu / chama / stokvel) agent on Celo,
distributed as a MiniPay Mini App. The contract holds the money and enforces every rule; the
agent only triggers legal state transitions; the LLM is restricted to natural-language Q&A and
never moves funds.

## Live on Celo mainnet (chainId 42220)
All contracts are source-verified (Sourcify exact_match) on Celoscan. Three fixed singletons
below, plus the per-circle `Circle` escrow the factory deploys on every `createCircle`.

| Component | Address / value |
|---|---|
| CircleFactory | `0xeDEC01aCD4AA71F7c8751ac62Fe6cC18eFF82D70` |
| CircleFactory (pre-fix, orphaned) | `0xE2401Ab2ea9E4c68cBA9946e4079cd7eF4d82186` |
| ReputationLedger | `0xd2f340Fe1616aB5190F326A6f127f852F5C5Ed04` |
| YieldAdapter (SimulatedYieldAdapter, loud sim) | `0xF9293905e64c39C5856CE4Aa895ab7c80F62014d` |
| Circle (escrow, one per circle) | per-circle; proof instance `0x4D03D887c3bB293623A8aF842DB80B4680a5E11F` |
| Agent (baked into factory) | `0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7` |
| ERC-8004 agent identity | agentId 9339 (Identity Registry `0x8004A169…`), https://8004scan.io/agents/celo/9339 |

The `CircleFactory` was **redeployed 2026-07-07** (block 71485599) with the audited bug fixes to
`Circle.sol` (see "Contract hardening" below). It **reuses** the same `ReputationLedger`, yield adapter,
and agent key, so member savings-credit history and **agentId 9339 stay valid — no ERC-8004
re-registration**. The pre-fix factory's circles are immutable and remain on-chain (orphaned: the
re-pointed agent services only new-factory circles); the dashboard therefore counts from the new factory.

A real-money autonomous rotation has completed on mainnet: a 3-member circle in real Tether
USD₮ (6 decimals) where the agent triggered all three payouts and finalize. Circle
`0x4D03D887c3bB293623A8aF842DB80B4680a5E11F` finished Completed, roundsPaid 3, reconcile
in == out == 3.6 USD₮, every member scored 8. The seed funds were fully recovered (only CELO
gas was spent). Run report: `config/demo_run.mainnet.json`.

The agent runs as an always-on Railway worker (`run-all 30`, CHAIN=mainnet), sweeping the
mainnet factory every 30 seconds with no operator in the loop.

## Testnet (Celo Sepolia) — development only
The same contracts were validated end-to-end on Sepolia during development (a full 4-member
rotation, agentId 307) and the app's faucet flow uses mintable test tokens there. **Mainnet is the
canonical, shipped deployment** — all proof/addresses above are mainnet.

## Implementation
- Contracts (Foundry): `Circle`, `CircleFactory`, `ReputationLedger`, `SimulatedYieldAdapter`,
  interfaces and mocks. 29 tests pass: the worked example to the unit, adversarial cases
  (double-trigger, reentrancy on payout and yield, contribute-after-default,
  recipient-delinquent withhold and cure, recipient self-default is withheld not paid,
  force-default of a never-cured withheld round, default by an already-received member,
  `setYieldAdapter` organizer/Forming-only, rounding drift), and 3 invariants (value
  conservation, received == roundsPaid, delinquent recipient unpaid) at 256x8192 calls with 0 reverts.
- Agent (Python, web3.py): perceive, reason, act, settle loop with rule-based decisions
  (now including `park_idle`/`withdraw_idle` of idle pot funds around the yield adapter), an
  idempotent scheduler, structlog tx-hash-linked logs, ERC-8004 registration, a natural-language
  handler (English, Nigerian Pidgin, Swahili; LLM rephrasing via DeepSeek, falling back to a
  deterministic chain-derived answer when no key is set — which now states the terminal outcome
  for members of a Completed/Defaulted/Dissolved circle instead of projecting a stale future round),
  and a fund-safe mainnet seed runner. 30 tests pass.
- Frontend (Next.js, viem/wagmi): Market Blocks landing page plus the MiniPay app (home, create,
  join, state-aware circle dashboard, pay, activity, score, and an "Ask" tab for natural-language
  member Q&A backed by `/app/api/ask`, a TS port of the agent's NL layer). Injected auto-connect
  inside MiniPay, stablecoin gas via CIP-64, reversible invite codes, QR sharing, a portable
  savings-credit score share link/QR (`/app/score/[address]`), and a testnet faucet gate.

## Key design decisions
- Single Mento stablecoin per circle; period is a constructor parameter. Member count is bounded
  by `slots` (uint8), so member loops cannot be gas-griefed.
- Payout always makes the recipient whole: shortfalls are covered first from defaulters' deposits
  (auto-swept in `triggerPayout`), then from the penalty pool; if still uncoverable the circle
  moves to Defaulted with pro-rata distribution to members who have not yet received.
- A delinquent recipient has their payout withheld (not skipped) until they cure. Reputation
  writes are wrapped so they can never block a money path.
- The agent pays gas in native CELO (web3.py cannot sign Celo CIP-64); only the MiniPay frontend
  pays gas in a stablecoin. Idle-fund yield is principal-only on-chain: the agent loop's
  `decide()` parks idle pot balances with the yield adapter and recalls them (`withdraw_idle`)
  before any payout/finalize, with the yield rate simulated loudly at the agent layer.

## Deployed surfaces
- Frontend live in production at https://ajo-ai-tan.vercel.app (and `/app`), serving the mainnet
  agent card (agentId 9339), the state-aware circle dashboard, the "Ask" tab (DeepSeek-backed,
  EN/Pidgin/Swahili), the portable score share page, and a read-only **MCP server** at `/api/mcp`
  (get_circle / get_score / ask / list_circles) for agent interop.
- Hosted agent live as an always-on Railway worker (`run-all 30`, CHAIN=mainnet), sweeping the
  mainnet factory every 30 seconds, including autonomous idle-fund `park_idle`/`withdraw_idle`.
- **Demo video:** https://youtube.com/shorts/YYtcAh31yNA.

## 8004scan agent page (2026-06-15)
The ERC-8004 card (served at the registered `tokenURI`) was brought to the registration-v1 schema and
re-indexed: typed `services` (web/A2A/MCP/DID/email; MCP lists its real `mcpTools`), `registrations`
using the canonical `agentRegistry` CAIP form (clears 8004scan WA012), a resolvable **PNG logo**
(`/icon.png`, the RingMark), and a live `provider` URL. Re-crawls were nudged via `setAgentURI(9339)`.
A2A + MCP report healthy; email/DID are identifiers (not health-probed by design).

## Frontend UX hardening (2026-06-15)
- Circle dashboard is now window-aware: it reads the contract's `windowClose`/`graceClose` and gates
  the Pay tab — within the window "Pay", in grace "Pay · late", past grace it stops offering Pay (which
  would revert `PastGrace`) and explains the deposit-cover instead. Member rows show recipient marker +
  live Paid/Due/Late, and poll so a payment flips Due→Paid on screen.
- The delinquency banner is split: a *non-recipient* miss keeps "We've got this round" (the agent
  auto-covers from the deposit and continues); a *delinquent recipient* now reads "Payout paused —
  waiting for … to restore their deposit" and exposes a **cure()** CTA (`CureButton`) — the human
  unblock for the deliberate recipient-withheld case.
- Mainnet currency flow: circles default to USDm (the only MiniPay gas currency, 1:1 Pockets-swappable
  from USDT/USDC); a `ConvertPanel` replaces the old "you need X" dead-end — Pockets guidance for the
  stable trio, and an in-app **Mento Broker** swap USDm→NGNm for the FX leg (Broker
  `0x777A8255cA72412f0d706dc03C9D1987306B4CaD`, verified USDm/NGNm exchange + quote). A `GasHint` nudges
  topping up USDm for gas. Frontend writes now pass explicit gas limits to dodge Celo's flaky
  `eth_estimateGas`, and revert reasons map to human copy (`friendlyTxError`).

## Stats, dashboard & metrics architecture (2026-06-18)
- **`/api/metrics` is snapshot-first and O(1)** (survives unbounded circle growth from the hourly
  rotation). It serves the freshest **snapshot** (Vercel Blob → committed `public/data/metrics.json`,
  imported at build time so it's always bundled) and overlays only two cheap live numbers
  (`agentTxCount`, `circlesCreated`); every path is deadline-bounded, so it can never hang (the old
  per-circle live enumeration caused 25s client timeouts). Shared logic in `miniapp/lib/metrics.ts`.
- **Snapshot freshness:** the agent POSTs the full snapshot to `/api/metrics/refresh` each sweep
  (`AJOAI_METRICS_INGEST_URL` + `CRON_SECRET`, authenticated) — the agent (Railway) and miniapp
  (Vercel) are separate deployments, so HTTP ingest is the bridge. A **daily** Vercel cron is a backstop.
- **Public dashboard** `/dashboard` (no wallet): global metrics + **recharts** (states donut, activity
  bars, reputation split), themed to Market Blocks. Linked from the landing hero/nav.
- **Personal stats** `/app/stats`: a connected wallet's cumulative stats across circles it created
  **or** joined (`useMyStats` reuses `useMyCircles`).
- **Deploy gotcha (learned):** Vercel **Hobby allows only DAILY crons** — a `*/15` schedule in
  `vercel.json` makes Vercel **reject every deployment**. Keep `crons` at `0 0 * * *` (or Pro for
  finer). This silently blocked all deploys for hours once.

## Yield & idle-funds hardening (2026-06-18)
- Realistic capital-efficiency framing: AjoAI parks the idle pot between payouts at a **5% simulated
  APY** (`SIM_APY_BPS=500` in `miniapp/lib/yield.ts`, mirrored `SIM_YIELD_APY_BPS` in
  `agent/src/config.py`) — the Aave V3 Celo stablecoin midpoint, loud-simulated. **Per-circle APY +
  projected yield** card on the circle page (reads `parkedAmount`/`period`/`windowClose`), and a
  "Capital efficiency — idle-fund yield" section on the dashboard. Demo can exercise real park/withdraw
  via `AJOAI_SEED_PARK=true` (off by default). No contract change / no redeploy.
- **Roadmap (needs a mainnet redeploy, deferred):** real `AaveYieldAdapter` (Aave V3 Celo) with
  time-based accrual; a protocol **Treasury Reserve** (10–20% yield split) — both require new contracts.

## Contract hardening (2026-07-07 redeploy — fixes two audited money-path bugs)
A double-verified audit surfaced two HIGH `Circle.sol` bugs; both are fixed in the redeployed factory
(`0xeDEC01aC…82D70`), reusing the existing ledger + adapter + agent key:
- **#1 — self-defaulting recipient mis-paid.** Previously `triggerPayout` could pay a recipient who
  missed their **own** round out of their own just-forfeited deposit. Now, after `_coverRound`, a
  delinquent recipient is **withheld** (`_withhold` stamps `withheldSince`, emits `PayoutWithheld`) and
  never paid — matching the "withhold, don't skip" rule (CLAUDE.md §4).
- **#2 — never-cured withheld round froze the circle** (this was the former "known gap"). Added an
  immutable `withholdTimeout = 2·(period + graceWindow)` and `forceDefaultUncured()` (`onlyAgent`,
  Active, `parkedAmount == 0`): once the timeout elapses on an uncured withheld round, the agent routes
  the circle to `Defaulted` and the existing `_defaultSettle()` distributes remaining funds + deposits
  pro-rata to members who have not yet received. Funds can no longer freeze indefinitely; the `cure()`
  CTA remains the human fast-path before the timeout.
- **LOW — `setYieldAdapter(address) onlyOrganizer inState(Forming)`** added, making the "settable
  pre-start" adapter comment true (was previously constructor-only).

The agent loop (`decide()`) now stamps the withhold timer via a safe no-pay `triggerPayout`, waits
through the timeout, then `force_default`s an uncured round (the earlier no-redeploy mitigation was
reverted — the fixed contract is self-safe). Covered by new adversarial + invariant tests.

## Submission
- **Published** via the Celo Builders Skill (`celo-onchain-agents`) for all three tracks
  (best-agent, most-activity, 8004scan-rank), with the live demo URL, mainnet contract addresses,
  the registration tweet as `socialLink`, and the **demo video** (`videoUrl`).
- Registration tweet posted (quote-tweet @CeloDevs / @Celo with the ERC-8004 link).

## Remaining (optional / post-deadline)
1. Self Agent ID: the registration session is bootstrapped programmatically; the human passport
   scan is pending (blocked on Self ID verification; region screenshot is the documented fallback).
   `python -m scripts.self_poll` completes it once scanned.
2. Self proof-of-personhood live gating: the on-chain `ISelfVerifier` hook is in OPEN mode (one
   wallet, one slot enforced via `usedHuman`); wiring a live Self verifier is roadmap.
