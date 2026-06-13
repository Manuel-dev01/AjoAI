# AjoAI, Landing + MiniPay Mini App

One Next.js app in the **Market Blocks** brand: a marketing **landing page** at `/`
and the functional **MiniPay app** at `/app/*`, wired to the live Celo Sepolia
contracts. Next.js (App Router) + viem/wagmi.

## Routes
| Route | Screen(s) |
|---|---|
| `/` | Landing, hero, how, the circle, voices, in-MiniPay, FAQ, footer |
| `/app` | Welcome (disconnected) → Home: your circles + savings score |
| `/app/create` | Start a circle → `factory.createCircle(...)` |
| `/app/join` | Join a circle (preview → approve deposit → `join`) |
| `/app/circle/[address]` | Dashboard + **Pay** (contribute) + **Activity** (events) + your-turn / default-handled |
| `/app/score` | Trust Score (ERC-8004 `scoreOf`) |

Every app screen reads/writes the real contracts (factory `0x032fEE…2191`,
circles, ReputationLedger `0x12Ac76Fd…B3Ce`). Addresses live in `lib/chain.ts`
(mirrors `config/addresses.sepolia.json`). No fake data, honest empty states.

## MiniPay integration (official patterns)
- **Chains:** viem `celoSepolia` / `celo` (built-in CIP-64 + feeCurrency serializers).
- **Connect:** `injected({ target: "metaMask" })`. Inside MiniPay
  (`window.ethereum.isMiniPay`) the wallet is implicit → connect button hidden +
  auto-connect (`app/providers.tsx`); on desktop a connect button shows for testing.
- **Gas in stablecoin:** every write passes **`feeCurrency: USDm`** (`lib/tx.ts`) -
  members/agent never need CELO. Legacy txs; no `personal_sign` (auth = address +
  on-chain state).
- **Identity:** MiniPay exposes no phone-number API, so members render as friendly
  initials/short address; the Welcome phone-field is presentational.
- Tokens: **NGNm + USDm** (Mento rebrand of cNGN/cUSD).

## Run
```bash
npm install
npm run dev            # http://localhost:3000  (/ landing, /app the app)
npm run build          # production build (passes clean)
```

## Test inside real MiniPay (required before relying on it)
```bash
npm run dev
ngrok http 3000        # copy the HTTPS URL
```
MiniPay app → **Settings → Developer Settings → Load test page** → paste the ngrok
URL. Must be a real Android/iOS device (not an emulator). Verify: implicit connect,
a contribute tx paying gas in USDm, balances.

## Deploy + submit (Phase 6)
Deploy to Vercel for the live URL, then submit via the MiniPay Mini App submission
form / register on Celo Proof-of-Ship. Set `NEXT_PUBLIC_CIRCLE` to the demo circle.
