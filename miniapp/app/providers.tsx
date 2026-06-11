"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { WagmiProvider, useConnect } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config, isMiniPay } from "@/lib/wagmi";

const queryClient = new QueryClient();

// True when running inside the MiniPay webview (wallet injected, connect button hidden).
export const MiniPayContext = createContext(false);
export const useInMiniPay = () => useContext(MiniPayContext);

// Inside MiniPay the wallet connection is implicit — auto-connect and hide any connect button.
// On a desktop browser we leave the connect button visible for dev/testing.
function AutoConnect({ onDetect }: { onDetect: (v: boolean) => void }) {
  const { connect, connectors } = useConnect();
  useEffect(() => {
    if (isMiniPay()) {
      onDetect(true);
      const injected = connectors[0];
      if (injected) connect({ connector: injected });
    }
  }, [connect, connectors, onDetect]);
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
