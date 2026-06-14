# AjoAI Test Checklist

A full walkthrough to exercise every product surface. Two environments:

- **Mainnet (default):** the live build. Real Celo (42220), real Tether USD₮ (6 decimals). You
  need a wallet with a little CELO for gas and some USD₮ to join/contribute.
- **Testnet:** set `NEXT_PUBLIC_CHAIN=sepolia`. Mintable test tokens with an in-app faucet, so you
  can fill circles without real funds. Best for full multi-member runs.

For a fast end-to-end run, create a circle with the **10 min** period and **2 members**; the hosted
agent (`run-all 30`) sweeps the factory every 30 seconds, so it starts and rotates within minutes.

## 0. Setup
- [ ] Open the app URL. The landing page (`/`) renders with the Market Blocks styling and the ring mark.
- [ ] Go to `/app`. If not connected, the welcome screen shows a Connect button (auto-connect inside MiniPay).
- [ ] Connect a wallet. On first connect you are prompted "What should we call you?"; enter a name.
- [ ] Top-left now shows your name (greeting `Sannu, <name>`); the app bar shows your name. "edit name" lets you change it.

## 1. Create a circle
- [ ] `/app/create`. Enter a circle name, an amount, pick a token (mainnet: USDT / USDm / NGNm; testnet: NGNm / USDm).
- [ ] Pick "10 min" period and "2" members for a fast test.
- [ ] The deposit line reflects your amount and token.
- [ ] Tap "Create & invite". The wallet prompts; on mainnet it does NOT force a chain switch (you are already on mainnet).
- [ ] After confirmation you land on the circle dashboard in the Forming state, showing 0/N members and the invite panel.

## 2. Invite + share
- [ ] The Forming dashboard shows a QR code, a "Copy invite link" action, and an `AJO-...` code.
- [ ] Copy the invite link; it contains `?c=<address>&n=<name>`.
- [ ] The members counter shows `0/N`.

## 3. Join (three input paths)
- [ ] Open the invite link in a second wallet (or incognito). The join screen prefills the circle and name.
- [ ] `/app/join` also accepts a pasted raw address or an `AJO-...` code.
- [ ] Testnet only: a "Get test tokens" faucet button appears when balance is low; mint, then proceed.
- [ ] Mainnet, low balance: the screen reads "You need X in your wallet to post the deposit" (no faucet), and you must hold the token.
- [ ] Approve the deposit, then Join. The members counter increments.
- [ ] Repeat until the circle is full (`N/N`).

## 4. Start + autonomous rotation
- [ ] When full, the organizer sees "Start circle". Tap it (or let the hosted agent auto-start a full circle).
- [ ] The dashboard switches to Active and shows the rotation and current round.
- [ ] Each member opens the Pay tab and contributes (Approve, then Pay). The amount shown matches the contribution.
- [ ] Once all contributions are in, the **agent** triggers the payout (no human presses pay). The round advances.
- [ ] Watch the recipient receive the full pot; repeat each round until the circle completes.

## 5. Activity feed + explorer
- [ ] Open the Activity tab on an Active or Completed circle. It lists contributions and payouts with rounds and amounts.
- [ ] On a completed circle, all rounds appear (no "no activity in this window").
- [ ] The "See all on Celoscan" link (Blockscout on testnet) opens the circle address on the correct explorer.

## 6. Default + penalty path (optional, deeper)
- [ ] In a circle with a short period, have one member NOT contribute past the grace window.
- [ ] The agent marks them delinquent; their deposit covers the round so the recipient is still made whole.
- [ ] The Activity feed shows the deposit-covered and penalty entries; the member's score reflects the negative signal.

## 7. Savings score (ERC-8004)
- [ ] `/app/score` shows your on-chain savings-credit score and the breakdown (on-time, late, defaults, completed).
- [ ] After a clean completed circle, the score increases.
- [ ] Tap "Copy score link" (or scan the QR) on `/app/score`; opening that link in a fresh browser
  with no wallet connected at `/app/score/<address>` shows the same score, read-only.

## 8. Home dashboard
- [ ] `/app` lists circles you organize or are a member of, each with its name, role, and state pill.
- [ ] A circle you created appears immediately (even before anyone joins).
- [ ] The demo circle link opens a completed circle you can inspect.

## 9. MiniPay specifics (real device, via ngrok or the deployed URL)
- [ ] Inside MiniPay the connect button is hidden and the wallet auto-connects.
- [ ] Writes use the stablecoin gas path (CIP-64) inside MiniPay; on desktop wallets gas is paid in CELO.
- [ ] No message-signing prompts appear (auth is by injected address only).

## 10. Agent + identity (out of app)
- [ ] The hosted agent (Railway) logs `serve_all_sweep` every 30s against the mainnet factory.
- [ ] The agent renders on 8004scan: https://8004scan.io/agents/celo/9339
- [ ] The agent card serves at `<app-url>/.well-known/agent-card.json` with the mainnet agentId.

## 11. Ask the agent (NL Q&A)
- [ ] Open a circle dashboard → **Ask** tab.
- [ ] As a member, ask "when do I get paid?" — the reply states your round/remaining rounds and
  the pot amount in plain language (English, Pidgin, or Swahili, matching your question).
- [ ] As a non-member (a different wallet), ask the same question — the reply says you are not a
  member of this circle.
- [ ] Answers are correct (deterministic, chain-derived facts) even without `ANTHROPIC_API_KEY` set
  on the server; with it set, the same facts come back phrased more conversationally.

## 12. Idle-fund yield (agent, on-chain)
- [ ] On an Active circle with a configured yield adapter and an idle token balance, the agent's
  `decide()` loop parks the balance (`parkIdleFunds`) when there is nothing more urgent to do.
- [ ] Before the next `triggerPayout`/`finalize`, the agent recalls parked funds
  (`withdrawIdleFunds`) first — these calls revert with `MustWithdrawIdleFirst` while
  `parkedAmount != 0`.
- [ ] The agent log shows a `SIMULATED` yield-rate banner alongside the real park/withdraw tx hashes.

## Known constraints
- Mainnet has no faucet; joiners must hold the chosen token (USD₮ recommended, since the funded test
  wallet holds it). For a no-funds full run, use testnet (`NEXT_PUBLIC_CHAIN=sepolia`).
- The agent pays its own gas in CELO; keep its account funded. Members pay their own gas.
