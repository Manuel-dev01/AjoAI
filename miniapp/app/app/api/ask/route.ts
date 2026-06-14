import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress, getAddress, type Address } from "viem";
import { circleAbi, erc20Abi, STATE_NAMES } from "@/lib/abi";
import { activeChain } from "@/lib/chain";
import { factsFor, baselineAnswer, SYSTEM_PROMPT, NL_MODEL, type CircleSnapshot } from "@/lib/nl";

// Server-side NL Q&A endpoint (CLAUDE.md §1.3): reads chain state, derives a deterministic
// money-safe answer (lib/nl.ts), and optionally has Claude rephrase it in the member's
// language. Never moves money — see agent/src/nl.py for the Python agent's equivalent.
export async function POST(req: Request) {
  let body: { circle?: string; member?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { circle, member, question } = body;
  if (!circle || !isAddress(circle) || !member || !isAddress(member)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  if (!question || typeof question !== "string" || !question.trim() || question.length > 500) {
    return NextResponse.json({ error: "Invalid question" }, { status: 400 });
  }

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

    const decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });

    const snapshot: CircleSnapshot = {
      members,
      rotation,
      currentRound: round,
      recipient,
      recipientDelinquent,
      stateName: STATE_NAMES[state] ?? "Unknown",
      intendedPot,
    };

    const facts = factsFor(snapshot, member, decimals);
    const baseline = baselineAnswer(facts);

    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) return NextResponse.json({ answer: baseline });

    const context = `FACTS (authoritative, from chain):
- circle state: ${facts.state}
- is member: ${facts.isMember}
- has received payout: ${facts.hasReceived}
- delinquent: ${facts.isDelinquent}
- rounds until your turn: ${facts.roundsUntilYourTurn}
- pot: ${facts.intendedPotStr}
- deterministic answer to relay: ${baseline}
`;

    try {
      // DeepSeek (OpenAI-compatible chat completions). Explanation only; the deterministic
      // baseline is passed as authoritative so the model can only rephrase, never invent facts.
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: NL_MODEL,
          max_tokens: 200,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `${context}\nMember asks: ${question}` },
          ],
        }),
      });
      if (!res.ok) return NextResponse.json({ answer: baseline });
      const data = await res.json();
      const text = (data?.choices?.[0]?.message?.content ?? "").trim();
      return NextResponse.json({ answer: text || baseline });
    } catch {
      return NextResponse.json({ answer: baseline });
    }
  } catch {
    return NextResponse.json({ error: "Failed to read circle state" }, { status: 500 });
  }
}
