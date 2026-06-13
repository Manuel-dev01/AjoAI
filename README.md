# AjoAI — Autonomous Rotating-Savings Agent on Celo

> Onchain Agents Hackathon: Build for Real-World Payments & Everyday Applications.
> **Agents for a real economy, not a casino.**

AjoAI turns Africa's most common informal savings institution — the rotating
savings circle (**ajo / esusu** in Nigeria, **chama** in Kenya, **stokvel** in
South Africa) — into an autonomous on-chain agent inside MiniPay. Members join by
phone, save in local Mento stablecoins, and the agent runs the whole circle:
collecting contributions, executing the payout rotation, parking idle funds,
enforcing defaults, and turning a completed circle into a portable savings-credit
score.

## How it works
A rotating savings circle: a group each contributes a fixed amount every period,
and each period one member receives the whole pot, until everyone has received
exactly once. AjoAI makes each circle an autonomous agent that:
1. Onboards members by phone number (with Self proof-of-personhood — one human, one slot).
2. Custodies + collects fixed contributions in a local stablecoin.
3. Executes the payout rotation automatically — **no human in the loop**.
4. Parks idle pot funds in yield between payouts.
5. Enforces defaults via security deposits + on-chain penalties + ERC-8004 reputation.
6. Issues each member a portable savings-credit score.
7. Answers questions in English, Nigerian Pidgin, and Swahili.

**Safety model (enforced, not promised):** the **contract holds the money and
enforces every rule**; the **agent only triggers legal transitions** and can never
drain a circle or pay an arbitrary address; the **LLM never moves funds** — it only
explains chain state.

## Live on Celo Sepolia (chainId 11142220) — verifiable now
All contracts source-verified on [Blockscout](https://celo-sepolia.blockscout.com).

| Contract | Address |
|---|---|
| CircleFactory | [`0x032fEE17…2191`](https://celo-sepolia.blockscout.com/address/0x032fEE1776508fE59bA715120Bc190b682162191) |
| ReputationLedger | [`0x12Ac76Fd…B3Ce`](https://celo-sepolia.blockscout.com/address/0x12Ac76Fd85500fd1dF47D6bF15B6B275eA3FB3Ce) |
| SimulatedYieldAdapter | [`0x22b1AA60…3640`](https://celo-sepolia.blockscout.com/address/0x22b1AA6022AfE68F5F019229Bf785D8083cD3640) |
| Example Circle (NGNm) | [`0xc578127F…6cb4`](https://celo-sepolia.blockscout.com/address/0xc578127F2978896ef1b4995CE44D780C89676cb4) |

**ERC-8004 agent identity:** registered as **agentId 307** on the Identity
Registry (`0x8004A818…`) — track #3 (8004scan rank).

### Proof: a complete autonomous rotation (real Sepolia txs)
The agent drove an entire 4-member circle end-to-end — every payout triggered by the
agent, not a human. Circle [`0x3DdF…3c68`](https://celo-sepolia.blockscout.com/address/0x3DdF59747B9592b50D40fbBCcaD958078E9b3c68)
finished in state **Completed**, `roundsPaid = 4`, and **reconcile in == out == 2000
units** (no wei created or destroyed, on-chain).

| Round | Autonomous payout tx |
|---|---|
| 0 | [`e57366f3…`](https://celo-sepolia.blockscout.com/tx/0xe57366f3d5391dc84a4c243da20a7cc6e126e3e0d464b6c652e9d3363ae61550) |
| 1 | [`393cdbc9…`](https://celo-sepolia.blockscout.com/tx/0x393cdbc9024abc09a9ce88a5f8695d092b838a32e5ee40487f3b8f5f0e996478) |
| 2 | [`4280b929…`](https://celo-sepolia.blockscout.com/tx/0x4280b929aece1e54d0fa513b38f9a9f294b3047706aff38298acfc701f0080a9) |
| 3 | [`445b4fe7…`](https://celo-sepolia.blockscout.com/tx/0x445b4fe7330f10a69b0de5388646b8944fb1c36e337dce5eb53eea59baddf19b) |
| finalize | [`02c5da0d…`](https://celo-sepolia.blockscout.com/tx/0x02c5da0deca23f77ab4170435dfa0d306eba371eeff506153bc5b94282045e0c) |

Each member earned an on-chain savings-credit score of **9** (4 on-time contributions
+ clean completion). The demo token is a MockERC20 mirroring NGNm's 18 decimals
(loudly logged as a mock); the mainnet rotation below uses **real Tether USD₮**.

## Live on Celo mainnet (chainId 42220) — real money, verifiable now
All contracts source-verified on [Celoscan](https://celoscan.io) (Sourcify exact_match).

| Contract | Address |
|---|---|
| CircleFactory | [`0xE2401Ab2…2186`](https://celoscan.io/address/0xE2401Ab2ea9E4c68cBA9946e4079cd7eF4d82186) |
| ReputationLedger | [`0xd2f340Fe…Ed04`](https://celoscan.io/address/0xd2f340Fe1616aB5190F326A6f127f852F5C5Ed04) |
| YieldAdapter | [`0xF9293905…014d`](https://celoscan.io/address/0xF9293905e64c39C5856CE4Aa895ab7c80F62014d) |

**ERC-8004 agent identity:** registered as **agentId 9339** on the mainnet Identity Registry
(`0x8004A169…`) — [8004scan](https://8004scan.io/agents/celo/9339) (track #3, Celo mainnet rank).

### Proof: a real-USD₮ autonomous rotation on mainnet
A 3-member circle in **real Tether USD₮** (6 decimals): the agent triggered **all 3 payouts** and
`finalize`. Circle [`0x4D03…E11F`](https://celoscan.io/address/0x4D03D887c3bB293623A8aF842DB80B4680a5E11F)
finished **Completed**, `roundsPaid = 3`, **reconcile in == out == 3.6 USD₮** (no wei created or
destroyed, real money). Members scored **8** each; the seed funds were fully recovered (only CELO gas spent).

| Round | Autonomous payout tx |
|---|---|
| 0 | [`9924e896…`](https://celoscan.io/tx/0x9924e89648651020bd11d3477a6e489ff24e720a380a2198e590118c6998fd0d) |
| 1 | [`b1cbabf8…`](https://celoscan.io/tx/0xb1cbabf84110b478e3203aeff75f96bb98128c18eb4276ac9364100fb88cf407) |
| 2 | [`4b75411f…`](https://celoscan.io/tx/0x4b75411f6cc4b8e29887f49ab5ac6406f79e2360e18079a15a97b7079f995f7b) |
| finalize | [`2ca4f1a4…`](https://celoscan.io/tx/0x2ca4f1a477a4f70a12746f51a29673790102cd38f7a59215c8667bfa59497220) |

The agent runs as an always-on Railway worker (`run-all 30`) sweeping the mainnet factory every 30s.

## Built on Celo
- **Mento** local stablecoins — **USDm** (Mento Dollar) and **NGNm** (Mento Naira);
  save in your own currency. (Mento rebranded cUSD→USDm, cNGN→NGNm.)
- **MiniPay** — phone-number onboarding + distribution to 15M+ wallets.
- **CIP-64 fee abstraction** — pay gas in stablecoins, no CELO needed.
- **Self** — ZK proof-of-personhood (live on Celo Sepolia); one human, one slot.
- **ERC-8004** — portable agent identity + savings reputation (Identity + Reputation).
- **x402** — premium endpoints (guarantor score, analytics) for other agents (planned).

## The four judging pillars
| Pillar | In AjoAI |
|---|---|
| **Economic agency** | Agent autonomously triggers payouts, idle-fund parking, penalty/default recovery — no human per cycle |
| **On-chain integration** | Custom escrow/rotation contracts, ERC-8004 identity + reputation writes, fee-abstracted txs — every action → a tx hash |
| **Real-world applicability** | Digitizes the most common informal savings institution in Africa |
| **Creative use of Celo infra** | Mento local stables (USDm/NGNm), MiniPay phone onboarding, Self sybil resistance, CIP-64 gas-in-stablecoin |

## Repository
| Path | What |
|---|---|
| `/contracts` | Solidity (Foundry) — `Circle`, `CircleFactory`, adapters; **25 tests** (worked example, adversarial, invariants) |
| `/agent` | Python runtime (perceive→reason→act→settle), NL handler, ERC-8004 registration; **13 tests** |
| `/miniapp` | MiniPay Mini App frontend (viem/wagmi) |
| `/config` | Per-chain addresses + ABIs + agent card |
| `/docs` | Verification, state machine, architecture, demo, pitch |

## Quick start
```bash
# Contracts
cd contracts && forge test -vvv

# Agent
cd agent && python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m pytest tests/ -q
.venv/Scripts/python -m src.main status   # perceive the live circle
```
Config + secrets: copy `env.example` → `.env`. Addresses are read from
`config/addresses.<chain>.json`; never hardcoded.

## Model / framework / tools
- **Contracts:** Solidity 0.8.28 + Foundry + OpenZeppelin v5.
- **Agent:** Python (web3.py) — perceive→reason→act→settle; APScheduler; structlog.
- **LLM (NL handler only, never moves money):** Claude (`claude-haiku-4-5`).
- **Frontend:** Celo Composer MiniPay template + viem/wagmi.

## Status
See `STATUS.md`. Built with Claude Code following `docs/BUILD_PLAN.md`, with a hard
Phase-0 verification gate (`docs/VERIFICATION.md`).

## License
MIT — see `LICENSE`.
