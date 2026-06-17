# AjoAI Project Status

Last updated: 2026-06-15.

AjoAI is an autonomous rotating-savings (ajo / esusu / chama / stokvel) agent on Celo,
distributed as a MiniPay Mini App. The contract holds the money and enforces every rule; the
agent only triggers legal state transitions; the LLM is restricted to natural-language Q&A and
never moves funds.

## Live on Celo mainnet (chainId 42220)
All contracts are source-verified (Sourcify exact_match) on Celoscan. Three fixed singletons
below, plus the per-circle `Circle` escrow the factory deploys on every `createCircle`.

| Component | Address / value |
|---|---|
| CircleFactory | `0xE2401Ab2ea9E4c68cBA9946e4079cd7eF4d82186` |
| ReputationLedger | `0xd2f340Fe1616aB5190F326A6f127f852F5C5Ed04` |
| YieldAdapter (SimulatedYieldAdapter, loud sim) | `0xF9293905e64c39C5856CE4Aa895ab7c80F62014d` |
| Circle (escrow, one per circle) | per-circle; proof instance `0x4D03D887c3bB293623A8aF842DB80B4680a5E11F` |
| Agent (baked into factory) | `0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7` |
| ERC-8004 agent identity | agentId 9339 (Identity Registry `0x8004A169…`), https://8004scan.io/agents/celo/9339 |

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
  interfaces and mocks. 25 tests pass: the worked example to the unit, adversarial cases
  (double-trigger, reentrancy on payout and yield, contribute-after-default,
  recipient-delinquent withhold and cure, default by an already-received member, rounding
  drift), and 3 invariants (value conservation, received == roundsPaid, delinquent recipient
  unpaid) at 256x8192 calls with 0 reverts.
- Agent (Python, web3.py): perceive, reason, act, settle loop with rule-based decisions
  (now including `park_idle`/`withdraw_idle` of idle pot funds around the yield adapter), an
  idempotent scheduler, structlog tx-hash-linked logs, ERC-8004 registration, a natural-language
  handler (English, Nigerian Pidgin, Swahili; LLM rephrasing via DeepSeek, falling back to a
  deterministic chain-derived answer when no key is set), and a fund-safe mainnet seed runner.
  18 tests pass.
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

## Known gap (future contract work)
- A delinquent recipient who never cures **freezes the circle**: `triggerPayout` withholds and the agent
  waits indefinitely — there is no on-chain path to skip the slot and redistribute without `cure()`.
  Resolving it autonomously needs a `Circle.sol` change + mainnet redeploy (e.g. a "force-default a
  long-withheld round" trigger). The cure CTA is the near-term unblock.

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
