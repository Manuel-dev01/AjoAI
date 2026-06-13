# Configuring Self Agent ID for the AjoAI agent

**Why:** Self Agent ID is on-chain **proof-of-human identity for an agent** (built on EIP-8004):
it binds the agent's keypair to a human's passport via a ZK proof and mints a **soulbound NFT**.
It's the entrypoint to the **Celo Agent Visa**. For this hackathon it's **not required but
beneficial for Track 1 (Best Agent, $2,500)** — and a judge is **Marek Olszewski, co-founder of
Celo *and* Self**. (You *must* be a real human with a supported passport; see the region caveat.)

This is **human-gated** (a passport scan in the Self mobile app) and **wallet/identity-personal**,
so *you* complete it — it can't be automated. Two paths:

## Path A — Web UI (easiest)
1. Go to **https://app.ai.self.xyz/register**.
2. Choose mode **agent-identity**, network **Celo Sepolia (testnet)** (chainId 11142220) — or
   **mainnet** for the final submission.
3. Enter the agent wallet: **`0x5b92F8A222704d522Fb3dCf8d734C3DAF51Fc4f1`** (our agent key;
   the one baked into the factory). Follow the guided flow.
4. Scan the QR with the **Self mobile app**, then scan your **passport (NFC)** to generate the
   ZK proof. A **soulbound ERC-721** is minted binding the agent to your verified identity.

## Path B — CLI (per github.com/selfxyz/self-agent-id — confirm exact package at run time)
```bash
npm install -g @selfxyz/agent-sdk        # provides the `self-agent` CLI (verify on the repo)
self-agent register init  --mode agent-identity --human-address <YOUR_WALLET> --network testnet
self-agent register open  --session .self/session.json     # shows QR → scan in Self app + passport
self-agent register wait  --session .self/session.json     # polls until on-chain
```
`--human-address` is **your** wallet (receives the soulbound NFT). The agent keypair is bound to it.

## Region caveat (important for the builder in Lagos)
If Self is **not available in your country**, the hackathon FAQ says: submit a **screenshot of the
Self app's "not supported in your region" message** with your submission. Capture that screenshot
now if applicable — it satisfies the requirement.

## After you have a Self Agent ID
1. Add it to the agent card (`config/agent-card.json` + `miniapp/public/.well-known/agent-card.json`):
   add a `"selfAgentId"` field (the NFT id / identity URL) so it shows alongside the ERC-8004
   `registrations`.
2. Include it in the **registration tweet** (with the ERC-8004 `agentId` 307), tagging
   **@Celo + @CeloDevs**.

## Relationship to our other identity (no conflict)
- **ERC-8004 / 8004scan** (agentId 307) = public identity + reputation + discoverability (Track 3).
- **Self Agent ID** = privacy-preserving proof the agent is human-backed (Track 1 booster + Agent Visa).
Both point at the same agent wallet; they're complementary layers.
