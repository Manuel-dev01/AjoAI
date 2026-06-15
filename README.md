# AjoAI: Autonomous Rotating-Savings Agent on Celo

> Onchain Agents Hackathon: Build for Real-World Payments & Everyday Applications.
> **Agents for a real economy, not a casino.**

AjoAI turns Africa's most common informal savings institution, the rotating
savings circle (**ajo / esusu** in Nigeria, **chama** in Kenya, **stokvel** in
South Africa), into an autonomous on-chain agent inside MiniPay. Members join in
MiniPay, save in local Mento stablecoins, and the agent runs the whole circle:
collecting contributions, executing the payout rotation, parking idle funds,
enforcing defaults, and turning a completed circle into a portable savings-credit
score.

**[▶ Demo video](https://youtube.com/shorts/YYtcAh31yNA)**  ·  **[Live app](https://ajo-ai-tan.vercel.app/app)**  ·  **[Agent on 8004scan — agentId 9339](https://8004scan.io/agents/celo/9339)**  ·  **[Mainnet circle](https://celoscan.io/address/0x4D03D887c3bB293623A8aF842DB80B4680a5E11F)**

## How it works
A rotating savings circle: a group each contributes a fixed amount every period,
and each period one member receives the whole pot, until everyone has received
exactly once. AjoAI makes each circle an autonomous agent that:
1. Onboards members inside MiniPay (wallet-based, one wallet = one slot; the join path carries a Self proof-of-personhood slot, live gating on the roadmap).
2. Custodies + collects fixed contributions in a local stablecoin.
3. Executes the payout rotation automatically, **no human in the loop**.
4. Parks idle pot funds in yield between payouts.
5. Enforces defaults via security deposits + on-chain penalties + ERC-8004 reputation.
6. Issues each member a portable savings-credit score.
7. Answers questions in English, Nigerian Pidgin, and Swahili.

**Safety model (enforced, not promised):** the **contract holds the money and
enforces every rule**; the **agent only triggers legal transitions** and can never
drain a circle or pay an arbitrary address; the **LLM never moves funds**, it only
explains chain state.

## Live on Celo mainnet (chainId 42220), real money, verifiable now
All contracts source-verified on [Celoscan](https://celoscan.io) (Sourcify exact_match).

| Contract | Address |
|---|---|
| CircleFactory | [`0xE2401Ab2…2186`](https://celoscan.io/address/0xE2401Ab2ea9E4c68cBA9946e4079cd7eF4d82186) |
| ReputationLedger | [`0xd2f340Fe…Ed04`](https://celoscan.io/address/0xd2f340Fe1616aB5190F326A6f127f852F5C5Ed04) |
| YieldAdapter | [`0xF9293905…014d`](https://celoscan.io/address/0xF9293905e64c39C5856CE4Aa895ab7c80F62014d) |

**ERC-8004 agent identity:** registered as **agentId 9339** on the mainnet Identity Registry
(`0x8004A169…`), [8004scan](https://8004scan.io/agents/celo/9339) (track #3, Celo mainnet rank).

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

> _Testnet:_ the same contracts were also validated end-to-end on Celo Sepolia during development
> (a full 4-member rotation, agentId 307). Mainnet above is the canonical, real-money deployment —
> all proof and addresses here are mainnet.

## Built on Celo
- **Mento** local stablecoins, **USDm** (Mento Dollar) and **NGNm** (Mento Naira);
  save in your own currency. (Mento rebranded cUSD→USDm, cNGN→NGNm.)
- **MiniPay**, in-wallet onboarding + distribution to 15M+ wallets.
- **CIP-64 fee abstraction**, pay gas in stablecoins, no CELO needed.
- **Self**, ZK proof-of-personhood: the contract enforces one slot per human and the join path carries a Self-proof argument; the verifier runs open-mode today, live gating is on the roadmap.
- **ERC-8004**, portable agent identity + savings reputation (Identity + Reputation).
- **x402**, premium endpoints (guarantor score, analytics) for other agents (planned).

## The four pillars
| Pillar | In AjoAI |
|---|---|
| **Economic agency** | Agent autonomously triggers payouts, idle-fund parking, penalty/default recovery, no human per cycle |
| **On-chain integration** | Custom escrow/rotation contracts, ERC-8004 identity + reputation writes, fee-abstracted txs, every action → a tx hash |
| **Real-world applicability** | Digitizes the most common informal savings institution in Africa |
| **Creative use of Celo infra** | Mento local stables (USDm/NGNm), MiniPay in-wallet onboarding, Self-ready join path, CIP-64 gas-in-stablecoin |

## Repository
| Path | What |
|---|---|
| `/contracts` | Solidity (Foundry), `Circle`, `CircleFactory`, adapters; **25 tests** (worked example, adversarial, invariants) |
| `/agent` | Python runtime (perceive→reason→act→settle), NL handler, ERC-8004 registration; **18 tests** |
| `/miniapp` | MiniPay Mini App (viem/wagmi): create / join / pay / activity / score / Ask, plus a read-only **MCP server** (`/api/mcp`) so other agents can query AjoAI |
| `/config` | Per-chain addresses + ABIs + agent card |

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
- **Agent:** Python (web3.py), perceive→reason→act→settle; APScheduler; structlog.
- **LLM (NL handler only, never moves money):** DeepSeek (`deepseek-chat`, OpenAI-compatible),
  with a deterministic chain-derived fallback when no key is set — so a hallucination can never
  authorize a transfer.
- **Frontend:** Next.js (App Router) + viem/wagmi, MiniPay-native (CIP-64 gas in USDm).
- **Agent interop:** a read-only MCP server (`miniapp/app/api/mcp`) + an ERC-8004 agent card at
  `/.well-known/agent-card.json`.

> Note: the build agent (Claude Code, Opus 4.8) wrote the code; the **runtime** NL model is DeepSeek.

## Status
See `STATUS.md` for the current deployment state, test coverage, and remaining work.

## License
MIT. See `LICENSE`.
