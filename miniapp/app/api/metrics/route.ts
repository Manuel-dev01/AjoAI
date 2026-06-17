import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  parseAbiItem,
  keccak256,
  toHex,
  type Address,
} from "viem";
import { activeChain, CONTRACTS } from "@/lib/chain";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Force dynamic — reads live chain data on every request (cached at the edge via
// Cache-Control below). A committed pre-computed file is used only as a recent fast
// path (local/monorepo dev) or as a last-resort fallback if the live read fails.
export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
};

// ── viem client ────────────────────────────────────────────────────────────
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

// Event topic0 selectors (must match the contract signatures used in agent/src/metrics.py).
const LATE_TOPIC = keccak256(toHex("LatePaid(address,uint256,uint256)"));
const DEPOSIT_TOPIC = keccak256(toHex("SimulatedDeposit(address,address,uint256)"));
const WITHDRAW_TOPIC = keccak256(toHex("SimulatedWithdraw(address,address,uint256,uint256)"));

// Factory deployment blocks — floor the event scan (mirrors agent/src/metrics.py _DEPLOY_BLOCK).
const DEPLOY_BLOCK: Record<number, bigint> = {
  11142220: 27_135_283n, // celoSepolia
  42220: 69_477_069n, // celo mainnet
};

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

// ── event aggregation (best-effort) ────────────────────────────────────────
// Late payments and simulated-yield figures live only in events, not call state.
// Scan every circle in one multi-address getLogs per block-chunk (chunked + parallel
// to bound latency). Best-effort: any failure degrades to zeros, never throws.
async function aggregateEvents(circles: Address[]): Promise<{
  lateContributions: number;
  yieldDeposits: number;
  yieldWithdrawals: number;
  totalYield: bigint;
}> {
  const empty = { lateContributions: 0, yieldDeposits: 0, yieldWithdrawals: 0, totalYield: 0n };
  if (circles.length === 0) return empty;
  try {
    const latest = await client.getBlockNumber();
    const floor = DEPLOY_BLOCK[activeChain.id] ?? 0n;
    const CHUNK = 10_000n;
    const ranges: { from: bigint; to: bigint }[] = [];
    for (let s = floor; s <= latest; s += CHUNK) {
      const e = s + CHUNK - 1n > latest ? latest : s + CHUNK - 1n;
      ranges.push({ from: s, to: e });
    }
    const settled = await Promise.allSettled(
      ranges.map((r) => client.getLogs({ address: circles, fromBlock: r.from, toBlock: r.to }))
    );
    let late = 0;
    let deposits = 0;
    let withdrawals = 0;
    let totalYield = 0n;
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      for (const log of s.value) {
        const t0 = log.topics[0];
        if (!t0) continue;
        if (t0 === LATE_TOPIC) {
          late++;
        } else if (t0 === DEPOSIT_TOPIC) {
          deposits++;
        } else if (t0 === WITHDRAW_TOPIC) {
          withdrawals++;
          // data layout: principal (0..32), yieldAccrued (32..64)
          const hex = log.data.slice(2);
          if (hex.length >= 128) totalYield += BigInt("0x" + hex.slice(64, 128));
        }
      }
    }
    return { lateContributions: late, yieldDeposits: deposits, yieldWithdrawals: withdrawals, totalYield };
  } catch {
    return empty;
  }
}

// ── pre-computed file ────────────────────────────────────────────────────
// The agent writes this in a LOCAL/monorepo run; in production (agent on Render,
// miniapp on Vercel) the deployments don't share a filesystem, so on Vercel this is
// the build-time-committed snapshot — used only when fresh, or as a last resort.
const METRICS_FILE = join(process.cwd(), "public", "data", "metrics.json");

function readPreComputed(): Record<string, unknown> | null {
  try {
    if (!existsSync(METRICS_FILE)) return null;
    return JSON.parse(readFileSync(METRICS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function isFresh(d: Record<string, unknown>): boolean {
  const ts = typeof d.timestamp === "string" ? Date.parse(d.timestamp) : NaN;
  return Number.isFinite(ts) && Date.now() - ts < 5 * 60_000; // < 5 min old
}

// An all-zeros result with no circles and no agent txs almost certainly means the live
// reads failed (transient RPC issue), not a genuinely empty chain — used to prefer a
// real cached snapshot over showing zeros during a demo.
function looksEmpty(d: Record<string, unknown>): boolean {
  return Number(d.circlesCreated ?? 0) === 0 && Number(d.agentTxCount ?? 0) === 0;
}

// ── live read ──────────────────────────────────────────────────────────────
async function readLive(): Promise<Record<string, unknown>> {
  const factory = CONTRACTS.circleFactory as Address;
  const repAddr = CONTRACTS.reputationLedger as Address;
  const agentAddr = (activeChain.testnet
    ? "0x5b92F8A222704d522Fb3dCf8d734C3DAF51Fc4f1"
    : "0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7") as Address;

  // Fire reputation + agent tx count IN PARALLEL with the circle sweep.
  const repPromise = Promise.allSettled([
    client.readContract({ address: repAddr, abi: scoreOfAbi, functionName: "scoreOf", args: [agentAddr] }),
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

  // Kick off the event scan now that we know the circle set (runs alongside state reads).
  const eventsPromise = aggregateEvents(circles);

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

  const ev = await eventsPromise;

  return {
    chain: activeChain.name,
    chainId: activeChain.id,
    timestamp: new Date().toISOString(),
    circlesCreated: circleCount,
    ...circleStates,
    uniqueMembers: uniqueMembers.size,
    contributionCount,
    lateContributions: ev.lateContributions,
    totalContributions: totalContributions.toString(),
    payoutCount,
    totalPayouts: totalPayouts.toString(),
    defaultsTriggered: circleStates.defaulted,
    reputationSignals,
    positiveSignals,
    negativeSignals,
    yieldDeposits: ev.yieldDeposits,
    yieldWithdrawals: ev.yieldWithdrawals,
    totalYield: ev.totalYield.toString(),
    agentTxCount,
  };
}

// ── route handler ────────────────────────────────────────────────────────
export async function GET() {
  const cached = readPreComputed();

  // Fast path: a recent pre-computed file (local/monorepo dev). On Vercel the
  // committed file is build-time-frozen, so it's stale → fall through to live.
  if (cached && isFresh(cached)) {
    return NextResponse.json(cached, { headers: CACHE_HEADERS });
  }

  // Primary: live chain read.
  try {
    const live = await readLive();
    // If the live read came back empty (likely a transient RPC failure) but we have a
    // non-empty snapshot on disk, prefer the snapshot over showing all-zeros.
    if (looksEmpty(live) && cached && !looksEmpty(cached)) {
      return NextResponse.json({ ...cached, stale: true }, { headers: CACHE_HEADERS });
    }
    return NextResponse.json(live, { headers: CACHE_HEADERS });
  } catch (err) {
    // Last resort: serve the stale file rather than 500 (better during a live demo).
    if (cached) {
      return NextResponse.json({ ...cached, stale: true }, { headers: CACHE_HEADERS });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
