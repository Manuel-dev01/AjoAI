"use client";

import { useState } from "react";
import { ConnectButton } from "@/components/ui";

type Message = { role: "me" | "bot"; text: string };

export function AskAgent({ address, member }: { address: `0x${string}`; member?: `0x${string}` }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const ask = async () => {
    const question = input.trim();
    if (!question || !member || sending) return;
    setMessages((m) => [...m, { role: "me", text: question }]);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/app/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ circle: address, member, question }),
      });
      const data = await res.json();
      const text = res.ok && data.answer ? data.answer : "Sorry, I couldn't reach the agent. Try again in a moment.";
      setMessages((m) => [...m, { role: "bot", text }]);
    } catch {
      setMessages((m) => [...m, { role: "bot", text: "Sorry, I couldn't reach the agent. Try again in a moment." }]);
    } finally {
      setSending(false);
    }
  };

  if (!member) {
    return (
      <div className="empty">
        <div className="muted" style={{ marginBottom: 14 }}>Connect your wallet to ask the agent about this circle.</div>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="chat">
      <div className="muted">Ask in English, Pidgin, or Swahili — the agent only explains, it never moves money.</div>
      {messages.length > 0 && (
        <div className="log">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role === "me" ? "me" : "bot"}`}>{m.text}</div>
          ))}
          {sending && <div className="msg bot">…</div>}
        </div>
      )}
      <div className="row">
        <input
          placeholder="e.g. when do I get paid?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          disabled={sending}
        />
        <button className="btn" disabled={sending || !input.trim()} onClick={ask}>Ask</button>
      </div>
    </div>
  );
}
