# AjoAI, Landing + MiniPay Mini App

One Next.js app in the **Market Blocks** brand: a marketing **landing page** at `/`
and the functional **MiniPay app** at `/app/*`, wired to the live Celo contracts.
Chain is env-switchable (`NEXT_PUBLIC_CHAIN`), **mainnet by default**, Sepolia for dev.
Next.js (App Router) + viem/wagmi. Live: https://ajo-ai-tan.vercel.app

## Routes
| Route | Screen(s) |
|---|---|
| `/` | Landing, hero, how, the circle, voices, in-MiniPay, FAQ, footer |
| `/app` | Welcome (disconnected) → Home: your circles + savings score |
| `/app/create` | Start a circle → `factory.createCircle(...)` |
| `/app/join` | Join a circle (preview → approve deposit → `join`) |
| `/app/circle/[address]` | Dashboard + **Pay** (contribute) + **Activity** (events) + **Ask** (NL Q&A via `/app/api/ask`) + your-turn / default-handled |
| `/app/score` | Trust Score (ERC-8004 `scoreOf`) + share/QR a portable score link |
| `/app/score/[address]` | Public, read-only view of any member's savings-credit score — no wallet needed |
| `/api/mcp` | Read-only **MCP server** (JSON-RPC): `get_circle` / `get_score` / `ask` / `list_circles` for agent interop |

Every app screen reads/writes the real contracts (mainnet factory
`0xE2401Ab2…2186`, ReputationLedger `0xd2f340Fe…Ed04`; Sepolia equivalents for dev).
Addresses live in `lib/chain.ts` (mirrors `config/addresses.<chain>.json`). No fake
data, honest empty states.

## MiniPay integration (official patterns)
- **Chains:** viem `celoSepolia` / `celo` (built-in CIP-64 + feeCurrency serializers).
- **Connect:** `injected({ target: "metaMask" })`. Inside MiniPay
  (`window.ethereum.isMiniPay`) the wallet is implicit → connect button hidden +
  auto-connect (`app/providers.tsx`); on desktop a connect button shows for testing.
- **Gas in stablecoin:** every write passes **`feeCurrency: USDm`** (`lib/tx.ts`) -
  members/agent never need CELO. Legacy txs; no `personal_sign` (auth = address +
  on-chain state).
- **Identity:** MiniPay exposes no phone-number API, so members render as friendly
  initials/short address; the Welcome phone-field is presentational (one wallet = one slot
  is enforced on-chain).
- **Tokens:** **USDm** (default), **USDT**, **USDC**, **NGNm** (Mento rebrand of cUSD/cNGN).
  A member who lacks the circle's token sees a Convert panel — MiniPay Pockets for the 1:1
  stable swap, or an in-app Mento Broker swap for the USDm→NGNm FX leg. Testnet uses mintable
  mock tokens + an in-app faucet.

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

## Deploy
Deployed to Vercel (production: https://ajo-ai-tan.vercel.app). `NEXT_PUBLIC_CHAIN`
selects the chain (default `mainnet`); `public/.well-known/agent-card.json` is served
as the ERC-8004 agent card (agentId 9339) and `public/icon.png` is the agent/app logo.
