"use client";

import { useMemo } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { circleAbi, erc20Abi, factoryAbi, reputationAbi } from "./abi";
import { CONTRACTS } from "./chain";

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
    ]),
  });
  const mine = all
    .map((addr, i) => {
      const isMember = relCalls.data?.[i * 2]?.result === true;
      const organizer = relCalls.data?.[i * 2 + 1]?.result as Addr | undefined;
      const isOrganizer = Boolean(me && organizer && organizer.toLowerCase() === me.toLowerCase());
      return { addr, isMember, isOrganizer };
    })
    .filter((c) => c.isMember || c.isOrganizer);
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

export { factory as FACTORY, reputation as REPUTATION };
