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
//
// NOT-DEPLOYED: the "POKT data-expansion pack" block below (suppliers,
// applications, tokenomics, throughput, validators) was written and
// syntax-checked overnight 2026-08-02 but deliberately NOT pushed to GitHub
// or redeployed to Portainer yet -- holding for explicit approval so the
// currently-live 11/11 Alpha5 state (tag: alpha5) keeps earning through the
// night undisturbed. Review, then push + "Pull and redeploy" when ready.

import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
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

// peaq (EVM, chain ID 3338) payout address — a *different* wallet from
// PAY_TO_ADDRESS above, since peaq is an EVM-layer chain and Solana keys
// don't work there. Deliberately optional: until this is set, every route
// below still lists Solana-only (current production behavior is unchanged).
// The moment PEAQ_PAY_TO_ADDRESS is set in Portainer and the stack is
// redeployed, peaq lights up as a second payment option on every route below
// with no further code changes needed.
const PEAQ_PAY_TO_ADDRESS = process.env.PEAQ_PAY_TO_ADDRESS;
if (!PEAQ_PAY_TO_ADDRESS) {
  console.warn(
    "[x402] NOTE: PEAQ_PAY_TO_ADDRESS is not set. Routes will list Solana " +
      "payment only until a peaq EVM wallet address is set in the " +
      "environment -- this is expected until peaq support is finished."
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

// PayAI's hosted facilitator is peaq's officially documented x402
// facilitator (https://docs.peaq.xyz — x402 integration guide). Unlike CDP's
// facilitator it doesn't require API key auth for verify/settle, matching
// FacilitatorConfig's optional createAuthHeaders. Kept behind an env var so
// it can be swapped without a code change if peaq documents a different
// facilitator later.
//
// IMPORTANT: registered ONLY when PEAQ_PAY_TO_ADDRESS is actually set, not
// unconditionally. A same-night production incident showed why: simply
// adding a second facilitator to the array below — even with zero routes
// advertising peaq in `accepts` — broke real Solana settlements on the
// higher-priced routes (pokt-service-demand, uprock-fetch). PayAI's own
// /supported response lists our exact Solana network too, and once it's
// registered the SDK apparently considers it a candidate for verify/settle
// on every Solana payment, not just peaq ones. Root cause not fully
// isolated (PayAI may cap sponsored-gas amounts, or facilitator selection
// among an array behaves differently than a single client) -- but the safe,
// conservative fix is: don't register a facilitator we're not using yet.
// Also confirmed PayAI genuinely does NOT support eip155:3338 (peaq) in its
// live /supported response despite peaq's docs claiming it does, so this
// stays unused until a working peaq facilitator is found anyway.
//
// TODO (next patch that touches this file): the "second facilitator broke
// Solana settlement" theory above was re-examined overnight 2026-08-02 by
// reading the actual @x402/core source, and it doesn't hold up -- facilitator
// selection is deterministic (first array entry wins per network+scheme) and
// has no concept of price, but the failures only ever hit the two highest
// price tiers ($0.03/$0.10). That pattern matches a simple insufficient-
// USDC-balance-in-the-test-wallet explanation exactly as well, which is what
// the SECOND "1/11 paid" regression was later confirmed to actually be, via
// Solscan. CONFIRM which one it really was next time this file is touched:
// on a non-prod branch, temporarily make BOTH facilitators + the EVM scheme
// unconditional again (remove the PEAQ_PAY_TO_ADDRESS_SET guards below), top
// the test wallet up well above $0.20, and run test-all-routes.mjs. 11/11 =
// the theory above was wrong and this conditional gating never fixed a real
// bug (still fine to keep as defensive practice). Any $0.03/$0.10 failure
// even with ample funds = there's a real amount-dependent bug worth chasing.
//
// If/when peaq is reactivated: do NOT reach for PayAI again, they still
// don't support peaq. Use peaq's own self-hosted reference facilitator
// instead (github.com/peaqnetwork/x402-peaq) -- but port it to @x402/core +
// @x402/evm v2 first. Their reference code targets the OLDER x402-foundation
// SDK (`x402`/`x402-types` packages, prices as `network: "peaq"` not CAIP-2
// `"eip155:3338"`), which is a different protocol-version surface than what
// this server runs on -- confirm it actually speaks x402Version 2 /
// PAYMENT-SIGNATURE headers before wiring it in, not just copy-paste it.
const PAYAI_FACILITATOR_URL = process.env.PAYAI_FACILITATOR_URL || "https://facilitator.payai.network";
// Reuses the PEAQ_PAY_TO_ADDRESS declared above -- one source of truth for
// "is peaq actually active" instead of re-reading the env var here.
const PEAQ_PAY_TO_ADDRESS_SET = Boolean(PEAQ_PAY_TO_ADDRESS);

// One resource server per process. Only add PayAI to the facilitator array
// once peaq is actually wired up (see note above) -- otherwise this is
// exactly the single-facilitator (CDP) setup already proven working in
// production. Register the Solana "exact" scheme (SPL/USDC transfers)
// unconditionally, the EVM "exact" scheme scoped to peaq only (not a
// blanket eip155:* wildcard) ONLY when peaq is active, and the Bazaar
// discovery extension once, then reuse this one server instance for every
// route below.
const server = new x402ResourceServer(
  PEAQ_PAY_TO_ADDRESS_SET
    ? [facilitatorClient, new HTTPFacilitatorClient({ url: PAYAI_FACILITATOR_URL })]
    : facilitatorClient
);
registerExactSvmScheme(server, { rpcUrl: process.env.SOL_RPC_URL });
if (PEAQ_PAY_TO_ADDRESS_SET) {
  registerExactEvmScheme(server, { networks: ["eip155:3338"] });
}
server.registerExtension(bazaarResourceServerExtension);

// CAIP-2 id CDP's facilitator actually advertises for Solana mainnet — a
// truncated genesis hash, not the human-readable "solana:mainnet" alias
// used in some SDK docs/migration tables. Using the wrong string here makes
// the facilitator's getSupported() sync reject every route with
// "Facilitator does not support scheme 'exact' on network ...".
// Reference: https://docs.cdp.coinbase.com/x402/network-support
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// CAIP-2 id for peaq mainnet — chain ID 3338, confirmed via peaq's own docs
// (docs.peaq.xyz) and cross-checked against OnFinality/ChainList/PublicNode.
const PEAQ_MAINNET = "eip155:3338";

// peaq's officially-announced bridged USDC (confirmed via peaq.xyz's own
// "USDC is now on peaq" blog post, cross-checked on Subscan: symbol USDC,
// 6 decimals, contract type FiatTokenProxy — i.e. Circle's standard
// FiatTokenV2 proxy pattern, the same contract template used for every other
// "USD Coin"/"2" entry in @x402/evm's own default-asset table). It is NOT
// in that table for peaq, so every route below supplies this asset
// explicitly instead of relying on the "$X.XX" shorthand, which would throw
// "No default asset configured for network eip155:3338".
//
// name/version here are the EIP-712 signing-domain fields the exact-EVM
// scheme includes in payment requirements so a wallet can produce a valid
// transferWithAuthorization signature — NOT display text. "USD Coin"/"2" is
// Circle's fixed domain for every FiatTokenV2 deployment regardless of
// chain; if the very first live peaq payment fails signature verification,
// this is the first thing to re-check against the deployed contract itself.
const PEAQ_USDC = {
  address: "0xbbA60da06c2c5424f03f7434542280FCAd453d10",
  decimals: 6,
  name: "USD Coin",
  version: "2",
};

// Builds a route's `accepts` array: always Solana (unchanged from before),
// plus peaq as a second option once PEAQ_PAY_TO_ADDRESS is configured. Same
// USD price on both networks — usdAmount is a plain number (e.g. 0.005), not
// a "$"-prefixed string, so it can be converted to both a Money string for
// the Solana side and an atomic USDC amount for the peaq side from one
// source of truth.
function multiNetworkAccepts(usdAmount) {
  const accepts = [
    { scheme: "exact", payTo: PAY_TO_ADDRESS, price: `$${usdAmount.toFixed(3)}`, network: SOLANA_MAINNET },
  ];
  if (PEAQ_PAY_TO_ADDRESS) {
    accepts.push({
      scheme: "exact",
      payTo: PEAQ_PAY_TO_ADDRESS,
      price: {
        amount: Math.round(usdAmount * 10 ** PEAQ_USDC.decimals).toString(),
        asset: PEAQ_USDC.address,
        extra: { name: PEAQ_USDC.name, version: PEAQ_USDC.version },
      },
      network: PEAQ_MAINNET,
    });
  }
  return accepts;
}

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
    accepts: multiNetworkAccepts(0.005),
    description: "Current Ethereum gas price (wei + gwei)",
    extensions: declareDiscoveryExtension({
      output: { example: { chain: "ethereum", wei: "12345678901", gwei: 12.345678901 } },
    }),
  },
  "GET /v1/eth/latest-block": {
    accepts: multiNetworkAccepts(0.005),
    description: "Latest Ethereum block number",
    extensions: declareDiscoveryExtension({
      output: { example: { chain: "ethereum", blockNumber: 20123456 } },
    }),
  },
  "GET /v1/sol/latest-block": {
    accepts: multiNetworkAccepts(0.005),
    description: "Latest Solana slot",
    extensions: declareDiscoveryExtension({
      output: { example: { chain: "solana", slot: 289456123 } },
    }),
  },
  "GET /v1/price/:symbol": {
    accepts: multiNetworkAccepts(0.005),
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
    accepts: multiNetworkAccepts(0.008),
    description: "Balance for an eth, sol, or peaq address",
    extensions: declareDiscoveryExtension({
      pathParams: { chain: "eth", address: "0x0000000000000000000000000000000000000000" },
      pathParamsSchema: {
        properties: {
          chain: { type: "string", description: "'eth', 'sol', or 'peaq'" },
          address: { type: "string", description: "Wallet address on the given chain" },
        },
        required: ["chain", "address"],
      },
      output: { example: { chain: "eth", address: "0x...", eth: 1.2345 } },
    }),
  },
  // peaq-native commodity routes (chain ID 3338) — same shape as the eth/sol
  // routes above, just pointed at peaq's own RPC. Priced at the same tier as
  // their eth/sol equivalents since they're the same kind of pass-through
  // data; peaq's differentiated value-add is the machine-identity route
  // (planned separately), not these.
  "GET /v1/peaq/gas-price": {
    accepts: multiNetworkAccepts(0.005),
    description: "Current peaq network gas price (wei + gwei)",
    extensions: declareDiscoveryExtension({
      output: { example: { chain: "peaq", wei: "1234567", gwei: 0.001234567 } },
    }),
  },
  "GET /v1/peaq/latest-block": {
    accepts: multiNetworkAccepts(0.005),
    description: "Latest peaq network block number",
    extensions: declareDiscoveryExtension({
      output: { example: { chain: "peaq", blockNumber: 3137077 } },
    }),
  },
  // Niche, judgment-tier route (same pricing logic as POKT service-demand
  // above): a machine trust/verification signal, not a raw pass-through.
  // Sourced from peaq's own public MCR (Machine Credit Rating) API --
  // credit rating, bond status, negative-flag, and event history for any
  // registered peaq machine. Sellable to other agents/bots deciding whether
  // to transact with a given machine, which is exactly the "is this thing
  // real and trustworthy" question a verifier needs answered before it pays
  // that machine for anything else.
  "GET /v1/peaq/machine-verify/:idOrAddress": {
    accepts: multiNetworkAccepts(0.03),
    description:
      "Trust/verification check for a peaq network machine: credit rating (MCR), bond status, " +
      "negative-flag status, and on-chain event history. Sourced live from peaq's public MCR API " +
      "-- pay once instead of building your own peaq chain integration to answer 'is this machine " +
      "real and in good standing.'",
    extensions: declareDiscoveryExtension({
      pathParams: { idOrAddress: "0x1bd46178040bc2b50358b4e75b6ebf05e7801e8f" },
      pathParamsSchema: {
        properties: {
          idOrAddress: {
            type: "string",
            description: "peaq machine DID (did:peaq:0x...) or raw 0x EVM address",
          },
        },
        required: ["idOrAddress"],
      },
      output: {
        example: {
          source: "peaqos-mcr",
          registered: true,
          did: "did:peaq:0x1bd46178040bc2b50358b4e75b6ebf05e7801e8f",
          machineId: 1,
          creditRating: "BBB",
          creditScore: 62,
          bondStatus: "bonded",
          negativeFlag: false,
          eventCount: 12,
        },
      },
    }),
  },
  // Niche, higher-margin route: live Pocket Network Shannon relay-demand
  // ranking, not another RPC/price pass-through. Priced above the RPC routes
  // because it's not commodity data — nothing else on Bazaar sells "which
  // services are seeing the most relay volume right now," and the buyer
  // (gateway/supplier operators deciding where to stake) has higher intent
  // than a generic lookup agent.
  "GET /v1/pokt/service-demand": {
    accepts: multiNetworkAccepts(0.03),
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
  // --- POKT data-expansion pack (built overnight 2026-08-02, held for
  // review/deploy approval -- see NOT-DEPLOYED note at top of this file) ---
  // Five new POKT Shannon routes, same "judgment-tier, not commodity
  // pass-through" pricing logic as service-demand above. Every field name
  // below matches the live-verified GraphQL/LCD schema in dataSources.js --
  // nothing here was guessed from docs alone (peaq's docs were already wrong
  // once this session; the indexer's own docs were wrong about the `relays`
  // connection being populated, caught by live-testing before writing code).
  "GET /v1/pokt/suppliers": {
    accepts: multiNetworkAccepts(0.02),
    description:
      "Pocket Network (Shannon) supplier landscape: active supplier count, total POKT staked " +
      "network-wide, and the top staked operators with their service-config counts. Supply-side " +
      "complement to /v1/pokt/service-demand's demand-side signal.",
    extensions: declareDiscoveryExtension({
      input: { limit: "10" },
      inputSchema: {
        properties: {
          limit: { type: "string", description: "Number of top suppliers to return, 1-25 (default 10)" },
        },
      },
      output: {
        example: {
          network: "pocket-shannon",
          activeSuppliers: 4083,
          totalStakedPokt: 245006941.99,
          rankedBy: "stakeAmount",
          topSuppliers: [
            { operatorId: "pokt1jck7...", stakedPokt: 60499.99, servicesCount: 7 },
          ],
        },
      },
    }),
  },
  "GET /v1/pokt/applications": {
    accepts: multiNetworkAccepts(0.02),
    description:
      "Pocket Network (Shannon) application (demand-side) stake feed: active application count, " +
      "total POKT staked to consume relays, and the top-staked applications -- who's buying " +
      "network capacity and how much.",
    extensions: declareDiscoveryExtension({
      input: { limit: "10" },
      inputSchema: {
        properties: {
          limit: { type: "string", description: "Number of top applications to return, 1-25 (default 10)" },
        },
      },
      output: {
        example: {
          network: "pocket-shannon",
          activeApplications: 125,
          totalStakedPokt: 830714.22,
          rankedBy: "stakeAmount",
          topApplications: [
            { applicationId: "pokt1hufj...", stakedPokt: 29580.35, servicesSubscribed: 1 },
          ],
        },
      },
    }),
  },
  "GET /v1/pokt/tokenomics": {
    accepts: multiNetworkAccepts(0.02),
    description:
      "Live Pocket Network (Shannon) tokenomics parameters straight from chain governance: the " +
      "PIP-41 mint ratio, the live burn-equals-mint settlement split (dao/proposer/supplier/" +
      "source_owner/application), and the compute-units-to-tokens multiplier. Never cached beyond " +
      "5 minutes; these are the numbers that go stale the moment a governance proposal passes.",
    extensions: declareDiscoveryExtension({
      output: {
        example: {
          network: "pocket-shannon",
          mintRatio: 0.975,
          settlementDistribution: { dao: 0.045, proposer: 0.14, supplier: 0.79, source_owner: 0.025, application: 0 },
          globalInflationPerClaim: 0.000001,
          computeUnitsToTokensMultiplier: "132470",
          blocksPerSession: "20",
        },
      },
    }),
  },
  "GET /v1/pokt/throughput": {
    accepts: multiNetworkAccepts(0.03),
    description:
      "Pocket Network (Shannon) throughput-by-service leaderboard: services ranked by ALL-TIME " +
      "cumulative on-chain CLAIMED relay and compute-unit volume -- real settled throughput, " +
      "distinct from service-demand's difficulty-adjusted momentum signal.",
    extensions: declareDiscoveryExtension({
      input: { limit: "10" },
      inputSchema: {
        properties: {
          limit: { type: "string", description: "Number of top services to return, 1-15 (default 10)" },
        },
      },
      output: {
        example: {
          network: "pocket-shannon",
          rankedBy: "cumulativeClaimedRelays",
          services: [
            {
              serviceId: "base-test",
              name: "Base Testnet",
              cumulativeClaimedRelays: 69180,
              cumulativeClaimedComputeUnits: 61293480,
              cumulativeEstimatedComputeUnits: 61293480,
            },
          ],
        },
      },
    }),
  },
  "GET /v1/pokt/validators": {
    accepts: multiNetworkAccepts(0.03),
    description:
      "Pocket Network (Shannon) validator security/decentralization feed: bonded validator count, " +
      "total POKT bonded network-wide, and each validator's TOTAL bonded stake (self + delegations " +
      "-- true voting power, not just self-stake) with commission rate and jailed status.",
    extensions: declareDiscoveryExtension({
      input: { limit: "10" },
      inputSchema: {
        properties: {
          limit: { type: "string", description: "Number of top validators to return, 1-25 (default 10)" },
        },
      },
      output: {
        example: {
          network: "pocket-shannon",
          bondedValidatorCount: 21,
          totalBondedPokt: 8706223.72,
          rankedBy: "bondedTokens",
          validators: [
            { moniker: "Validatus", bondedTokensPokt: 5552223.72, commissionRatePct: 5, jailed: false },
          ],
        },
      },
    }),
  },
  // Unlike every other route here, this one has a real per-call upstream
  // cost: confirmed with the UpRock team at ~2-3 credits per crawl fetch,
  // i.e. ~$0.012-$0.018 at $0.006/credit after the first 5,000 free
  // credits/month (200/day). $0.10 leaves ~85-88% margin -- priced on
  // value/differentiation (real-device fetch), not cost-plus, so no need to
  // chase the cost floor down. Note the ~65-100 calls/day free-tier ceiling
  // before UpRock billing shifts to per-credit overage.
  "GET /v1/uprock/fetch": {
    accepts: multiNetworkAccepts(0.1),
    description:
      "Fetch any URL through a real residential/mobile device (UpRock's network, 190+ " +
      "countries) instead of a datacenter IP -- returns the page as an actual user in that " +
      "location would see it, bypassing anti-bot blocking and geo-filtered content.",
    extensions: declareDiscoveryExtension({
      input: { url: "https://example.com" },
      inputSchema: {
        properties: {
          url: { type: "string", description: "Absolute URL to fetch (http or https)" },
        },
        required: ["url"],
      },
      output: {
        example: {
          source: "uprock-real-device",
          url: "https://example.com",
          statusCode: 200,
          success: true,
          content: "Example Domain...",
        },
      },
    }),
  },
};

export function buildX402Middleware() {
  return paymentMiddleware(routes, server);
}
