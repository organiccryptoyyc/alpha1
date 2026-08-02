// x402Middleware.js
// Single adapter point for the x402 payment layer, on the current v2 SDK
// (@x402/express + @x402/core + @x402/svm + @x402/extensions + @coinbase/x402).
//
// The old v1 `x402-express` package used here previously is deprecated
// (security patches only). v2 is a different shape: routes declare a CAIP-2
// `network` id (e.g. "eip155:8453" for Base, or Solana's genesis-hash-based
// id — see SOLANA_MAINNET below) inside an `accepts` entry, schemes are
// registered on an `x402ResourceServer` instance instead of being implicit,
// and Bazaar discovery is an explicit extension you register and attach per
// route rather than a boolean flag on the facilitator config.
//
// Before going live: check https://docs.cdp.coinbase.com/x402/quickstart-for-sellers
// and https://docs.cdp.coinbase.com/x402/migration-guide for the current shape
// — this ecosystem moves fast. What will NOT change regardless of SDK version:
// you need (1) a payout address, (2) a facilitator that settles payments and
// reports to Bazaar, (3) a price per route.

import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { facilitator } from "@coinbase/x402";

const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;
if (!PAY_TO_ADDRESS) {
  console.warn(
    "[x402] WARNING: PAY_TO_ADDRESS is not set. Every route will fail to " +
      "generate valid payment requirements until you set your Solana wallet " +
      "address in the environment."
  );
}

// `facilitator` (from @coinbase/x402) is pre-wired to CDP's production
// endpoint (https://api.cdp.coinbase.com/platform/v2/x402) and reads
// CDP_API_KEY_ID / CDP_API_KEY_SECRET from the environment automatically for
// the authenticated verify/settle calls. It ignores X402_FACILITATOR_URL —
// that env var is kept in .env for documentation/reference, but this package
// does not read it. If you ever need a different facilitator, build a plain
// FacilitatorConfig ({ url, createAuthHeaders }) yourself instead of using
// this import.
if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
  console.warn(
    "[x402] WARNING: CDP_API_KEY_ID / CDP_API_KEY_SECRET are not set. " +
      "Payment verification and settlement (and therefore Bazaar listing) " +
      "will fail until both are set."
  );
}
const facilitatorClient = new HTTPFacilitatorClient(facilitator);

// One resource server per process: register the Solana "exact" payment
// scheme (SPL/USDC transfers) and the Bazaar discovery extension once, then
// reuse it for every route below.
const server = new x402ResourceServer(facilitatorClient);
registerExactSvmScheme(server, { rpcUrl: process.env.SOL_RPC_URL });
server.registerExtension(bazaarResourceServerExtension);

// CAIP-2 id CDP's facilitator actually advertises for Solana mainnet — a
// truncated genesis hash, not the human-readable "solana:mainnet" alias
// used in some SDK docs/migration tables. Using the wrong string here makes
// the facilitator's getSupported() sync reject every route with
// "Facilitator does not support scheme 'exact' on network ...".
// Reference: https://docs.cdp.coinbase.com/x402/network-support
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// Prices are intentionally above the ~$0.00125 combined Solana network fee +
// CDP facilitator fee ($0.00025 + $0.001 after the first 1,000 free calls/mo)
// so each call carries real margin. Adjust once you have real usage data.
//
// `extensions: declareDiscoveryExtension({...})` is what gets each route
// listed in x402 Bazaar the first time the CDP facilitator *settles* a real
// payment against it (verify alone doesn't trigger indexing) — no manual
// submission step. Once listed, agents crawling Bazaar (or its MCP server)
// find and call these routes without you doing anything further.
export const routes = {
  "GET /v1/eth/gas-price": {
    accepts: { scheme: "exact", payTo: PAY_TO_ADDRESS, price: "$0.005", network: SOLANA_MAINNET },
    description: "Current Ethereum gas price (wei + gwei)",
    extensions: declareDiscoveryExtension({
      output: { example: { chain: "ethereum", wei: "12345678901", gwei: 12.345678901 } },
    }),
  },
  "GET /v1/eth/latest-block": {
    accepts: { scheme: "exact", payTo: PAY_TO_ADDRESS, price: "$0.005", network: SOLANA_MAINNET },
    description: "Latest Ethereum block number",
    extensions: declareDiscoveryExtension({
      output: { example: { chain: "ethereum", blockNumber: 20123456 } },
    }),
  },
  "GET /v1/sol/latest-block": {
    accepts: { scheme: "exact", payTo: PAY_TO_ADDRESS, price: "$0.005", network: SOLANA_MAINNET },
    description: "Latest Solana slot",
    extensions: declareDiscoveryExtension({
      output: { example: { chain: "solana", slot: 289456123 } },
    }),
  },
  "GET /v1/price/:symbol": {
    accepts: { scheme: "exact", payTo: PAY_TO_ADDRESS, price: "$0.005", network: SOLANA_MAINNET },
    description: "USD price for eth, sol, btc, usdc, or pokt",
    extensions: declareDiscoveryExtension({
      pathParams: { symbol: "eth" },
      pathParamsSchema: {
        properties: { symbol: { type: "string", description: "eth, sol, btc, usdc, or pokt" } },
        required: ["symbol"],
      },
      output: { example: { symbol: "eth", usd: 3123.45 } },
    }),
  },
  "GET /v1/wallet/balance/:chain/:address": {
    accepts: { scheme: "exact", payTo: PAY_TO_ADDRESS, price: "$0.008", network: SOLANA_MAINNET },
    description: "Balance for an eth or sol address",
    extensions: declareDiscoveryExtension({
      pathParams: { chain: "eth", address: "0x0000000000000000000000000000000000000000" },
      pathParamsSchema: {
        properties: {
          chain: { type: "string", description: "'eth' or 'sol'" },
          address: { type: "string", description: "Wallet address on the given chain" },
        },
        required: ["chain", "address"],
      },
      output: { example: { chain: "eth", address: "0x...", eth: 1.2345 } },
    }),
  },
  // Niche, higher-margin route: live Pocket Network Shannon relay-demand
  // ranking, not another RPC/price pass-through. Priced above the RPC routes
  // because it's not commodity data — nothing else on Bazaar sells "which
  // services are seeing the most relay volume right now," and the buyer
  // (gateway/supplier operators deciding where to stake) has higher intent
  // than a generic lookup agent.
  "GET /v1/pokt/service-demand": {
    accepts: { scheme: "exact", payTo: PAY_TO_ADDRESS, price: "$0.03", network: SOLANA_MAINNET },
    description:
      "Live Pocket Network (Shannon) relay-demand ranking: which services/chains are seeing " +
      "the most relay volume right now, trend vs. the prior EMA window, and active supplier " +
      "count per service. Sourced live from the public Pocketdex GraphQL indexer, never cached " +
      "beyond 60s.",
    extensions: declareDiscoveryExtension({
      input: { limit: "10" },
      inputSchema: {
        properties: {
          limit: { type: "string", description: "Number of top services to return, 1-25 (default 10)" },
        },
      },
      output: {
        example: {
          network: "pocket-shannon",
          rankedBy: "relayVolumeEma",
          services: [
            {
              serviceId: "eth",
              name: "Ethereum",
              relayVolumeEma: 12345,
              prevRelayVolumeEma: 11800,
              trend: "rising",
              pctChange: 4.62,
              activeSuppliers: 812,
            },
          ],
        },
      },
    }),
  },
};

export function buildX402Middleware() {
  return paymentMiddleware(routes, server);
}
