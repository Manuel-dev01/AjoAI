import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress, getAddress, formatUnits, type Address } from "viem";
import { circleAbi, erc20Abi, factoryAbi, reputationAbi, STATE_NAMES } from "@/lib/abi";
import { activeChain, CONTRACTS } from "@/lib/chain";
import { factsFor, answerWithLlm, type CircleSnapshot } from "@/lib/nl";

// AjoAI MCP server (Model Context Protocol over Streamable HTTP / JSON-RPC 2.0).
// READ-ONLY: it only reads on-chain state and explains it — it never moves money or sends a tx
// (CLAUDE.md §1.3). Lets other agents query AjoAI circles, scores, and member status.

const factory = CONTRACTS.circleFactory as Address;
const reputation = CONTRACTS.reputationLedger as Address;
const PROTOCOL_VERSION = "2025-06-18";
const SERVER = { name: "AjoAI", version: "0.1.0" };

// Open CORS so any agent/scanner (incl. browser-based health probes) can reach this endpoint.
// Mcp-Session-Id must be exposed, or a browser client can never read the id we issue.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
} as const;

// Streamable HTTP sessions. The server is stateless per request (every tool call reads chain state
// fresh), so a session is just an issued id we accept back — it exists to satisfy the transport,
// not to hold state. Serverless instances are ephemeral and not shared, so ids are NOT tracked in
// memory: any well-formed id we could have issued is honoured. Nothing is authorised by it.
const SESSION_HEADER = "Mcp-Session-Id";
const SESSION_RE = /^[0-9a-f]{32}$/;
const newSessionId = () => randomUUID().replace(/-/g, "");

const client = () => createPublicClient({ chain: activeChain, transport: http() });

const TOOLS = [
  {
    name: "get_circle",
    description: "Read the on-chain state of an AjoAI savings circle (state, round, pot, members, recipient).",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "Circle contract address (0x...)" } },
      required: ["address"],
    },
  },
  {
    name: "get_score",
    description: "Read a member's portable ERC-8004 savings-credit score (score, on-time, late, defaults, completed circles).",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "Member wallet address (0x...)" } },
      required: ["address"],
    },
  },
  {
    name: "ask",
    description: "Ask a money-accurate question about a member's situation in a circle (deterministic, never moves money).",
    inputSchema: {
      type: "object",
      properties: {
        circle: { type: "string", description: "Circle contract address" },
        member: { type: "string", description: "Member wallet address" },
        question: { type: "string", description: "The question to answer" },
      },
      required: ["circle", "member", "question"],
    },
  },
  {
    name: "list_circles",
    description: "List all AjoAI circle addresses created by the factory on the active chain.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function snapshotOf(circle: Address): Promise<{ snap: CircleSnapshot; decimals: number; contribution: bigint; roundsPaid: bigint; symbol: string }> {
  const c = client();
  const base = { address: circle, abi: circleAbi } as const;
  const [state, currentRound, slots, intendedPot, contribution, membersLength, token, roundsPaid] = await c.multicall({
    contracts: [
      { ...base, functionName: "state" },
      { ...base, functionName: "currentRound" },
      { ...base, functionName: "slots" },
      { ...base, functionName: "intendedPot" },
      { ...base, functionName: "contribution" },
      { ...base, functionName: "membersLength" },
      { ...base, functionName: "token" },
      { ...base, functionName: "roundsPaid" },
    ],
    allowFailure: false,
  });
  const memberCount = Number(membersLength);
  const members = memberCount > 0
    ? await c.multicall({
        contracts: Array.from({ length: memberCount }, (_, i) => ({ ...base, functionName: "members", args: [BigInt(i)] } as const)),
        allowFailure: false,
      })
    : [];
  let rotation: readonly Address[] = [];
  let recipient: Address | null = null;
  let recipientDelinquent = false;
  if (state === 1 && Number(slots) > 0) {
    rotation = await c.multicall({
      contracts: Array.from({ length: Number(slots) }, (_, i) => ({ ...base, functionName: "recipientOf", args: [BigInt(i)] } as const)),
      allowFailure: false,
    });
    recipient = rotation[Number(currentRound)] ?? null;
    if (recipient) recipientDelinquent = await c.readContract({ ...base, functionName: "isDelinquent", args: [recipient] });
  }
  const [decimals, symbol] = await Promise.all([
    c.readContract({ address: token as Address, abi: erc20Abi, functionName: "decimals" }),
    c.readContract({ address: token as Address, abi: erc20Abi, functionName: "symbol" }).catch(() => "tokens"),
  ]);
  const snap: CircleSnapshot = {
    members: members as Address[],
    rotation,
    currentRound: Number(currentRound),
    recipient,
    recipientDelinquent,
    stateName: STATE_NAMES[state] ?? "Unknown",
    intendedPot,
    slots: Number(slots),
    symbol,
  };
  return { snap, decimals, contribution, roundsPaid, symbol };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  try {
    if (name === "get_circle") {
      const a = String(args.address ?? "");
      if (!isAddress(a)) return { text: "Invalid circle address.", isError: true };
      const { snap, decimals, contribution, roundsPaid, symbol } = await snapshotOf(getAddress(a));
      const pot = `${formatUnits(snap.intendedPot, decimals)} ${symbol}`;
      const contrib = `${formatUnits(contribution, decimals)} ${symbol}`;
      return { text: [
        `Circle ${a}`,
        `State: ${snap.stateName}`,
        `Round: ${snap.currentRound} (rounds paid: ${roundsPaid})`,
        `Members joined: ${snap.members.length}`,
        `Contribution: ${contrib} per round  ·  Pot: ${pot}`,
        snap.recipient ? `Current recipient: ${snap.recipient}${snap.recipientDelinquent ? " (delinquent — payout withheld)" : ""}` : "",
      ].filter(Boolean).join("\n") };
    }
    if (name === "get_score") {
      const a = String(args.address ?? "");
      if (!isAddress(a)) return { text: "Invalid member address.", isError: true };
      const s = await client().readContract({ address: reputation, abi: reputationAbi, functionName: "scoreOf", args: [getAddress(a)] });
      const [score, onTime, late, defaults, completed] = s as readonly [bigint, bigint, bigint, bigint, bigint];
      return { text: [
        `Savings-credit score for ${a}`,
        `Score: ${score}`,
        `On-time contributions: ${onTime}  ·  Late: ${late}  ·  Defaults: ${defaults}`,
        `Circles completed: ${completed}`,
      ].join("\n") };
    }
    if (name === "ask") {
      const circle = String(args.circle ?? "");
      const member = String(args.member ?? "");
      const question = String(args.question ?? "");
      if (!isAddress(circle) || !isAddress(member)) return { text: "Invalid circle or member address.", isError: true };
      if (!question.trim()) return { text: "Empty question.", isError: true };
      const { snap, decimals } = await snapshotOf(getAddress(circle));
      const facts = factsFor(snap, member, decimals);
      // Same path the human-facing /app/api/ask route takes, so an agent asking a question gets
      // a real answer to THAT question rather than the canned baseline (which ignored it).
      const { answer } = await answerWithLlm(question, facts, { apiKey: process.env.LLM_API_KEY });
      return { text: answer };
    }
    if (name === "list_circles") {
      const c = client();
      const len = Number(await c.readContract({ address: factory, abi: factoryAbi, functionName: "allCirclesLength" }));
      if (len === 0) return { text: "No circles yet." };
      const addrs = await c.multicall({
        contracts: Array.from({ length: len }, (_, i) => ({ address: factory, abi: factoryAbi, functionName: "allCircles", args: [BigInt(i)] } as const)),
        allowFailure: false,
      });
      return { text: `${len} circle(s):\n${(addrs as Address[]).join("\n")}` };
    }
    return { text: `Unknown tool: ${name}`, isError: true };
  } catch {
    return { text: "Failed to read on-chain state.", isError: true };
  }
}

type RpcReq = { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  let body: RpcReq;
  try { body = await req.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS }); }
  const { id, method, params } = body;

  // A client that sends a session id must send one we could have issued.
  const session = req.headers.get(SESSION_HEADER);
  if (session && !SESSION_RE.test(session)) {
    return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid session" } }, { status: 404, headers: CORS });
  }
  // `initialize` mints the session; every later response echoes whichever id the client presented.
  const issued = method === "initialize" ? newSessionId() : session;
  const headers = issued ? { ...CORS, [SESSION_HEADER]: issued } : CORS;
  const ok = (result: unknown) => NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result }, { headers });

  // Notifications (no id) expect no response body.
  if (id === undefined && typeof method === "string" && method.startsWith("notifications/")) return new NextResponse(null, { status: 202, headers });

  switch (method) {
    case "initialize":
      // We speak exactly one revision; the client decides whether it can live with it.
      return ok({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: "Read-only AjoAI tools. Query savings circles, member scores, and circle state on Celo. Nothing here moves money.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(params?.name ?? "");
      const args = (params?.arguments as Record<string, unknown>) ?? {};
      const { text, isError } = await callTool(name, args);
      return ok({ content: [{ type: "text", text }], isError: Boolean(isError) });
    }
    default:
      return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } }, { status: 200, headers });
  }
}

export async function GET(req: Request) {
  // Streamable HTTP: an Accept: text/event-stream GET opens the server->client notification
  // stream. This server never initiates requests (all four tools are request/response), so the
  // stream carries only keep-alive comments and stays open until the client drops it — which is
  // exactly what the transport expects of a server with nothing to push.
  if ((req.headers.get("accept") ?? "").includes("text/event-stream")) {
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(": ajoai mcp stream open\n\n"));
        const tick = setInterval(() => {
          try { controller.enqueue(enc.encode(": keep-alive\n\n")); } catch { clearInterval(tick); }
        }, 15_000);
        // Vercel functions are time-bounded; close cleanly so clients reconnect rather than hang.
        setTimeout(() => { clearInterval(tick); try { controller.close(); } catch { /* already closed */ } }, 240_000);
      },
    });
    return new NextResponse(stream, {
      headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
    });
  }
  // Lightweight discovery for humans / health checks (MCP itself uses POST JSON-RPC).
  return NextResponse.json({ name: SERVER.name, protocol: "mcp", protocolVersion: PROTOCOL_VERSION, transport: "streamable-http", tools: TOOLS.map((t) => t.name) }, { headers: CORS });
}

export async function DELETE(req: Request) {
  // Session teardown. Nothing is retained server-side, so this always succeeds for a well-formed
  // id — it exists so a spec-compliant client can end its session explicitly.
  const session = req.headers.get(SESSION_HEADER);
  if (session && !SESSION_RE.test(session)) return new NextResponse(null, { status: 404, headers: CORS });
  return new NextResponse(null, { status: 204, headers: CORS });
}
