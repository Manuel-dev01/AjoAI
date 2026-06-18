import { NextResponse } from "next/server";
import {
  readCallState,
  aggregateEvents,
  assembleMetrics,
  writeBlobSnapshot,
  type Metrics,
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

// POST ingest — the hosted agent computes the full snapshot every sweep and pushes it here, so the
// Blob stays near-real-time without depending on Vercel's cron frequency (Hobby throttles crons).
// Requires the CRON_SECRET bearer (must be set; no open ingest).
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as Metrics;
    // Minimal shape check — must look like a metrics snapshot, not arbitrary data.
    if (!body || typeof body !== "object" || typeof body.circlesCreated !== "number") {
      return NextResponse.json({ error: "invalid metrics payload" }, { status: 400 });
    }
    const metrics: Metrics = { ...body, timestamp: new Date().toISOString() };
    const stored = await writeBlobSnapshot(metrics);
    return NextResponse.json({ ok: true, stored });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
