"""Tiny HTTP server that serves the latest metrics snapshot off the Railway volume.

The agent already computes the snapshot every sweep; instead of pushing it to Vercel Blob
(which hit the Hobby quota and got suspended), we persist it to the volume and serve it here.
The miniapp's /api/metrics fetches this URL (with the committed file as a fallback). No blob,
no ingest POST, no write quota. Runs in a daemon thread alongside the BlockingScheduler.
"""

from __future__ import annotations

import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Where the sweep writes the snapshot (Railway volume mount). Overridable for local runs.
SNAPSHOT_PATH = os.getenv("AJOAI_SNAPSHOT_PATH", "/data/metrics.json")


def _handler(path: str):
    class SnapshotHandler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 — stdlib API
            # Health check at "/", snapshot at any path (keep it simple + forgiving).
            if self.path in ("/health", "/healthz"):
                self._send(200, b'{"ok":true}')
                return
            try:
                with open(path, "rb") as f:
                    self._send(200, f.read())
            except FileNotFoundError:
                self._send(503, b'{"error":"no snapshot yet"}')
            except Exception as e:  # noqa: BLE001
                self._send(500, f'{{"error":"{e}"}}'.encode())

        def _send(self, code: int, body: bytes):
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")  # public read-only metrics
            self.send_header("Cache-Control", "public, max-age=30")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):  # silence per-request stderr logging
            pass

    return SnapshotHandler


def start_snapshot_server(log, path: str = SNAPSHOT_PATH) -> None:
    """Start the snapshot server in a daemon thread. Binds to $PORT (Railway) or 8080."""
    port = int(os.getenv("PORT", "8080"))
    try:
        srv = ThreadingHTTPServer(("0.0.0.0", port), _handler(path))
    except Exception as e:  # noqa: BLE001 — never let a bind failure kill the agent
        log.warning("snapshot_server_bind_error", port=port, error=str(e))
        return
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    log.info("snapshot_server_started", port=port, path=path)
