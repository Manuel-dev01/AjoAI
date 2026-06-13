"""Poll a Self Agent ID registration session to completion, then record the result.

Reads agent/.self_session.json (written when the session was started), polls
GET /api/agent/register/status until stage == 'registered' (the human must scan their passport
in the Self app first), then writes config/self-agent-id.mainnet.json and patches the
selfAgentId field in both agent-card.json copies.

Run:  agent/.venv/Scripts/python -m scripts.self_poll [max_polls]
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SESS = REPO_ROOT / "agent" / ".self_session.json"
BASE = "https://app.ai.self.xyz"


def _get(url: str, token: str | None = None) -> dict:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def _patch_card(card_path: Path, self_agent_id) -> None:
    if not card_path.exists():
        return
    card = json.loads(card_path.read_text(encoding="utf-8"))
    card["selfAgentId"] = self_agent_id
    card_path.write_text(json.dumps(card, indent=2) + "\n", encoding="utf-8")
    print(f"patched {card_path}")


def main() -> None:
    max_polls = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    sess = json.loads(SESS.read_text(encoding="utf-8"))
    token = sess["sessionToken"]
    status_url = f"{BASE}/api/agent/register/status"

    last = None
    for i in range(max_polls):
        try:
            st = _get(status_url, token=token)
        except Exception as e:  # noqa: BLE001
            print(f"[{i}] poll error: {type(e).__name__}")
            time.sleep(5)
            continue
        # the API rotates the session token each call — refresh it for the next poll
        if st.get("sessionToken"):
            token = st["sessionToken"]
        stage = st.get("stage")
        if stage != last:
            print(f"[{i}] stage={stage} {json.dumps({k: v for k, v in st.items() if k != 'qrData'})[:300]}")
            last = stage
        if stage == "registered":
            out = {
                "agentAddress": sess.get("agentAddress"),
                "humanAddress": sess.get("humanAddress"),
                "network": sess.get("network"),
                "mode": sess.get("mode"),
                "status": st,
            }
            (REPO_ROOT / "config" / "self-agent-id.mainnet.json").write_text(
                json.dumps(out, indent=2), encoding="utf-8")
            sid = st.get("selfAgentId") or st.get("agentId") or sess.get("agentAddress")
            self_ref = {
                "agentAddress": sess.get("agentAddress"),
                "humanAddress": sess.get("humanAddress"),
                "network": "celo-mainnet",
                "id": sid,
            }
            _patch_card(REPO_ROOT / "config" / "agent-card.json", self_ref)
            _patch_card(REPO_ROOT / "miniapp" / "public" / ".well-known" / "agent-card.json", self_ref)
            print("REGISTERED — wrote config/self-agent-id.mainnet.json + patched cards")
            return
        time.sleep(5)
    print(f"not registered after {max_polls} polls — re-run once you've scanned, or restart the session if expired")


if __name__ == "__main__":
    main()
