"use client";

import { createContext, useContext, useEffect, useState, useRef } from "react";
import { WagmiProvider, useConnect, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config, isMiniPay } from "@/lib/wagmi";

const queryClient = new QueryClient();

// True when running inside the MiniPay webview (wallet injected, connect button hidden).
export const MiniPayContext = createContext(false);
export const useInMiniPay = () => useContext(MiniPayContext);

// Inside MiniPay the wallet connection is implicit — auto-connect and hide any connect button.
// On a desktop browser we leave the connect button visible for dev/testing.
function AutoConnect({ onDetect }: { onDetect: (v: boolean) => void }) {
  const { connect, connectors, isPending, error } = useConnect();
  const { isConnected } = useAccount();
  const attempts = useRef(0);

  useEffect(() => {
    if (!isMiniPay() || isConnected) return;
    onDetect(true);

    // Find the injected connector reliably (not by array index)
    const injected = connectors.find((c) => c.id === "injected");
    if (!injected) return; // connectors not ready yet — effect re-runs when connectors change

    connect(
      { connector: injected },
      {
        onError: (err) => {
          console.error("[AutoConnect] MiniPay connect failed:", err);
        },
      }
    );
  }, [connect, connectors, onDetect, isConnected]);

  // Retry on error (up to 5 attempts, 2s apart)
  useEffect(() => {
    if (!error || isConnected || attempts.current >= 5) return;
    attempts.current += 1;
    const t = setTimeout(() => {
      const injected = connectors.find((c) => c.id === "injected");
      if (injected) connect({ connector: injected });
    }, 2000);
    return () => clearTimeout(t);
  }, [error, isConnected, connect, connectors]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [inMiniPay, setInMiniPay] = useState(false);
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <MiniPayContext.Provider value={inMiniPay}>
          <AutoConnect onDetect={setInMiniPay} />
          {children}
        </MiniPayContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
