import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress, getAddress, formatUnits, type Address } from "viem";
import { circleAbi, erc20Abi, factoryAbi, reputationAbi, STATE_NAMES } from "@/lib/abi";
import { activeChain, CONTRACTS } from "@/lib/chain";
import { factsFor, baselineAnswer, type CircleSnapshot } from "@/lib/nl";

// AjoAI MCP server (Model Context Protocol over Streamable HTTP / JSON-RPC 2.0).
// READ-ONLY: it only reads on-chain state and explains it — it never moves money or sends a tx
// (CLAUDE.md §1.3). Lets other agents query AjoAI circles, scores, and member status.

const factory = CONTRACTS.circleFactory as Address;
const reputation = CONTRACTS.reputationLedger as Address;
const PROTOCOL_VERSION = "2025-06-18";
const SERVER = { name: "AjoAI", version: "0.1.0" };

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
      return { text: baselineAnswer(facts) };
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

export async function POST(req: Request) {
  let body: RpcReq;
  try { body = await req.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }); }
  const { id, method, params } = body;
  const ok = (result: unknown) => NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });

  // Notifications (no id) expect no response body.
  if (id === undefined && typeof method === "string" && method.startsWith("notifications/")) return new NextResponse(null, { status: 202 });

  switch (method) {
    case "initialize":
      return ok({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER });
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
      return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } }, { status: 200 });
  }
}

export async function GET() {
  // Lightweight discovery for humans / health checks (MCP itself uses POST JSON-RPC).
  return NextResponse.json({ name: SERVER.name, protocol: "mcp", protocolVersion: PROTOCOL_VERSION, transport: "streamable-http", tools: TOOLS.map((t) => t.name) });
}
