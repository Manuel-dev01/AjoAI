"use client";

import { useMemo } from "react";
import { useAccount, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { decodeEventLog } from "viem";
import { circleAbi, erc20Abi, factoryAbi, reputationAbi } from "./abi";
import { CONTRACTS, activeChain } from "./chain";

const factory = CONTRACTS.circleFactory as `0x${string}`;
const reputation = CONTRACTS.reputationLedger as `0x${string}`;

type Addr = `0x${string}`;
const enabled = (v: unknown) => ({ enabled: Boolean(v) });

/** Scalar state of one circle, batched. */
export function useCircle(address?: Addr) {
  const c = { address: address as Addr, abi: circleAbi } as const;
  const { data, refetch, isLoading } = useReadContracts({
    query: { enabled: Boolean(address), refetchInterval: 12_000 },
    contracts: [
      { ...c, functionName: "state" },
      { ...c, functionName: "currentRound" },
      { ...c, functionName: "slots" },
      { ...c, functionName: "intendedPot" },
      { ...c, functionName: "contribution" },
      { ...c, functionName: "deposit" },
      { ...c, functionName: "token" },
      { ...c, functionName: "roundsPaid" },
      { ...c, functionName: "membersLength" },
      { ...c, functionName: "penaltyPool" },
      { ...c, functionName: "organizer" },
    ],
  });
  const r = data?.map((d) => d.result);
  const round = r?.[1] as bigint | undefined;
  const { data: recipient } = useReadContract({
    address,
    abi: circleAbi,
    functionName: "recipientOf",
    args: round !== undefined ? [round] : undefined,
    query: { enabled: address !== undefined && round !== undefined },
  });
  return {
    isLoading,
    refetch,
    state: r?.[0] as number | undefined,
    round,
    slots: r?.[2] as number | undefined,
    pot: r?.[3] as bigint | undefined,
    contribution: r?.[4] as bigint | undefined,
    deposit: r?.[5] as bigint | undefined,
    token: r?.[6] as Addr | undefined,
    roundsPaid: r?.[7] as bigint | undefined,
    membersLength: r?.[8] as bigint | undefined,
    penaltyPool: r?.[9] as bigint | undefined,
    organizer: r?.[10] as Addr | undefined,
    recipient: recipient as Addr | undefined,
  };
}

/** ERC20 symbol + decimals for a token. */
export function useToken(token?: Addr) {
  const t = { address: token as Addr, abi: erc20Abi } as const;
  const { data } = useReadContracts({
    query: enabled(token),
    contracts: [
      { ...t, functionName: "symbol" },
      { ...t, functionName: "decimals" },
    ],
  });
  return {
    symbol: (data?.[0]?.result as string) ?? "",
    decimals: (data?.[1]?.result as number) ?? 18,
  };
}

/** Members + per-member status for the current round. */
export function useMembers(address?: Addr, count?: bigint, round?: bigint) {
  const n = count ? Number(count) : 0;
  const memberCalls = useReadContracts({
    query: { enabled: Boolean(address) && n > 0 },
    contracts: Array.from({ length: n }, (_, i) => ({
      address: address as Addr,
      abi: circleAbi,
      functionName: "members" as const,
      args: [BigInt(i)] as const,
    })),
  });
  const addrs = useMemo(
    () => (memberCalls.data?.map((d) => d.result as Addr).filter(Boolean) ?? []),
    [memberCalls.data],
  );
  const statusCalls = useReadContracts({
    query: { enabled: addrs.length > 0 && round !== undefined },
    contracts: addrs.flatMap((m) => [
      { address: address as Addr, abi: circleAbi, functionName: "hasReceived" as const, args: [m] as const },
      { address: address as Addr, abi: circleAbi, functionName: "isDelinquent" as const, args: [m] as const },
      { address: address as Addr, abi: circleAbi, functionName: "contributedInRound" as const, args: [round as bigint, m] as const },
    ]),
  });
  const members = addrs.map((m, i) => ({
    address: m,
    hasReceived: statusCalls.data?.[i * 3]?.result as boolean | undefined,
    isDelinquent: statusCalls.data?.[i * 3 + 1]?.result as boolean | undefined,
    contributed: statusCalls.data?.[i * 3 + 2]?.result as boolean | undefined,
  }));
  return { members, refetch: () => { memberCalls.refetch(); statusCalls.refetch(); } };
}

/** The connected member's relationship to a circle. */
export function useMyStatus(address?: Addr, round?: bigint) {
  const { address: me } = useAccount();
  const c = { address: address as Addr, abi: circleAbi } as const;
  const { data, refetch } = useReadContracts({
    query: { enabled: Boolean(address && me) },
    contracts: [
      { ...c, functionName: "isMember", args: [me as Addr] },
      { ...c, functionName: "hasReceived", args: [me as Addr] },
      { ...c, functionName: "isDelinquent", args: [me as Addr] },
      { ...c, functionName: "contributedInRound", args: [round ?? 0n, me as Addr] },
    ],
  });
  return {
    me,
    refetch,
    isMember: data?.[0]?.result as boolean | undefined,
    hasReceived: data?.[1]?.result as boolean | undefined,
    isDelinquent: data?.[2]?.result as boolean | undefined,
    contributed: data?.[3]?.result as boolean | undefined,
  };
}

/** All circles where the connected address is a member (enumerated from the factory). */
export function useMyCircles() {
  const { address: me } = useAccount();
  const { data: lenData } = useReadContract({
    address: factory,
    abi: factoryAbi,
    functionName: "allCirclesLength",
    query: { refetchInterval: 15_000 },
  });
  const len = lenData ? Number(lenData) : 0;
  const listCalls = useReadContracts({
    query: { enabled: len > 0 },
    contracts: Array.from({ length: len }, (_, i) => ({
      address: factory,
      abi: factoryAbi,
      functionName: "allCircles" as const,
      args: [BigInt(i)] as const,
    })),
  });
  const all = useMemo(
    () => (listCalls.data?.map((d) => d.result as Addr).filter(Boolean) ?? []),
    [listCalls.data],
  );
  // Include circles you ORGANIZE (even before you join) and circles you're a member of.
  const relCalls = useReadContracts({
    query: { enabled: all.length > 0 && Boolean(me) },
    contracts: all.flatMap((addr) => [
      { address: addr, abi: circleAbi, functionName: "isMember" as const, args: [me as Addr] as const },
      { address: addr, abi: circleAbi, functionName: "organizer" as const },
      { address: addr, abi: circleAbi, functionName: "state" as const },
    ]),
  });
  const mine = all
    .map((addr, i) => {
      const isMember = relCalls.data?.[i * 3]?.result === true;
      const organizer = relCalls.data?.[i * 3 + 1]?.result as Addr | undefined;
      const state = relCalls.data?.[i * 3 + 2]?.result as number | undefined;
      const isOrganizer = Boolean(me && organizer && organizer.toLowerCase() === me.toLowerCase());
      return { addr, isMember, isOrganizer, state };
    })
    // Dissolved circles were "deleted" by the organizer — drop them from the board.
    .filter((c) => (c.isMember || c.isOrganizer) && c.state !== 4);
  return { me, all, mine, isLoading: listCalls.isLoading };
}

/** ERC-8004 savings-credit score breakdown. */
export function useScore(who?: Addr) {
  const { data } = useReadContract({
    address: reputation,
    abi: reputationAbi,
    functionName: "scoreOf",
    args: who ? [who] : undefined,
    query: { enabled: Boolean(who) },
  });
  const t = data as readonly [bigint, bigint, bigint, bigint, bigint] | undefined;
  return t
    ? { score: t[0], onTime: t[1], late: t[2], defaults: t[3], completed: t[4] }
    : undefined;
}

export type ActivityEvent = {
  kind: "in" | "out" | "sys";
  eventName: string;
  member: string;
  round: number;
  amount: bigint;
  late?: boolean;
};

/**
 * Decoded circle events (contributions, payouts, defaults, penalties), newest first.
 * Runs as a cached react-query so it can be PREFETCHED at page mount (not on tab open):
 * the chunked backward scan respects RPC range caps and early-stops once the circle's
 * contiguous activity is collected. Keyed on roundsPaid so it refreshes as the agent advances.
 */
export function useCircleActivity(address?: Addr, roundsPaid?: bigint) {
  const client = usePublicClient({ chainId: activeChain.id });
  const q = useQuery({
    queryKey: ["activity", activeChain.id, address, roundsPaid?.toString() ?? "0"],
    enabled: Boolean(address && client),
    staleTime: 30_000,
    queryFn: async (): Promise<ActivityEvent[]> => {
      if (!client || !address) return [];
      const latest = await client.getBlockNumber();
      const STEP = 10_000n;
      const MAX_LOOKBACK = 200_000n;
      const floor = latest > MAX_LOOKBACK ? latest - MAX_LOOKBACK : 0n;
      type RawLog = { blockNumber: bigint; logIndex: number; data: `0x${string}`; topics: [signature: `0x${string}`, ...args: `0x${string}`[]] };
      const raw: RawLog[] = [];
      let to = latest;
      let found = false;
      while (to >= floor) {
        const from = to > STEP ? to - STEP + 1n : 0n;
        let chunk: RawLog[] = [];
        try { chunk = (await client.getLogs({ address, fromBlock: from, toBlock: to })) as unknown as RawLog[]; } catch { chunk = []; }
        if (chunk.length) { raw.push(...chunk); found = true; }
        else if (found) break; // collected the contiguous activity — stop scanning older blocks
        if (from === 0n) break;
        to = from - 1n;
      }
      raw.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)));
      const out: ActivityEvent[] = [];
      for (const log of raw) {
        try {
          const d = decodeEventLog({ abi: circleAbi, data: log.data, topics: log.topics });
          const a = d.args as Record<string, unknown>;
          const round = a.round !== undefined ? Number(a.round) : 0;
          if (d.eventName === "Contributed") out.push({ kind: "in", eventName: d.eventName, member: a.member as string, round, amount: a.amount as bigint, late: a.late as boolean });
          else if (d.eventName === "PaidOut") out.push({ kind: "out", eventName: d.eventName, member: a.recipient as string, round, amount: a.pot as bigint });
          else if (d.eventName === "Delinquent") out.push({ kind: "sys", eventName: d.eventName, member: a.member as string, round, amount: a.depositConsumed as bigint });
          else if (d.eventName === "LatePaid") out.push({ kind: "sys", eventName: d.eventName, member: a.member as string, round, amount: a.penalty as bigint });
        } catch { /* non-matching log */ }
      }
      return out.reverse(); // newest first
    },
  });
  return { events: q.data, isLoading: q.isLoading };
}

export { factory as FACTORY, reputation as REPUTATION };
