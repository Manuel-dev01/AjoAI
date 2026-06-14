# AjoAI Project Status

Last updated: 2026-06-14.

AjoAI is an autonomous rotating-savings (ajo / esusu / chama / stokvel) agent on Celo,
distributed as a MiniPay Mini App. The contract holds the money and enforces every rule; the
agent only triggers legal state transitions; the LLM is restricted to natural-language Q&A and
never moves funds.

## Live on Celo mainnet (chainId 42220)
All three contracts are source-verified (Sourcify exact_match) on Celoscan.

| Component | Address / value |
|---|---|
| CircleFactory | `0xE2401Ab2ea9E4c68cBA9946e4079cd7eF4d82186` |
| ReputationLedger | `0xd2f340Fe1616aB5190F326A6f127f852F5C5Ed04` |
| YieldAdapter | `0xF9293905e64c39C5856CE4Aa895ab7c80F62014d` |
| Agent (baked into factory) | `0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7` |
| ERC-8004 agent identity | agentId 9339 (Identity Registry `0x8004A169…`), https://8004scan.io/agents/celo/9339 |

A real-money autonomous rotation has completed on mainnet: a 3-member circle in real Tether
USD₮ (6 decimals) where the agent triggered all three payouts and finalize. Circle
`0x4D03D887c3bB293623A8aF842DB80B4680a5E11F` finished Completed, roundsPaid 3, reconcile
in == out == 3.6 USD₮, every member scored 8. The seed funds were fully recovered (only CELO
gas was spent). Run report: `config/demo_run.mainnet.json`.

The agent runs as an always-on Railway worker (`run-all 30`, CHAIN=mainnet), sweeping the
mainnet factory every 30 seconds with no operator in the loop.

## Live on Celo Sepolia (chainId 11142220)
Testnet validation, all contracts source-verified on Blockscout. A full 4-member rotation
completed end-to-end (circle `0x3DdF59747B9592b50D40fbBCcaD958078E9b3c68`, Completed,
reconcile in == out == 2000 units). ERC-8004 agentId 307. Used for the in-app faucet flow with
mintable test tokens, since real Mento stablecoins are not faucetable on testnet.

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
  handler (English, Nigerian Pidgin, Swahili), and a fund-safe mainnet seed runner. 18 tests pass.
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

## Remaining for submission
1. Self Agent ID: the registration session is bootstrapped programmatically; the human passport
   scan is pending (blocked on Self ID verification, region screenshot is the documented fallback).
   `python -m scripts.self_poll` completes it once scanned.
2. Redeploy `/miniapp` on Vercel so the hosted agent card serves the mainnet agentId 9339.
3. Post the registration tweet quote-tweeting @CeloDevs and @Celo with the ERC-8004 link.
4. Submit via the Celo Builders Skill (`celo-onchain-agents`).
