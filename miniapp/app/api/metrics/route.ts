import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { activeChain, CONTRACTS } from "@/lib/chain";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Force dynamic — serves pre-computed JSON when available, falls back to live RPC.
export const dynamic = "force-dynamic";

// ── viem client (used only as fallback when no pre-computed file exists) ──
const RPC_URL = activeChain.testnet
  ? "https://11142220.rpc.thirdweb.com"
  : "https://42220.rpc.thirdweb.com";
const client = createPublicClient({
  chain: activeChain,
  transport: http(RPC_URL, { timeout: 10_000 }),
});

// ── ABIs ─────────────────────────────────────────────────────────────────
const factoryAbi = [
  parseAbiItem("function allCirclesLength() view returns (uint256)"),
  parseAbiItem("function allCircles(uint256) view returns (address)"),
] as const;

const circleAbi = [
  parseAbiItem("function state() view returns (uint8)"),
  parseAbiItem("function slots() view returns (uint8)"),
  parseAbiItem("function roundsPaid() view returns (uint256)"),
  parseAbiItem("function contribution() view returns (uint256)"),
  parseAbiItem("function membersLength() view returns (uint256)"),
  parseAbiItem("function members(uint256) view returns (address)"),
] as const;

const scoreOfAbi = [
  parseAbiItem(
    "function scoreOf(address) view returns (int256 score, uint64 onTime, uint64 late, uint64 defaults, uint64 completed)"
  ),
] as const;

// Batch multicall — split large arrays into chunks to avoid RPC limits.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function batchMulticall(contracts: any[], batchSize = 40): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = [];
  for (let i = 0; i < contracts.length; i += batchSize) {
    const batch = contracts.slice(i, i + batchSize);
    const r = await client.multicall({ contracts: batch, allowFailure: true });
    results.push(...r);
  }
  return results;
}

// ── pre-computed file ────────────────────────────────────────────────────
// The agent writes this after each sweep via MetricsCollector.export_json().
const METRICS_FILE = join(process.cwd(), "public", "data", "metrics.json");

function readPreComputed(): Record<string, unknown> | null {
  try {
    if (!existsSync(METRICS_FILE)) return null;
    const raw = readFileSync(METRICS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── route handler ────────────────────────────────────────────────────────

export async function GET() {
  // 1. Try the pre-computed file first (instant, no RPC).
  const cached = readPreComputed();
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  }

  // 2. Fallback: live chain query (slower, may timeout on Vercel Hobby).
  try {
    const factory = CONTRACTS.circleFactory as Address;
    const repAddr = CONTRACTS.reputationLedger as Address;
    const agentAddr = (activeChain.testnet
      ? "0x5b92F8A222704d522Fb3dCf8d734C3DAF51Fc4f1"
      : "0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7") as Address;

    // Fire reputation + agent tx count IN PARALLEL with the circle sweep.
    const repPromise = Promise.allSettled([
      client.readContract({
        address: repAddr,
        abi: scoreOfAbi,
        functionName: "scoreOf",
        args: [agentAddr],
      }),
      client.getTransactionCount({ address: agentAddr }),
    ]);

    let circleCount = 0;
    let circles: Address[] = [];

    try {
      const len = await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "allCirclesLength",
      });
      circleCount = Number(len);

      if (circleCount > 0) {
        const results = await client.multicall({
          contracts: Array.from({ length: circleCount }, (_, i) => ({
            address: factory,
            abi: factoryAbi,
            functionName: "allCircles" as const,
            args: [BigInt(i)] as const,
          })),
          allowFailure: true,
        });
        circles = results
          .filter((r) => r.status === "success")
          .map((r) => r.result as Address);
      }
    } catch {
      // factory read failed
    }

    const circleStates = { completed: 0, defaulted: 0, dissolved: 0, active: 0, forming: 0 };
    const uniqueMembers = new Set<string>();
    let totalContributions = 0n;
    let totalPayouts = 0n;
    let contributionCount = 0;
    let payoutCount = 0;

    if (circles.length > 0) {
      const stateContracts = circles.flatMap((addr) => [
        { address: addr, abi: circleAbi, functionName: "state" as const },
        { address: addr, abi: circleAbi, functionName: "slots" as const },
        { address: addr, abi: circleAbi, functionName: "roundsPaid" as const },
        { address: addr, abi: circleAbi, functionName: "contribution" as const },
        { address: addr, abi: circleAbi, functionName: "membersLength" as const },
      ]);

      const stateResults = await batchMulticall(stateContracts, 40);

      const circleData: {
        addr: Address;
        state: number;
        slots: number;
        roundsPaid: number;
        contribution: bigint;
        membersLen: number;
      }[] = [];

      for (let i = 0; i < circles.length; i++) {
        const base = i * 5;
        const getNum = (idx: number, def: number) => {
          const r = stateResults[base + idx];
          return r && r.status === "success" ? Number(r.result as bigint) : def;
        };
        const getBig = (idx: number) => {
          const r = stateResults[base + idx];
          return r && r.status === "success" ? (r.result as bigint) : 0n;
        };
        circleData.push({
          addr: circles[i],
          state: getNum(0, -1),
          slots: getNum(1, 0),
          roundsPaid: getNum(2, 0),
          contribution: getBig(3),
          membersLen: getNum(4, 0),
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memberContracts: any[] = [];
      for (const c of circleData) {
        for (let j = 0; j < Math.min(c.membersLen, 20); j++) {
          memberContracts.push({
            address: c.addr,
            abi: circleAbi,
            functionName: "members" as const,
            args: [BigInt(j)],
          });
        }
      }

      if (memberContracts.length > 0) {
        const memberResults = await batchMulticall(memberContracts, 40);
        for (const r of memberResults) {
          if (r && r.status === "success" && r.result) {
            uniqueMembers.add((r.result as string).toLowerCase());
          }
        }
      }

      for (const c of circleData) {
        if (c.slots > 0 && c.contribution > 0n) {
          totalContributions += BigInt(c.roundsPaid) * BigInt(c.slots) * c.contribution;
          contributionCount += c.roundsPaid * c.slots;
          totalPayouts += BigInt(c.roundsPaid) * c.contribution * BigInt(c.slots);
          payoutCount += c.roundsPaid;
        }
        if (c.state === 0) circleStates.forming++;
        else if (c.state === 1) circleStates.active++;
        else if (c.state === 2) circleStates.completed++;
        else if (c.state === 3) circleStates.defaulted++;
        else if (c.state === 4) circleStates.dissolved++;
      }
    }

    let reputationSignals = 0;
    let positiveSignals = 0;
    let negativeSignals = 0;
    let agentTxCount = 0;

    const settled = await repPromise;

    if (settled[0].status === "fulfilled") {
      const s = settled[0].value as readonly [bigint, bigint, bigint, bigint, bigint];
      const onTime = Number(s[1]);
      const late = Number(s[2]);
      const defaults = Number(s[3]);
      reputationSignals = onTime + late + defaults;
      positiveSignals = onTime;
      negativeSignals = late + defaults;
    }

    if (settled[1].status === "fulfilled") {
      agentTxCount = Number(settled[1].value);
    }

    return NextResponse.json(
      {
        chain: activeChain.name,
        chainId: activeChain.id,
        timestamp: new Date().toISOString(),
        circlesCreated: circleCount,
        ...circleStates,
        uniqueMembers: uniqueMembers.size,
        contributionCount,
        lateContributions: 0,
        totalContributions: totalContributions.toString(),
        payoutCount,
        totalPayouts: totalPayouts.toString(),
        defaultsTriggered: circleStates.defaulted,
        reputationSignals,
        positiveSignals,
        negativeSignals,
        agentTxCount,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
