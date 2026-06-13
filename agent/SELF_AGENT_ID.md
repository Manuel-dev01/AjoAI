# Configuring Self Agent ID for the AjoAI agent

**Why:** Self Agent ID is on-chain **proof-of-human identity for an agent** (built on EIP-8004):
it binds the agent's keypair to a human's passport via a ZK proof and mints a **soulbound NFT**.
It's the entrypoint to the **Celo Agent Visa**. For this hackathon it's **not required but
beneficial for Track 1 (Best Agent, $2,500)**, and a judge is **Marek Olszewski, co-founder of
Celo *and* Self**. (You *must* be a real human with a supported passport; see the region caveat.)

Only the **passport scan** is human-gated; the registration **session is bootstrapped
programmatically** by the agent (CLAUDE.md §8). Mainnet agent wallet (humanAddress / owner):
**`0x8974881e39a5ef62214929b6caa6ec0c6e7d47c7`** (the key baked into the mainnet factory).

## Path A, Agent bootstrap (what we use; mainnet)
The agent drives the Self API; you only scan. See `scripts/self_poll.py`.
1. Discover the API: `curl https://app.ai.self.xyz/api/agent/bootstrap` (OpenAPI spec).
2. Start a session, `POST /api/agent/register` with
   `{"mode":"linked","network":"mainnet","humanAddress":"0x8974…d47c7"}` → returns a
   `sessionToken`, `scanUrl`, `deepLink`, QR, and a server-generated Self agent address
   (`linked` mode). Saved to gitignored `agent/.self_session.json`.
3. **You scan:** open the `scanUrl` (or `deepLink`) → Self app → scan your **passport (NFC)**.
4. The agent polls: `agent/.venv/Scripts/python -m scripts.self_poll` polls
   `GET /api/agent/register/status?token=…` until stage `registered`, then writes
   `config/self-agent-id.mainnet.json` and patches `selfAgentId` in both agent-card.json copies.
   A **soulbound NFT** binds the Self agent identity to your passport-verified `0x8974…` owner.

## Path B, Web UI (fallback)
Go to **https://app.ai.self.xyz/register**, choose **agent-identity**, network **Celo mainnet**,
enter the agent wallet **`0x8974881e39a5ef62214929b6caa6ec0c6e7d47c7`**, scan QR + passport.

## Region caveat (important for the builder in Lagos)
If Self is **not available in your country**, the hackathon FAQ says: submit a **screenshot of the
Self app's "not supported in your region" message** with your submission. Capture that screenshot
now if applicable, it satisfies the requirement.

## After you have a Self Agent ID
1. Add it to the agent card (`config/agent-card.json` + `miniapp/public/.well-known/agent-card.json`):
   add a `"selfAgentId"` field (the NFT id / identity URL) so it shows alongside the ERC-8004
   `registrations`.
2. Include it in the **registration tweet** (with the ERC-8004 mainnet `agentId` 9339), tagging
   **@Celo + @CeloDevs**.

## Relationship to our other identity (no conflict)
- **ERC-8004 / 8004scan** (agentId 307) = public identity + reputation + discoverability (Track 3).
- **Self Agent ID** = privacy-preserving proof the agent is human-backed (Track 1 booster + Agent Visa).
Both point at the same agent wallet; they're complementary layers.
