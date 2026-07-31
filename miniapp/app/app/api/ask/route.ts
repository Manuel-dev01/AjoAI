import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress, getAddress, type Address } from "viem";
import { circleAbi, erc20Abi, STATE_NAMES } from "@/lib/abi";
import { activeChain } from "@/lib/chain";
import { factsFor, baselineAnswer, answerWithLlm, sanitizeHistory, type CircleSnapshot } from "@/lib/nl";

// Server-side NL Q&A endpoint (CLAUDE.md §1.3): reads chain state, derives a deterministic
// money-safe answer (lib/nl.ts), and has DeepSeek rephrase it in the member's language. Never
// moves money — see agent/src/nl.py for the Python agent's equivalent.
//
// The response carries `mode` ("llm" | "baseline") and, when deterministic, a `reason`. Without
// that, an unset key, an expired key and a 402 are indistinguishable from the outside — which is
// exactly how this endpoint silently served canned answers in production.

// In-memory rate limit so an anonymous loop can't drain the paid LLM_API_KEY budget. Over the
// limit we still answer — with the deterministic baseline (money-accurate, $0) — just without the
// LLM rephrase. Per serverless instance (Fluid Compute reuses instances), enough to blunt abuse.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 8; // LLM calls per client key per minute
const _llmHits = new Map<string, number[]>();
function llmAllowed(key: string): boolean {
  const now = Date.now();
  const arr = (_llmHits.get(key) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) {
    _llmHits.set(key, arr);
    return false;
  }
  arr.push(now);
  _llmHits.set(key, arr);
  return true;
}

export async function POST(req: Request) {
  let body: { circle?: string; member?: string; question?: string; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { circle, member, question } = body;
  const history = sanitizeHistory(body.history);
  if (!circle || !isAddress(circle) || !member || !isAddress(member)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  if (!question || typeof question !== "string" || !question.trim() || question.length > 300) {
    return NextResponse.json({ error: "Invalid question" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const rlKey = `${ip}:${member.toLowerCase()}`;

  const client = createPublicClient({ chain: activeChain, transport: http() });
  const c = { address: getAddress(circle), abi: circleAbi } as const;

  try {
    const [state, currentRound, slots, intendedPot, membersLength, token] = await client.multicall({
      contracts: [
        { ...c, functionName: "state" },
        { ...c, functionName: "currentRound" },
        { ...c, functionName: "slots" },
        { ...c, functionName: "intendedPot" },
        { ...c, functionName: "membersLength" },
        { ...c, functionName: "token" },
      ],
      allowFailure: false,
    });

    const memberCount = Number(membersLength);
    const slotCount = Number(slots);
    const round = Number(currentRound);

    const members = memberCount > 0
      ? await client.multicall({
          contracts: Array.from({ length: memberCount }, (_, i) => ({ ...c, functionName: "members", args: [BigInt(i)] } as const)),
          allowFailure: false,
        })
      : [];

    let rotation: readonly Address[] = [];
    let recipient: Address | null = null;
    let recipientDelinquent = false;
    if (state === 1 && slotCount > 0) {
      rotation = await client.multicall({
        contracts: Array.from({ length: slotCount }, (_, i) => ({ ...c, functionName: "recipientOf", args: [BigInt(i)] } as const)),
        allowFailure: false,
      });
      if (round < slotCount) {
        recipient = rotation[round] ?? null;
        if (recipient) {
          recipientDelinquent = await client.readContract({ ...c, functionName: "isDelinquent", args: [recipient] });
        }
      }
    }

    const [decimals, symbol] = await client.multicall({
      contracts: [
        { address: token, abi: erc20Abi, functionName: "decimals" },
        { address: token, abi: erc20Abi, functionName: "symbol" },
      ],
      allowFailure: false,
    });

    const snapshot: CircleSnapshot = {
      members,
      rotation,
      currentRound: round,
      recipient,
      recipientDelinquent,
      stateName: STATE_NAMES[state] ?? "Unknown",
      intendedPot,
      slots: slotCount,
      symbol: (symbol as string) || "units",
    };

    const facts = factsFor(snapshot, member, decimals);

    // The limiter is only consulted when a key exists, so a keyless deployment always reports
    // "no_api_key" instead of eventually reporting "rate_limited" for a call it never makes.
    // Over the limit we still answer — deterministically, money-accurately, for $0 — just
    // without the LLM rephrase.
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) console.warn("[ask] no_api_key — set LLM_API_KEY on the Vercel project serving this domain");
    if (apiKey && !llmAllowed(rlKey)) {
      console.warn("[ask] rate_limited", rlKey);
      return NextResponse.json({ answer: baselineAnswer(facts), mode: "baseline", reason: "rate_limited" });
    }

    const result = await answerWithLlm(question, facts, { apiKey, history });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to read circle state" }, { status: 500 });
  }
}
