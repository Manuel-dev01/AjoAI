import { NextResponse, type NextRequest } from "next/server";
import { getAddress, isAddress } from "viem";
import { buildReport, collectFacts } from "@/lib/underwriting";
import {
  isPaidEndpointAvailable,
  PAY_TO,
  PRICE_USDC,
  price,
  withX402,
  X402_NETWORK,
} from "@/lib/x402";

// AjoAI's paid service: a savings-credit underwriting report for a wallet, priced in USDC over
// x402. This is the tier above the free MCP `get_score` tool — that returns the raw score, this
// returns the full assessment (history, live exposure, risk band, suggested credit limit).
//
// READ-ONLY over circle funds: it reads chain state and scores it (CLAUDE.md §1.3). The only value
// that moves is the buyer's own USDC, payer -> agent wallet, settled by the Celo facilitator.

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT",
  "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
  "Access-Control-Max-Age": "86400",
} as const;

const DESCRIPTION = "AjoAI savings-credit underwriting report for a Celo wallet";

async function handler(_req: NextRequest, body: unknown): Promise<NextResponse> {
  const address = String((body as { address?: unknown })?.address ?? "");
  // A 4xx here means settlement never runs — malformed requests are not charged.
  if (!isAddress(address)) {
    return NextResponse.json({ error: "Invalid or missing `address` (expected 0x...)" }, { status: 400, headers: CORS });
  }
  try {
    const checksummed = getAddress(address);
    const { facts, truncated } = await collectFacts(checksummed);
    return NextResponse.json(buildReport(checksummed, facts, truncated), { headers: CORS });
  } catch {
    return NextResponse.json({ error: "Failed to read on-chain state." }, { status: 502, headers: CORS });
  }
}

const unavailable = async () =>
  NextResponse.json(
    { error: "The paid endpoint is available on Celo mainnet only.", network: X402_NETWORK },
    { status: 503, headers: CORS },
  );

export const POST = isPaidEndpointAvailable()
  ? withX402(
      handler,
      {
        accepts: { scheme: "exact", price: price(), network: X402_NETWORK, payTo: PAY_TO },
        description: DESCRIPTION,
        mimeType: "application/json",
        serviceName: "AjoAI",
        tags: ["credit", "reputation", "roscas", "celo"],
        // x402 v2 carries the machine-readable requirements in the `payment-required` header and
        // leaves the body to the server. Default is `{}`; say something useful instead, so a human
        // or a crawler that hits this cold understands the offer.
        unpaidResponseBody: () => ({
          contentType: "application/json",
          body: {
            error: "Payment required",
            service: DESCRIPTION,
            price: { amount: PRICE_USDC, currency: "USDC", network: X402_NETWORK },
            howToPay: "Retry with an x402 X-PAYMENT header; see the `payment-required` response header for the exact requirements.",
            freeAlternatives: {
              offer: "GET this URL",
              basicScore: "MCP tool `get_score` at /api/mcp (raw score only)",
            },
          },
        }),
      },
      CORS,
    )
  : unavailable;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Free, unpaid discovery so agents (and 8004scan) can see the offer without buying it. */
export async function GET() {
  return NextResponse.json(
    {
      name: "AjoAI underwriting",
      description: DESCRIPTION,
      method: "POST",
      protocol: "x402",
      network: X402_NETWORK,
      price: { amount: PRICE_USDC, currency: "USDC" },
      payTo: PAY_TO,
      available: isPaidEndpointAvailable(),
      request: { address: "0x... wallet to underwrite" },
      response: ["savingsCredit", "participation", "assessment.riskBand", "assessment.suggestedCreditLimit"],
    },
    { headers: CORS },
  );
}
