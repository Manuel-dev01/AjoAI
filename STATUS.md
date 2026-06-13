# STATUS.md — AjoAI Living Status

> Updated after EVERY phase / significant work session. Read at session start.
> Keep the highest-risk unknown at the TOP. Keep it short — this is a dashboard,
> not a log.

---

## ⚠️ HIGHEST-RISK UNKNOWN (top of mind)
**TIME.** Submissions close **June 15 (9AM GMT), 2026**; today is **2026-06-12** → **~3 days**.
Core product is DONE (contracts+agent+frontend, all builds green, live on Sepolia). Remaining is
SUBMISSION-CRITICAL + human-gated: (1) **register tweet** @CeloDevs/@Celo + ERC-8004 link;
(2) **Self Agent ID** (your passport via Self app, or region screenshot) — agent/SELF_AGENT_ID.md;
(3) **mainnet-early deploy** (fund AGENT_PRIVATE_KEY_MAINNET; bake agent into factory) → drives
T1 activity weight + T2; (4) **deploy /miniapp to Vercel** for the live URL + re-register agentURI;
(5) **submit via Celo Builders Skill** (`celo-onchain-agents`, opens June 8) — NOT Karma GAP.

---

## CURRENT PHASE
Phases 0–5 DONE. Frontend furnished (Market Blocks landing + 10-screen app, real-wired, lifecycle
fixed, faucet). Agent hosting ready. **Phase 6 (submission) is the remaining work** — mostly the
5 human/submission steps above.

## ⚠️ HIGHEST-RISK UNKNOWN (updated)
Gas unblocked — dev key topped up to **11.7 CELO** (2026-06-02). Full 4-member
autonomous rotation running now. Remaining risks are external/validation: MiniPay
device testing (Phase 5) and the separate mainnet key funding (Phase 6 mainnet-early).

## 🟢 LIVE ON CELO SEPOLIA (2026-06-02, chainId 11142220)
All four contract types source-verified on Blockscout (celo-sepolia.blockscout.com):
- CircleFactory:   0x032fEE1776508fE59bA715120Bc190b682162191
- ReputationLedger:0x12Ac76Fd85500fd1dF47D6bF15B6B275eA3FB3Ce
- YieldAdapter:    0x22b1AA6022AfE68F5F019229Bf785D8083cD3640
- Demo Circle:     0xc578127F2978896ef1b4995CE44D780C89676cb4 (NGNm, 4 slots, Forming)
- Agent/deployer:  0x5b92F8A222704d522Fb3dCf8d734C3DAF51Fc4f1
On-chain smoke test passed: createCircle works, reputation auto-authorize fired (isWriter=true).

## 🏆 TRACK #3 ADDRESSED — ERC-8004 agent registered
- **agentId 307** on the ERC-8004 Identity Registry (0x8004A818…); tx 0x5ac0763b…
  → visible on 8004scan (agentURI → config/agent-card.json). config/agent-id.sepolia.json.

## 🎬 DEMO CENTERPIECE DONE — full autonomous rotation on Sepolia (verified)
Circle 0x3DdF59747B9592b50D40fbBCcaD958078E9b3c68 → state **Completed**, roundsPaid 4,
**reconcile in==out==2000e18** (no wei created/destroyed, on real chain). The AGENT
triggered all 4 payouts (economic agency) + finalize. Member scores all 9 (on-chain).
- payouts: e57366f3 / 393cdbc9 / 4280b929 / 445b4fe7 ; finalize: 02c5da0d (all status 1)
- Mock token (mirrors NGNm 18-dec, loudly logged); real NGNm reserved for Phase-6 mainnet seed.
- Also feeds track #2 (Most On-chain Transactions): ~40 real txs from this run.
- Dev key topped up to 11.7 CELO; rotation reproducible via `python -m scripts.demo_rotation`.

## DONE
- Phase 0 verification → docs/VERIFICATION.md; GATE 0 approved (all §E + mainnet-early).
- Phase 1: spec diff applied to CLAUDE.md; STACK.md locked; config + env filled;
  monorepo dirs + CI; STATE_MACHINE.md reviewed. GATE 1 approved.
- Phase 2 contracts: Circle.sol + CircleFactory.sol + adapters (SimulatedYieldAdapter,
  ReputationLedger) + interfaces + mocks. Foundry project (vendored forge-std + OZ v5.1).
- **25 tests pass** (forge fmt clean): §5 worked example number-for-number; lifecycle/
  personhood/rotation/dissolve/exit/yield; adversarial (double-trigger, reentrancy on
  payout, contribute-after-default, recipient-delinquent withhold+cure, default-by-
  already-received, rounding); 3 invariants (conservation, received==roundsPaid,
  delinquent-recipient-unpaid) at 256×8192 calls, 0 reverts.
- Deploy.s.sol ready (writes config/deployments.<chain>.json); dry-run validated.
- git initialized (no commits, no co-author trail); .env gitignored.

## KEY DECISIONS
- Chain config-switchable; default Celo Sepolia (11142220); mainnet 42220, EARLY.
- Stack LOCKED: Foundry + Python agent (web3.py + chaoschain-sdk + self.xyz +
  APScheduler + structlog + pytest) + Celo Composer MiniPay; ABIs in config/abi/
  are the cross-language contract.
- Agent non-custodial; contract is source of truth; LLM never moves money.
- Security-deposit model for default recovery (CLAUDE.md §4).
- Tokens: USDm + NGNm only for the demo (Mento rebrand; cKES/cGHS unconfirmed).

## KEY CONTRACT DECISIONS (Phase 2)
- Single token per circle; `period` configurable (GATE 1). N bounded by `slots` (uint8).
- Payout always makes the recipient whole: shortfalls covered from defaulters'
  deposits (auto-swept in triggerPayout via _coverRound) then the penalty pool;
  uncoverable -> DEFAULTED with pro-rata to non-received.
- Recipient-delinquent -> triggerPayout emits PayoutWithheld and no-ops (idempotent);
  cleared by cure() (re-deposit). Reputation writes never block a money path (try/catch).
- DEVIATION (scope cut, recorded): clean mid-circle exit is FORMING-only in v1;
  mid-ACTIVE rotation resize deferred. STATE_MACHINE.md §5.7 + this line.

## OPEN RISKS
- (P0) Deployment blocked on funded Sepolia key (human action).
- (P0) 13-day runway — scope frozen to critical path.
- (P1) Yield venue unconfirmed on testnet -> SIMULATE_YIELD=true; on-chain park/withdraw
  is principal-only, yield RATE simulated loudly at the agent layer.
- (P1) MiniPay live feeCurrency set (cUSD vs USDm) — confirm in real app.
- (P2) "Self Agent ID" vs ERC-8004 identity overlap — confirm Phase 3.
- (P2) Real Self verifier + ERC-8004 bridge are stubbed (OPEN mode / local ledger);
  Phase 3 wires the real registries.

## PHASE 4 DONE (agent runtime core)
- Python agent package (/agent): config loader (reads .env + addresses.<chain>.json +
  config/abi/), web3 chain client (perceive + agent-only act), perceive→reason→act→settle
  loop with rule-based decide() (LLM never moves money), APScheduler runner, structlog
  tx-hash-linked logs, loud SIMULATE banners.
- 7 agent unit tests pass (pure decide() logic mirrors contract guards).
- **Validated live:** `python -m src.main status` reads the real Sepolia circle correctly
  (Forming 0/4 → plans "wait"). Connectivity + ABI wiring confirmed end-to-end.

## 📋 OFFICIAL RULES OBTAINED (2026-06-12) — corrections (VERIFICATION.md §B)
- Tracks + $: **T1 Best Agent $2,500/$1,000/$500 · T2 Most Activity $500 · T3 8004scan rank $500** (T2/T3 combinable).
- **Submission = Celo Builders Skill, NOT Karma GAP:** opens June 8 → `npx skills add https://celobuilders.xyz`
  → "Help me submit… Celo Onchain Agents Hackathon" → `celo-onchain-agents`.
- **Register:** quote-tweet @CeloDevs + @Celo with the **ERC-8004 link** (by June 15). Telegram for updates.
- **Self Agent ID:** beneficial for T1; judge = Marek (co-founder Celo+Self). Region caveat → screenshot if Self unavailable.
- Winners June 17. OpenClaw recommended (any framework OK). MiniPay "15M+".

## 🐛 JOIN BUG FIXED + AGENT IDENTITY (8004scan + Self Agent ID)
- Root cause: circles used real Mento NGNm (not faucetable on testnet) → `join` reverted on the
  deposit transfer even after approve. Fix: deployed **mintable test tokens** on Sepolia
  (tNGNm 0x435917C8…E6f7, tUSDm 0x3019C211…7527), app uses them via FAUCETABLE flag in lib/chain.ts,
  + in-app **faucet** (components/Faucet.tsx) + **balance gate** in join/forming/pay so the flow
  can't fail on insufficient balance. Mainnet will use real Mento. `npm run build` clean.
- **8004scan:** enriched ERC-8004 agent card now hosted at miniapp `/.well-known/agent-card.json`
  (serves 200; name/skills/registrations incl. agentId 307). register_agent.py defaults agentURI
  to the deployed path — re-register with AJOAI_AGENT_URI=<deployed URL> so 8004scan renders it.
- **Self Agent ID:** separate credential/auth layer (JS-first SDK) — scoped with user, not a named track.

## ☁️ AGENT HOSTING (autonomous, no laptop) — ready
- agent/Dockerfile (context=repo root, ships agent/ + config/) + .dockerignore; **image builds
  + boots verified** (container `info` connects to Sepolia, derives agent addr, loads config).
- render.yaml (Render Blueprint, `worker` running `run-all 30`, restart-always) + Railway steps
  + local-docker check in **agent/DEPLOY.md**.
- Low-gas guard: `chain.gas_balance_wei()` + loud `low_gas` warning each sweep (<0.05 CELO).
- **Gas decision:** agent pays gas in **native CELO**, NOT USDm. web3.py/eth-account cannot sign
  Celo CIP-64 (feeCurrency) txs (verified: "unrecognized field") — that's a viem-only path used
  by the MiniPay frontend for end users. Hand-rolling CIP-64 signing in the money path was
  rejected as too fragile. Keep a small CELO float on the mainnet agent account.
- **Phase-6 deps:** (1) deploy mainnet contracts + fill config/addresses.mainnet.json;
  (2) factory must bake `agent` = the hosted worker's mainnet address (or setIntegrations);
  (3) set AGENT_PRIVATE_KEY_MAINNET secret + fund it with CELO.

## 🔧 LIFECYCLE WIRING FIXED (create→invite→join→start→rotate)
- Home now lists circles you ORGANISE or are a member of (was isMember-only) → created circles show.
- Create takes a name; routes to a **state-aware dashboard**: Forming shows an **Invite panel**
  (QR + copy-link + reversible `AJO-…` code) + **Join this circle** + organiser **Start circle**;
  Active shows rotation; Pay tab gated to Active. Join accepts link/`AJO`-code/address + `?c?n` deep link.
- Invite abstraction: lib/code.ts (encode/decode/inviteLink/parseInviteInput, round-trip verified),
  lib/names.ts (off-chain names via localStorage + link), components/InvitePanel.tsx (qrcode.react).
- **Agent serve-all**: `chain.all_circles()` + `serve-all`/`run-all` CLI — services EVERY factory
  circle (auto-start full Forming, trigger Active), so UI-created circles rotate autonomously.
  Verified: enumerates all 8 circles; `npm run build` clean; all routes 200 in dev smoke.
- Note: desktop pays gas in CELO (feeCurrency is MiniPay-only) — expected.

## 🎨 FRONTEND FURNISHED (Market Blocks design, real-wired)
/miniapp is now the full brand: landing at `/` + the 10-screen MiniPay app at `/app/*`
(home/welcome, create, join, circle/[address] dashboard+pay+activity+your-turn+default,
score). Every app screen reads/writes the LIVE contracts (factory, circles, ReputationLedger).
- MiniPay official patterns: viem celoSepolia/celo chains, injected({target:'metaMask'}) +
  isMiniPay detect + hidden connect, **feeCurrency=USDm on every write** (lib/tx.ts), legacy tx.
- `npm run build` passes clean (8 routes); dev smoke: all routes 200, no runtime errors.
- HUMAN: device-test via ngrok → MiniPay Developer Settings → Load test page; then Vercel deploy.

## DONE SINCE (this session)
- ERC-8004 agent registration on Sepolia → agentId 307 (track #3).
- Full autonomous rotation on Sepolia → Completed + reconciled + verified (centerpiece).
- README (judge-facing, live addresses + agentId + payout tx table) + MIT LICENSE.
- **Phase 5 — MiniPay mini app built** (/miniapp): Next.js + viem/wagmi, injected
  auto-connect (hidden button), join/contribute/track/cure screens reading the live
  circle + on-chain savings score, USDm feeCurrency noted. **`npm run build` passes clean.**
- Removed stray .gitkeep files (per user).

## NEXT (Phase 6 — submission)
- HUMAN: device-test /miniapp inside real MiniPay; deploy to Vercel for the live URL.
- HUMAN: fund the SEPARATE mainnet key (AGENT_PRIVATE_KEY_MAINNET) for the
  mainnet-early seeded circle (real NGNm) → strengthens tracks #1/#2.
- Demo video shot list + 60s pitch (note: docs/ are gitignored by user — may live in
  README or be recorded directly). Karma GAP submission + X post tagging Celo accounts.
- Deferred: real on-chain ISelfVerifier (Self Sepolia verifier address UNVERIFIED) —
  frontend can use the Self SDK; contract gate stays OPEN-mode meanwhile.

---

## 🧑‍🔧 HUMAN ACTIONS (consolidated — what only you can do)
Priority order. I'll do everything else.
1. **Dev wallet + Sepolia gas (NOW, unblocks deploy):** create a fresh dev key,
   put it in `.env` as `AGENT_PRIVATE_KEY`; fund it with Celo Sepolia CELO via the
   Google Web3 faucet (Self-gated — needs your phone for proof-of-humanity).
2. **Test stablecoins:** get Sepolia USDm/NGNm (faucet/swap) to the dev key for demo circles.
3. **LLM key:** Anthropic API key in `.env` as `LLM_API_KEY` (Phase 4 NL handler).
4. **Mainnet wallet (later, mainnet-early):** SEPARATE key in `AGENT_PRIVATE_KEY_MAINNET`,
   funded with a small real CELO + USDm/NGNm amount. Never reuse the dev key.
5. **Phone for MiniPay + Self:** real-device MiniPay testing (Phase 5) + Self personhood scan.
6. **Submission accounts (Phase 6):** Karma GAP project, X account to post tagging
   @Celo/@CeloDevs/@CeloPublicGoods, hosting (Vercel) for the live miniapp URL.

---

### Update template (copy per phase)
```
## CURRENT PHASE: <n — name>
## DONE: <bullets>
## KEY DECISIONS: <bullets>
## OPEN RISKS: <(severity) bullets>
## NEXT: <bullets>
(move highest-risk unknown to the top section)
```
