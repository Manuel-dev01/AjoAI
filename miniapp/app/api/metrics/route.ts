import { NextResponse } from "next/server";
import { activeChain } from "@/lib/chain";
import { readSnapshot, readLiveOverlay, withTimeout, type Metrics } from "@/lib/metrics";

// Force dynamic. Strategy: serve the freshest SNAPSHOT (the full picture — circles, states,
// members, contributions, payouts, reputation, events — refreshed out-of-band by the agent
// ingest / cron and stored in Vercel Blob, with a committed file as the floor), and overlay only
// two cheap, fast-growing live numbers (agent tx count + total circles). Snapshot read and live
// overlay both run in parallel under hard timeouts, so the handler ALWAYS returns quickly,
// regardless of how many circles exist — no per-circle enumeration on the request path.
export const dynamic = "force-dynamic";

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };
const OVERLAY_DEADLINE_MS = 6_000;
const MEMO_TTL_MS = 30_000;
let memo: { data: Metrics; expiry: number } | null = null;

export async function GET() {
  if (memo && memo.expiry > Date.now()) {
    return NextResponse.json(memo.data, { headers: CACHE_HEADERS });
  }

  // Snapshot (internally timed) + cheap 2-call live overlay (deadline-bounded), in parallel.
  const [snap, overlay] = await Promise.all([
    readSnapshot().catch(() => null),
    withTimeout(readLiveOverlay(), OVERLAY_DEADLINE_MS).catch(() => null),
  ]);

  let data: Metrics;
  if (snap) {
    // Base on the snapshot; overlay the two headline numbers when the live read succeeded.
    data = overlay
      ? { ...snap, ...overlay, timestamp: new Date().toISOString() }
      : { ...snap, stale: true };
  } else if (overlay) {
    // No snapshot at all (extremely unlikely — the committed copy is bundled): minimal live shell.
    data = {
      chain: activeChain.name,
      chainId: activeChain.id,
      timestamp: new Date().toISOString(),
      ...overlay,
    } as unknown as Metrics;
  } else {
    return NextResponse.json({ error: "metrics temporarily unavailable" }, { status: 503 });
  }

  memo = { data, expiry: Date.now() + MEMO_TTL_MS };
  return NextResponse.json(data, { headers: CACHE_HEADERS });
}
