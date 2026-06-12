# Running the AjoAI agent autonomously (always-on, no laptop)

The agent is a stateless, idempotent worker: `run-all` sweeps **every** circle the factory
deployed each tick — auto-starting full `Forming` circles and triggering payouts/defaults on
`Active` ones — so a circle created in the MiniPay app rotates with **no human in the loop**.
You host the exact same command in the cloud; nothing about the logic changes.

## Prerequisites (Phase 6 — mainnet)
1. **Mainnet contracts deployed** and their addresses written into `config/addresses.mainnet.json`
   (`deployments.circleFactory`, `reputationLedger`, etc.). Until then the worker has nothing to service.
2. **The factory must bake in the hosted agent's address.** Every `Circle` stores `agent =
   factory.agent` and only that key may trigger payouts. So deploy the factory with
   `agent = <hosted mainnet agent address>` (or call `setIntegrations(...)` to update it).
   The hosted worker signs with `AGENT_PRIVATE_KEY_MAINNET` → its address must equal `factory.agent`.
3. **Fund the agent account with a little CELO** for gas. The agent pays gas in **native CELO**
   (stock web3.py/eth-account can't sign Celo CIP-64 `feeCurrency` txs — that's a viem-only path
   used by the MiniPay frontend for end users). The worker logs `low_gas` below ~0.05 CELO.
   The agent is **non-custodial**: even if the key leaks it can't drain a circle or pay an
   arbitrary address — the contract enforces every money rule — but keep the key secret anyway.

## Deploy on Render (Blueprint) — recommended
1. Push the repo. In Render: **New → Blueprint**, select this repo (`render.yaml` defines the worker).
2. In the service's **Environment**, set the secret **`AGENT_PRIVATE_KEY_MAINNET`** (separate from dev).
3. Deploy. It runs `python -m src.main run-all 30` 24/7 and restarts on crash. Watch **Logs** for
   `serve_all_sweep` / `serviced` / `low_gas`.

## Deploy on Railway
1. **New Project → Deploy from GitHub repo.**
2. Service settings: **Dockerfile Path** = `agent/Dockerfile`, **Root Directory** = `/` (repo root
   is the build context — the image needs `config/`).
3. **Variables:** `CHAIN=mainnet`, `RPC_URL=https://forno.celo.org`, `AGENT_PRIVATE_KEY_MAINNET=<secret>`,
   `FEE_CURRENCY=USDm`, `SIMULATE_YIELD=true`, `SIMULATE_SELF=false`, `LOG_LEVEL=info`.
4. Deploy. Railway runs the Dockerfile `CMD` as a long-running service and restarts on failure.

## Local Docker (sanity check)
```bash
docker build -f agent/Dockerfile -t ajoai-agent .
docker run --rm -e CHAIN=sepolia -e RPC_URL=https://11142220.rpc.thirdweb.com \
  -e AGENT_PRIVATE_KEY=<dev-key> ajoai-agent
```

## Operational notes
- **One instance only.** Two workers double-triggering is *safe* (the contract makes
  double-trigger impossible) but wastes gas — run a single replica.
- **Cadence.** `run-all 30` reacts every 30s (good for short demo windows). For real
  weekly/monthly circles you can raise the interval; the sweep is cheap (reads only when idle).
- **Alerting.** Pipe the worker logs to your host's alerting and page on `low_gas` /
  repeated `serve_all_error`.
- **Alternative (zero-server).** For real long-period circles, a scheduled `serve-all`
  (GitHub Actions cron / cloud scheduler) every few minutes also works — but ≥5-min cron is
  too slow for a minutes-long on-camera rotation, which is why the always-on worker is default.
