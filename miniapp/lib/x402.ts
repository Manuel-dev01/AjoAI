import { NextResponse, type NextRequest } from "next/server";
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type HTTPAdapter,
  type HTTPRequestContext,
  type HTTPResponseInstructions,
  type RouteConfig,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { activeChain, CONTRACTS, TOKENS } from "./chain";

// x402 (HTTP-native stablecoin micropayments) for AjoAI's one paid endpoint.
//
// Celo Core Co. runs a NATIVE x402 facilitator — no third-party rail needed. It settles via
// EIP-3009 transferWithAuthorization: the buyer signs an authorization off-chain, the facilitator
// submits it and pays the gas, and funds move payer -> payee inside the token contract. The
// facilitator never custodies anything.
//
//   GET https://api.x402.celo.org/supported
//   -> { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42220" }, ...] }
//
// Only Celo MAINNET is supported by that facilitator, so the paid route is mainnet-only and
// degrades to an explicit 503 elsewhere (see isPaidEndpointAvailable) rather than serving free.
//
// We drive @x402/core directly instead of using @x402/next: every published @x402/next requires
// Next >= 16 and this app is on Next 14 (MiniPay-tested). @x402/core and @x402/evm are
// framework-agnostic with no peer deps, so withX402 below is the ~40-line Next 14 adapter that
// @x402/next would otherwise provide.
export const FACILITATOR_URL = "https://api.x402.celo.org";

export const X402_NETWORK = `eip155:${activeChain.id}` as `${string}:${string}`;

/** The facilitator settles USDC and USD₮ on Celo. USDC is the marketplace-conventional unit. */
const USDC_DECIMALS = 6;
export const PRICE_USDC = "0.05";

/** Payment is only wired where the Celo facilitator actually settles. */
export const isPaidEndpointAvailable = () => activeChain.id === 42220 && Boolean(TOKENS.USDC);

/**
 * Price as an explicit AssetAmount. The `$0.05` shorthand is not used: it resolves against x402's
 * default per-network stablecoin map, which has no Celo entry — naming the asset is unambiguous.
 * `extra` carries the EIP-712 domain the wallet signs the EIP-3009 authorization against.
 */
export const price = () => ({
  asset: TOKENS.USDC,
  amount: BigInt(Math.round(Number(PRICE_USDC) * 10 ** USDC_DECIMALS)).toString(),
  extra: { name: "USDC", version: "2" },
});

/** Payments land in the agent's own wallet — separate from every circle's funds (§1.1). */
export const PAY_TO = CONTRACTS.agentWallet;

/** Minimal HTTPAdapter over a NextRequest (App Router). */
class NextAdapter implements HTTPAdapter {
  constructor(private readonly req: NextRequest, private readonly body: unknown) {}
  getHeader(name: string) {
    return this.req.headers.get(name) ?? undefined;
  }
  getMethod() {
    return this.req.method;
  }
  getPath() {
    return new URL(this.req.url).pathname;
  }
  getUrl() {
    return this.req.url;
  }
  getAcceptHeader() {
    return this.req.headers.get("accept") ?? "";
  }
  getUserAgent() {
    return this.req.headers.get("user-agent") ?? "";
  }
  getBody() {
    return this.body;
  }
}

const toResponse = (r: HTTPResponseInstructions, extraHeaders: Record<string, string>) =>
  r.isHtml
    ? new NextResponse(String(r.body ?? ""), {
        status: r.status,
        headers: { ...r.headers, ...extraHeaders, "Content-Type": "text/html" },
      })
    : NextResponse.json(r.body ?? {}, { status: r.status, headers: { ...r.headers, ...extraHeaders } });

/**
 * Wrap a route handler so it is payable over x402.
 *
 * Settlement happens only AFTER the handler succeeds (status < 400) — a request that fails
 * validation or an RPC read is never charged, and its verified payment is explicitly cancelled.
 *
 * @param handler receives the already-parsed JSON body, so the body is read exactly once
 */
export function withX402(
  handler: (req: NextRequest, body: unknown) => Promise<NextResponse>,
  route: RouteConfig,
  headers: Record<string, string> = {},
) {
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL })).register(
    X402_NETWORK,
    new ExactEvmScheme(),
  );
  const http = new x402HTTPResourceServer(server, route);
  let ready: Promise<void> | null = null;

  return async function POST(req: NextRequest): Promise<NextResponse> {
    let body: unknown = undefined;
    try {
      body = await req.json();
    } catch {
      /* handler validates; a malformed body must still reach it as a free 400 */
    }

    // initialize() fetches the facilitator's supported kinds and validates the route against them.
    // Cached per lambda instance; a failure here must not silently serve paid content for free.
    try {
      ready ??= http.initialize();
      await ready;
    } catch {
      ready = null;
      return NextResponse.json(
        { error: "Payment facilitator unavailable; try again shortly." },
        { status: 503, headers },
      );
    }

    const adapter = new NextAdapter(req, body);
    const context: HTTPRequestContext = {
      adapter,
      path: adapter.getPath(),
      method: adapter.getMethod(),
      paymentHeader: adapter.getHeader("X-PAYMENT"),
    };

    const gate = await http.processHTTPRequest(context);
    if (gate.type === "payment-error") return toResponse(gate.response, headers);

    let res: NextResponse;
    try {
      res = await handler(req, body);
    } catch (err) {
      if (gate.type === "payment-verified") await gate.cancellationDispatcher.cancel({ reason: "handler_threw", error: err });
      throw err;
    }

    if (gate.type !== "payment-verified") return res;

    if (res.status >= 400) {
      await gate.cancellationDispatcher.cancel({ reason: "handler_failed", responseStatus: res.status });
      return res;
    }

    const settled = await http.processSettlement(gate.paymentPayload, gate.paymentRequirements, gate.declaredExtensions, {
      request: context,
    });
    if (!settled.success) return toResponse(settled.response, headers);

    for (const [k, v] of Object.entries(settled.headers)) res.headers.set(k, v);
    return res;
  };
}
