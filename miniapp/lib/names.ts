"use client";

// Circle names are a UX layer (the Circle contract has no name field) — the on-chain address
// stays the source of truth. Names live in localStorage and also travel in the invite link's
// &n= param so joiners cache the same name. Keyed by lowercased address.

const KEY = "ajoai.names";

function readAll(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function getName(addr?: string): string | undefined {
  if (!addr) return undefined;
  return readAll()[addr.toLowerCase()];
}

export function setName(addr: string, name: string): void {
  if (typeof window === "undefined" || !name.trim()) return;
  const all = readAll();
  all[addr.toLowerCase()] = name.trim();
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full / unavailable — names are best-effort */
  }
}
