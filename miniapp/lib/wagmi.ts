import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { celo, celoSepolia } from "./chain";

// MiniPay injects its wallet as window.ethereum (isMiniPay === true) and connects implicitly.
// We target the injected provider; the connect button is hidden inside MiniPay (see providers).
export const config = createConfig({
  chains: [celoSepolia, celo],
  connectors: [injected()],
  transports: {
    [celoSepolia.id]: http(),
    [celo.id]: http(),
  },
  ssr: true,
});

export function isMiniPay(): boolean {
  if (typeof window === "undefined") return false;
  const eth = (window as unknown as { ethereum?: { isMiniPay?: boolean } }).ethereum;
  return Boolean(eth && eth.isMiniPay);
}

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
