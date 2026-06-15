# ARCHITECTURE.md, AjoAI System Architecture

> How the pieces fit. Domain rules live in `CLAUDE.md` §4 + `STATE_MACHINE.md`;
> this is the component + data-flow + trust view.

---

## 1. COMPONENTS

```
┌──────────────────────────────────────────────────────────────────┐
│                        MEMBERS (humans)                            │
│                 MiniPay wallet · one wallet, one slot              │
└───────────────┬────────────────────────────────┬─────────────────┘
                │ tap (contribute / join / view)  │ NL questions
                ▼                                  ▼
        ┌───────────────┐                 ┌──────────────────┐
        │  MiniPay Mini │                 │  Agent NL handler │
        │  App (frontend)│◀───────────────│  (EN/Pidgin/Swa)  │
        └───────┬───────┘                 └────────┬─────────┘
                │ viem/wagmi txs                    │ reads chain (never moves $)
                ▼                                   ▼
   ┌──────────────────────────────────────────────────────────────┐
   │              CELO L2 (mainnet · Sepolia for dev)               │
   │  ┌───────────────┐   ┌──────────────┐   ┌──────────────────┐  │
   │  │ CircleFactory │──▶│    Circle    │──▶│ ERC-8004 Registries│ │
   │  └───────────────┘   │ escrow+rules │   │ identity/reputation│ │
   │                      └──────┬───────┘   └──────────────────┘  │
   │                             │ idle funds                        │
   │                             ▼                                   │
   │                      ┌──────────────┐   ┌────────┐   ┌───────┐ │
   │                      │ Yield adapter│   │ Mento  │   │ Self  │ │
   │                      │ (Aave/stub)  │   │ stables│   │ proofs│ │
   │                      └──────────────┘   └────────┘   └───────┘ │
   └──────────────────────────────┬───────────────────────────────┘
                                   │ triggers transitions, pays gas in stablecoin
                          ┌────────┴─────────┐
                          │   AGENT RUNTIME   │
                          │ perceive→reason→  │
                          │ act→settle loop   │
                          │ + scheduler       │
                          │ + x402 skills     │
                          └──────────────────┘
```

**Contracts (`/contracts`)**, source of truth for all money state and rules.
`CircleFactory` deploys `Circle`s; `Circle` holds funds, enforces the state
machine, writes ERC-8004 reputation, and routes idle funds to the yield adapter.

**Agent runtime (`/agent`)**, autonomous loop + scheduler. It *reads* chain
state, *decides* which legal transition is due, and *triggers* it (payout, park/
withdraw idle funds, mark delinquent). Pays its own gas in **native CELO** (web3.py
can't sign CIP-64). Runs the LLM (DeepSeek) only for NL understanding/replies.
x402-gated premium skills are planned.

**MiniPay Mini App (`/miniapp`)**, the human surface. Wallet onboarding (one wallet,
one slot), join+deposit, contribute, track, receive, a portable savings score, and an
**Ask** tab for NL Q&A (`/app/api/ask`, a TypeScript port of the agent's NL handler —
same deterministic, money-safe facts, reads chain directly, never moves funds). Also
serves a read-only **MCP server** (`/api/mcp`) so other agents can query AjoAI. Submits
member txs directly via viem/wagmi.

**External Celo infra**, Mento (local stables), Self (personhood + agent ID; verifier
in OPEN mode today), ERC-8004 (portable reputation), a yield venue, MiniPay (distribution).

---

## 2. DATA FLOW, one round (happy path)
1. Window opens (contract time-based; agent observes event).
2. Members `contribute()` via the Mini App (on-time -> +rep).
3. Agent `parkIdleFunds()` if there's a gap before settle; `withdrawIdleFunds()`
   before settle.
4. Agent checks the §3 payout condition; when met, `triggerPayout()` -> recipient
   receives intendedPot; `received` set; reputation written.
5. Round advances; agent logs each step with its tx hash + served pillar.

## 3. DATA FLOW, default path
1. A member misses the window + grace.
2. Agent `markDelinquent(m)` -> deposit consumed to cover, strong −rep.
3. Payout condition still met from deposit cover -> recipient made whole.
4. If uncoverable -> contract -> DEFAULTED, pro-rata distribution.

---

## 4. TRUST MODEL (what each party can and cannot do)

| Party | Can | Cannot |
|---|---|---|
| **Contract** | hold funds, enforce every rule, pay recipients, write reputation | act on its own without a trigger |
| **Agent** | trigger *legal* transitions, park/withdraw idle funds, mark delinquency, pay gas | drain a circle, pay an arbitrary address, override a rule, move funds the contract wouldn't allow |
| **Member** | join+verify, deposit, contribute, request exit (if eligible), receive their turn | receive twice, skip their contribution, receive while delinquent |
| **Organizer/governance** | create circle, set rotation (FORMING), dissolve (FORMING) | touch funds mid-circle |
| **LLM** | understand + explain in natural language | authorize or move money |

Core stance (`CLAUDE.md` §1): the agent is non-custodial over rules; the contract
is the source of truth; the LLM never moves money. A compromised agent key can at
worst trigger *due* transitions early/late, not steal funds.

---

## 5. KEY DESIGN CHOICES
- **Per-circle contract** (factory pattern) keeps each circle's funds isolated -
  a bug or default in one circle can't touch another.
- **Pull-over-push** on payouts where a recipient could revert, so one bad
  recipient can't brick settlement.
- **Yield behind an interface** so it can be a real venue or a loud stub without
  touching circle logic.
- **Reputation as a first-class output**, not a side effect, completed circles
  produce a portable savings-credit score (the future micro-credit primitive).
- **Time-based rounds in the contract**, observed (not controlled) by the agent,
  so the schedule is trust-minimized even if the agent is offline.

---

## 6. FAILURE MODES & HANDLING
| Failure | Handling |
|---|---|
| Agent offline | Rounds are time-based on-chain; members can still contribute; payout can be triggered by any allowed caller once due (document who). |
| Yield venue unavailable | Stub via `SIMULATE_YIELD`; circle logic unaffected. |
| Self verifier not wired | `ISelfVerifier` in OPEN mode on both chains (`SIMULATE_SELF` for dev); **one wallet, one slot** still enforced on-chain via `usedHuman`. Live Self gating is roadmap. |
| Recipient reverts on payout | Pull-over-push; recipient claims; round still advances. |
| Tx not yet final | Agent treats only confirmed txs as settled (§ finality). |
| MiniPay constraint changed | Caught in Phase 0 / VERIFICATION.md; frontend adapts. |
