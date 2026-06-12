"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { AppBar, Lrow, ConnectButton } from "@/components/ui";
import { RingMark } from "@/components/RingMark";
import { useCeloWrite } from "@/lib/tx";
import { circleAbi, erc20Abi } from "@/lib/abi";
import { useCircle, useToken } from "@/lib/circle";
import { fmtAmount, short } from "@/lib/format";
import { parseInviteInput } from "@/lib/code";
import { getName, setName } from "@/lib/names";

export default function JoinPage() {
  return (
    <Suspense fallback={<div className="appmain" />}>
      <JoinInner />
    </Suspense>
  );
}

function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { address: me, isConnected } = useAccount();
  const [input, setInput] = useState("");

  // Prefill from an invite deep link (?c=address&n=name) and cache the shared name.
  useEffect(() => {
    const c = params.get("c");
    const n = params.get("n");
    if (c) {
      setInput(c);
      if (n) setName(c, decodeURIComponent(n));
    }
  }, [params]);

  const parsed = parseInviteInput(input);
  const circle = parsed.address;
  const circleName = circle ? getName(circle) : undefined;

  return (
    <>
      <AppBar title="Join a circle" back="/app" />
      <div className="appmain">
        <div className="fld">
          <div className="fl">Invite link or code</div>
          <input
            className="fi"
            placeholder="Paste invite link, AJO-code, or address"
            value={input}
            onChange={(e) => setInput(e.target.value.trim())}
            style={{ fontSize: 13 }}
          />
        </div>
        {circle ? (
          <Preview circle={circle} name={circleName} me={me} isConnected={isConnected} onJoined={() => router.push(`/app/circle/${circle}`)} />
        ) : (
          <p className="muted">{input ? "That doesn't look like a valid circle. Check the link or code." : "Paste the invite link, AJO-code, or address your circle organiser shared."}</p>
        )}
      </div>
    </>
  );
}

function Preview({ circle, name, me, isConnected, onJoined }: { circle: `0x${string}`; name?: string; me?: `0x${string}`; isConnected: boolean; onJoined: () => void }) {
  const { slots, membersLength, contribution, deposit, pot, token } = useCircle(circle);
  const { symbol, decimals } = useToken(token);
  const { write, isPending, error } = useCeloWrite();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: allowance, refetch: refetchAllow } = useReadContract({
    address: token, abi: erc20Abi, functionName: "allowance",
    args: me && token ? [me, circle] : undefined,
    query: { enabled: Boolean(me && token) },
  });
  const needsApproval = deposit !== undefined && (allowance === undefined || (allowance as bigint) < deposit);
  const joinIndex = membersLength !== undefined ? Number(membersLength) + 1 : undefined;

  async function approve() {
    if (!token || deposit === undefined) return;
    const h = await write({ address: token, abi: erc20Abi, functionName: "approve", args: [circle, deposit] });
    setTxHash(h);
    setTimeout(() => refetchAllow(), 4000);
  }
  async function join() {
    const h = await write({ address: circle, abi: circleAbi, functionName: "join", args: ["0x"] });
    setTxHash(h);
  }

  if (receipt && !needsApproval) onJoined();
  const busy = isPending || (!!txHash && !receipt);

  return (
    <>
      <div className="invite">
        <RingMark variant="full" />
        <div className="nm">{name || `Circle ${short(circle)}`}</div>
        <div className="meta">{slots ?? "…"} members · {fmtAmount(contribution, symbol || "…", decimals)} / round</div>
      </div>
      <Lrow k="Members so far" v={`${membersLength?.toString() ?? "…"} / ${slots ?? "…"}`} />
      <Lrow k="You'd join as" v={joinIndex ? `Member #${joinIndex}` : "…"} />
      <Lrow k="Security deposit" v={fmtAmount(deposit, symbol, decimals)} />
      <Lrow k="You receive on your turn" v={fmtAmount(pot, symbol, decimals)} vColor="var(--clay-d)" />
      {error && <p className="banner">{error.message.slice(0, 120)}</p>}

      <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
        {!isConnected ? (
          <ConnectButton />
        ) : needsApproval ? (
          <button className="btn btn-block" disabled={busy} onClick={approve}>
            {busy ? "Approving…" : `1. Approve deposit (${fmtAmount(deposit, symbol, decimals)})`}
          </button>
        ) : (
          <button className="btn btn-ochre btn-block" disabled={busy} onClick={join}>
            {busy ? "Joining…" : "Join the circle"}
          </button>
        )}
      </div>
    </>
  );
}
