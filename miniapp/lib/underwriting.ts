import { createPublicClient, http, formatUnits, type Address } from "viem";
import { circleAbi, erc20Abi, factoryAbi, reputationAbi, STATE_NAMES } from "./abi";
import { activeChain, CONTRACTS } from "./chain";

// Savings-credit underwriting: turns a member's on-chain ROSCA history into a risk band and a
// suggested credit limit. This is the primitive the roadmap points at (CLAUDE.md §15) — completed
// circles as collateral-free creditworthiness.
//
// DETERMINISTIC BY CONSTRUCTION. Every number below is derived from contract state by fixed
// arithmetic; no LLM is involved (§1.3) and nothing here moves money — it only reads and scores.

// A circle scan is O(circles) in RPC calls, so it is bounded and the truncation is reported in the
// payload rather than silently applied.
export const MAX_CIRCLES_SCANNED = 200;

export type Band = "none" | "high-risk" | "building" | "good" | "prime";

export type Membership = {
  address: Address;
  state: string;
  contribution: bigint;
  decimals: number;
  symbol: string;
  isDelinquent: boolean;
  hasReceived: boolean;
};

export type CreditFacts = {
  score: bigint;
  onTime: bigint;
  late: bigint;
  defaults: bigint;
  completed: bigint;
  circles: Membership[];
};

/** Share of obligations met on time, in [0,1]. Returns null when there is no history to judge. */
export function reliability(f: Pick<CreditFacts, "onTime" | "late" | "defaults">): number | null {
  const total = Number(f.onTime) + Number(f.late) + Number(f.defaults);
  if (total === 0) return null;
  return Number(f.onTime) / total;
}

/** True while the member is delinquent in any circle — an active, uncured breach. */
export function isCurrentlyDelinquent(f: CreditFacts): boolean {
  return f.circles.some((c) => c.isDelinquent);
}

/**
 * Risk band. Ordered from worst to best; the first matching rule wins.
 *  high-risk  any default on record, or an uncured delinquency right now
 *  none       no payment history at all
 *  building   some history, clean, but too short to underwrite (< 6 obligations met)
 *  prime      perfect record across >= 2 completed circles
 *  good       everything else clean (>= 90% on time, >= 1 completed circle)
 */
export function riskBand(f: CreditFacts): Band {
  if (f.defaults > 0n || isCurrentlyDelinquent(f)) return "high-risk";
  const r = reliability(f);
  if (r === null) return "none";
  const obligations = Number(f.onTime) + Number(f.late);
  if (obligations < 6) return "building";
  if (r === 1 && f.completed >= 2n) return "prime";
  if (r >= 0.9 && f.completed >= 1n) return "good";
  return "building";
}

/** Multiple of demonstrated per-round capacity extended at each band. */
export const BAND_MULTIPLIER: Record<Band, number> = {
  none: 0,
  "high-risk": 0,
  building: 1,
  good: 3,
  prime: 6,
};

/**
 * Suggested credit limit, denominated in the token of the largest circle the member services.
 * Capacity is what they have actually demonstrated they can pay each round — not a guess — so the
 * limit is that contribution scaled by the band multiplier.
 */
export function creditLimit(f: CreditFacts): { amount: bigint; decimals: number; symbol: string } | null {
  if (f.circles.length === 0) return null;
  const largest = f.circles.reduce((a, b) => (b.contribution > a.contribution ? b : a));
  const mult = BAND_MULTIPLIER[riskBand(f)];
  return { amount: largest.contribution * BigInt(mult), decimals: largest.decimals, symbol: largest.symbol };
}

/** Outstanding obligation: rounds still owed across circles the member has not finished paying. */
export function activeExposure(f: CreditFacts): { amount: bigint; decimals: number; symbol: string } | null {
  const active = f.circles.filter((c) => c.state === "Active");
  if (active.length === 0) return null;
  const largest = active.reduce((a, b) => (b.contribution > a.contribution ? b : a));
  const amount = active
    .filter((c) => c.decimals === largest.decimals && c.symbol === largest.symbol)
    .reduce((sum, c) => sum + c.contribution, 0n);
  return { amount, decimals: largest.decimals, symbol: largest.symbol };
}

const BAND_RATIONALE: Record<Band, string> = {
  none: "No contribution history on record yet.",
  "high-risk": "A default or an uncured delinquency is on record.",
  building: "Clean record, but too short to underwrite against yet.",
  good: "Consistently on time with at least one completed circle.",
  prime: "Perfect payment record across two or more completed circles.",
};

/** Assemble the human/machine-readable report from facts. Pure — safe to unit test. */
export function buildReport(address: string, f: CreditFacts, truncated: boolean) {
  const band = riskBand(f);
  const r = reliability(f);
  const limit = creditLimit(f);
  const exposure = activeExposure(f);
  const fmt = (v: { amount: bigint; decimals: number; symbol: string } | null) =>
    v ? { amount: formatUnits(v.amount, v.decimals), symbol: v.symbol, raw: v.amount.toString() } : null;

  return {
    address,
    chain: `eip155:${activeChain.id}`,
    generatedAt: new Date().toISOString(),
    savingsCredit: {
      score: f.score.toString(),
      onTime: Number(f.onTime),
      late: Number(f.late),
      defaults: Number(f.defaults),
      circlesCompleted: Number(f.completed),
      reliability: r === null ? null : Number(r.toFixed(4)),
    },
    participation: {
      circles: f.circles.length,
      active: f.circles.filter((c) => c.state === "Active").length,
      currentlyDelinquent: isCurrentlyDelinquent(f),
      memberships: f.circles.map((c) => ({
        circle: c.address,
        state: c.state,
        contributionPerRound: formatUnits(c.contribution, c.decimals),
        symbol: c.symbol,
        hasReceivedPot: c.hasReceived,
        delinquent: c.isDelinquent,
      })),
    },
    assessment: {
      riskBand: band,
      rationale: BAND_RATIONALE[band],
      multiplierApplied: BAND_MULTIPLIER[band],
      suggestedCreditLimit: fmt(limit),
      activeExposure: fmt(exposure),
    },
    methodology:
      "Derived deterministically from Celo contract state (ERC-8004 ReputationLedger + AjoAI Circle contracts). " +
      "No model inference is used. Credit limit = largest per-round contribution serviced x band multiplier.",
    ...(truncated
      ? { truncated: `Only the first ${MAX_CIRCLES_SCANNED} circles were scanned; results may be incomplete.` }
      : {}),
  };
}

export type UnderwritingReport = ReturnType<typeof buildReport>;

const client = () => createPublicClient({ chain: activeChain, transport: http() });

/** Read every fact the report needs from chain state (no event scans — see the getLogs cap). */
export async function collectFacts(member: Address): Promise<{ facts: CreditFacts; truncated: boolean }> {
  const c = client();
  const factory = CONTRACTS.circleFactory as Address;
  const reputation = CONTRACTS.reputationLedger as Address;

  const [scoreTuple, lengthRaw] = await Promise.all([
    c.readContract({ address: reputation, abi: reputationAbi, functionName: "scoreOf", args: [member] }),
    c.readContract({ address: factory, abi: factoryAbi, functionName: "allCirclesLength" }),
  ]);
  const [score, onTime, late, defaults, completed] = scoreTuple as readonly [bigint, bigint, bigint, bigint, bigint];

  const total = Number(lengthRaw);
  const scan = Math.min(total, MAX_CIRCLES_SCANNED);
  const addresses =
    scan > 0
      ? ((await c.multicall({
          contracts: Array.from({ length: scan }, (_, i) => ({
            address: factory,
            abi: factoryAbi,
            functionName: "allCircles",
            args: [BigInt(i)],
          } as const)),
          allowFailure: false,
        })) as Address[])
      : [];

  const membership = addresses.length
    ? await c.multicall({
        contracts: addresses.map((a) => ({ address: a, abi: circleAbi, functionName: "isMember", args: [member] } as const)),
        allowFailure: true,
      })
    : [];
  const mine = addresses.filter((_, i) => membership[i]?.status === "success" && membership[i].result === true);

  const circles: Membership[] = [];
  if (mine.length) {
    const details = await c.multicall({
      contracts: mine.flatMap((a) => [
        { address: a, abi: circleAbi, functionName: "state" } as const,
        { address: a, abi: circleAbi, functionName: "contribution" } as const,
        { address: a, abi: circleAbi, functionName: "token" } as const,
        { address: a, abi: circleAbi, functionName: "isDelinquent", args: [member] } as const,
        { address: a, abi: circleAbi, functionName: "hasReceived", args: [member] } as const,
      ]),
      allowFailure: false,
    });

    const tokens = [...new Set(mine.map((_, i) => details[i * 5 + 2] as Address))];
    const meta = await c.multicall({
      contracts: tokens.flatMap((t) => [
        { address: t, abi: erc20Abi, functionName: "decimals" } as const,
        { address: t, abi: erc20Abi, functionName: "symbol" } as const,
      ]),
      allowFailure: true,
    });
    const tokenMeta = new Map<Address, { decimals: number; symbol: string }>(
      tokens.map((t, i) => [
        t,
        {
          decimals: meta[i * 2]?.status === "success" ? Number(meta[i * 2].result) : 18,
          symbol: meta[i * 2 + 1]?.status === "success" ? String(meta[i * 2 + 1].result) : "tokens",
        },
      ]),
    );

    mine.forEach((a, i) => {
      const token = details[i * 5 + 2] as Address;
      const m = tokenMeta.get(token)!;
      circles.push({
        address: a,
        state: STATE_NAMES[Number(details[i * 5])] ?? "Unknown",
        contribution: details[i * 5 + 1] as bigint,
        decimals: m.decimals,
        symbol: m.symbol,
        isDelinquent: Boolean(details[i * 5 + 3]),
        hasReceived: Boolean(details[i * 5 + 4]),
      });
    });
  }

  return { facts: { score, onTime, late, defaults, completed, circles }, truncated: total > scan };
}
