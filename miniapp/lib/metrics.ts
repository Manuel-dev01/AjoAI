// Shared on-chain metrics logic for /api/metrics (fast live read) and
// /api/metrics/refresh (full out-of-band compute → Vercel Blob).
//
// Split by cost:
//  • Call-state metrics (circles, states, members, contributions, payouts, reputation,
//    agent txs) are cheap, bounded reads — safe to compute live on every request.
//  • Event-derived metrics (late payments, simulated yield) require a full-history log
//    scan from the deploy block, which grows unbounded over time and would blow the
//    request budget. Those are computed ONLY in the refresh job and read back from a
//    snapshot (Vercel Blob, else the committed file).
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
// Build-time import of the committed snapshot — guaranteed to be in the serverless bundle even
// when `public/` files aren't traced into the lambda, so we always have a non-empty floor.
import committedSnapshot from "@/public/data/metrics.json";

// ── viem client ────────────────────────────────────────────────────────────
const RPC_URL = activeChain.testnet
  ? "https://11142220.rpc.thirdweb.com"
  : "https://42220.rpc.thirdweb.com";
export const client = createPublicClient({
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
  parseAbiItem("function token() view returns (address)"),
] as const;

const erc20DecimalsAbi = [parseAbiItem("function decimals() view returns (uint8)")] as const;

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
  42220: 71_485_599n, // celo mainnet — new factory redeploy (2026-07-07)
};

const AGENT_ADDR = (activeChain.testnet
  ? "0x5b92F8A222704d522Fb3dCf8d734C3DAF51Fc4f1"
  : "0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7") as Address;

// ── types ──────────────────────────────────────────────────────────────────
export interface EventMetrics {
  lateContributions: number;
  yieldDeposits: number;
  yieldWithdrawals: number;
  totalYield: string; // wei string (simulated)
}

export interface Metrics {
  chain: string;
  chainId: number;
  timestamp: string;
  circlesCreated: number;
  [key: string]: unknown;
}

// Race a promise against a timeout so a slow/stuck dependency can never hang the request.
export function withTimeout<T>(p: Promise<T>, ms: number, label = "timeout"): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// ── small concurrency pool ───────────────────────────────────────────────
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// Batch a large contract array into multicalls. `batchSize: 0` disables viem's internal
// calldata-size splitting so each of our chunks is exactly one RPC round-trip; chunks run
// with bounded concurrency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function batchMulticall(contracts: any[], batchSize = 150, concurrency = 4): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chunks: any[][] = [];
  for (let i = 0; i < contracts.length; i += batchSize) chunks.push(contracts.slice(i, i + batchSize));
  const results = await mapPool(chunks, concurrency, (batch) =>
    client.multicall({ contracts: batch, allowFailure: true, batchSize: 0 })
  );
  return results.flat();
}

// ── live call-state read (cheap, bounded) ────────────────────────────────
export interface CallState {
  circles: Address[];
  // All Metrics fields except `timestamp` and the event-derived ones; built at runtime with
  // chain/chainId/circlesCreated always present.
  metrics: Record<string, unknown>;
}

export async function readCallState(): Promise<CallState> {
  const factory = CONTRACTS.circleFactory as Address;
  const repAddr = CONTRACTS.reputationLedger as Address;

  // Agent tx count runs in parallel with the circle sweep. Reputation is aggregated AFTER the
  // sweep (it needs the unique-member set) because reputation is written about members, not the
  // agent trigger key — scoreOf(agent) is always 0.
  const agentTxPromise = client.getTransactionCount({ address: AGENT_ADDR });

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
        batchSize: 0,
      });
      circles = results
        .filter((r) => r.status === "success")
        .map((r) => r.result as Address);
    }
  } catch {
    // factory read failed — leave circles empty
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
      { address: addr, abi: circleAbi, functionName: "token" as const },
    ]);

    const stateResults = await batchMulticall(stateContracts);

    const circleData: {
      addr: Address;
      state: number;
      slots: number;
      roundsPaid: number;
      contribution: bigint;
      membersLen: number;
      token: string;
    }[] = [];

    for (let i = 0; i < circles.length; i++) {
      const base = i * 6;
      const getNum = (idx: number, def: number) => {
        const r = stateResults[base + idx];
        return r && r.status === "success" ? Number(r.result as bigint) : def;
      };
      const getBig = (idx: number) => {
        const r = stateResults[base + idx];
        return r && r.status === "success" ? (r.result as bigint) : 0n;
      };
      const getStr = (idx: number) => {
        const r = stateResults[base + idx];
        return r && r.status === "success" ? (r.result as string) : "";
      };
      circleData.push({
        addr: circles[i],
        state: getNum(0, -1),
        slots: getNum(1, 0),
        roundsPaid: getNum(2, 0),
        contribution: getBig(3),
        membersLen: getNum(4, 0),
        token: getStr(5),
      });
    }

    // Tokens vary in decimals (USDT/USDC 6, USDm/NGNm 18). Read decimals once per unique token so
    // we can normalize all pots to an 18-dec equivalent — otherwise a 6-dec USDT total shows 0.00
    // (the dashboard formats totals as 18-dec). Mirrors agent/src/metrics.py.
    const tokenDecimals = new Map<string, number>();
    const uniqueTokens = [...new Set(circleData.map((c) => c.token).filter(Boolean))];
    if (uniqueTokens.length > 0) {
      const decResults = await batchMulticall(
        uniqueTokens.map((t) => ({ address: t as Address, abi: erc20DecimalsAbi, functionName: "decimals" as const }))
      );
      uniqueTokens.forEach((t, i) => {
        const r = decResults[i];
        tokenDecimals.set(t, r && r.status === "success" ? Number(r.result) : 18);
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memberContracts: any[] = [];
    for (const c of circleData) {
      // slots is a uint8 (≤255); cap generously so uniqueMembers matches the Python collector.
      for (let j = 0; j < Math.min(c.membersLen, 255); j++) {
        memberContracts.push({
          address: c.addr,
          abi: circleAbi,
          functionName: "members" as const,
          args: [BigInt(j)],
        });
      }
    }

    if (memberContracts.length > 0) {
      const memberResults = await batchMulticall(memberContracts);
      for (const r of memberResults) {
        if (r && r.status === "success" && r.result) {
          uniqueMembers.add((r.result as string).toLowerCase());
        }
      }
    }

    for (const c of circleData) {
      if (c.slots > 0 && c.contribution > 0n) {
        const dec = tokenDecimals.get(c.token) ?? 18;
        const scale = 10n ** BigInt(Math.max(0, 18 - dec)); // normalize to 18-dec equivalent
        const pot18 = BigInt(c.roundsPaid) * BigInt(c.slots) * c.contribution * scale;
        totalContributions += pot18;
        contributionCount += c.roundsPaid * c.slots;
        totalPayouts += pot18;
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

  // Aggregate ERC-8004 signals across every unique member (scoreOf is keyed by member).
  if (uniqueMembers.size > 0) {
    const repResults = await batchMulticall(
      [...uniqueMembers].map((m) => ({
        address: repAddr, abi: scoreOfAbi, functionName: "scoreOf" as const, args: [m as Address],
      }))
    );
    for (const r of repResults) {
      if (r && r.status === "success" && r.result) {
        const s = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
        const onTime = Number(s[1]), late = Number(s[2]), defaults = Number(s[3]);
        reputationSignals += onTime + late + defaults;
        positiveSignals += onTime;
        negativeSignals += late + defaults;
      }
    }
  }
  try {
    agentTxCount = Number(await agentTxPromise);
  } catch {
    /* leave 0 */
  }

  return {
    circles,
    metrics: {
      chain: activeChain.name,
      chainId: activeChain.id,
      circlesCreated: circleCount,
      ...circleStates,
      uniqueMembers: uniqueMembers.size,
      contributionCount,
      totalContributions: totalContributions.toString(),
      payoutCount,
      totalPayouts: totalPayouts.toString(),
      defaultsTriggered: circleStates.defaulted,
      reputationSignals,
      positiveSignals,
      negativeSignals,
      agentTxCount,
    },
  };
}

// ── cheap live overlay (O(1), used on every /api/metrics request) ─────────
// Only the two headline numbers that must feel live — agent tx count and total circles —
// each a single RPC call, so the request cost is independent of how many circles exist.
export interface LiveOverlay {
  agentTxCount: number;
  circlesCreated: number;
}
export async function readLiveOverlay(): Promise<LiveOverlay | null> {
  try {
    const factory = CONTRACTS.circleFactory as Address;
    const [tx, len] = await Promise.all([
      client.getTransactionCount({ address: AGENT_ADDR }),
      client.readContract({ address: factory, abi: factoryAbi, functionName: "allCirclesLength" }),
    ]);
    return { agentTxCount: Number(tx), circlesCreated: Number(len) };
  } catch {
    return null;
  }
}

// ── full-history event aggregation (refresh job only) ─────────────────────
// Scanned in forno's real 5,000-block getLogs cap (was 1,000 — 5× more chunks for no reason)
// with a bounded concurrency pool. These feed only the SECONDARY late/yield fields (the headline
// numbers come from the reliable state-based readCallState), so a partial scan is non-fatal — but
// chunk failures are now COUNTED and logged LOUD instead of silently degrading to zeros.
export async function aggregateEvents(circles: Address[]): Promise<EventMetrics> {
  const empty: EventMetrics = { lateContributions: 0, yieldDeposits: 0, yieldWithdrawals: 0, totalYield: "0" };
  if (circles.length === 0) return empty;
  try {
    const latest = await client.getBlockNumber();
    const floor = DEPLOY_BLOCK[activeChain.id] ?? 0n;
    const CHUNK = 5_000n; // forno caps getLogs at 5,000 blocks
    const ranges: { from: bigint; to: bigint }[] = [];
    for (let s = floor; s <= latest; s += CHUNK) {
      const e = s + CHUNK - 1n > latest ? latest : s + CHUNK - 1n;
      ranges.push({ from: s, to: e });
    }
    // LatePaid is emitted by the circle, but SimulatedDeposit/Withdraw are emitted by the YIELD
    // ADAPTER — filtering on circles alone silently dropped every yield event (yield stuck at 0).
    // Include the adapter address so its logs are captured; topic0 is matched below.
    const yieldAdapter = (CONTRACTS as { yieldAdapter?: string }).yieldAdapter;
    const scanAddrs = yieldAdapter ? [...circles, yieldAdapter as Address] : circles;
    let failedChunks = 0;
    const settled = await mapPool(ranges, 10, async (r) => {
      try {
        return await client.getLogs({ address: scanAddrs, fromBlock: r.from, toBlock: r.to });
      } catch {
        failedChunks++;
        return [];
      }
    });
    if (failedChunks > 0) {
      console.warn(`aggregateEvents: ${failedChunks}/${ranges.length} getLogs chunks failed — late/yield counts may be partial`);
    }

    let late = 0;
    let deposits = 0;
    let withdrawals = 0;
    let totalYield = 0n;
    for (const logs of settled) {
      for (const log of logs) {
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
    return { lateContributions: late, yieldDeposits: deposits, yieldWithdrawals: withdrawals, totalYield: totalYield.toString() };
  } catch {
    return empty;
  }
}

export function assembleMetrics(call: CallState, ev: EventMetrics): Metrics {
  return {
    ...call.metrics,
    timestamp: new Date().toISOString(),
    lateContributions: ev.lateContributions,
    yieldDeposits: ev.yieldDeposits,
    yieldWithdrawals: ev.yieldWithdrawals,
    totalYield: ev.totalYield,
  } as unknown as Metrics;
}

// ── snapshot source (Vercel Blob → committed file) ────────────────────────
export const BLOB_PATH = "metrics/latest.json";
const METRICS_FILE = join(process.cwd(), "public", "data", "metrics.json");

export async function readBlobSnapshot(): Promise<Metrics | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const { list } = await import("@vercel/blob");
    // Pass the token EXPLICITLY. Without it the SDK auto-detects creds, and in the Vercel runtime
    // (OIDC auto-injected + a stale BLOB_STORE_ID from an earlier store) it targets the wrong store
    // → silent failure. The explicit token pins reads/writes to the connected store.
    // Hard timeouts so a slow/stuck Blob endpoint can never hang the request.
    const { blobs } = await withTimeout(list({ prefix: BLOB_PATH, token }), 2500, "blob list timeout");
    const hit = blobs.find((b) => b.pathname === BLOB_PATH) ?? blobs[0];
    if (!hit) return null;
    const res = await fetch(hit.url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return (await res.json()) as Metrics;
  } catch {
    return null;
  }
}

export function readCommittedSnapshot(): Metrics | null {
  // Prefer the on-disk file (may be newer if redeployed), else the build-time import (always
  // bundled). One of these is always available, so a snapshot is never missing.
  try {
    if (existsSync(METRICS_FILE)) return JSON.parse(readFileSync(METRICS_FILE, "utf-8")) as Metrics;
  } catch {
    /* fall through to the bundled copy */
  }
  return (committedSnapshot as Metrics) ?? null;
}

// The agent (on Railway) serves its freshest snapshot over HTTP from its volume — this replaces
// Vercel Blob (which hit the Hobby quota and got suspended). A plain HTTPS fetch is serverless-
// friendly (no TCP DB pooling) and there is no write quota to blow.
export async function readAgentSnapshot(): Promise<Metrics | null> {
  const url = process.env.AGENT_METRICS_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const d = (await res.json()) as Metrics;
    // Ignore an empty/placeholder body (e.g. the agent hasn't written a snapshot yet).
    return typeof (d as { circlesCreated?: unknown }).circlesCreated === "number" ? d : null;
  } catch {
    return null;
  }
}

// Freshest available snapshot: the agent's Railway HTTP endpoint, else the committed file floor.
export async function readSnapshot(): Promise<Metrics | null> {
  return (await readAgentSnapshot()) ?? readCommittedSnapshot();
}

export async function writeBlobSnapshot(data: Metrics): Promise<boolean> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;
  try {
    const { put } = await import("@vercel/blob");
    // Explicit token (see readBlobSnapshot) — verified to fix `stored:false` writes where the
    // SDK's auto-detected creds resolved to the wrong store in the Vercel runtime.
    await put(BLOB_PATH, JSON.stringify(data), {
      access: "public",
      contentType: "application/json",
      allowOverwrite: true,
      addRandomSuffix: false,
      token,
    });
    return true;
  } catch {
    return false;
  }
}

export function isFresh(d: Metrics | null, maxAgeMs = 5 * 60_000): boolean {
  if (!d) return false;
  const ts = typeof d.timestamp === "string" ? Date.parse(d.timestamp) : NaN;
  return Number.isFinite(ts) && Date.now() - ts < maxAgeMs;
}

// An all-zeros result with no circles and no agent txs almost certainly means the live
// reads failed (transient RPC issue), not a genuinely empty chain.
export function looksEmpty(d: Metrics | null): boolean {
  if (!d) return true;
  return Number(d.circlesCreated ?? 0) === 0 && Number(d.agentTxCount ?? 0) === 0;
}

// Fill event-derived fields on a live result from a snapshot (live read omits them).
export function withEventsFrom(live: Metrics, snap: Metrics | null): Metrics {
  return {
    lateContributions: Number(snap?.lateContributions ?? 0),
    yieldDeposits: Number(snap?.yieldDeposits ?? 0),
    yieldWithdrawals: Number(snap?.yieldWithdrawals ?? 0),
    totalYield: String(snap?.totalYield ?? "0"),
    ...live,
  };
}
