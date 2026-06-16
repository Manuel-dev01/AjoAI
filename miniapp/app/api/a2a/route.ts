import { NextResponse } from "next/server";

// AjoAI A2A endpoint (Agent2Agent protocol, JSON-RPC 2.0 over HTTP).
// GET  → the A2A Agent Card (discovery). POST → A2A JSON-RPC methods.
// READ-ONLY surface: it explains chain state and points to the MCP tools; it never moves money
// (CLAUDE.md §1.3 — the contract enforces all money rules, the agent only triggers legal transitions).
// This is the endpoint declared as the "A2A" service in the ERC-8004 agent card, so 8004scan can
// health-check a real A2A server (a valid card on GET, valid JSON-RPC on POST) — not a static file.

const BASE = "https://ajo-ai-tan.vercel.app";
const PROTOCOL_VERSION = "0.3.0";
const VERSION = "0.1.0";

// Open CORS so any agent/scanner (incl. browser-based health probes) can reach this endpoint —
// a missing preflight/CORS is the usual reason a live endpoint reads as "unknown" to a checker.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

const SKILLS = [
  { id: "rosca.create", name: "Create circle", description: "Deploy a savings circle with fixed contribution, period, and rotation.", tags: ["rosca", "savings", "celo"] },
  { id: "rosca.contribute", name: "Collect contributions", description: "Pull each member's periodic contribution in a Mento stablecoin.", tags: ["rosca", "payments", "stablecoin"] },
  { id: "rosca.payout", name: "Autonomous payout", description: "Pay the full pot to the round's recipient on schedule, no human in the loop.", tags: ["rosca", "autonomous", "payout"] },
  { id: "rosca.default-recovery", name: "Default recovery", description: "Cover missed rounds from security deposits; write negative ERC-8004 reputation.", tags: ["rosca", "reputation", "erc-8004"] },
  { id: "rosca.reputation", name: "Savings-credit score", description: "Issue a portable ERC-8004 savings-credit score per member.", tags: ["reputation", "credit", "erc-8004"] },
  { id: "nl.query", name: "Natural-language member Q&A", description: "Answer member questions in English, Nigerian Pidgin, and Swahili (explains chain state; never authorizes money).", tags: ["nlp", "multilingual", "read-only"] },
];

const AGENT_CARD = {
  protocolVersion: PROTOCOL_VERSION,
  name: "AjoAI",
  description:
    "Autonomous rotating-savings (ajo/esusu/chama/stokvel) agent on Celo. A2A surface is read-only: query circles, scores, and member status in natural language. The contract enforces every money rule; the agent never moves funds via A2A.",
  url: `${BASE}/api/a2a`,
  preferredTransport: "JSONRPC",
  version: VERSION,
  iconUrl: `${BASE}/icon.png`,
  documentationUrl: BASE,
  provider: { organization: "AjoAI", url: BASE },
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain", "application/json"],
  skills: SKILLS,
};

function textFromMessage(message: unknown): string {
  const parts = (message as { parts?: { kind?: string; text?: string }[] } | undefined)?.parts ?? [];
  return parts.filter((p) => p?.kind === "text" && typeof p.text === "string").map((p) => p.text).join(" ").trim();
}

function agentMessage(text: string) {
  return {
    kind: "message",
    role: "agent",
    messageId: globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`,
    parts: [{ kind: "text", text }],
  };
}

const INFO =
  "AjoAI is an autonomous rotating-savings agent on Celo. This A2A surface is read-only — for live data " +
  "query the MCP endpoint at /api/mcp (tools: get_circle, get_score, ask, list_circles). The smart contract " +
  "enforces all money rules; the agent only triggers legal on-chain transitions and never moves funds via A2A.";

type RpcReq = { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  return NextResponse.json(AGENT_CARD, { headers: CORS });
}

export async function POST(req: Request) {
  let body: RpcReq;
  try { body = await req.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS }); }
  const { id, method, params } = body;
  const ok = (result: unknown) => NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result }, { headers: CORS });
  const err = (code: number, message: string) => NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { headers: CORS });

  switch (method) {
    case "message/send": {
      const userText = textFromMessage(params?.message);
      const reply = userText ? `Received: "${userText.slice(0, 200)}". ${INFO}` : INFO;
      return ok(agentMessage(reply));
    }
    case "agent/getAuthenticatedExtendedCard":
      return ok(AGENT_CARD);
    case "tasks/get":
    case "tasks/cancel":
      return err(-32001, "Task not found (this A2A surface is stateless and read-only)");
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}
