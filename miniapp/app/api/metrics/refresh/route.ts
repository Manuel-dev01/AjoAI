import { NextResponse } from "next/server";
import {
  readCallState,
  aggregateEvents,
  assembleMetrics,
  writeBlobSnapshot,
} from "@/lib/metrics";

// Cron target — recomputes the FULL metrics out of band (call-state + the unbounded
// full-history event scan in 1,000-block chunks) and persists them to Vercel Blob, so the
// user-facing /api/metrics can serve event-derived figures (late payments, yield) without
// scanning the chain on every request. Runs server-side without the 25s client constraint.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel cron invocations carry this header; allow them, plus an explicit bearer for
  // manual/local refreshes. If no secret is configured, allow (dev convenience).
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const call = await readCallState();
    const ev = await aggregateEvents(call.circles);
    const metrics = assembleMetrics(call, ev);
    const stored = await writeBlobSnapshot(metrics);
    return NextResponse.json({ ok: true, stored, metrics });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
