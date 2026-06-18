import { NextResponse } from "next/server";
import {
  readCallState,
  readSnapshot,
  looksEmpty,
  withEventsFrom,
  type Metrics,
} from "@/lib/metrics";

// Force dynamic — reads live chain data, but bounded: only cheap call-state metrics are read
// live (circles, members, contributions, payouts, reputation, agent txs). Event-derived
// figures (late payments, simulated yield) come from the freshest snapshot (Vercel Blob, kept
// current by the /api/metrics/refresh cron, else the committed file). An in-process cache and
// the CDN header below keep this fast and bound RPC load.
export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
};

// Overall internal deadline so the handler ALWAYS returns before the client's 25s abort.
const LIVE_DEADLINE_MS = 12_000;
// In-process memo so warm invocations / "refresh" clicks don't re-hit the RPC.
const MEMO_TTL_MS = 60_000;
let memo: { data: Metrics; expiry: number } | null = null;

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("live read deadline")), ms)),
  ]);
}

export async function GET() {
  if (memo && memo.expiry > Date.now()) {
    return NextResponse.json(memo.data, { headers: CACHE_HEADERS });
  }

  try {
    // Live call-state + snapshot (for event fields / fallback) in parallel, under one deadline.
    const [call, snap] = await withDeadline(
      Promise.all([readCallState(), readSnapshot()]),
      LIVE_DEADLINE_MS
    );

    const live: Metrics = { ...call.metrics, timestamp: new Date().toISOString() } as Metrics;

    // If the live read came back empty (likely a transient RPC failure) but we have a
    // non-empty snapshot, prefer the snapshot over showing all-zeros.
    if (looksEmpty(live) && snap && !looksEmpty(snap)) {
      return NextResponse.json({ ...snap, stale: true }, { headers: CACHE_HEADERS });
    }

    const merged = withEventsFrom(live, snap);
    memo = { data: merged, expiry: Date.now() + MEMO_TTL_MS };
    return NextResponse.json(merged, { headers: CACHE_HEADERS });
  } catch (err) {
    // Deadline or RPC failure — serve the freshest snapshot rather than hang/500.
    const snap = await readSnapshot().catch(() => null);
    if (snap) {
      return NextResponse.json({ ...snap, stale: true }, { headers: CACHE_HEADERS });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
