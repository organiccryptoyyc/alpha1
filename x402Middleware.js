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

// SECURITY (key custody, reviewed 2026-08-04): this app holds NO signing key
// for the Solana/CDP path above -- CDP_API_KEY_ID/SECRET is a bearer API key
// that authenticates calls to Coinbase's hosted facilitator, not a private
// key. The buyer's own wallet signs their payment authorization client-side;
// CDP verifies and submits it on-chain using its own infrastructure. This
// app never custodies a Solana signing key at any point. Contrast with the
// self-hosted peaq facilitator (peaq-facilitator.js), which DOES hold a real
// private key (FACILITATOR_PRIVATE_KEY) -- see that file's header for the
// max-loss-if-leaked analysis (gas-only, distinct from the payout wallet).

// Self-hosted peaq facilitator (peaq-facilitator.js, deployed as its own
// docker-compose service). Replaces PayAI, which was confirmed (live
// /supported check, prior session) to NOT actually advertise eip155:3338
// support despite peaq's own docs naming it as peaq's official facilitator.
// peaq's published reference facilitator (github.com/peaqnetwork/x402-peaq)
// couldn't be pointed to directly either -- it's pinned to the OLDER
// pre-v2 `x402` package (v0.7), advertising x402Version 1 and a bare
// `network: "peaq"` string rather than the v2 CAIP-2 "eip155:3338" this
// server speaks. peaq-facilitator.js is a from-scratch v2-native rebuild
// using @x402/core/facilitator + @x402/evm/exact/facilitator instead --
// see that file's header comment for the full detail on why and how.
//
// STATUS as of 2026-08-03: built and staged, NOT yet live-tested against a
// real payment. Needs a dedicated peaq wallet funded with native PEAQ (for
// this facilitator's own gas) before a real settle can be confirmed. Until
// FACILITATOR_PRIVATE_KEY is set on the peaq-facilitator service, it idles
// with an empty /supported list, so it's safe to have deployed already.
//
// IMPORTANT: registered ONLY when PEAQ_PAY_TO_ADDRESS is actually set, not
// unconditionally. A same-night production incident (prior session, with
// PayAI as the second facilitator) showed why: simply adding a second
// facilitator to the array below — even with zero routes advertising peaq in
// `accepts` — appeared to break real Solana settlements on the higher-priced
// routes (pokt-service-demand, uprock-fetch). Root cause not fully isolated;
// see the TODO below for the leading alternative explanation. Regardless of
// which it was, the safe, conservative fix stands: don't register a
// facilitator we're not using yet.
//
// TODO (next patch that touches this file, and definitely before the first
// real peaq settle test): the "second facilitator broke Solana settlement"
// theory above was re-examined overnight 2026-08-02 by reading the actual
// @x402/core source, and it doesn't hold up -- facilitator selection is
// deterministic (first array entry wins per network+scheme) and has no
// concept of price, but the failures only ever hit the two highest price
// tiers ($0.03/$0.10). That pattern matches a simple insufficient-USDC-
// balance-in-the-test-wallet explanation exactly as well, which is what the
// SECOND "1/11 paid" regression was later confirmed to actually be, via
// Solscan. This is now doubly important to settle before flipping
// PEAQ_PAY_TO_ADDRESS on for real, since doing so re-introduces the exact
// "second facilitator in the array" condition implicated above. CONFIRM
// which explanation it really was: on a non-prod branch, temporarily make
// both facilitators + the EVM scheme unconditional again (remove the
// PEAQ_PAY_TO_ADDRESS_SET guards below), top the test wallet up well above
// $0.20, and run test-all-routes.mjs. 11/11 = the theory above was wrong and
// this conditional gating never fixed a real bug (still fine to keep as
// defensive practice). Any $0.03/$0.10 failure even with ample funds =
// there's a real amount-dependent bug worth chasing -- and this time it'd
// need chasing with peaq-facilitator.js as a suspect too, not just PayAI.
const PEAQ_FACILITATOR_URL = process.env.PEAQ_FACILITATOR_URL || "http://peaq-facilitator:3333";
// Reuses the PEAQ_PAY_TO_ADDRESS declared above -- one source of truth for
// "is peaq actually active" instead of re-reading the env var here.
const PEAQ_PAY_TO_ADDRESS_SET = Boolean(PEAQ_PAY_TO_ADDRESS);

// --- BNB Smart Chain (BSC, chain ID 56) -- SCAFFOLDED, NOT YET ACTIVE ------
// Binance's own hosted x402 facilitator ("B402") launched on BSC in July
// 2026, covering the stablecoins U, USD1, USDT, and USDC
// (developers.binance.com/docs/products/onchainpay-x402). Unlike CDP (a
// free-signup bearer API key) or our self-hosted peaq facilitator (plain
// HTTP, no auth), B402 requires becoming an approved "partner developer":
// a formal application (business name, contact email, the BSC payout wallet
// below, a 1024-bit RSA public key, and this server's outbound IP for
// allowlisting), filed separately for sandbox and production, per
// developers.binance.com's "Apply partner developer account" page. Every
// B402 API call then has to be signed RSA-SHA256 with the matching private
// key -- a plain `new HTTPFacilitatorClient({ url })` (which works fine for
// CDP and our own peaq facilitator) has no way to produce that signature, so
// it cannot talk to B402 as-is.
//
// VERIFIED ON-CHAIN (2026-08-03, queried directly via eth_call against BSC
// mainnet -- not assumed from docs, same discipline that caught the peaq
// domain bug below): despite Binance's own docs listing "USD1" as
// supporting the x402 "eip3009" scheme, USD1's real deployed contract
// (address in BSC_USD1 below) REVERTS on authorizationState(address,bytes32)
// -- it does not actually implement EIP-3009 transferWithAuthorization. It
// DOES implement EIP-2612 permit (nonces() succeeds) and reports a real
// EIP-5267 domain via eip712Domain() (not the separate version() selector,
// which returned an empty string on this specific contract). A real
// USD1 payment would therefore have to go through @x402/evm's Permit2
// fallback path (x402ExactPermit2Proxy -- confirmed present in the
// installed @x402/evm@2.20.0 package) rather than the plain
// transferWithAuthorization flow already proven on Solana and peaq. That
// path has NOT been live-tested by this project -- treat it with at least
// as much caution as peaq needed before its first real payment.
//
// buildBinanceFacilitatorConfig() deliberately returns null (no RSA signing
// implemented yet), which keeps BSC_ENABLED false and this entire network
// inert -- exactly the "don't advertise a network we can't actually settle"
// discipline the peaq section above documents as a real past incident, not
// a hypothetical. To finish activating BSC: (1) apply for and receive B402
// partner credentials (sandbox first), (2) implement RSA-SHA256 request
// signing here per developers.binance.com's "API request signing" page,
// (3) set BSC_PAY_TO_ADDRESS + the B402 credentials in Portainer, (4) run a
// real end-to-end payment test before trusting it, the same way peaq needed
// two live-test rounds to surface real bugs no amount of code review caught.
const BSC_PAY_TO_ADDRESS = process.env.BSC_PAY_TO_ADDRESS;
if (!BSC_PAY_TO_ADDRESS) {
  console.warn(
    "[x402] NOTE: BSC_PAY_TO_ADDRESS is not set. BSC is not offered as a " +
      "payment option -- this is expected, see the BSC scaffolding note in " +
      "x402Middleware.js for what's still needed before it can be."
  );
}

function buildBinanceFacilitatorConfig() {
  // TODO: implement RSA-SHA256 request signing (see comment above) once
  // B402 partner credentials exist. Returning null keeps BSC fully inert
  // regardless of whether BSC_PAY_TO_ADDRESS is set.
  return null;
}
const binanceFacilitatorConfig = buildBinanceFacilitatorConfig();
const BSC_ENABLED = Boolean(BSC_PAY_TO_ADDRESS && binanceFacilitatorConfig);
if (BSC_PAY_TO_ADDRESS && !binanceFacilitatorConfig) {
  console.warn(
    "[x402] NOTE: BSC_PAY_TO_ADDRESS is set but the B402 facilitator client " +
      "isn't implemented yet (needs RSA-SHA256 signing + partner " +
      "credentials) -- BSC will NOT be offered as a payment option until " +
      "that's finished."
  );
}

// One resource server per process. Only add the self-hosted peaq facilitator
// (and, once finished, the B402 client) to the array once each is actually
// wired up (see notes above) -- otherwise this is exactly the
// single-facilitator (CDP) setup already proven working in production.
// Register the Solana "exact" scheme (SPL/USDC transfers) unconditionally,
// the EVM "exact" scheme scoped to only the specific EVM networks that are
// actually active (never a blanket eip155:* wildcard), and the Bazaar
// discovery extension once, then reuse this one server instance for every
// route below.
const additionalFacilitators = [];
if (PEAQ_PAY_TO_ADDRESS_SET) additionalFacilitators.push(new HTTPFacilitatorClient({ url: PEAQ_FACILITATOR_URL }));
if (BSC_ENABLED) additionalFacilitators.push(new HTTPFacilitatorClient(binanceFacilitatorConfig));

const server = new x402ResourceServer(
  additionalFacilitators.length > 0 ? [facilitatorClient, ...additionalFacilitators] : facilitatorClient
);
registerExactSvmScheme(server, { rpcUrl: process.env.SOL_RPC_URL });
const evmNetworks = [];
if (PEAQ_PAY_TO_ADDRESS_SET) evmNetworks.push("eip155:3338");
if (BSC_ENABLED) evmNetworks.push("eip155:56");
if (evmNetworks.length > 0) {
  registerExactEvmScheme(server, { networks: evmNetworks });
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
// transferWithAuthorization signature — NOT display text, and NOT
// necessarily "USD Coin"/"2" despite that being Circle's usual FiatTokenV2
// domain on most chains. CONFIRMED WRONG here: a live payment test on
// 2026-08-03 failed with "invalid_exact_evm_token_name_mismatch", and
// querying the deployed contract directly (name()/version() via eth_call)
// showed its real on-chain name is "USDC", not "USD Coin" — version is "2"
// as assumed. The facilitator checks the live contract's name()/version()
// against these values before settling, so they must match byte-for-byte;
// if a future peaq asset swap ever breaks a payment the same way again,
// re-query the contract directly rather than assuming the usual default.
const PEAQ_USDC = {
  address: "0xbbA60da06c2c5424f03f7434542280FCAd453d10",
  decimals: 6,
  name: "USDC",
  version: "2",
};

// CAIP-2 id for BNB Smart Chain mainnet — chain ID 56.
const BSC_MAINNET = "eip155:56";

// World Liberty Financial USD (USD1) on BSC — see the BSC scaffolding note
// above for why this asset was picked over USDT/USDC (Binance's own docs
// list those two as permit2-exact/permit2-upto ONLY, never eip3009, and
// this project hasn't built/tested a Permit2 flow yet either way).
//
// Every field below was queried directly from the live contract on
// 2026-08-03 (eth_call against BSC mainnet), not assumed from docs or
// convention -- name/version specifically came from eip712Domain()
// (EIP-5267), not the separate name()/version() selectors, because this
// contract's standalone version() call returned an empty string while
// eip712Domain() reported the real signing domain used on-chain:
//   name()          -> "World Liberty Financial USD"
//   eip712Domain()  -> name "World Liberty Financial USD", version "1"
//   decimals()      -> 18 (NOT 6 -- unlike every other stablecoin in this
//                      file, USD1 uses 18 decimals; verified, not assumed)
// Inert until BSC_ENABLED is true (see above) -- multiNetworkAccepts() below
// only pushes this once a real B402 facilitator client exists.
const BSC_USD1 = {
  address: "0x8d0D000eE44948FC98c9B98A4FA4921476f08B0D",
  decimals: 18,
  name: "World Liberty Financial USD",
  version: "1",
};

// Builds a route's `accepts` array: always Solana (unchanged from before),
// plus peaq once PEAQ_PAY_TO_ADDRESS is configured, plus BSC once BSC_ENABLED
// is true (see the scaffolding note above -- not yet reachable in
// production). Same USD price on every network — usdAmount is a plain
// number (e.g. 0.005), not a "$"-prefixed string, so it can be converted to
// a Money string for Solana and an atomic token amount for each EVM side
// from one source of truth.
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
  if (BSC_ENABLED) {
    accepts.push({
      scheme: "exact",
      payTo: BSC_PAY_TO_ADDRESS,
      price: {
        amount: Math.round(usdAmount * 10 ** BSC_USD1.decimals).toString(),
        asset: BSC_USD1.address,
        extra: { name: BSC_USD1.name, version: BSC_USD1.version },
      },
      network: BSC_MAINNET,
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
    description: "Balance for an eth, sol, peaq, or bsc address",
    extensions: declareDiscoveryExtension({
      pathParams: { chain: "eth", address: "0x0000000000000000000000000000000000000000" },
      pathParamsSchema: {
        properties: {
          chain: { type: "string", description: "'eth', 'sol', 'peaq', or 'bsc'" },
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
  // BNB Smart Chain commodity routes (chain ID 56) — same shape and pricing
  // tier as the eth/sol/peaq equivalents above; pure pass-through data,
  // sellable via Solana/peaq today regardless of BSC's own payment-network
  // status (see the BSC scaffolding note in the payment-layer section above).
  "GET /v1/bsc/gas-price": {
    accepts: multiNetworkAccepts(0.005),
    description: "Current BNB Smart Chain gas price (wei + gwei)",
    extensions: declareDiscoveryExtension({
      output: { example: { chain: "bsc", wei: "1000000000", gwei: 1 } },
    }),
  },
  "GET /v1/bsc/latest-block": {
    accepts: multiNetworkAccepts(0.005),
    description: "Latest BNB Smart Chain block number",
    extensions: declareDiscoveryExtension({
      output: { example: { chain: "bsc", blockNumber: 48123456 } },
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
          services: [{ name: "web", endpoint: "https://example.com/api" }],
          documentationUrl: "https://example.com/docs",
          dataVisibility: "onchain",
        },
      },
    }),
  },
  // Cheap, boring, high-frequency utility -- deliberately priced at the
  // bottom of this catalog's range. Live market check (x402scan, 2026-08-03)
  // showed a near-identical bare-bones IP-lookup service outperforming every
  // narrow crypto-signal product on the platform by orders of magnitude on
  // transaction count (1.87K txns/117 buyers in 30 days vs. low-single-digit
  // or zero for niche trading-signal APIs) -- simple + cheap + broadly
  // useful beats narrow + expensive here. Sourced from FreeIPAPI, free and
  // keyless, same positioning as the rest of this catalog.
  "GET /v1/geo/ip/:ip": {
    accepts: multiNetworkAccepts(0.003),
    description: "Geolocate an IPv4 or IPv6 address: country, region, city, lat/long, timezone, ISP/ASN, and proxy flag.",
    extensions: declareDiscoveryExtension({
      pathParams: { ip: "8.8.8.8" },
      pathParamsSchema: {
        properties: { ip: { type: "string", description: "IPv4 or IPv6 address to geolocate" } },
        required: ["ip"],
      },
      output: {
        example: {
          source: "freeipapi",
          ip: "8.8.8.8",
          country: "United States",
          countryCode: "US",
          region: "California",
          city: "Mountain View",
          latitude: 37.422,
          longitude: -122.085,
          timezone: "America/Los_Angeles",
          isp: "Google LLC",
          asn: "15169",
          isProxy: false,
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
  // PATCH (2026-08-08): UpRock Verify -- a different UpRock resource
  // (Sweep, not Crawl) than /v1/uprock/fetch above. Multi-region real-device
  // reachability + Core Web Vitals + screenshot proof, built on the same
  // edge.uprock.com API. See getUprockVerify() in dataSources.js for the
  // full endpoint/pricing rationale. $0.15/call: ~50% above this catalog's
  // own closest comparable (/v1/uprock/fetch at $0.10) since a 3-region
  // sweep with screenshots is a bigger unit of upstream work than one
  // single-page fetch -- landed on via external comparables too (Checkly/
  // Datadog-style per-check screenshot/uptime pricing, roughly $0.01-0.04
  // for a 3-region-equivalent bundle). Revisit once UpRock confirms actual
  // sweep credit cost against a real payment.
  "GET /v1/uprock/verify/:domain": {
    accepts: multiNetworkAccepts(0.15),
    description:
      "Multi-region real-device uptime/performance check for a domain (default NA/EU/APAC, via " +
      "UpRock Verify): per-region reachability, Core Web Vitals (LCP/FCP/CLS/TTFB), total load " +
      "time, and screenshot-captured proof -- not a synthetic/datacenter check, run from UpRock's " +
      "real residential/mobile device network.",
    extensions: declareDiscoveryExtension({
      pathParams: { domain: "example.com" },
      pathParamsSchema: {
        properties: {
          domain: { type: "string", description: "Bare domain to check, e.g. 'example.com' (no scheme)" },
        },
        required: ["domain"],
      },
      queryParams: {
        properties: {
          regions: {
            type: "string",
            description: "Comma-separated regions to check: NA, EU, APAC, LATAM, MEA (default: NA,EU,APAC)",
          },
        },
      },
      output: {
        example: {
          source: "uprock-verify-sweep",
          domain: "example.com",
          url: "https://example.com",
          sweepId: "5cb37d22-bdf7-432c-83a3-6b2d1645ed54",
          regions: [
            {
              region: "NA",
              status: "completed",
              country: "US",
              reachable: true,
              loadTimeMs: 842,
              ttfbMs: 120,
              lcpMs: 610,
              clsScore: 0.01,
              hasScreenshot: true,
              errorType: null,
              errorMessage: null,
            },
          ],
          completedJobs: 3,
          failedJobs: 0,
          totalJobs: 3,
          timedOut: false,
        },
      },
    }),
  },
  "GET /v1/brand-verify/:domain": {
    accepts: multiNetworkAccepts(0.23),
    description:
      "Composite trust and safety check for a domain: domain-to-IP resolution, multi-region website " +
      "verification (screenshots plus Core Web Vitals via UpRock Verify), and IP intelligence " +
      "(geolocation plus proxy/VPN detection) rolled into a single 0-100 trust score and verdict. " +
      "Built for trust and safety, compliance, brand protection, anti-fraud, and monitoring whether " +
      "a site is live, performant, and hosted where it claims to be.",
    extensions: declareDiscoveryExtension({
      pathParams: { domain: "example.com" },
      pathParamsSchema: {
        properties: {
          domain: { type: "string", description: "Bare domain to check, e.g. 'example.com' (no scheme)" },
        },
        required: ["domain"],
      },
      queryParams: {
        properties: {
          regions: {
            type: "string",
            description: "Comma-separated regions to check: NA, EU, APAC, LATAM, MEA (default: NA,EU,APAC)",
          },
        },
      },
      output: {
        example: {
          source: "brand-verify-composite",
          domain: "example.com",
          resolvedIp: "93.184.216.34",
          dnsError: null,
          trustScore: 92,
          verdict: "high-trust",
          scoringReasons: [
            "3/3 regions reachable (+40)",
            "avg load 842ms across 3 region(s) (+20)",
            "resolves to United States, no proxy/VPN detected (+20)",
            "3 region(s) captured screenshot proof (+20)",
            ],
          verification: {
            source: "uprock-verify-sweep",
            domain: "example.com",
            url: "https://example.com",
            sweepId: "5cb37d22-bdf7-432c-83a3-6b2d1645ad54",
            regions: [
              {
                region: "NA",
                status: "completed",
                country: "US",
                reachable: true,
                loadTimeMs: 842,
                ttfbMs: 120,
                lcpMs: 610,
                clsScore: 0.01,
                hasScreenshot: true,
                errorType: null,
                errorMessage: null,
              },
              ],
            completedJobs: 3,
            failedJobs: 0,
            totalJobs: 3,
            timedOut: false,
          },
          verificationError: null,
          ipIntelligence: {
            source: "ip-geolocation",
            ip: "93.184.216.34",
            country: "United States",
            countryCode: "US",
            region: "Virginia",
            city: "Ashburn",
            latitude: 39.0437,
            longitude: -77.4875,
            timezone: "America/New_York",
            isp: "Edgecast Inc.",
            asn: "AS15133",
            isProxy: false,
            fetchedAt: "2026-08-08T00:00:00.000Z",
          },
          ipIntelligenceError: null,
          fetchedAt: "2026-08-08T00:00:00.000Z",
        },
      },
    }),
  },
  "GET /v1/pokt/supplier-trust/:operatorId": {
    accepts: multiNetworkAccepts(0.05),
    description:
      "Composite trust score for a Pocket Network (Shannon) supplier: on-chain stake status " +
      "(staked vs. unstaking) plus a live reachability probe of the supplier's own advertised " +
      "service RPC endpoints, rolled into a single 0-100 trust score. Useful to Application and " +
      "gateway operators deciding which suppliers to route relays to -- is this operator actually " +
      "staked, in good standing, and serving traffic on the endpoints it advertises.",
    extensions: declareDiscoveryExtension({
      pathParams: { operatorId: "pokt1l8lttpkctge3a9zq62uq9n9jqclt4ptz77ymsw" },
      pathParamsSchema: {
        properties: {
          operatorId: { type: "string", description: "POKT supplier operator address (bech32, pokt1...)" },
        },
        required: ["operatorId"],
      },
      output: {
        example: {
          source: "pokt-supplier-trust",
          operatorId: "pokt1l8lttpkctge3a9zq62uq9n9jqclt4ptz77ymsw",
          found: true,
          stakeStatus: "Staked",
          stakedPokt: 60499.99,
          unstakingReason: null,
          services: ["akash", "osmosis"],
          endpointsProbed: [
            { url: "https://akash-json-europe.highstakes.ch", reachable: true, statusCode: 200, responseTimeMs: 210 },
            ],
          endpointsTotalAdvertised: 8,
          trustScore: 90,
          verdict: "high-trust",
          scoringReasons: [
            "supplier is actively staked (+40)",
            "5/5 advertised endpoints reachable (+40)",
            "staked for 2 service(s) (+10)",
            ],
          fetchedAt: "2026-08-10T00:00:00.000Z",
        },
      },
    }),
  },

  "GET /v1/x402/seller-trust/:encodedUrl": {
    accepts: multiNetworkAccepts(0.23),
    description: "Trust score for an x402 seller.",
    extensions: declareDiscoveryExtension({
      pathParams: { encodedUrl: "example.com" },
      pathParamsSchema: {
        properties: { encodedUrl: { type: "string", description: "Encoded seller URL" } },
        required: ["encodedUrl"],
      },
      output: {
        example: { source: "x402-seller-trust-composite", trustScore: 88, verdict: "high-trust" },
      },
    }),
  },
  // Headless-Chrome screenshot render (Puppeteer, via the puppeteer-render
  // service -- see dataSources.js/puppeteer-render.js for the full
  // architecture). $0.03/call: unlike the UpRock-backed routes above, there
  // is no per-call upstream credit cost here -- the compute is entirely
  // infrastructure this project already runs -- but a headless-Chrome
  // render is meaningfully heavier (real CPU + ~100-300MB RAM per call)
  // than the sub-cent RPC pass-through routes at the top of this file, so
  // it sits mid-tier rather than at the bottom. Revisit once real render
  // volume shows actual infra cost.
  //
  // Discovery-extension content deliberately kept minimal (short
  // description, no embedded example beyond a few scalar fields) -- see the
  // seller-trust payment failures writeup in README.md (2026-08-15) for
  // why: a large/deeply nested Bazaar discovery-extension declaration was
  // the confirmed root cause of that route's live-payment failures,
  // independent of price or URL structure. screenshotBase64 is deliberately
  // left out of the example below for the same reason.
  "GET /v1/render/screenshot": {
    accepts: multiNetworkAccepts(0.03),
    description: "Headless-Chrome screenshot of a URL (PNG, base64-encoded).",
    extensions: declareDiscoveryExtension({
      input: { url: "https://example.com" },
      inputSchema: {
        properties: {
          url: { type: "string", description: "Absolute URL to screenshot (http or https)" },
        },
        required: ["url"],
      },
      output: {
        example: { source: "puppeteer-screenshot", statusCode: 200, width: 1280, height: 800 },
      },
    }),
  },
  // HEIC to PNG conversion. $0.005/call -- pure compute, same pricing tier
  // as geo/ip above (cheap, boring, high-frequency utility; no upstream
  // credit cost, and unlike render/screenshot this doesn't even need a
  // second container -- see getHeicToPng() in dataSources.js).
  //
  // Discovery-extension content kept minimal for the same reason as
  // render/screenshot above -- see the seller-trust root-cause writeup in
  // README.md (2026-08-15).
  "GET /v1/convert/heic-to-png": {
    accepts: multiNetworkAccepts(0.005),
    description: "Convert a HEIC/HEIF image to PNG (base64-encoded).",
    extensions: declareDiscoveryExtension({
      input: { url: "https://example.com/photo.heic" },
      inputSchema: {
        properties: {
          url: { type: "string", description: "Absolute URL to a HEIC/HEIF image (http or https)" },
        },
        required: ["url"],
      },
      output: {
        example: { source: "heic-to-png", width: 4032, height: 3024 },
      },
    }),
  },
  // Web search, backed by this project's own self-hosted SearXNG instance
  // (see docker-compose.yml's searxng service / getWebSearch() in
  // dataSources.js). $0.008/call -- positioned between Exa ($0.004) and
  // Tavily ($0.01), the two closest live x402-marketplace comparables found
  // researching this route. No per-call upstream credit cost (self-hosted,
  // free, keyless) -- same margin story as heic-to-png above.
  //
  // Discovery-extension content kept minimal for the same reason as every
  // route added since the seller-trust root-cause writeup in README.md
  // (2026-08-15).
  "GET /v1/search/web": {
    accepts: multiNetworkAccepts(0.008),
    description: "Web search via a self-hosted SearXNG instance (title/url/snippet per result).",
    extensions: declareDiscoveryExtension({
      input: { q: "pocket network shannon upgrade" },
      inputSchema: {
        properties: {
          q: { type: "string", description: "Search query" },
        },
        required: ["q"],
      },
      output: {
        example: { source: "searxng", resultCount: 5 },
      },
    }),
  },
  // ERC-8004 (Trustless Agents) reputation lookup. $0.03/call -- same
  // pricing tier as peaq/machine-verify above, the closest architectural
  // analog (a small number of RPC eth_calls against a known contract, no
  // external paid API). Registry addresses and ABI confirmed directly from
  // erc-8004/erc-8004-contracts source, not assumed -- see getAgentReputation()
  // in dataSources.js. Fills the one trust-score gap none of this server's
  // other composite routes cover: AI-agent identity/reputation, distinct
  // from brand-verify (domains), x402-seller-trust (x402 sellers),
  // pokt-supplier-trust (POKT infra operators), and peaq/machine-verify
  // (IoT/machine identity).
  //
  // Discovery-extension content kept minimal for the same reason as every
  // route added since the seller-trust root-cause writeup in README.md
  // (2026-08-15).
  "GET /v1/agent/reputation/:agentId": {
    accepts: multiNetworkAccepts(0.03),
    description: "ERC-8004 on-chain agent identity + aggregated feedback (Ethereum or BSC).",
    extensions: declareDiscoveryExtension({
      pathParams: { agentId: "47167" },
      pathParamsSchema: {
        properties: {
          agentId: { type: "string", description: "ERC-8004 agent token ID" },
        },
        required: ["agentId"],
      },
      queryParams: {
        properties: {
          chain: { type: "string", description: "'eth' (default) or 'bsc'" },
        },
      },
      output: {
        example: { source: "erc8004-agent-reputation", registered: true, feedbackCount: 4 },
      },
    }),
  },
  // Tier A historical/indexed chain data (2026-08-16) -- ETH + Solana only
  // for this round (BSC/peaq deferred, see README's Tier B notes section).
  // Zero new dependencies or containers: both reuse the existing
  // ETH_RPC_URL/SOL_RPC_URL infra already wired up for the snapshot routes
  // above. Both are bounded to recent history, not full-archive -- see
  // getEthLogs()/getSolTransactionHistory() in dataSources.js for exactly
  // why (undocumented per-provider eth_getLogs block-range ceilings; the
  // Solana RPC spec's own hard 1000-signature cap on getSignaturesForAddress).
  "GET /v1/eth/logs": {
    accepts: multiNetworkAccepts(0.012),
    description: "Recent Ethereum event logs for a contract/address (bounded to the last 1000 blocks, not full-archive history).",
    extensions: declareDiscoveryExtension({
      queryParams: {
        properties: {
          address: { type: "string", description: "Contract or wallet address to filter logs by" },
          topic0: { type: "string", description: "Optional event signature hash to filter by" },
          blocks: { type: "string", description: "How many recent blocks to search, max 1000 (default 500)" },
        },
        required: ["address"],
      },
      output: {
        example: { source: "eth-logs", blocksSearched: 500, logCount: 3 },
      },
    }),
  },
  "GET /v1/sol/history/:address": {
    accepts: multiNetworkAccepts(0.01),
    description: "Recent Solana transaction signatures for an address (most recent up to 100, not full history since genesis).",
    extensions: declareDiscoveryExtension({
      pathParams: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
      pathParamsSchema: {
        properties: {
          address: { type: "string", description: "Base58 Solana address" },
        },
        required: ["address"],
      },
      queryParams: {
        properties: {
          limit: { type: "string", description: "Number of recent transactions to return, max 100 (default 20)" },
        },
      },
      output: {
        example: { source: "sol-history", count: 20 },
      },
    }),
  },
  "GET /v1/compliance/sanctions-check/:address": {
    accepts: multiNetworkAccepts(0.015),
    description: "Screens a wallet address against OFAC's published SDN sanctions list (direct match only, Ethereum or Solana).",
    extensions: declareDiscoveryExtension({
      pathParams: { address: "0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c" },
      pathParamsSchema: {
        properties: {
          address: { type: "string", description: "Ethereum (0x...) or Solana (base58) address to screen" },
        },
        required: ["address"],
      },
      queryParams: {
        properties: {
          chain: { type: "string", description: "Optional: 'ethereum' or 'solana' -- overrides auto-detection from address format" },
        },
      },
      output: {
        example: { source: "ofac-sanctions-check", sanctioned: false },
      },
    }),
  },
  // Currency conversion (ECB reference rates via Frankfurter, free/keyless
  // upstream -- see getCurrencyConversion() in dataSources.js). $0.01/call,
  // deliberately undercutting the ~$0.02 median found on live Bazaar
  // comparables researched 2026-08-22. 3600s cache in server.js -- ECB rates
  // only update once daily, so an hour-long cache costs no real accuracy.
  "GET /v1/currency/convert": {
    accepts: multiNetworkAccepts(0.01),
    description: "Convert an amount between two ISO 4217 currencies using ECB daily reference rates.",
    extensions: declareDiscoveryExtension({
      input: { from: "USD", to: "EUR", amount: 100 },
      inputSchema: {
        properties: {
          from: { type: "string", description: "3-letter ISO 4217 source currency code, e.g. USD" },
          to: { type: "string", description: "3-letter ISO 4217 target currency code, e.g. EUR" },
          amount: { type: "number", description: "Amount to convert (default 1)" },
        },
        required: ["from", "to"],
      },
      output: {
        example: { source: "frankfurter-ecb", from: "USD", to: "EUR", rate: 0.92, convertedAmount: 92 },
      },
    }),
  },
  // Webpage-to-PDF render via the puppeteer-render service (see
  // getPuppeteerPdf() in dataSources.js) -- same container as
  // render/screenshot below. $0.01/call, undercutting the closest live
  // comparable found (Relaystation's URL-to-PDF at $0.02/render).
  "GET /v1/render/pdf": {
    accepts: multiNetworkAccepts(0.01),
    description: "Render a webpage to PDF (base64-encoded), via headless Chrome.",
    extensions: declareDiscoveryExtension({
      input: { url: "https://example.com" },
      inputSchema: {
        properties: {
          url: { type: "string", description: "Absolute URL to render as PDF (http or https)" },
          format: { type: "string", description: "Page size, e.g. Letter, A4 (default Letter)" },
          landscape: { type: "boolean", description: "Landscape orientation (default false)" },
        },
        required: ["url"],
      },
      output: {
        example: { source: "puppeteer-pdf", statusCode: 200, format: "Letter" },
      },
    }),
  },
  // Image OCR (Tesseract, via the puppeteer-render service -- see
  // getImageOcr() in dataSources.js). $0.01/call, undercutting the ~$0.05-0.10
  // median found for scanned-PDF OCR comparables; the plain-image-OCR niche
  // itself is thinner but growing.
  "GET /v1/image/ocr": {
    accepts: multiNetworkAccepts(0.01),
    description: "Extract text from an image via OCR (Tesseract).",
    extensions: declareDiscoveryExtension({
      input: { url: "https://example.com/photo.png" },
      inputSchema: {
        properties: {
          url: { type: "string", description: "Absolute URL to an image (http or https)" },
        },
        required: ["url"],
      },
      output: {
        example: { source: "tesseract-ocr", text: "example text", confidence: 92.4 },
      },
    }),
  },
};

export function buildX402Middleware() {
  return paymentMiddleware(routes, server);
}
