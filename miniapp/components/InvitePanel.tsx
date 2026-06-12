"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Avatar } from "@/components/ui";
import { encodeCircle, inviteLink } from "@/lib/code";

// Shareable invite for a Forming circle: QR + copy-link + a friendly reversible "AJO-…" code,
// plus a live members k/N strip. Abstracts the raw hex address away from the person sharing.
export function InvitePanel({
  address,
  name,
  slots,
  members,
}: {
  address: `0x${string}`;
  name?: string;
  slots?: number;
  members: { address: `0x${string}` }[];
}) {
  const link = inviteLink(address, name);
  const code = encodeCircle(address);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  const copy = async (what: "link" | "code", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked — the value is still visible to copy manually */
    }
  };

  return (
    <div className="invite" style={{ background: "var(--cream)", color: "var(--ink)" }}>
      <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 18, letterSpacing: "-.02em" }}>
        Invite your circle
      </div>
      <div className="muted" style={{ marginBottom: 12 }}>Share the link or the code — neighbours tap to join.</div>
      <div style={{ background: "#fff", border: "2.5px solid var(--ink)", padding: 12, display: "inline-block", marginBottom: 12 }}>
        <QRCodeSVG value={link} size={148} bgColor="#ffffff" fgColor="#231b12" level="M" />
      </div>
      <button className="btn btn-block" onClick={() => copy("link", link)}>
        {copied === "link" ? "Link copied ✓" : "Copy invite link"}
      </button>
      <div
        onClick={() => copy("code", code)}
        style={{ marginTop: 10, border: "2px dashed var(--ink)", padding: "10px 8px", cursor: "pointer", fontFamily: "var(--display)", fontWeight: 800, fontSize: 13, letterSpacing: ".02em", wordBreak: "break-all" }}
      >
        {copied === "code" ? "Code copied ✓" : code}
      </div>
      <div className="avstack" style={{ justifyContent: "center", marginTop: 14 }}>
        {members.slice(0, 6).map((m) => (
          <Avatar key={m.address} addr={m.address} size={30} />
        ))}
        <span className="more">{members.length}{slots ? ` / ${slots}` : ""} joined</span>
      </div>
    </div>
  );
}
