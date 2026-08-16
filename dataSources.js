// dataSources.js
// Thin wrappers around cheap/free upstream data sources. Kept separate from
// server.js so you can swap in a POKT gateway endpoint, Alchemy, Infura, or
// your own Umbrel-hosted node without touching the payment/route logic.
//
// Uses Node's built-in global fetch (stable since Node 18) instead of the
// node-fetch package — one less dependency to install/break.

const ETH_RPC_URL = process.env.ETH_RPC_URL || "https://eth.llamarpc.com";
const SOL_RPC_URL = process.env.SOL_RPC_URL || "https://api.mainnet-beta.solana.com";
// peaq is a standard EVM chain (chain ID 3338) — same JSON-RPC interface as
// ETH_RPC_URL above, just pointed at peaq's public RPC by default. Free
// public endpoints (publicnode, OnFinality, etc.) are fine for these
// low-frequency snapshot calls; swap in a paid/private RPC if volume grows.
const PEAQ_RPC_URL = process.env.PEAQ_RPC_URL || "https://peaq-rpc.publicnode.com";
// BNB Smart Chain (BSC, chain ID 56) — same eth_* JSON-RPC interface as
// Ethereum/peaq above, since BSC is EVM-compatible. Public default endpoint;
// swap in a private/paid RPC if volume grows. (Data-source layer only — see
// x402Middleware.js for the separate, NOT-YET-ACTIVE work needed before BSC
// can be offered as a *payment* network too.)
const BSC_RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org";
// If you stake POKT and run a gateway, point ETH_RPC_URL / SOL_RPC_URL at your
// POKT gateway endpoint instead of the public defaults above — same interface,
// you just become the infra layer instead of renting someone else's.

async function rpcCall(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method} error: ${json.error.message}`);
  return json.result;
}

export async function getEthGasPrice() {
  const hex = await rpcCall(ETH_RPC_URL, "eth_gasPrice");
  const wei = BigInt(hex);
  return {
    chain: "ethereum",
    wei: wei.toString(),
    gwei: Number(wei) / 1e9,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getEthLatestBlock() {
  const hex = await rpcCall(ETH_RPC_URL, "eth_blockNumber");
  return {
    chain: "ethereum",
    blockNumber: parseInt(hex, 16),
    fetchedAt: new Date().toISOString(),
  };
}

export async function getSolLatestBlock() {
  const slot = await rpcCall(SOL_RPC_URL, "getSlot");
  return {
    chain: "solana",
    slot,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getEthBalance(address) {
  const hex = await rpcCall(ETH_RPC_URL, "eth_getBalance", [address, "latest"]);
  const wei = BigInt(hex);
  return {
    chain: "ethereum",
    address,
    wei: wei.toString(),
    eth: Number(wei) / 1e18,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getSolBalance(address) {
  const lamports = await rpcCall(SOL_RPC_URL, "getBalance", [address]);
  const value = typeof lamports === "object" ? lamports.value : lamports;
  return {
    chain: "solana",
    address,
    lamports: value,
    sol: value / 1e9,
    fetchedAt: new Date().toISOString(),
  };
}

// --- peaq (machine-economy L1, chain ID 3338) ------------------------------
// Same eth_* JSON-RPC surface as the Ethereum functions above since peaq is
// EVM-compatible — these exist as their own "peaq" chain label (rather than
// routing peaq addresses through the existing eth/ functions) so the sale
// catalog can price and list "peaq network data" as its own distinct
// product, separate from Ethereum mainnet data.
export async function getPeaqGasPrice() {
  const hex = await rpcCall(PEAQ_RPC_URL, "eth_gasPrice");
  const wei = BigInt(hex);
  return {
    chain: "peaq",
    wei: wei.toString(),
    gwei: Number(wei) / 1e9,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getPeaqLatestBlock() {
  const hex = await rpcCall(PEAQ_RPC_URL, "eth_blockNumber");
  return {
    chain: "peaq",
    blockNumber: parseInt(hex, 16),
    fetchedAt: new Date().toISOString(),
  };
}

export async function getPeaqBalance(address) {
  const hex = await rpcCall(PEAQ_RPC_URL, "eth_getBalance", [address, "latest"]);
  const wei = BigInt(hex);
  return {
    chain: "peaq",
    address,
    wei: wei.toString(),
    peaq: Number(wei) / 1e18,
    fetchedAt: new Date().toISOString(),
  };
}

// --- BNB Smart Chain (BSC, chain ID 56) ------------------------------------
// Same eth_* JSON-RPC surface as Ethereum/peaq above — BSC is EVM-compatible.
// Own "bsc" chain label for the same reason as peaq above: lets the catalog
// price and list BSC data as its own distinct product. This data layer is
// independent of, and ships ahead of, BSC's use as a *payment* network (see
// x402Middleware.js) — these three routes are sellable via the existing
// Solana/peaq payment rails today.
export async function getBscGasPrice() {
  const hex = await rpcCall(BSC_RPC_URL, "eth_gasPrice");
  const wei = BigInt(hex);
  return {
    chain: "bsc",
    wei: wei.toString(),
    gwei: Number(wei) / 1e9,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getBscLatestBlock() {
  const hex = await rpcCall(BSC_RPC_URL, "eth_blockNumber");
  return {
    chain: "bsc",
    blockNumber: parseInt(hex, 16),
    fetchedAt: new Date().toISOString(),
  };
}

export async function getBscBalance(address) {
  const hex = await rpcCall(BSC_RPC_URL, "eth_getBalance", [address, "latest"]);
  const wei = BigInt(hex);
  return {
    chain: "bsc",
    address,
    wei: wei.toString(),
    bnb: Number(wei) / 1e18,
    fetchedAt: new Date().toISOString(),
  };
}

// --- peaq machine verification (peaqOS MCR API) -----------------------------
// Sourced from peaq's own public, read-only Machine Credit Rating API
// (https://mcr.peaq.xyz). No API key required -- all data originates from
// on-chain contracts on peaq chain (chain ID 3338): IdentityRegistry (is
// this machine registered/bonded), AdminFlags (negative_flag), and the
// EventRegistry-derived MCR score/rating.
//
// Deliberately NOT built on the raw DID precompile (0x...800) -- peaq's own
// docs flag that as absorbed into peaqOS/peaqID, with this MCR API as the
// current, documented surface. Verified live against a real registered
// machine (machine_id 1) before shipping: /health returned {"status":"ok"},
// and /mcr/<real DID> returned the exact documented shape.
//
// Rate limit on peaq's side: 90 req/min per IP, MCR_CACHE_TTL defaults to
// 3600s upstream -- so our own cache TTL below doesn't need to be tight.
const PEAQOS_MCR_API_URL = process.env.PEAQOS_MCR_API_URL || "https://mcr.peaq.xyz";

// Accepts either a full peaq DID ("did:peaq:0x...") or a raw EVM address
// ("0x...") -- the MCR API supports both, but we normalize to the full DID
// form before calling so the response's own `did` field is always present.
function normalizePeaqDid(input) {
  const trimmed = String(input || "").trim();
  const addr = trimmed.startsWith("did:peaq:") ? trimmed.slice("did:peaq:".length) : trimmed;
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    throw new Error("machine id must be a peaq DID (did:peaq:0x...) or a raw 0x address");
  }
  return `did:peaq:${addr}`;
}

export async function getPeaqMachineVerification(didOrAddress) {
  const did = normalizePeaqDid(didOrAddress);
  const res = await fetch(`${PEAQOS_MCR_API_URL}/mcr/${did}`);

  // "Not registered" is a legitimate, valuable answer for a verifier bot
  // (like a credit check coming back "no record") -- not an upstream
  // failure, so it's a normal 200 response here, not a thrown error.
  if (res.status === 404) {
    return { source: "peaqos-mcr", did, registered: false, fetchedAt: new Date().toISOString() };
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.detail || `HTTP ${res.status}`;
    throw new Error(`peaqOS MCR lookup failed for ${did}: ${detail}`);
  }

  // Best-effort enrichment from the same MCR API's /machines/{machine_id}
  // endpoint (no extra key, same host, numeric ID from the /mcr/ response
  // above) -- carries a machine's advertised service endpoints,
  // documentation URL, and data-visibility setting, none of which /mcr/{did}
  // itself returns. NOTE: deliberately NOT /machine/{did} (singular) -- that
  // sibling endpoint nests everything under a `peaqos` key and has no
  // `services` field at all; live-verified both shapes 2026-08-03 against
  // machine_id 1 before picking this one. Failure here is non-fatal: the MCR
  // fields above are the core paid product, this is additive bonus data, so
  // a hiccup on this second call shouldn't fail the whole request.
  let services = null;
  let documentationUrl = null;
  let dataVisibility = null;
  if (json.machine_id != null) {
    try {
      const machineRes = await fetch(`${PEAQOS_MCR_API_URL}/machines/${json.machine_id}`);
      if (machineRes.ok) {
        const machineJson = await machineRes.json();
        services = machineJson.services ?? null;
        documentationUrl = machineJson.documentation_url ?? null;
        dataVisibility = machineJson.data_visibility ?? null;
      }
    } catch {
      // Non-fatal -- enrichment only, see comment above.
    }
  }

  return {
    source: "peaqos-mcr",
    registered: true,
    did: json.did,
    machineId: json.machine_id,
    creditRating: json.mcr,
    creditScore: json.mcr_score,
    ratingDegraded: json.mcr_degraded,
    bondStatus: json.bond_status,
    negativeFlag: json.negative_flag,
    eventCount: json.event_count,
    revenueEventCount: json.revenue_event_count,
    activityEventCount: json.activity_event_count,
    revenueTrend: json.revenue_trend,
    totalRevenueUsdCents: json.total_revenue,
    lastUpdated: json.last_updated,
    services,
    documentationUrl,
    dataVisibility,
    fetchedAt: new Date().toISOString(),
  };
}

// --- IP geolocation ---------------------------------------------------------
// Sourced from FreeIPAPI (free.freeipapi.com) -- a free, keyless IP
// geolocation lookup explicitly permitted for commercial use (no attribution
// or paid tier required for this endpoint). Verified live 2026-08-03:
// looking up 8.8.8.8 returned Mountain View, CA with lat/long, timezone,
// ASN/ISP, and a proxy flag. Rate limit on their side is 60 req/min, well
// above what a cached per-IP lookup needs. Same "no API keys" positioning as
// every other route in this file.
const IP_GEO_BASE_URL = process.env.IP_GEO_BASE_URL || "https://free.freeipapi.com/api/json";

export async function getIpGeolocation(ip) {
  const res = await fetch(`${IP_GEO_BASE_URL}/${encodeURIComponent(ip)}`);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.message || `HTTP ${res.status}`;
    throw new Error(`IP geolocation lookup failed for ${ip}: ${detail}`);
  }
  return {
    source: "freeipapi",
    ip: json.ipAddress ?? ip,
    country: json.countryName ?? null,
    countryCode: json.countryCode ?? null,
    region: json.regionName ?? null,
    city: json.cityName ?? null,
    latitude: json.latitude ?? null,
    longitude: json.longitude ?? null,
    timezone: json.timeZones?.[0] ?? null,
    isp: json.asnOrganization ?? null,
    asn: json.asn ?? null,
    isProxy: json.isProxy ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

// CoinGecko free tier — fine for a cached, low-frequency lookup. Swap for a
// paid tier if you outgrow the rate limit.
export async function getTokenPrice(symbol) {
  const idMap = {
    eth: "ethereum",
    sol: "solana",
    btc: "bitcoin",
    usdc: "usd-coin",
    pokt: "pocket-network",
    bnb: "binancecoin",
  };
  const id = idMap[symbol.toLowerCase()];
  if (!id) throw new Error(`Unsupported symbol: ${symbol}`);
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
  );
  if (!res.ok) throw new Error(`CoinGecko failed: HTTP ${res.status}`);
  const json = await res.json();
  return {
    symbol: symbol.toLowerCase(),
    usd: json[id]?.usd ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon service-demand snapshot ---------------------------------
// Sourced live from Pocket Network's public GraphQL indexer (Pocketdex).
// This is deliberately NOT a price/RPC pass-through like everything above —
// it sells relay-demand signal: which services (chains/APIs) are seeing the
// most relay volume on the Shannon network right now, which way that's
// trending, and how many suppliers are already competing to serve it. That
// makes it useful to gateway operators and suppliers deciding where to
// stake, not just to agents doing a routine lookup.
//
// Per pocket-engineering discipline: nothing here is hardcoded. Every field
// is queried fresh from the indexer on each (cache-bounded) call.
const POKT_GRAPHQL_URL = process.env.POKT_GRAPHQL_URL || "https://data.pocket.network/graphql";

async function poktGraphQL(query, variables = {}) {
  const res = await fetch(POKT_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`POKT indexer failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`POKT indexer error: ${json.errors[0].message}`);
  }
  return json.data;
}

const SERVICE_DEMAND_QUERY = `
  query ServiceDemand($first: Int!) {
    services(
      first: $first
      orderBy: NEW_NUM_RELAYS_EMA_DESC
      filter: { newNumRelaysEma: { greaterThan: "0" } }
    ) {
      nodes {
        id
        name
        computeUnitsPerRelay
        newNumRelaysEma
        prevNumRelaysEma
        supplierServiceConfigs {
          totalCount
        }
      }
    }
  }
`;

export async function getPoktServiceDemand(limit = 10) {
  // Bounded, never unbounded — Three S Framework (Scalability).
  const capped = Math.max(1, Math.min(Number(limit) || 10, 25));
  const data = await poktGraphQL(SERVICE_DEMAND_QUERY, { first: capped });
  const nodes = data?.services?.nodes ?? [];

  const services = nodes.map((s) => {
    const prev = Number(s.prevNumRelaysEma);
    const cur = Number(s.newNumRelaysEma);
    const pctChange = prev > 0 ? ((cur - prev) / prev) * 100 : null;
    const trend =
      pctChange === null ? "unknown" : pctChange > 1 ? "rising" : pctChange < -1 ? "falling" : "flat";
    return {
      serviceId: s.id,
      name: s.name,
      computeUnitsPerRelay: Number(s.computeUnitsPerRelay),
      relayVolumeEma: cur,
      prevRelayVolumeEma: prev,
      trend,
      pctChange: pctChange === null ? null : Number(pctChange.toFixed(2)),
      activeSuppliers: s.supplierServiceConfigs?.totalCount ?? 0,
    };
  });

  return {
    network: "pocket-shannon",
    source: "data.pocket.network/graphql",
    rankedBy: "relayVolumeEma",
    limit: capped,
    services,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon supplier landscape ---------------------------------------
// Supply-side complement to service-demand above: how many suppliers are
// actively staked network-wide, how much POKT is staked in total, and who
// the largest operators are. Live-verified against the indexer 2026-08-02 --
// note the doc-suggested field name "totalCount" combined with "aggregates"
// and "first" in the SAME connection call returned empty/slow results in
// testing here, so this deliberately splits into three separate aliased
// root fields (count-only, aggregates-only, first+orderBy-only) in one
// round trip instead -- each form individually verified fast and reliable.
const SUPPLIER_LANDSCAPE_QUERY = `
  query SupplierLandscape($first: Int!) {
    count: suppliers(filter: { stakeStatus: { equalTo: Staked } }) {
      totalCount
    }
    totals: suppliers(filter: { stakeStatus: { equalTo: Staked } }) {
      aggregates { sum { stakeAmount } }
    }
    top: suppliers(
      filter: { stakeStatus: { equalTo: Staked } }
      first: $first
      orderBy: STAKE_AMOUNT_DESC
    ) {
      nodes {
        operatorId
        stakeAmount
        serviceConfigs { totalCount }
      }
    }
  }
`;

export async function getPoktSupplierLandscape(limit = 10) {
  const capped = Math.max(1, Math.min(Number(limit) || 10, 25));
  const data = await poktGraphQL(SUPPLIER_LANDSCAPE_QUERY, { first: capped });

  const activeSuppliers = data?.count?.totalCount ?? 0;
  // upokt -> POKT (1 POKT = 1,000,000 upokt). BigInt to avoid precision loss
  // on network-wide sums that can run into the tens of trillions of upokt.
  const totalStakedUpokt = BigInt(data?.totals?.aggregates?.sum?.stakeAmount ?? "0");
  const topSuppliers = (data?.top?.nodes ?? []).map((s) => ({
    operatorId: s.operatorId,
    stakedPokt: Number(BigInt(s.stakeAmount)) / 1e6,
    servicesCount: s.serviceConfigs?.totalCount ?? 0,
  }));

  return {
    network: "pocket-shannon",
    source: "data.pocket.network/graphql",
    activeSuppliers,
    totalStakedPokt: Number(totalStakedUpokt) / 1e6,
    rankedBy: "stakeAmount",
    limit: capped,
    topSuppliers,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon application (demand-side) stake feed ---------------------
// Mirror of the supplier feed above but for Applications -- the actors that
// stake POKT to consume relays. Tells you who's buying network capacity and
// how much, distinct from service-demand's per-service EMA signal.
const APPLICATION_DEMAND_QUERY = `
  query ApplicationDemand($first: Int!) {
    count: applications(filter: { stakeStatus: { equalTo: Staked } }) {
      totalCount
    }
    totals: applications(filter: { stakeStatus: { equalTo: Staked } }) {
      aggregates { sum { stakeAmount } }
    }
    top: applications(
      filter: { stakeStatus: { equalTo: Staked } }
      first: $first
      orderBy: STAKE_AMOUNT_DESC
    ) {
      nodes {
        id
        stakeAmount
        applicationServices { totalCount }
      }
    }
  }
`;

export async function getPoktApplicationDemand(limit = 10) {
  const capped = Math.max(1, Math.min(Number(limit) || 10, 25));
  const data = await poktGraphQL(APPLICATION_DEMAND_QUERY, { first: capped });

  const activeApplications = data?.count?.totalCount ?? 0;
  const totalStakedUpokt = BigInt(data?.totals?.aggregates?.sum?.stakeAmount ?? "0");
  const topApplications = (data?.top?.nodes ?? []).map((a) => ({
    applicationId: a.id,
    stakedPokt: Number(BigInt(a.stakeAmount)) / 1e6,
    servicesSubscribed: a.applicationServices?.totalCount ?? 0,
  }));

  return {
    network: "pocket-shannon",
    source: "data.pocket.network/graphql",
    activeApplications,
    totalStakedPokt: Number(totalStakedUpokt) / 1e6,
    rankedBy: "stakeAmount",
    limit: capped,
    topApplications,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon tokenomics / settlement split -----------------------------
// Sourced from the LIVE Cosmos LCD governance params, never hardcoded -- the
// pocket-engineering skill's Rule 1 exists specifically because these values
// (mint ratio, the settlement split) move by governance proposal and every
// past hardcoded copy of them has gone stale. The "/pokt-network/" URL
// prefix is required; the bare path 404s.
const POKT_LCD_URL = process.env.POKT_LCD_URL || "https://sauron-api.infra.pocket.network";

async function poktLcdGet(path) {
  const res = await fetch(`${POKT_LCD_URL}${path}`);
  if (!res.ok) throw new Error(`POKT LCD ${path} failed: HTTP ${res.status}`);
  return res.json();
}

export async function getPoktTokenomics() {
  const [tokenomics, shared] = await Promise.all([
    poktLcdGet("/pokt-network/poktroll/tokenomics/params"),
    poktLcdGet("/pokt-network/poktroll/shared/params"),
  ]);

  const t = tokenomics?.params ?? {};
  const s = shared?.params ?? {};

  return {
    network: "pocket-shannon",
    source: "sauron-api.infra.pocket.network (Cosmos LCD)",
    mintRatio: t.mint_ratio ?? null,
    // The live settlement split under PIP-41 burn-equals-mint (the active
    // path today). mintAllocationPercentages only governs the legacy
    // GlobalMintTLM path -- included for completeness but only actually
    // "in effect" if globalInflationPerClaim is meaningfully > 0.
    settlementDistribution: t.mint_equals_burn_claim_distribution ?? null,
    globalInflationPerClaim: t.global_inflation_per_claim ?? null,
    mintAllocationPercentages: t.mint_allocation_percentages ?? null,
    computeUnitsToTokensMultiplier: s.compute_units_to_tokens_multiplier ?? null,
    blocksPerSession: s.num_blocks_per_session ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon throughput-by-service leaderboard -------------------------
// Ranks services by ACTUAL cumulative on-chain claimed relay/compute-unit
// volume -- distinct from service-demand's difficulty-adjusted EMA "current
// momentum" signal above. Two live findings shaped this implementation:
//   1. The indexer's dedicated `relays` connection is empty (0 rows) on this
//      deployment despite being documented -- verified directly, not assumed.
//      `msgCreateClaims` (the actual claim transactions) carries the same
//      numRelays/numClaimedComputedUnits fields and IS populated, so that's
//      the real source here.
//   2. Claim settlement is bursty per-service (confirmed live: many services
//      show zero claims in any recent rolling window even with real EMA
//      demand), so this reports ALL-TIME cumulative volume per service
//      rather than a "last 24h" figure that would show mostly zeros and
//      mislead more than it informs.
const TOP_SERVICES_QUERY = `
  query TopServices($first: Int!) {
    services(
      first: $first
      orderBy: NEW_NUM_RELAYS_EMA_DESC
      filter: { newNumRelaysEma: { greaterThan: "0" } }
    ) {
      nodes { id name }
    }
  }
`;

export async function getPoktThroughputLeaderboard(limit = 10) {
  const capped = Math.max(1, Math.min(Number(limit) || 10, 15));

  const svcData = await poktGraphQL(TOP_SERVICES_QUERY, { first: capped });
  const services = svcData?.services?.nodes ?? [];
  if (services.length === 0) {
    return {
      network: "pocket-shannon",
      source: "data.pocket.network/graphql",
      rankedBy: "cumulativeClaimedRelays",
      limit: capped,
      services: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  // One round trip for all N services via GraphQL aliases (each alias must
  // be a valid identifier, so service ids -- which can contain characters
  // like "-" -- are referenced by a safe positional alias "s0", "s1", ...
  // and mapped back to the real id from the services list above).
  const fields = services
    .map(
      (s, i) => `s${i}: service(id: "${s.id}") {
        msgCreateClaims {
          aggregates { sum { numRelays numClaimedComputedUnits numEstimatedComputedUnits } }
        }
      }`
    )
    .join("\n");
  const throughputData = await poktGraphQL(`query ThroughputBatch { ${fields} }`);

  const ranked = services
    .map((s, i) => {
      const sum = throughputData?.[`s${i}`]?.msgCreateClaims?.aggregates?.sum ?? {};
      return {
        serviceId: s.id,
        name: s.name,
        cumulativeClaimedRelays: Number(sum.numRelays ?? 0),
        cumulativeClaimedComputeUnits: Number(sum.numClaimedComputedUnits ?? 0),
        cumulativeEstimatedComputeUnits: Number(sum.numEstimatedComputedUnits ?? 0),
      };
    })
    .sort((a, b) => b.cumulativeClaimedRelays - a.cumulativeClaimedRelays);

  return {
    network: "pocket-shannon",
    source: "data.pocket.network/graphql",
    rankedBy: "cumulativeClaimedRelays",
    note: "All-time cumulative settled volume per service, not a rolling window -- claim settlement is bursty enough that short windows are frequently zero even for actively demanded services.",
    limit: capped,
    services: ranked,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon validator security / decentralization feed ---------------
// LCD-only data (the indexer's `stakeAmount` for validators is self-stake
// only -- true voting power is total bonded `tokens`, which only the LCD
// exposes; see pocket-engineering data-access.md §5). Bonded validator set
// is small (~21 at verification time) so fetching the full set and ranking
// client-side is simple and well within the Three S Framework's
// "don't list unbounded sets" guidance -- this set just isn't large.
export async function getPoktValidatorSecurity(limit = 10) {
  const capped = Math.max(1, Math.min(Number(limit) || 10, 25));
  const json = await poktLcdGet(
    "/cosmos/staking/v1beta1/validators?pagination.limit=200&pagination.count_total=true&status=BOND_STATUS_BONDED"
  );

  const validators = (json?.validators ?? [])
    .map((v) => ({
      moniker: v.description?.moniker ?? "unknown",
      operatorAddress: v.operator_address,
      bondedTokensPokt: Number(BigInt(v.tokens ?? "0")) / 1e6,
      commissionRatePct: v.commission?.commission_rates?.rate
        ? Number(v.commission.commission_rates.rate) * 100
        : null,
      jailed: Boolean(v.jailed),
    }))
    .sort((a, b) => b.bondedTokensPokt - a.bondedTokensPokt);

  const totalBondedPokt = validators.reduce((sum, v) => sum + v.bondedTokensPokt, 0);

  return {
    network: "pocket-shannon",
    source: "sauron-api.infra.pocket.network (Cosmos LCD)",
    bondedValidatorCount: Number(json?.pagination?.total ?? validators.length),
    totalBondedPokt,
    rankedBy: "bondedTokens",
    limit: capped,
    validators: validators.slice(0, capped),
    fetchedAt: new Date().toISOString(),
  };
}

// --- UpRock real-device web fetch ------------------------------------------
// Sourced from UpRock's residential/mobile device network (edge.uprock.com,
// verified against their live API docs). UNLIKE everything else in this
// file, this is NOT free: UpRock bills in credits ($0.006/credit on paid
// tiers, first 5,000 credits/month free), so every call here has a real
// upstream cost, not just the Solana/facilitator fee. That changes the price
// floor math -- see the PLACEHOLDER note in x402Middleware.js.
//
// Requires UPROCK_API_KEY. Sign up free at https://uprock.ai (no credit
// card for the free tier) and grab a key from the dashboard -- see
// https://uprock.ai/docs/guides/getting-started/01-api_keys.
//
// What this sells: a URL fetched through an actual residential/mobile
// device somewhere in the world, so you get what a real user in that
// location sees -- not a datacenter-IP view that trips anti-bot defenses or
// gets geo-filtered content. That's UpRock's own core value prop, not a
// derived metric, so the value-add here is "who fetched it."
const UPROCK_BASE_URL = process.env.UPROCK_BASE_URL || "https://edge.uprock.com";
const UPROCK_API_KEY = process.env.UPROCK_API_KEY;

// PATCH: optional third param so callers can supply a DIFFERENT UpRock API
// key than UPROCK_API_KEY above (see UPROCK_VERIFY_API_KEY / getUprockVerify
// further down) -- defaults to the original behavior exactly when omitted,
// so the existing getUprockFetch call path below is byte-for-byte unchanged.
async function uprockRequest(path, options = {}, apiKeyOverride) {
  const apiKey = apiKeyOverride ?? UPROCK_API_KEY;
  const res = await fetch(`${UPROCK_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...options.headers,
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof json === "string" ? json : JSON.stringify(json ?? {});
    throw new Error(`UpRock ${path} failed: HTTP ${res.status} ${detail}`.trim());
  }
  return json;
}

// Crawl jobs are async on UpRock's side: submit -> poll status -> download
// result. We poll inside this one function so every caller in this project
// still gets the same synchronous shape as every other data-source function
// here -- it just means this particular call takes as long as the real
// device takes to fetch the page (typically a few seconds), bounded by
// maxWaitMs so a slow/stuck device can't hang an x402 request forever.
async function uprockCrawl(targetUrl, { timeoutSec = 20, maxWaitMs = 20000, pollMs = 1000 } = {}) {
  if (!UPROCK_API_KEY) {
    throw new Error("UPROCK_API_KEY is not set -- sign up free at https://uprock.ai to get one");
  }

  const job = await uprockRequest("/crawl/v1/new", {
    method: "POST",
    body: JSON.stringify({ url: targetUrl, method: "GET", timeout_sec: timeoutSec }),
  });

  const jobId = job.job_id;
  let status = job.status;
  const deadline = Date.now() + maxWaitMs;

  while (status !== "completed" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const check = await uprockRequest(`/crawl/v1/status/${jobId}`);
    status = check.status;
    if (status === "failed" || status === "error") {
      throw new Error(`UpRock crawl job ${jobId} failed`);
    }
  }

  if (status !== "completed") {
    throw new Error(
      `UpRock crawl job ${jobId} did not complete within ${maxWaitMs}ms (last status: ${status})`
    );
  }

  const result = await uprockRequest(`/crawl/v1/jobs/${jobId}/download`);
  return { jobId, result };
}

// SECURITY (SSRF hardening, reviewed 2026-08-04): this route accepts a
// buyer-supplied URL and hands it to UpRock's residential/mobile device
// network -- an arbitrary-fetch primitive available to anyone holding a
// stablecoin, no identity attached. The fetch itself executes on UpRock's
// device (not this container), so it isn't a classic SSRF-into-our-own-
// docker-network vector, but nothing stopped a buyer from pointing a real
// residential device at a target's internal/loopback/link-local address
// (including cloud metadata endpoints like 169.254.169.254) with zero
// filtering. This blocks the obvious literal-hostname/IP cases. It is NOT
// a complete defense: a hostname that resolves to a private/loopback address
// only at DNS time (DNS rebinding) would slip through this check, since it
// only inspects the string the buyer supplied, not what it resolves to.
// Closing that gap needs a resolve-then-recheck step (and ideally the same
// check repeated by UpRock's own crawler); flagged here, not yet built.
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "[::1]", "::1"]);
const BLOCKED_HOSTNAME_PATTERNS = [
  /^127\./, // IPv4 loopback (127.0.0.0/8)
  /^10\./, // RFC1918 private
  /^192\.168\./, // RFC1918 private
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 private (172.16.0.0/12)
  /^169\.254\./, // link-local, incl. cloud metadata (169.254.169.254)
  /^fe80:/i, // IPv6 link-local
  /^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/i, // IPv6 unique local (fc00::/7)
];
function isBlockedTarget(hostname) {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  return BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(h));
}

export async function getUprockFetch(targetUrl) {
  if (!targetUrl) throw new Error("url query param is required");
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("url must be a valid absolute URL, e.g. https://example.com");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url must use http or https");
  }
  if (isBlockedTarget(parsed.hostname)) {
    throw new Error("url must not target a localhost, private, or link-local address");
  }

  const { jobId, result } = await uprockCrawl(parsed.toString());
  // readerContent is UpRock's cleaned "reader mode" extraction (ads/nav
  // stripped); fall back to raw body if a given page didn't produce one.
  // Capped at 20k chars so one giant page doesn't blow up the response.
  const content = (result?.readerContent || result?.mainResult?.body || "").slice(0, 20000);

  return {
    source: "uprock-real-device",
    jobId,
    url: parsed.toString(),
    statusCode: result?.mainResult?.statusCode ?? null,
    success: result?.mainResult?.success ?? null,
    content,
    fetchedAt: new Date().toISOString(),
  };
}


// --- UpRock Verify (multi-region sweep) -------------------------------------
// PATCH (built 2026-08-08, staged offline -- not yet live-tested against a
// real payment, same status every other new network/route in this project
// has carried before its first real test). Sourced from the SAME
// edge.uprock.com API as getUprockFetch above, but a different UpRock
// resource: Sweep, not Crawl. A sweep launches one crawl job per region in
// parallel and returns per-region reachability, Core Web Vitals (LCP/FCP/
// CLS/TTFB), total load time, and a screenshot per region -- this is what
// UpRock's own "Verify" product is built on top of (their own API docs
// literally title this endpoint "Create a new deploy validation sweep").
// Endpoint paths confirmed directly against UpRock's live API reference
// docs 2026-08-08 (POST /crawl/v1/sweep/new, GET /crawl/v1/sweep/{id}), not
// assumed -- the status-poll path in particular does NOT follow the same
// shape as the existing crawl-job poll above (/crawl/v1/status/{id}), so
// this deliberately does not try to reuse that helper.
//
// Uses a SEPARATE API key (UPROCK_VERIFY_API_KEY) from UPROCK_API_KEY above,
// per request: separate UpRock accounts/keys per service line make it
// possible to see exactly which product line is driving UpRock credit spend
// from UpRock's own dashboard, without digging through this app's logs.
// Falls back to UPROCK_API_KEY if a dedicated key hasn't been minted yet, so
// this route doesn't hard-fail on a missing second key -- same
// graceful-degrade posture as every other optional config in this file.
const UPROCK_VERIFY_API_KEY = process.env.UPROCK_VERIFY_API_KEY || UPROCK_API_KEY;

// Bounded on purpose: an unbounded region/tries selection would turn one
// x402-paid request into an open-ended number of UpRock-billed jobs. Default
// is 3 of UpRock's 5 available regions (NA/EU/APAC -- the same three used in
// UpRock's own createSweep API example) at 1 try per region, not their API
// default of 3 tries -- this is a reachability/screenshot check, not a
// statistical load test, and every additional try is a real additional
// billed job.
const VERIFY_ALL_REGIONS = ["NA", "EU", "APAC", "LATAM", "MEA"];
const VERIFY_DEFAULT_REGIONS = ["NA", "EU", "APAC"];
const VERIFY_DEFAULT_TRIES_PER_REGION = 1;
const VERIFY_DEFAULT_TIMEOUT_SEC = 30;
// A sweep (multi-region navigation + screenshot capture) is slower than the
// plain single-page crawl getUprockFetch polls for above, so this gets a
// longer ceiling and a longer poll interval to match -- no point polling
// every second for a job that reliably takes 15-30s per region.
const VERIFY_MAX_WAIT_MS = 45000;
const VERIFY_POLL_MS = 2000;

async function uprockSweepCreate({ url, regions, triesPerRegion, timeoutSec, apiKey }) {
  return uprockRequest(
    "/crawl/v1/sweep/new",
    {
      method: "POST",
      body: JSON.stringify({
        url,
        regions,
        tries_per_region: triesPerRegion,
        timeout_sec: timeoutSec,
        device_type: "mobile",
      }),
    },
    apiKey
  );
}

async function uprockSweepStatus(sweepId, apiKey) {
  return uprockRequest(`/crawl/v1/sweep/${sweepId}`, {}, apiKey);
}

// Polls a sweep until every region reports a terminal status, bounded by
// maxWaitMs so a slow or stuck region can't hang an x402-paid request
// forever. Returns the last status payload either way (with timedOut set) --
// the caller decides what a partial/timed-out sweep means for its response,
// rather than this helper silently throwing away partial regional data.
async function pollSweepUntilDone(sweepId, apiKey, { maxWaitMs = VERIFY_MAX_WAIT_MS, pollMs = VERIFY_POLL_MS } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let last = await uprockSweepStatus(sweepId, apiKey);

  while (Date.now() < deadline) {
    const regionStatuses = Object.values(last.results || {}).map((r) => r.status);
    const allTerminal =
      regionStatuses.length > 0 &&
      regionStatuses.every((s) => s === "completed" || s === "failed" || s === "error");
    if (allTerminal || last.status === "completed" || last.status === "failed") {
      return { ...last, timedOut: false };
    }
    await new Promise((r) => setTimeout(r, pollMs));
    last = await uprockSweepStatus(sweepId, apiKey);
  }

  return { ...last, timedOut: true };
}

// Accepts a bare domain (path param, e.g. "example.com"), not a full URL --
// reuses the same SSRF hardening as getUprockFetch above (isBlockedTarget),
// since this is the same "buyer-supplied target handed to UpRock's device
// network" shape as the fetch route, just always coerced to https:// rather
// than accepting an arbitrary scheme.
export async function getUprockVerify(domain, { regions } = {}) {
  if (!domain) throw new Error("domain is required");
  const trimmed = String(domain).trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!trimmed) throw new Error("domain must not be empty");
  if (isBlockedTarget(trimmed.split(":")[0])) {
    throw new Error("domain must not be a localhost, private, or link-local address");
  }

  const selectedRegions = Array.isArray(regions) && regions.length > 0 ? regions : VERIFY_DEFAULT_REGIONS;
  const validRegions = selectedRegions.filter((r) => VERIFY_ALL_REGIONS.includes(r));
  if (validRegions.length === 0) {
    throw new Error(`regions must be one or more of ${VERIFY_ALL_REGIONS.join(", ")}`);
  }

  if (!UPROCK_VERIFY_API_KEY) {
    throw new Error(
      "UPROCK_VERIFY_API_KEY (or UPROCK_API_KEY as a fallback) is not set -- sign up free at https://uprock.ai"
    );
  }

  const targetUrl = `https://${trimmed}`;
  const created = await uprockSweepCreate({
    url: targetUrl,
    regions: validRegions,
    triesPerRegion: VERIFY_DEFAULT_TRIES_PER_REGION,
    timeoutSec: VERIFY_DEFAULT_TIMEOUT_SEC,
    apiKey: UPROCK_VERIFY_API_KEY,
  });

  const final = await pollSweepUntilDone(created.sweep_id, UPROCK_VERIFY_API_KEY);

  // Response deliberately omits the raw screenshot payload (likely base64,
  // potentially large) -- same "don't blow up the response" discipline as
  // getUprockFetch's 20k-char content cap above. hasScreenshot tells the
  // caller one was captured; fetching the actual image bytes is a future
  // extension (e.g. a signed URL or a separate download route), not built
  // here.
  const regionResults = Object.values(final.results || {}).map((r) => {
    const job = r.jobs?.[0]; // one try per region by default -- see VERIFY_DEFAULT_TRIES_PER_REGION
    return {
      region: r.region,
      status: r.status,
      country: job?.country ?? null,
      reachable: job?.status === "completed" && !job?.error_type,
      loadTimeMs: job?.metrics?.total_load_time ?? null,
      ttfbMs: job?.metrics?.ttfb ?? null,
      lcpMs: job?.metrics?.lcp ?? null,
      clsScore: job?.metrics?.cls ?? null,
      hasScreenshot: Boolean(job?.screenshot),
      errorType: job?.error_type ?? null,
      errorMessage: job?.error_message ?? null,
    };
  });

  return {
    source: "uprock-verify-sweep",
    domain: trimmed,
    url: targetUrl,
    sweepId: created.sweep_id,
    regions: regionResults,
    completedJobs: final.completed_jobs ?? null,
    failedJobs: final.failed_jobs ?? null,
    totalJobs: final.total_jobs ?? null,
    timedOut: Boolean(final.timedOut),
    fetchedAt: new Date().toISOString(),
  };
}


// ---------------------------------------------------------------------------
// brand_verify -- composite trust & safety product ($0.23/call)
//
// Bundles three things a trust/safety, compliance, brand-protection, or
// anti-fraud buyer would otherwise have to stitch together themselves:
//   1. Domain-to-IP resolution (plain DNS lookup, done inline below)
//   2. Multi-region website verification with screenshots + Core Web Vitals
//      (reuses getUprockVerify() above -- same UpRock Sweep under the hood)
//   3. IP intelligence: geolocation + proxy/VPN detection (reuses
//      getIpGeolocation() below)
// and turns them into a single 0-100 trust score + verdict, so the caller
// gets a judgment call -- "is this site live, performant, and hosted where
// it claims to be" -- not three raw data dumps to interpret themselves.
// ---------------------------------------------------------------------------
function scoreBrandVerify({ verify, geo, dnsError }) {
    let score = 0;
    const reasons = [];

  if (verify && verify.totalJobs > 0) {
        const reachableCount = (verify.regions || []).filter((r) => r.reachable).length;
        const reachablePts = Math.round((reachableCount / verify.totalJobs) * 40);
        score += reachablePts;
        reasons.push(`${reachableCount}/${verify.totalJobs} regions reachable (+${reachablePts})`);
        if (verify.timedOut) reasons.push("sweep timed out before all regions completed");
  } else {
        reasons.push("no reachability data (+0)");
  }

  const perfSamples = (verify?.regions || []).filter((r) => r.reachable && r.loadTimeMs != null);
    if (perfSamples.length) {
          const avgLoadMs = perfSamples.reduce((sum, r) => sum + r.loadTimeMs, 0) / perfSamples.length;
          let perfPts;
          if (avgLoadMs <= 1500) perfPts = 20;
          else if (avgLoadMs <= 3000) perfPts = 14;
          else if (avgLoadMs <= 5000) perfPts = 8;
          else perfPts = 2;
          score += perfPts;
          reasons.push(`avg load ${Math.round(avgLoadMs)}ms across ${perfSamples.length} region(s) (+${perfPts})`);
    } else {
          reasons.push("no performance data (+0)");
    }

  if (dnsError) {
        reasons.push("DNS resolution failed (+0)");
  } else if (geo && !geo.isProxy) {
        score += 20;
        reasons.push(`resolves to ${geo.country || "unknown location"}, no proxy/VPN detected (+20)`);
  } else if (geo && geo.isProxy) {
        score += 5;
        reasons.push("IP flagged as proxy/VPN (+5)");
  } else {
        reasons.push("no IP intelligence available (+0)");
  }

  const screenshotCount = (verify?.regions || []).filter((r) => r.hasScreenshot).length;
    if (screenshotCount > 0) {
          score += 20;
          reasons.push(`${screenshotCount} region(s) captured screenshot proof (+20)`);
    } else {
          reasons.push("no screenshot proof captured (+0)");
    }

  score = Math.max(0, Math.min(100, score));
    let verdict;
    if (score >= 80) verdict = "high-trust";
    else if (score >= 55) verdict = "moderate-trust";
    else if (score >= 30) verdict = "low-trust";
    else verdict = "untrusted";

  return { score, verdict, reasons };
}

export async function getBrandVerify(domain, { regions } = {}) {
    const trimmed = (domain || "").trim().toLowerCase();
    if (!trimmed) throw new Error("domain is required");
    if (isBlockedTarget(trimmed)) throw new Error("target host is not allowed");

  const { lookup: dnsLookup } = await import("node:dns/promises");

  let resolvedIp = null;
    let dnsError = null;
    try {
          const result = await dnsLookup(trimmed);
          resolvedIp = result.address;
    } catch (err) {
          dnsError = err.message;
    }

  const [verifyResult, geoResult] = await Promise.allSettled([
        getUprockVerify(trimmed, { regions }),
        resolvedIp ? getIpGeolocation(resolvedIp) : Promise.resolve(null),
      ]);

  const verify = verifyResult.status === "fulfilled" ? verifyResult.value : null;
    const verifyError = verifyResult.status === "rejected" ? verifyResult.reason?.message : null;
    const geo = geoResult.status === "fulfilled" ? geoResult.value : null;
    const geoError = geoResult.status === "rejected" ? geoResult.reason?.message : null;

  const trust = scoreBrandVerify({ verify, geo, dnsError });

  return {
        source: "brand-verify-composite",
        domain: trimmed,
        resolvedIp,
        dnsError,
        trustScore: trust.score,
        verdict: trust.verdict,
        scoringReasons: trust.reasons,
        verification: verify,
        verificationError: verifyError,
        ipIntelligence: geo,
        ipIntelligenceError: geoError,
        fetchedAt: new Date().toISOString(),
  };
}


// ---------------------------------------------------------------------------
// pokt-supplier-trust -- composite trust score for a POKT Shannon supplier
// ($0.05/call)
//
// Mirrors brand_verify's pattern (on-chain data + a live reachability probe,
// rolled into one 0-100 score) but applied to POKT Network suppliers instead
// of arbitrary domains. Useful to Application/gateway operators deciding
// which suppliers to route relays to: is this operator actually staked, in
// good standing, and serving traffic on the RPC endpoints it advertises --
// a judgment neither the raw on-chain stake data nor a bare uptime check
// answers alone.
//
// Schema confirmed live 2026-08-10 (not documented anywhere): Pocketdex's
// singular `supplier` query takes an `id` argument, and `id` is exactly the
// same bech32 string as `operatorId` (verified: fetching both for the same
// row returns identical values). `serviceConfigs.nodes[].endpoints` is a
// JSON scalar (an array of {url, configs, rpcType} objects, not a GraphQL
// object type) -- querying it with a sub-selection throws
// "must not have a selection since type JSON! has no subfields", confirmed
// live before writing this, not assumed from the schema shape alone.
const SUPPLIER_TRUST_QUERY = `
  query SupplierTrust($operatorId: String!) {
      supplier(id: $operatorId) {
            operatorId
                  stakeAmount
                        stakeStatus
                              unstakingReason
                                    serviceConfigs {
                                            nodes {
                                                      serviceId
                                                                endpoints
                                                                        }
                                                                              }
                                                                                  }
                                                                                    }
                                                                                    `;

// Bounded on purpose, same discipline as every other buyer-triggered probe
// in this file (see getUprockFetch/getUprockVerify's SSRF notes above): a
// supplier can advertise many endpoints across many services, and this is
// one x402-paid call, not an unbounded crawl. Reuses isBlockedTarget() so a
// malicious/misconfigured advertised endpoint can't be used to probe this
// container's internal network.
const SUPPLIER_TRUST_PROBE_TIMEOUT_MS = 4000;
const SUPPLIER_TRUST_PROBE_MAX = 5;

async function probePoktSupplierEndpoint(url) {
    let parsed;
    try {
          parsed = new URL(url);
    } catch {
          return { url, reachable: false, error: "invalid URL" };
    }
    if (!["http:", "https:"].includes(parsed.protocol) || isBlockedTarget(parsed.hostname)) {
          return { url, reachable: false, error: "blocked target" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUPPLIER_TRUST_PROBE_TIMEOUT_MS);
    const start = Date.now();
    try {
          const res = await fetch(parsed.toString(), { method: "GET", signal: controller.signal });
          return { url, reachable: true, statusCode: res.status, responseTimeMs: Date.now() - start };
    } catch (err) {
          return { url, reachable: false, error: err.name === "AbortError" ? "timeout" : err.message };
    } finally {
          clearTimeout(timeout);
    }
}

function scorePoktSupplierTrust({ supplier, endpointResults, serviceCount }) {
    if (!supplier) {
          return {
                  score: 0,
                  verdict: "not-found",
                  reasons: ["operator not found in Pocketdex -- not a registered/staked supplier"],
          };
    }

  let score = 0;
    const reasons = [];

  if (supplier.stakeStatus === "Staked") {
        score += 40;
        reasons.push("supplier is actively staked (+40)");
  } else if (supplier.stakeStatus === "Unstaking") {
        score += 15;
        reasons.push(`supplier is unstaking (${supplier.unstakingReason || "reason unknown"}) (+15)`);
  } else {
        reasons.push(`supplier stake status is ${supplier.stakeStatus || "unknown"} (+0)`);
  }

  if (endpointResults.length > 0) {
        const reachableCount = endpointResults.filter((e) => e.reachable).length;
        const pts = Math.round((reachableCount / endpointResults.length) * 40);
        score += pts;
        reasons.push(`${reachableCount}/${endpointResults.length} advertised endpoints reachable (+${pts})`);
  } else {
        reasons.push("no advertised endpoints to probe (+0)");
  }

  if (serviceCount >= 3) {
        score += 20;
        reasons.push(`staked for ${serviceCount} distinct services (+20)`);
  } else if (serviceCount >= 1) {
        score += 10;
        reasons.push(`staked for ${serviceCount} service(s) (+10)`);
  } else {
        reasons.push("no services configured (+0)");
  }

  score = Math.max(0, Math.min(100, score));
    let verdict;
    if (score >= 80) verdict = "high-trust";
    else if (score >= 55) verdict = "moderate-trust";
    else if (score >= 30) verdict = "low-trust";
    else verdict = "untrusted";

  return { score, verdict, reasons };
}

export async function getPoktSupplierTrust(operatorId) {
    const trimmed = String(operatorId || "").trim();
    if (!trimmed) throw new Error("operatorId is required");

  const data = await poktGraphQL(SUPPLIER_TRUST_QUERY, { operatorId: trimmed });
    const supplier = data?.supplier ?? null;

  const serviceNodes = supplier?.serviceConfigs?.nodes ?? [];
    const serviceCount = serviceNodes.length;

  const allEndpointUrls = serviceNodes.flatMap((s) =>
        (Array.isArray(s.endpoints) ? s.endpoints : []).map((e) => e?.url).filter(Boolean)
                                                 );
    const probeUrls = allEndpointUrls.slice(0, SUPPLIER_TRUST_PROBE_MAX);
    const endpointResults = await Promise.all(probeUrls.map((url) => probePoktSupplierEndpoint(url)));

  const trust = scorePoktSupplierTrust({ supplier, endpointResults, serviceCount });

  return {
        source: "pokt-supplier-trust",
        operatorId: trimmed,
        found: Boolean(supplier),
        stakeStatus: supplier?.stakeStatus ?? null,
        stakedPokt: supplier ? Number(BigInt(supplier.stakeAmount ?? "0")) / 1e6 : null,
        unstakingReason: supplier?.unstakingReason ?? null,
        services: serviceNodes.map((s) => s.serviceId),
        endpointsProbed: endpointResults,
        endpointsTotalAdvertised: allEndpointUrls.length,
        trustScore: trust.score,
        verdict: trust.verdict,
        scoringReasons: trust.reasons,
        fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// x402_seller_trust -- composite trust score for an x402 SELLER (not POKT).
// Given a seller's base URL (e.g. "https://example.com:8443"), scores
// whether this looks like a real, actually-used, currently-live x402
// marketplace listing -- not a POKT supplier, and not a bare-domain brand
// check (this needs the full base URL since sellers commonly run on
// non-standard ports, same as this project's own :8443).
//
// Design doc: X402-SELLER-TRUST-ARCHITECTURE.md. Four pillars:
//   1. Bazaar usage/social proof (real settled-payment call/payer counts,
//      free and keyless from Coinbase's own discovery index) -- 35 pts
//   2. Live reachability / 402 conformance probe of the seller's own
//      advertised resources -- 25 pts
//   3. Seller's own /.well-known/x402 manifest quality/completeness -- 15 pts
//   4. Hosting legitimacy (DNS + IP intelligence, reuses brand_verify's
//      exact logic) -- 15 pts
// plus listing freshness -- 10 pts.
//
// Known limitation, disclosed in the response itself, not just here: Bazaar
// quality data only covers payments settled through Coinbase's CDP
// facilitator. A seller using a different/self-hosted facilitator (this
// project's own peaq route is a real example) will show zero Bazaar usage
// despite being legitimately paid elsewhere -- this route can't see that.
// ---------------------------------------------------------------------------

const BAZAAR_SEARCH_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";
const BAZAAR_LOOKUP_TIMEOUT_MS = 6000;

async function queryBazaarDiscovery(hostname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BAZAAR_LOOKUP_TIMEOUT_MS);
  try {
    const url = `${BAZAAR_SEARCH_URL}?query=${encodeURIComponent(hostname)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { matched: false, error: `Bazaar search returned ${res.status}`, routes: [] };
    }
    const body = await res.json();
    const all = Array.isArray(body?.resources) ? body.resources : [];
    // /search is fuzzy/hybrid (matches descriptions too), so filter
    // client-side to only resources whose own hostname exactly matches the
    // target -- an unfiltered result set will include false positives.
    const matched = all.filter((r) => {
      try {
        return new URL(r.resource).hostname.toLowerCase() === hostname.toLowerCase();
      } catch {
        return false;
      }
    });
    return { matched: matched.length > 0, error: null, routes: matched };
  } catch (err) {
    return { matched: false, error: err.name === "AbortError" ? "timeout" : err.message, routes: [] };
  } finally {
    clearTimeout(timeout);
  }
}

const MANIFEST_FETCH_TIMEOUT_MS = 5000;

async function fetchManifestAt(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANIFEST_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSellerManifest(baseUrl) {
  const trimmedBase = baseUrl.replace(/\/$/, "");
  const manifest =
    (await fetchManifestAt(`${trimmedBase}/.well-known/x402`)) ??
    (await fetchManifestAt(`${trimmedBase}/.well-known/x402.json`));
  if (!manifest) {
    return { found: false, resources: [], resourceCount: 0, wellFormedCount: 0, hasX402Version: false };
  }
  const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
  const wellFormedCount = resources.filter((r) => {
    const accepts = Array.isArray(r.accepts) ? r.accepts : [];
    return accepts.length > 0 && accepts.every((a) => a.network && a.payTo && a.price);
  }).length;
  return {
    found: true,
    hasX402Version: Boolean(manifest.x402Version),
    resourceCount: resources.length,
    wellFormedCount,
    resources,
  };
}

// Bounded on purpose, same discipline as every other buyer-triggered probe
// in this file -- a seller can advertise many resources and this is one
// x402-paid call, not an unbounded crawl. Reuses isBlockedTarget() so a
// malicious/misconfigured advertised resource can't be used to probe this
// container's internal network.
const SELLER_TRUST_PROBE_TIMEOUT_MS = 4000;
const SELLER_TRUST_PROBE_MAX = 3;

async function probeSellerResource(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { url, checkedOk: false, error: "invalid URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol) || isBlockedTarget(parsed.hostname)) {
    return { url, checkedOk: false, error: "blocked target" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SELLER_TRUST_PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(parsed.toString(), { method: "GET", signal: controller.signal });
    const responseTimeMs = Date.now() - start;
    let hasAcceptsArray = false;
    if (res.status === 402) {
      try {
        const body = await res.json();
        hasAcceptsArray = Array.isArray(body?.accepts) && body.accepts.length > 0;
      } catch {
        hasAcceptsArray = false;
      }
    }
    return {
      url,
      checkedOk: true,
      statusCode: res.status,
      is402: res.status === 402,
      hasAcceptsArray,
      responseTimeMs,
    };
  } catch (err) {
    return { url, checkedOk: false, error: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timeout);
  }
}

function scoreX402SellerTrust({ bazaar, manifest, probeResults, dnsError, geo }) {
  if (!bazaar.matched && !manifest.found) {
    return {
      score: 0,
      verdict: "not-found",
      reasons: ["not listed on Bazaar and no live x402 manifest found at this URL"],
    };
  }

  let score = 0;
  const reasons = [];

  if (bazaar.matched) {
    const totalCalls = bazaar.routes.reduce((sum, r) => sum + (r.quality?.l30DaysTotalCalls || 0), 0);
    const uniquePayers = Math.max(0, ...bazaar.routes.map((r) => r.quality?.l30DaysUniquePayers || 0));
    let usagePts;
    if (totalCalls >= 1000 && uniquePayers >= 10) usagePts = 35;
    else if (totalCalls >= 100 && uniquePayers >= 3) usagePts = 25;
    else if (totalCalls >= 10) usagePts = 15;
    else if (totalCalls > 0) usagePts = 8;
    else usagePts = 3;
    score += usagePts;
    reasons.push(
      `${bazaar.routes.length} route(s) on Bazaar, ${totalCalls} calls / ${uniquePayers} unique payers in 30d (+${usagePts})`
    );
  } else {
    reasons.push(bazaar.error ? `Bazaar lookup failed: ${bazaar.error} (+0)` : "not listed on Bazaar (+0)");
  }

  if (probeResults.length > 0) {
    const conformant = probeResults.filter((p) => p.checkedOk && p.is402 && p.hasAcceptsArray).length;
    const pts = Math.round((conformant / probeResults.length) * 25);
    score += pts;
    reasons.push(`${conformant}/${probeResults.length} probed resource(s) returned a live 402 paywall (+${pts})`);
  } else {
    reasons.push("no resources available to probe (+0)");
  }

  if (manifest.found) {
    let manifestPts = 5;
    if (manifest.hasX402Version) manifestPts += 3;
    if (manifest.resourceCount > 0) {
      const completeness = manifest.wellFormedCount / manifest.resourceCount;
      manifestPts += Math.round(completeness * 7);
    }
    manifestPts = Math.min(15, manifestPts);
    score += manifestPts;
    reasons.push(
      `manifest live with ${manifest.resourceCount} listed resource(s), ${manifest.wellFormedCount} well-formed (+${manifestPts})`
    );
  } else {
    reasons.push("no /.well-known/x402 manifest reachable (+0)");
  }

  if (dnsError) {
    reasons.push("DNS resolution failed (+0)");
  } else if (geo && !geo.isProxy) {
    score += 15;
    reasons.push(`resolves to ${geo.country || "unknown location"}, no proxy/VPN detected (+15)`);
  } else if (geo && geo.isProxy) {
    score += 4;
    reasons.push("IP flagged as proxy/VPN (+4)");
  } else {
    reasons.push("no IP intelligence available (+0)");
  }

  const lastCalledDates = bazaar.routes
    .map((r) => r.quality?.lastCalledAt)
    .filter(Boolean)
    .map((d) => new Date(d).getTime());
  if (lastCalledDates.length > 0) {
    const mostRecent = Math.max(...lastCalledDates);
    const daysSince = (Date.now() - mostRecent) / (1000 * 60 * 60 * 24);
    let freshPts;
    if (daysSince <= 7) freshPts = 10;
    else if (daysSince <= 30) freshPts = 6;
    else if (daysSince <= 90) freshPts = 2;
    else freshPts = 0;
    score += freshPts;
    reasons.push(`last paid call ${Math.round(daysSince)} day(s) ago (+${freshPts})`);
  } else {
    reasons.push("no call history to judge freshness (+0)");
  }

  score = Math.max(0, Math.min(100, score));
  let verdict;
  if (score >= 80) verdict = "high-trust";
  else if (score >= 55) verdict = "moderate-trust";
  else if (score >= 30) verdict = "low-trust";
  else verdict = "untrusted";

  return { score, verdict, reasons };
}

export async function getX402SellerTrust(baseUrl) {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) throw new Error("baseUrl is required");
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("baseUrl must be a valid absolute URL, e.g. https://example.com:8443");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("baseUrl must use http or https");
  }
  if (isBlockedTarget(parsed.hostname)) {
    throw new Error("baseUrl must not target a localhost, private, or link-local address");
  }
  const hostname = parsed.hostname;
  const trimmedBase = trimmed.replace(/\/$/, "");

  const { lookup: dnsLookup } = await import("node:dns/promises");
  let resolvedIp = null;
  let dnsError = null;
  try {
    const result = await dnsLookup(hostname);
    resolvedIp = result.address;
  } catch (err) {
    dnsError = err.message;
  }

  const [bazaarResult, manifestResult, geoResult] = await Promise.allSettled([
    queryBazaarDiscovery(hostname),
    fetchSellerManifest(trimmedBase),
    resolvedIp ? getIpGeolocation(resolvedIp) : Promise.resolve(null),
  ]);

  const bazaar =
    bazaarResult.status === "fulfilled"
      ? bazaarResult.value
      : { matched: false, error: bazaarResult.reason?.message, routes: [] };
  const manifest =
    manifestResult.status === "fulfilled"
      ? manifestResult.value
      : { found: false, resources: [], resourceCount: 0, wellFormedCount: 0, hasX402Version: false };
  const geo = geoResult.status === "fulfilled" ? geoResult.value : null;
  const geoError = geoResult.status === "rejected" ? geoResult.reason?.message : null;

  const bazaarUrls = bazaar.routes.map((r) => r.resource).filter(Boolean);
  const manifestUrls = (manifest.resources || []).map((r) => r.resource).filter(Boolean);
  const candidateUrls = [...new Set([...bazaarUrls, ...manifestUrls])].slice(0, SELLER_TRUST_PROBE_MAX);
  const probeResults = await Promise.all(candidateUrls.map((url) => probeSellerResource(url)));

  const trust = scoreX402SellerTrust({ bazaar, manifest, probeResults, dnsError, geo });

  return {
    source: "x402-seller-trust-composite",
    baseUrl: trimmedBase,
    hostname,
    resolvedIp,
    dnsError,
    bazaarListed: bazaar.matched,
    bazaarRouteCount: bazaar.routes.length,
    bazaarTotal30dCalls: bazaar.routes.reduce((sum, r) => sum + (r.quality?.l30DaysTotalCalls || 0), 0),
    bazaarLookupError: bazaar.error,
    manifestReachable: manifest.found,
    manifestResourceCount: manifest.resourceCount || 0,
    resourcesProbed: probeResults,
    ipIntelligence: geo,
    ipIntelligenceError: geoError,
    trustScore: trust.score,
    verdict: trust.verdict,
    scoringReasons: trust.reasons,
    fetchedAt: new Date().toISOString(),
  };
}
// --- Headless-Chrome screenshot render (Puppeteer) --------------------------
// PATCH (2026-08-15): backs GET /v1/render/screenshot. Unlike every other
// route in this file, the actual rendering work happens in a SEPARATE
// container (puppeteer-render.js) -- headless Chrome's resource footprint
// (100-300MB RAM, real CPU per render) is a different order of magnitude
// than this file's lightweight RPC/API pass-throughs, so it's isolated in
// its own service instead of run in this process. See puppeteer-render.js
// for the full "why a separate container" rationale, and docker-compose.yml
// for how the two containers are wired together.
//
// SSRF hardening: reuses the exact same isBlockedTarget() denylist that
// guards getUprockFetch/getX402SellerTrust above -- a caller-supplied URL is
// checked here, BEFORE it's ever handed to the render service, not inside
// that service (same "check once, at the edge closest to the caller"
// pattern already established in this file).
const PUPPETEER_RENDER_URL = process.env.PUPPETEER_RENDER_URL || "http://puppeteer-render:3002";
// Above puppeteer-render.js's own 15s navigation timeout, so THAT service's
// more specific error (e.g. "render failed: Navigation timeout...") surfaces
// to the caller instead of this file's generic "unreachable" message racing
// it.
const RENDER_TIMEOUT_MS = 20_000;

export async function getPuppeteerScreenshot(targetUrl) {
  if (!targetUrl) throw new Error("url query param is required");
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("url must be a valid absolute URL, e.g. https://example.com");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url must use http or https");
  }
  if (isBlockedTarget(parsed.hostname)) {
    throw new Error("url must not target a localhost, private, or link-local address");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${PUPPETEER_RENDER_URL}/screenshot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: parsed.toString() }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`puppeteer-render service unreachable: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `puppeteer-render service returned HTTP ${res.status}`);
  }

  return {
    source: "puppeteer-screenshot",
    url: parsed.toString(),
    statusCode: json.statusCode ?? null,
    width: json.width,
    height: json.height,
    screenshotBase64: json.screenshotBase64,
    renderedAt: new Date().toISOString(),
  };
}

// --- HEIC to PNG conversion --------------------------------------------
// PATCH (2026-08-15): backs GET /v1/convert/heic-to-png. Straightforward
// utility conversion -- fetches a caller-supplied HEIC/HEIF image and
// returns it re-encoded as PNG, base64 in JSON (same response shape as
// getPuppeteerScreenshot() above, for the same reason: keeps every route
// on this server returning JSON rather than introducing a second, binary-
// response code path in server.js).
//
// Uses heic-convert (pure JavaScript -- wraps libheif-js, a WASM build of
// libheif, plus pngjs/jpeg-js for encoding) instead of a native binding
// like sharp's libvips. No system libraries to apk-install, no separate
// container needed the way puppeteer-render needed one above -- this runs
// fine in-process on the existing node:20-alpine image with a single
// `npm install`.
//
// SSRF hardening: reuses the exact same isBlockedTarget() denylist as
// every other buyer-supplied-URL route in this file.
import convert from "heic-convert";

// 20MB is generous for a phone photo and bounds memory: an unbounded
// upstream response decoded straight into memory is a real way to OOM
// this container, same class of risk flagged for the buyer-supplied-URL
// routes above (getUprockFetch, getPuppeteerScreenshot).
const HEIC_MAX_INPUT_BYTES = 20 * 1024 * 1024;

// Minimal, dependency-free PNG dimension reader -- IHDR is always the
// first chunk; width/height are big-endian uint32s at a fixed offset
// right after the 8-byte PNG signature + 4-byte chunk length + 4-byte
// "IHDR" tag. Avoids pulling in a second image library just to report
// width/height back to the caller.
function readPngDimensions(buffer) {
  if (buffer.length < 24) return { width: null, height: null };
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export async function getHeicToPng(targetUrl) {
  if (!targetUrl) throw new Error("url query param is required");
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("url must be a valid absolute URL, e.g. https://example.com/photo.heic");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url must use http or https");
  }
  if (isBlockedTarget(parsed.hostname)) {
    throw new Error("url must not target a localhost, private, or link-local address");
  }

  const res = await fetch(parsed.toString());
  if (!res.ok) {
    throw new Error(`failed to fetch source image: HTTP ${res.status}`);
  }
  const declaredLength = Number(res.headers.get("content-length") || 0);
  if (declaredLength > HEIC_MAX_INPUT_BYTES) {
    throw new Error(`source image is too large (${declaredLength} bytes, max ${HEIC_MAX_INPUT_BYTES})`);
  }
  const inputBuffer = Buffer.from(await res.arrayBuffer());
  if (inputBuffer.length > HEIC_MAX_INPUT_BYTES) {
    throw new Error(`source image is too large (${inputBuffer.length} bytes, max ${HEIC_MAX_INPUT_BYTES})`);
  }

  let outputBuffer;
  try {
    outputBuffer = await convert({ buffer: inputBuffer, format: "PNG" });
  } catch (err) {
    throw new Error(`HEIC decode failed: ${err.message}`);
  }

  const { width, height } = readPngDimensions(outputBuffer);

  return {
    source: "heic-to-png",
    url: parsed.toString(),
    width,
    height,
    pngBase64: outputBuffer.toString("base64"),
    convertedAt: new Date().toISOString(),
  };
}


// --- Web search (self-hosted SearXNG) --------------------------------------
// PATCH (2026-08-16): backs GET /v1/search/web. Unlike every URL-fetching
// route above, this takes a caller-supplied QUERY STRING, not a URL -- there
// is no buyer-controlled target host to SSRF-check here, since the only
// thing this route ever fetches is our own internal searxng service.
//
// Runs its own SearXNG instance (see docker-compose.yml's searxng service)
// rather than paying a third-party search API per call -- SearXNG is a free,
// open-source metasearch engine that aggregates results from 70+ upstream
// engines (Google, Bing, DuckDuckGo, etc.) with no API key. Same "own the
// infra, keep the margin" reasoning as heic-convert above, but packaged as
// its own container (like puppeteer-render) rather than an in-process npm
// package, since SearXNG ships as a ready-made Docker image -- there's
// nothing to npm-install here.
//
// Known caveat, disclosed honestly: SearXNG works by scraping the HTML
// result pages of upstream search engines. That's inherently less stable
// than a real search API -- an upstream engine changing its markup, or
// rate-limiting/blocking this box's IP, can degrade or break results
// without warning. Acceptable for this project's current volume; revisit
// (e.g. swap in a paid engine like Tavily/Brave behind the same route
// signature) if reliability becomes a real problem.
const SEARXNG_URL = process.env.SEARXNG_URL || "http://searxng:8080";
const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_RESULT_LIMIT = 10;
const SEARCH_QUERY_MAX_LEN = 500;

export async function getWebSearch(query, { limit } = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed) throw new Error("q query param is required");
  if (trimmed.length > SEARCH_QUERY_MAX_LEN) {
    throw new Error(`q must be ${SEARCH_QUERY_MAX_LEN} characters or fewer`);
  }
  const capped = Math.max(1, Math.min(Number(limit) || SEARCH_RESULT_LIMIT, SEARCH_RESULT_LIMIT));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let res;
  try {
    const url = `${SEARXNG_URL}/search?q=${encodeURIComponent(trimmed)}&format=json`;
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new Error(`searxng service unreachable: ${err.name === "AbortError" ? "timeout" : err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`searxng service returned HTTP ${res.status}`);
  }
  const json = await res.json().catch(() => ({}));
  const rawResults = Array.isArray(json.results) ? json.results : [];

  const results = rawResults.slice(0, capped).map((r) => ({
    title: r.title ?? null,
    url: r.url ?? null,
    snippet: r.content ?? null,
    engine: r.engine ?? null,
  }));

  return {
    source: "searxng",
    query: trimmed,
    resultCount: results.length,
    results,
    fetchedAt: new Date().toISOString(),
  };
}

// --- ERC-8004 agent reputation ----------------------------------------------
// PATCH (2026-08-16): backs GET /v1/agent/reputation/:agentId. Looks up an
// AI agent's on-chain identity + aggregated feedback via the ERC-8004
// "Trustless Agents" standard (eips.ethereum.org/EIPS/eip-8004) -- distinct
// from every other trust route in this file: getBrandVerify/getX402SellerTrust
// score DOMAINS/SELLERS, getPoktSupplierTrust scores POKT infrastructure
// operators, getPeaqMachineVerification verifies IoT/machine identity --
// none of them answer "does this AI AGENT have a real track record."
//
// Registry addresses confirmed directly from erc-8004/erc-8004-contracts's
// README (github.com/erc-8004/erc-8004-contracts), not assumed -- both
// registries are deployed via CREATE2 at the SAME address on every chain
// they support (Ethereum, Base, BSC, Polygon, Arbitrum, and others), which
// is why this route can support multiple chains with zero new
// contract-address configuration.
import { Interface } from "ethers";

const ERC8004_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const ERC8004_REPUTATION_REGISTRY = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

// Reuses this project's existing ETH_RPC_URL/BSC_RPC_URL -- ERC-8004 has no
// live deployment on peaq or Solana, so those two are the only chains this
// route can serve without adding a brand-new RPC env var.
function erc8004RpcUrl(chainKey) {
  if (chainKey === "eth") return ETH_RPC_URL;
  if (chainKey === "bsc") return BSC_RPC_URL;
  return null;
}

// Minimal read-only ABI -- just the functions this route calls. ethers is
// used ONLY for its ABI encoder/decoder (encodeFunctionData /
// decodeFunctionResult); the actual JSON-RPC round trip reuses this file's
// existing rpcCall() helper, the same one every other eth_call in this file
// goes through, rather than pulling in ethers' own Provider/network stack.
const ERC8004_IDENTITY_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
];
const ERC8004_REPUTATION_ABI = [
  "function getClients(uint256 agentId) view returns (address[])",
  "function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)",
];
const erc8004IdentityIface = new Interface(ERC8004_IDENTITY_ABI);
const erc8004ReputationIface = new Interface(ERC8004_REPUTATION_ABI);

async function erc8004Call(rpcUrl, to, iface, fn, args) {
  const data = iface.encodeFunctionData(fn, args);
  const resultHex = await rpcCall(rpcUrl, "eth_call", [{ to, data }, "latest"]);
  return iface.decodeFunctionResult(fn, resultHex);
}

// Bounded on purpose, same discipline as every other probe/aggregate route
// in this file -- an agent with an unusually large feedback history
// shouldn't turn one x402-paid call into unbounded client-side processing.
const ERC8004_MAX_FEEDBACK_ENTRIES = 2000;

export async function getAgentReputation(agentIdRaw, { chain = "eth" } = {}) {
  const chainKey = String(chain || "eth").toLowerCase();
  const rpcUrl = erc8004RpcUrl(chainKey);
  if (!rpcUrl) {
    throw new Error(
      "chain must be 'eth' or 'bsc' -- ERC-8004 has no live deployment on this project's other supported chains"
    );
  }

  let agentId;
  try {
    agentId = BigInt(String(agentIdRaw));
    if (agentId < 0n) throw new Error("negative");
  } catch {
    throw new Error("agentId must be a non-negative integer");
  }

  let owner;
  try {
    [owner] = await erc8004Call(rpcUrl, ERC8004_IDENTITY_REGISTRY, erc8004IdentityIface, "ownerOf", [agentId]);
  } catch {
    // Revert (ERC721NonexistentToken or equivalent) -- not a registered
    // agent. Same "not-found is a legitimate answer, not an upstream
    // failure" posture as getPeaqMachineVerification's 404 case above.
    return {
      source: "erc8004-agent-reputation",
      chain: chainKey,
      agentId: agentId.toString(),
      registered: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  const [agentURI] = await erc8004Call(rpcUrl, ERC8004_IDENTITY_REGISTRY, erc8004IdentityIface, "tokenURI", [agentId]);
  const [agentWallet] = await erc8004Call(
    rpcUrl,
    ERC8004_IDENTITY_REGISTRY,
    erc8004IdentityIface,
    "getAgentWallet",
    [agentId]
  );
  const [clients] = await erc8004Call(rpcUrl, ERC8004_REPUTATION_REGISTRY, erc8004ReputationIface, "getClients", [
    agentId,
  ]);

  // Empty clientAddresses array makes the contract itself default to its
  // full stored client list; empty tag1/tag2 strings mean "no filter" --
  // both confirmed directly from ReputationRegistryUpgradeable.sol source
  // (the contract compares keccak256(tag) against keccak256("") to decide
  // whether to skip filtering at all), not assumed from the written spec.
  const [, , values, valueDecimals, tag1s, , revokedStatuses] = await erc8004Call(
    rpcUrl,
    ERC8004_REPUTATION_REGISTRY,
    erc8004ReputationIface,
    "readAllFeedback",
    [agentId, [], "", "", false]
  );

  const cap = Math.min(values.length, ERC8004_MAX_FEEDBACK_ENTRIES);
  const truncated = values.length > ERC8004_MAX_FEEDBACK_ENTRIES;

  // Grouped by tag1 -- blending unrelated signals (e.g. "uptime" percentages
  // with "starred" 0-100 ratings) into one average would be close to
  // meaningless, same reasoning that keeps every other composite score in
  // this file (brand-verify, seller-trust, supplier-trust) broken into
  // named pillars rather than one raw blended number.
  const byTag = new Map();
  for (let i = 0; i < cap; i++) {
    if (revokedStatuses[i]) continue;
    const tag = tag1s[i] || "(untagged)";
    const decimals = Number(valueDecimals[i]);
    const normalized = Number(values[i]) / 10 ** decimals;
    const bucket = byTag.get(tag) || { tag1: tag, count: 0, sum: 0 };
    bucket.count += 1;
    bucket.sum += normalized;
    byTag.set(tag, bucket);
  }
  const feedbackByTag = Array.from(byTag.values()).map((b) => ({
    tag1: b.tag1,
    count: b.count,
    averageValue: Number((b.sum / b.count).toFixed(4)),
  }));
  const feedbackCount = feedbackByTag.reduce((sum, b) => sum + b.count, 0);

  // Best-effort: the agent's registration file (name/description/services),
  // fetched only if agentURI is a plain https:// URL -- ipfs:// and
  // data:application/json;base64 URIs are valid per the ERC-8004 spec but
  // out of scope for v1 (no IPFS gateway wired up yet). Non-fatal on
  // failure, same posture as getPeaqMachineVerification's /machines
  // enrichment call above.
  let registrationFile = null;
  if (agentURI && agentURI.startsWith("https://")) {
    try {
      const parsedUri = new URL(agentURI);
      if (!isBlockedTarget(parsedUri.hostname)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const res = await fetch(agentURI, { signal: controller.signal });
          if (res.ok) {
            const json = await res.json();
            registrationFile = {
              name: json.name ?? null,
              description: json.description ?? null,
              services: Array.isArray(json.services) ? json.services : [],
              x402Support: json.x402Support ?? null,
              active: json.active ?? null,
            };
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch {
      // Non-fatal -- enrichment only.
    }
  }

  return {
    source: "erc8004-agent-reputation",
    chain: chainKey,
    agentId: agentId.toString(),
    registered: true,
    owner,
    agentWallet: agentWallet === "0x0000000000000000000000000000000000000000" ? null : agentWallet,
    agentURI: agentURI || null,
    registrationFile,
    uniqueClients: clients.length,
    feedbackCount,
    feedbackByTag,
    feedbackTruncated: truncated,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Tier A historical/indexed chain data (2026-08-16) ----------------------
// "Tier A" = zero new dependencies, zero new containers, zero new env vars --
// reuses the exact same ETH_RPC_URL / SOL_RPC_URL already wired up above.
// Scoped to ETH + Solana only for this round (BSC and peaq deferred -- their
// free-tier indexer/API situations are unverified, see README). Both routes
// are deliberately bounded to "recent" history, not full-archive: public RPC
// providers reject eth_getLogs queries over some undocumented block-range
// ceiling (varies 100-100,000 blocks by provider, no way to know llamarpc's
// specific number without hitting it in production), and getSignaturesForAddress
// has a hard 1000-signature ceiling built into the Solana RPC spec itself.
// Rather than guess a provider's exact limit, both routes clamp their own
// request to a conservative worst-case-safe size server-side, so a caller
// can never accidentally trigger a provider-side rejection.

const ETH_LOGS_MAX_BLOCKS = 1000; // conservative floor seen across providers
const ETH_LOGS_MAX_RESULTS = 500; // cap the response payload, not just the range

function toBlockHex(n) {
  return "0x" + Math.max(0, Math.trunc(n)).toString(16);
}

// INCIDENT (2026-08-16, live-test follow-up): the block-range clamp above
// is not enough on its own. First live test against a real high-traffic
// contract (USDC) failed even at a 1000-block window:
//   RPC eth_getLogs error: query exceeds max results 20000, retry with the
//   range 25768071-25768348
// llamarpc enforces a RESULT-COUNT ceiling (20,000 logs) independent of
// block range -- a busy-enough contract can blow past that in far fewer
// than 1000 blocks (this error's own suggested retry range was ~277
// blocks). No fixed block-count cap can fully solve this: an even busier
// contract could exceed 20k logs in 10 blocks. Fix: catch this specific
// rejection and narrow the range instead of failing outright. llamarpc's
// error conveniently names an exact working range -- use it directly when
// present; fall back to halving the window (bounded attempts) for
// providers/errors that don't.
const ETH_LOGS_RETRY_RANGE_REGEX = /retry with the range[:\s]*(\d+)\s*-\s*(\d+)/i;
const ETH_LOGS_MAX_NARROW_ATTEMPTS = 5;
const ETH_LOGS_MIN_RANGE = 10; // give up narrowing below this -- contract is too hot for this endpoint right now

async function fetchEthLogsWithNarrowing(baseFilter, fromBlock, toBlock) {
  let attemptFrom = fromBlock;
  let attemptTo = toBlock;
  let lastErr;
  for (let attempt = 0; attempt < ETH_LOGS_MAX_NARROW_ATTEMPTS; attempt++) {
    try {
      const filter = { ...baseFilter, fromBlock: toBlockHex(attemptFrom), toBlock: toBlockHex(attemptTo) };
      const logs = await rpcCall(ETH_RPC_URL, "eth_getLogs", [filter]);
      return { logs, fromBlock: attemptFrom, toBlock: attemptTo };
    } catch (err) {
      lastErr = err;
      const match = err.message.match(ETH_LOGS_RETRY_RANGE_REGEX);
      const suggestedFrom = match ? parseInt(match[1], 10) : NaN;
      const suggestedTo = match ? parseInt(match[2], 10) : NaN;
      if (Number.isFinite(suggestedFrom) && Number.isFinite(suggestedTo) && suggestedTo > suggestedFrom) {
        attemptFrom = suggestedFrom;
        attemptTo = suggestedTo;
        continue;
      }
      // No usable suggested range (or the suggestion itself later failed) --
      // halve the window, anchored to the same toBlock, and try again.
      const span = attemptTo - attemptFrom;
      if (span <= ETH_LOGS_MIN_RANGE) break;
      attemptFrom = attemptTo - Math.floor(span / 2);
    }
  }
  throw lastErr;
}

export async function getEthLogs(addressRaw, { topic0: topic0Raw, blocks: blocksRaw } = {}) {
  const address = String(addressRaw || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("address must be a 0x-prefixed 20-byte Ethereum address");
  }

  let topic0;
  if (topic0Raw !== undefined && topic0Raw !== null && String(topic0Raw).trim() !== "") {
    topic0 = String(topic0Raw).trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(topic0)) {
      throw new Error("topic0 must be a 0x-prefixed 32-byte event signature hash");
    }
  }

  // Always clamp, never reject -- a caller asking for 50000 blocks just gets
  // the max safe window back rather than an error, same "forgiving input"
  // posture as getWebSearch's limit clamping above.
  const blocksRequested = Number(blocksRaw) || 500;
  const blocksSearched = Math.max(1, Math.min(Math.trunc(blocksRequested), ETH_LOGS_MAX_BLOCKS));

  const latestHex = await rpcCall(ETH_RPC_URL, "eth_blockNumber");
  const latest = parseInt(latestHex, 16);
  const fromBlock = Math.max(0, latest - blocksSearched);

  const baseFilter = { address };
  if (topic0) baseFilter.topics = [topic0];

  const { logs: rawLogs, fromBlock: actualFromBlock, toBlock: actualToBlock } = await fetchEthLogsWithNarrowing(
    baseFilter,
    fromBlock,
    latest
  );
  const narrowedDueToActivity = actualFromBlock !== fromBlock || actualToBlock !== latest;

  const truncated = rawLogs.length > ETH_LOGS_MAX_RESULTS;
  const logs = rawLogs.slice(0, ETH_LOGS_MAX_RESULTS).map((l) => ({
    address: l.address,
    topics: l.topics,
    data: l.data,
    blockNumber: parseInt(l.blockNumber, 16),
    transactionHash: l.transactionHash,
    logIndex: parseInt(l.logIndex, 16),
    removed: !!l.removed,
  }));

  return {
    source: "eth-logs",
    chain: "ethereum",
    address,
    topic0: topic0 || null,
    fromBlock: actualFromBlock,
    toBlock: actualToBlock,
    blocksSearched: actualToBlock - actualFromBlock,
    blocksRequested: blocksSearched,
    narrowedDueToActivity,
    logCount: logs.length,
    truncated,
    logs,
    note: narrowedDueToActivity
      ? `contract activity was too high for the requested ${blocksSearched}-block window -- automatically narrowed to ${actualToBlock - actualFromBlock} blocks to stay under the RPC provider's result-count ceiling; recent history only, not a full-archive query`
      : `bounded to the most recent ${ETH_LOGS_MAX_BLOCKS} blocks -- recent history only, not a full-archive query`,
    fetchedAt: new Date().toISOString(),
  };
}

const SOL_HISTORY_MAX_LIMIT = 100; // native API allows up to 1000; kept far
// smaller here since payload size scales linearly and this is priced/cached
// as a "recent activity" product, not a bulk-export one.

export async function getSolTransactionHistory(addressRaw, { limit: limitRaw } = {}) {
  const address = String(addressRaw || "").trim();
  // Loose base58 shape check only -- same light-validation posture as the
  // existing getSolBalance() above, which does no format check at all and
  // just lets a malformed address surface the RPC's own error. This adds a
  // clearer error message for the most common mistake (wrong chain's address
  // format) without trying to fully validate base58/curve-point validity.
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    throw new Error("address must be a base58 Solana address");
  }

  const limit = Math.max(1, Math.min(Math.trunc(Number(limitRaw) || 20), SOL_HISTORY_MAX_LIMIT));

  const raw = await rpcCall(SOL_RPC_URL, "getSignaturesForAddress", [address, { limit }]);
  const transactions = (Array.isArray(raw) ? raw : []).map((t) => ({
    signature: t.signature,
    slot: t.slot,
    blockTime: t.blockTime ?? null,
    confirmationStatus: t.confirmationStatus ?? null,
    err: t.err !== null && t.err !== undefined,
    memo: t.memo ?? null,
  }));

  return {
    source: "sol-history",
    chain: "solana",
    address,
    limit,
    count: transactions.length,
    transactions,
    note: "most recent transactions only -- not full history since genesis",
    fetchedAt: new Date().toISOString(),
  };
}

// --- OFAC sanctions screening (2026-08-16) ---
//
// OFAC's own authoritative source is the SDN list, published as
// sdn_advanced.xml (~80MB, relational schema: names/addresses/documents/
// digital-currency IDs all in separate linked structures) --
// https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml.
// Parsing that directly in-process for a lightweight per-address lookup
// is more than this route needs. Instead this uses the `lists` branch of
// 0xB10C/ofac-sanctioned-digital-currency-addresses (MIT-licensed, verified
// directly against its README before building this): a GitHub Actions
// workflow re-extracts and republishes that exact same OFAC XML nightly at
// 0 UTC as plain per-asset text files, one address per line. Confirmed live
// by fetching both files directly -- ETH list is ~90 addresses, SOL list is
// a single address as of 2026-08-16.
//
// Scoped to ETH + Solana only, same "Tier A" scoping discipline as the
// historical chain-data routes above. The source covers more assets (XBT,
// LTC, BSC, TRX, ARB, etc.) if this ever needs to expand -- see README.
const OFAC_LIST_URLS = {
  ethereum:
    process.env.OFAC_ETH_LIST_URL ||
    "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt",
  solana:
    process.env.OFAC_SOL_LIST_URL ||
    "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_SOL.txt",
};
// The source regenerates once/night -- this just bounds how stale our own
// in-process copy can get between regenerations, not a real-time freshness
// guarantee. Module-level singleton (not the server.js `cached()` helper)
// because what needs caching here is the whole list, shared across every
// address lookup, not a per-request key -- the per-address answer itself
// is a free Set.has() once the list is loaded and is never worth caching
// on its own.
const OFAC_LIST_TTL_MS = 6 * 60 * 60 * 1000; // 6h
let ofacListCache = null; // { fetchedAt, sets: { ethereum: Set, solana: Set } }

async function loadOfacLists() {
  if (ofacListCache && Date.now() - ofacListCache.fetchedAt < OFAC_LIST_TTL_MS) {
    return ofacListCache;
  }
  const chains = Object.keys(OFAC_LIST_URLS);
  const texts = await Promise.all(
    chains.map(async (chain) => {
      const url = OFAC_LIST_URLS[chain];
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OFAC sanctions list fetch failed: HTTP ${res.status} (${chain})`);
      return res.text();
    })
  );
  const toSet = (text) =>
    new Set(
      text
        .split("\n")
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean)
    );
  const sets = {};
  chains.forEach((chain, i) => {
    sets[chain] = toSet(texts[i]);
  });
  ofacListCache = { fetchedAt: Date.now(), sets };
  return ofacListCache;
}

function detectAddressChain(address) {
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return "ethereum";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "solana";
  return null;
}

export async function getSanctionsCheck(addressRaw, { chain: chainRaw } = {}) {
  const address = String(addressRaw || "").trim();
  if (!address) throw new Error("address is required");

  const chain = chainRaw ? String(chainRaw).trim().toLowerCase() : detectAddressChain(address);
  if (chain !== "ethereum" && chain !== "solana") {
    throw new Error(
      "could not determine chain from address format -- pass chain=ethereum or chain=solana explicitly, or supply a 0x-prefixed Ethereum address or a base58 Solana address"
    );
  }
  if (chain === "ethereum" && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("address must be a 0x-prefixed 20-byte Ethereum address");
  }
  if (chain === "solana" && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    throw new Error("address must be a base58 Solana address");
  }

  const { sets, fetchedAt } = await loadOfacLists();
  const sanctioned = sets[chain].has(address.toLowerCase());

  return {
    source: "ofac-sanctions-check",
    chain,
    address,
    sanctioned,
    matchType: sanctioned ? "direct-sdn-list-match" : null,
    list: "OFAC Specially Designated Nationals (SDN) List -- digital currency addresses",
    listSourceUrl: OFAC_LIST_URLS[chain],
    listSyncedAt: new Date(fetchedAt).toISOString(),
    note: "direct address match against OFAC's published SDN list only -- does not perform multi-hop / indirect-exposure clustering, so funds that passed through a sanctioned address via an intermediary wallet will not be flagged here; not a substitute for a full compliance screening program",
    fetchedAt: new Date().toISOString(),
  };
}
// dataSources.js
// Thin wrappers around cheap/free upstream data sources. Kept separate from
// server.js so you can swap in a POKT gateway endpoint, Alchemy, Infura, or
// your own Umbrel-hosted node without touching the payment/route logic.
//
// Uses Node's built-in global fetch (stable since Node 18) instead of the
// node-fetch package — one less dependency to install/break.

const ETH_RPC_URL = process.env.ETH_RPC_URL || "https://eth.llamarpc.com";
const SOL_RPC_URL = process.env.SOL_RPC_URL || "https://api.mainnet-beta.solana.com";
// peaq is a standard EVM chain (chain ID 3338) — same JSON-RPC interface as
// ETH_RPC_URL above, just pointed at peaq's public RPC by default. Free
// public endpoints (publicnode, OnFinality, etc.) are fine for these
// low-frequency snapshot calls; swap in a paid/private RPC if volume grows.
const PEAQ_RPC_URL = process.env.PEAQ_RPC_URL || "https://peaq-rpc.publicnode.com";
// BNB Smart Chain (BSC, chain ID 56) — same eth_* JSON-RPC interface as
// Ethereum/peaq above, since BSC is EVM-compatible. Public default endpoint;
// swap in a private/paid RPC if volume grows. (Data-source layer only — see
// x402Middleware.js for the separate, NOT-YET-ACTIVE work needed before BSC
// can be offered as a *payment* network too.)
const BSC_RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org";
// If you stake POKT and run a gateway, point ETH_RPC_URL / SOL_RPC_URL at your
// POKT gateway endpoint instead of the public defaults above — same interface,
// you just become the infra layer instead of renting someone else's.

async function rpcCall(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method} error: ${json.error.message}`);
  return json.result;
}

export async function getEthGasPrice() {
  const hex = await rpcCall(ETH_RPC_URL, "eth_gasPrice");
  const wei = BigInt(hex);
  return {
    chain: "ethereum",
    wei: wei.toString(),
    gwei: Number(wei) / 1e9,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getEthLatestBlock() {
  const hex = await rpcCall(ETH_RPC_URL, "eth_blockNumber");
  return {
    chain: "ethereum",
    blockNumber: parseInt(hex, 16),
    fetchedAt: new Date().toISOString(),
  };
}

export async function getSolLatestBlock() {
  const slot = await rpcCall(SOL_RPC_URL, "getSlot");
  return {
    chain: "solana",
    slot,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getEthBalance(address) {
  const hex = await rpcCall(ETH_RPC_URL, "eth_getBalance", [address, "latest"]);
  const wei = BigInt(hex);
  return {
    chain: "ethereum",
    address,
    wei: wei.toString(),
    eth: Number(wei) / 1e18,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getSolBalance(address) {
  const lamports = await rpcCall(SOL_RPC_URL, "getBalance", [address]);
  const value = typeof lamports === "object" ? lamports.value : lamports;
  return {
    chain: "solana",
    address,
    lamports: value,
    sol: value / 1e9,
    fetchedAt: new Date().toISOString(),
  };
}

// --- peaq (machine-economy L1, chain ID 3338) ------------------------------
// Same eth_* JSON-RPC surface as the Ethereum functions above since peaq is
// EVM-compatible — these exist as their own "peaq" chain label (rather than
// routing peaq addresses through the existing eth/ functions) so the sale
// catalog can price and list "peaq network data" as its own distinct
// product, separate from Ethereum mainnet data.
export async function getPeaqGasPrice() {
  const hex = await rpcCall(PEAQ_RPC_URL, "eth_gasPrice");
  const wei = BigInt(hex);
  return {
    chain: "peaq",
    wei: wei.toString(),
    gwei: Number(wei) / 1e9,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getPeaqLatestBlock() {
  const hex = await rpcCall(PEAQ_RPC_URL, "eth_blockNumber");
  return {
    chain: "peaq",
    blockNumber: parseInt(hex, 16),
    fetchedAt: new Date().toISOString(),
  };
}

export async function getPeaqBalance(address) {
  const hex = await rpcCall(PEAQ_RPC_URL, "eth_getBalance", [address, "latest"]);
  const wei = BigInt(hex);
  return {
    chain: "peaq",
    address,
    wei: wei.toString(),
    peaq: Number(wei) / 1e18,
    fetchedAt: new Date().toISOString(),
  };
}

// --- BNB Smart Chain (BSC, chain ID 56) ------------------------------------
// Same eth_* JSON-RPC surface as Ethereum/peaq above — BSC is EVM-compatible.
// Own "bsc" chain label for the same reason as peaq above: lets the catalog
// price and list BSC data as its own distinct product. This data layer is
// independent of, and ships ahead of, BSC's use as a *payment* network (see
// x402Middleware.js) — these three routes are sellable via the existing
// Solana/peaq payment rails today.
export async function getBscGasPrice() {
  const hex = await rpcCall(BSC_RPC_URL, "eth_gasPrice");
  const wei = BigInt(hex);
  return {
    chain: "bsc",
    wei: wei.toString(),
    gwei: Number(wei) / 1e9,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getBscLatestBlock() {
  const hex = await rpcCall(BSC_RPC_URL, "eth_blockNumber");
  return {
    chain: "bsc",
    blockNumber: parseInt(hex, 16),
    fetchedAt: new Date().toISOString(),
  };
}

export async function getBscBalance(address) {
  const hex = await rpcCall(BSC_RPC_URL, "eth_getBalance", [address, "latest"]);
  const wei = BigInt(hex);
  return {
    chain: "bsc",
    address,
    wei: wei.toString(),
    bnb: Number(wei) / 1e18,
    fetchedAt: new Date().toISOString(),
  };
}

// --- peaq machine verification (peaqOS MCR API) -----------------------------
// Sourced from peaq's own public, read-only Machine Credit Rating API
// (https://mcr.peaq.xyz). No API key required -- all data originates from
// on-chain contracts on peaq chain (chain ID 3338): IdentityRegistry (is
// this machine registered/bonded), AdminFlags (negative_flag), and the
// EventRegistry-derived MCR score/rating.
//
// Deliberately NOT built on the raw DID precompile (0x...800) -- peaq's own
// docs flag that as absorbed into peaqOS/peaqID, with this MCR API as the
// current, documented surface. Verified live against a real registered
// machine (machine_id 1) before shipping: /health returned {"status":"ok"},
// and /mcr/<real DID> returned the exact documented shape.
//
// Rate limit on peaq's side: 90 req/min per IP, MCR_CACHE_TTL defaults to
// 3600s upstream -- so our own cache TTL below doesn't need to be tight.
const PEAQOS_MCR_API_URL = process.env.PEAQOS_MCR_API_URL || "https://mcr.peaq.xyz";

// Accepts either a full peaq DID ("did:peaq:0x...") or a raw EVM address
// ("0x...") -- the MCR API supports both, but we normalize to the full DID
// form before calling so the response's own `did` field is always present.
function normalizePeaqDid(input) {
  const trimmed = String(input || "").trim();
  const addr = trimmed.startsWith("did:peaq:") ? trimmed.slice("did:peaq:".length) : trimmed;
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    throw new Error("machine id must be a peaq DID (did:peaq:0x...) or a raw 0x address");
  }
  return `did:peaq:${addr}`;
}

export async function getPeaqMachineVerification(didOrAddress) {
  const did = normalizePeaqDid(didOrAddress);
  const res = await fetch(`${PEAQOS_MCR_API_URL}/mcr/${did}`);

  // "Not registered" is a legitimate, valuable answer for a verifier bot
  // (like a credit check coming back "no record") -- not an upstream
  // failure, so it's a normal 200 response here, not a thrown error.
  if (res.status === 404) {
    return { source: "peaqos-mcr", did, registered: false, fetchedAt: new Date().toISOString() };
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.detail || `HTTP ${res.status}`;
    throw new Error(`peaqOS MCR lookup failed for ${did}: ${detail}`);
  }

  // Best-effort enrichment from the same MCR API's /machines/{machine_id}
  // endpoint (no extra key, same host, numeric ID from the /mcr/ response
  // above) -- carries a machine's advertised service endpoints,
  // documentation URL, and data-visibility setting, none of which /mcr/{did}
  // itself returns. NOTE: deliberately NOT /machine/{did} (singular) -- that
  // sibling endpoint nests everything under a `peaqos` key and has no
  // `services` field at all; live-verified both shapes 2026-08-03 against
  // machine_id 1 before picking this one. Failure here is non-fatal: the MCR
  // fields above are the core paid product, this is additive bonus data, so
  // a hiccup on this second call shouldn't fail the whole request.
  let services = null;
  let documentationUrl = null;
  let dataVisibility = null;
  if (json.machine_id != null) {
    try {
      const machineRes = await fetch(`${PEAQOS_MCR_API_URL}/machines/${json.machine_id}`);
      if (machineRes.ok) {
        const machineJson = await machineRes.json();
        services = machineJson.services ?? null;
        documentationUrl = machineJson.documentation_url ?? null;
        dataVisibility = machineJson.data_visibility ?? null;
      }
    } catch {
      // Non-fatal -- enrichment only, see comment above.
    }
  }

  return {
    source: "peaqos-mcr",
    registered: true,
    did: json.did,
    machineId: json.machine_id,
    creditRating: json.mcr,
    creditScore: json.mcr_score,
    ratingDegraded: json.mcr_degraded,
    bondStatus: json.bond_status,
    negativeFlag: json.negative_flag,
    eventCount: json.event_count,
    revenueEventCount: json.revenue_event_count,
    activityEventCount: json.activity_event_count,
    revenueTrend: json.revenue_trend,
    totalRevenueUsdCents: json.total_revenue,
    lastUpdated: json.last_updated,
    services,
    documentationUrl,
    dataVisibility,
    fetchedAt: new Date().toISOString(),
  };
}

// --- IP geolocation ---------------------------------------------------------
// Sourced from FreeIPAPI (free.freeipapi.com) -- a free, keyless IP
// geolocation lookup explicitly permitted for commercial use (no attribution
// or paid tier required for this endpoint). Verified live 2026-08-03:
// looking up 8.8.8.8 returned Mountain View, CA with lat/long, timezone,
// ASN/ISP, and a proxy flag. Rate limit on their side is 60 req/min, well
// above what a cached per-IP lookup needs. Same "no API keys" positioning as
// every other route in this file.
const IP_GEO_BASE_URL = process.env.IP_GEO_BASE_URL || "https://free.freeipapi.com/api/json";

export async function getIpGeolocation(ip) {
  const res = await fetch(`${IP_GEO_BASE_URL}/${encodeURIComponent(ip)}`);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.message || `HTTP ${res.status}`;
    throw new Error(`IP geolocation lookup failed for ${ip}: ${detail}`);
  }
  return {
    source: "freeipapi",
    ip: json.ipAddress ?? ip,
    country: json.countryName ?? null,
    countryCode: json.countryCode ?? null,
    region: json.regionName ?? null,
    city: json.cityName ?? null,
    latitude: json.latitude ?? null,
    longitude: json.longitude ?? null,
    timezone: json.timeZones?.[0] ?? null,
    isp: json.asnOrganization ?? null,
    asn: json.asn ?? null,
    isProxy: json.isProxy ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

// CoinGecko free tier — fine for a cached, low-frequency lookup. Swap for a
// paid tier if you outgrow the rate limit.
export async function getTokenPrice(symbol) {
  const idMap = {
    eth: "ethereum",
    sol: "solana",
    btc: "bitcoin",
    usdc: "usd-coin",
    pokt: "pocket-network",
    bnb: "binancecoin",
  };
  const id = idMap[symbol.toLowerCase()];
  if (!id) throw new Error(`Unsupported symbol: ${symbol}`);
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
  );
  if (!res.ok) throw new Error(`CoinGecko failed: HTTP ${res.status}`);
  const json = await res.json();
  return {
    symbol: symbol.toLowerCase(),
    usd: json[id]?.usd ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon service-demand snapshot ---------------------------------
// Sourced live from Pocket Network's public GraphQL indexer (Pocketdex).
// This is deliberately NOT a price/RPC pass-through like everything above —
// it sells relay-demand signal: which services (chains/APIs) are seeing the
// most relay volume on the Shannon network right now, which way that's
// trending, and how many suppliers are already competing to serve it. That
// makes it useful to gateway operators and suppliers deciding where to
// stake, not just to agents doing a routine lookup.
//
// Per pocket-engineering discipline: nothing here is hardcoded. Every field
// is queried fresh from the indexer on each (cache-bounded) call.
const POKT_GRAPHQL_URL = process.env.POKT_GRAPHQL_URL || "https://data.pocket.network/graphql";

async function poktGraphQL(query, variables = {}) {
  const res = await fetch(POKT_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`POKT indexer failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`POKT indexer error: ${json.errors[0].message}`);
  }
  return json.data;
}

const SERVICE_DEMAND_QUERY = `
  query ServiceDemand($first: Int!) {
    services(
      first: $first
      orderBy: NEW_NUM_RELAYS_EMA_DESC
      filter: { newNumRelaysEma: { greaterThan: "0" } }
    ) {
      nodes {
        id
        name
        computeUnitsPerRelay
        newNumRelaysEma
        prevNumRelaysEma
        supplierServiceConfigs {
          totalCount
        }
      }
    }
  }
`;

export async function getPoktServiceDemand(limit = 10) {
  // Bounded, never unbounded — Three S Framework (Scalability).
  const capped = Math.max(1, Math.min(Number(limit) || 10, 25));
  const data = await poktGraphQL(SERVICE_DEMAND_QUERY, { first: capped });
  const nodes = data?.services?.nodes ?? [];

  const services = nodes.map((s) => {
    const prev = Number(s.prevNumRelaysEma);
    const cur = Number(s.newNumRelaysEma);
    const pctChange = prev > 0 ? ((cur - prev) / prev) * 100 : null;
    const trend =
      pctChange === null ? "unknown" : pctChange > 1 ? "rising" : pctChange < -1 ? "falling" : "flat";
    return {
      serviceId: s.id,
      name: s.name,
      computeUnitsPerRelay: Number(s.computeUnitsPerRelay),
      relayVolumeEma: cur,
      prevRelayVolumeEma: prev,
      trend,
      pctChange: pctChange === null ? null : Number(pctChange.toFixed(2)),
      activeSuppliers: s.supplierServiceConfigs?.totalCount ?? 0,
    };
  });

  return {
    network: "pocket-shannon",
    source: "data.pocket.network/graphql",
    rankedBy: "relayVolumeEma",
    limit: capped,
    services,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon supplier landscape ---------------------------------------
// Supply-side complement to service-demand above: how many suppliers are
// actively staked network-wide, how much POKT is staked in total, and who
// the largest operators are. Live-verified against the indexer 2026-08-02 --
// note the doc-suggested field name "totalCount" combined with "aggregates"
// and "first" in the SAME connection call returned empty/slow results in
// testing here, so this deliberately splits into three separate aliased
// root fields (count-only, aggregates-only, first+orderBy-only) in one
// round trip instead -- each form individually verified fast and reliable.
const SUPPLIER_LANDSCAPE_QUERY = `
  query SupplierLandscape($first: Int!) {
    count: suppliers(filter: { stakeStatus: { equalTo: Staked } }) {
      totalCount
    }
    totals: suppliers(filter: { stakeStatus: { equalTo: Staked } }) {
      aggregates { sum { stakeAmount } }
    }
    top: suppliers(
      filter: { stakeStatus: { equalTo: Staked } }
      first: $first
      orderBy: STAKE_AMOUNT_DESC
    ) {
      nodes {
        operatorId
        stakeAmount
        serviceConfigs { totalCount }
      }
    }
  }
`;

export async function getPoktSupplierLandscape(limit = 10) {
  const capped = Math.max(1, Math.min(Number(limit) || 10, 25));
  const data = await poktGraphQL(SUPPLIER_LANDSCAPE_QUERY, { first: capped });

  const activeSuppliers = data?.count?.totalCount ?? 0;
  // upokt -> POKT (1 POKT = 1,000,000 upokt). BigInt to avoid precision loss
  // on network-wide sums that can run into the tens of trillions of upokt.
  const totalStakedUpokt = BigInt(data?.totals?.aggregates?.sum?.stakeAmount ?? "0");
  const topSuppliers = (data?.top?.nodes ?? []).map((s) => ({
    operatorId: s.operatorId,
    stakedPokt: Number(BigInt(s.stakeAmount)) / 1e6,
    servicesCount: s.serviceConfigs?.totalCount ?? 0,
  }));

  return {
    network: "pocket-shannon",
    source: "data.pocket.network/graphql",
    activeSuppliers,
    totalStakedPokt: Number(totalStakedUpokt) / 1e6,
    rankedBy: "stakeAmount",
    limit: capped,
    topSuppliers,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon application (demand-side) stake feed ---------------------
// Mirror of the supplier feed above but for Applications -- the actors that
// stake POKT to consume relays. Tells you who's buying network capacity and
// how much, distinct from service-demand's per-service EMA signal.
const APPLICATION_DEMAND_QUERY = `
  query ApplicationDemand($first: Int!) {
    count: applications(filter: { stakeStatus: { equalTo: Staked } }) {
      totalCount
    }
    totals: applications(filter: { stakeStatus: { equalTo: Staked } }) {
      aggregates { sum { stakeAmount } }
    }
    top: applications(
      filter: { stakeStatus: { equalTo: Staked } }
      first: $first
      orderBy: STAKE_AMOUNT_DESC
    ) {
      nodes {
        id
        stakeAmount
        applicationServices { totalCount }
      }
    }
  }
`;

export async function getPoktApplicationDemand(limit = 10) {
  const capped = Math.max(1, Math.min(Number(limit) || 10, 25));
  const data = await poktGraphQL(APPLICATION_DEMAND_QUERY, { first: capped });

  const activeApplications = data?.count?.totalCount ?? 0;
  const totalStakedUpokt = BigInt(data?.totals?.aggregates?.sum?.stakeAmount ?? "0");
  const topApplications = (data?.top?.nodes ?? []).map((a) => ({
    applicationId: a.id,
    stakedPokt: Number(BigInt(a.stakeAmount)) / 1e6,
    servicesSubscribed: a.applicationServices?.totalCount ?? 0,
  }));

  return {
    network: "pocket-shannon",
    source: "data.pocket.network/graphql",
    activeApplications,
    totalStakedPokt: Number(totalStakedUpokt) / 1e6,
    rankedBy: "stakeAmount",
    limit: capped,
    topApplications,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon tokenomics / settlement split -----------------------------
// Sourced from the LIVE Cosmos LCD governance params, never hardcoded -- the
// pocket-engineering skill's Rule 1 exists specifically because these values
// (mint ratio, the settlement split) move by governance proposal and every
// past hardcoded copy of them has gone stale. The "/pokt-network/" URL
// prefix is required; the bare path 404s.
const POKT_LCD_URL = process.env.POKT_LCD_URL || "https://sauron-api.infra.pocket.network";

async function poktLcdGet(path) {
  const res = await fetch(`${POKT_LCD_URL}${path}`);
  if (!res.ok) throw new Error(`POKT LCD ${path} failed: HTTP ${res.status}`);
  return res.json();
}

export async function getPoktTokenomics() {
  const [tokenomics, shared] = await Promise.all([
    poktLcdGet("/pokt-network/poktroll/tokenomics/params"),
    poktLcdGet("/pokt-network/poktroll/shared/params"),
  ]);

  const t = tokenomics?.params ?? {};
  const s = shared?.params ?? {};

  return {
    network: "pocket-shannon",
    source: "sauron-api.infra.pocket.network (Cosmos LCD)",
    mintRatio: t.mint_ratio ?? null,
    // The live settlement split under PIP-41 burn-equals-mint (the active
    // path today). mintAllocationPercentages only governs the legacy
    // GlobalMintTLM path -- included for completeness but only actually
    // "in effect" if globalInflationPerClaim is meaningfully > 0.
    settlementDistribution: t.mint_equals_burn_claim_distribution ?? null,
    globalInflationPerClaim: t.global_inflation_per_claim ?? null,
    mintAllocationPercentages: t.mint_allocation_percentages ?? null,
    computeUnitsToTokensMultiplier: s.compute_units_to_tokens_multiplier ?? null,
    blocksPerSession: s.num_blocks_per_session ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon throughput-by-service leaderboard -------------------------
// Ranks services by ACTUAL cumulative on-chain claimed relay/compute-unit
// volume -- distinct from service-demand's difficulty-adjusted EMA "current
// momentum" signal above. Two live findings shaped this implementation:
//   1. The indexer's dedicated `relays` connection is empty (0 rows) on this
//      deployment despite being documented -- verified directly, not assumed.
//      `msgCreateClaims` (the actual claim transactions) carries the same
//      numRelays/numClaimedComputedUnits fields and IS populated, so that's
//      the real source here.
//   2. Claim settlement is bursty per-service (confirmed live: many services
//      show zero claims in any recent rolling window even with real EMA
//      demand), so this reports ALL-TIME cumulative volume per service
//      rather than a "last 24h" figure that would show mostly zeros and
//      mislead more than it informs.
const TOP_SERVICES_QUERY = `
  query TopServices($first: Int!) {
    services(
      first: $first
      orderBy: NEW_NUM_RELAYS_EMA_DESC
      filter: { newNumRelaysEma: { greaterThan: "0" } }
    ) {
      nodes { id name }
    }
  }
`;

export async function getPoktThroughputLeaderboard(limit = 10) {
  const capped = Math.max(1, Math.min(Number(limit) || 10, 15));

  const svcData = await poktGraphQL(TOP_SERVICES_QUERY, { first: capped });
  const services = svcData?.services?.nodes ?? [];
  if (services.length === 0) {
    return {
      network: "pocket-shannon",
      source: "data.pocket.network/graphql",
      rankedBy: "cumulativeClaimedRelays",
      limit: capped,
      services: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  // One round trip for all N services via GraphQL aliases (each alias must
  // be a valid identifier, so service ids -- which can contain characters
  // like "-" -- are referenced by a safe positional alias "s0", "s1", ...
  // and mapped back to the real id from the services list above).
  const fields = services
    .map(
      (s, i) => `s${i}: service(id: "${s.id}") {
        msgCreateClaims {
          aggregates { sum { numRelays numClaimedComputedUnits numEstimatedComputedUnits } }
        }
      }`
    )
    .join("\n");
  const throughputData = await poktGraphQL(`query ThroughputBatch { ${fields} }`);

  const ranked = services
    .map((s, i) => {
      const sum = throughputData?.[`s${i}`]?.msgCreateClaims?.aggregates?.sum ?? {};
      return {
        serviceId: s.id,
        name: s.name,
        cumulativeClaimedRelays: Number(sum.numRelays ?? 0),
        cumulativeClaimedComputeUnits: Number(sum.numClaimedComputedUnits ?? 0),
        cumulativeEstimatedComputeUnits: Number(sum.numEstimatedComputedUnits ?? 0),
      };
    })
    .sort((a, b) => b.cumulativeClaimedRelays - a.cumulativeClaimedRelays);

  return {
    network: "pocket-shannon",
    source: "data.pocket.network/graphql",
    rankedBy: "cumulativeClaimedRelays",
    note: "All-time cumulative settled volume per service, not a rolling window -- claim settlement is bursty enough that short windows are frequently zero even for actively demanded services.",
    limit: capped,
    services: ranked,
    fetchedAt: new Date().toISOString(),
  };
}

// --- POKT Shannon validator security / decentralization feed ---------------
// LCD-only data (the indexer's `stakeAmount` for validators is self-stake
// only -- true voting power is total bonded `tokens`, which only the LCD
// exposes; see pocket-engineering data-access.md §5). Bonded validator set
// is small (~21 at verification time) so fetching the full set and ranking
// client-side is simple and well within the Three S Framework's
// "don't list unbounded sets" guidance -- this set just isn't large.
export async function getPoktValidatorSecurity(limit = 10) {
  const capped = Math.max(1, Math.min(Number(limit) || 10, 25));
  const json = await poktLcdGet(
    "/cosmos/staking/v1beta1/validators?pagination.limit=200&pagination.count_total=true&status=BOND_STATUS_BONDED"
  );

  const validators = (json?.validators ?? [])
    .map((v) => ({
      moniker: v.description?.moniker ?? "unknown",
      operatorAddress: v.operator_address,
      bondedTokensPokt: Number(BigInt(v.tokens ?? "0")) / 1e6,
      commissionRatePct: v.commission?.commission_rates?.rate
        ? Number(v.commission.commission_rates.rate) * 100
        : null,
      jailed: Boolean(v.jailed),
    }))
    .sort((a, b) => b.bondedTokensPokt - a.bondedTokensPokt);

  const totalBondedPokt = validators.reduce((sum, v) => sum + v.bondedTokensPokt, 0);

  return {
    network: "pocket-shannon",
    source: "sauron-api.infra.pocket.network (Cosmos LCD)",
    bondedValidatorCount: Number(json?.pagination?.total ?? validators.length),
    totalBondedPokt,
    rankedBy: "bondedTokens",
    limit: capped,
    validators: validators.slice(0, capped),
    fetchedAt: new Date().toISOString(),
  };
}

// --- UpRock real-device web fetch ------------------------------------------
// Sourced from UpRock's residential/mobile device network (edge.uprock.com,
// verified against their live API docs). UNLIKE everything else in this
// file, this is NOT free: UpRock bills in credits ($0.006/credit on paid
// tiers, first 5,000 credits/month free), so every call here has a real
// upstream cost, not just the Solana/facilitator fee. That changes the price
// floor math -- see the PLACEHOLDER note in x402Middleware.js.
//
// Requires UPROCK_API_KEY. Sign up free at https://uprock.ai (no credit
// card for the free tier) and grab a key from the dashboard -- see
// https://uprock.ai/docs/guides/getting-started/01-api_keys.
//
// What this sells: a URL fetched through an actual residential/mobile
// device somewhere in the world, so you get what a real user in that
// location sees -- not a datacenter-IP view that trips anti-bot defenses or
// gets geo-filtered content. That's UpRock's own core value prop, not a
// derived metric, so the value-add here is "who fetched it."
const UPROCK_BASE_URL = process.env.UPROCK_BASE_URL || "https://edge.uprock.com";
const UPROCK_API_KEY = process.env.UPROCK_API_KEY;

// PATCH: optional third param so callers can supply a DIFFERENT UpRock API
// key than UPROCK_API_KEY above (see UPROCK_VERIFY_API_KEY / getUprockVerify
// further down) -- defaults to the original behavior exactly when omitted,
// so the existing getUprockFetch call path below is byte-for-byte unchanged.
async function uprockRequest(path, options = {}, apiKeyOverride) {
  const apiKey = apiKeyOverride ?? UPROCK_API_KEY;
  const res = await fetch(`${UPROCK_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...options.headers,
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof json === "string" ? json : JSON.stringify(json ?? {});
    throw new Error(`UpRock ${path} failed: HTTP ${res.status} ${detail}`.trim());
  }
  return json;
}

// Crawl jobs are async on UpRock's side: submit -> poll status -> download
// result. We poll inside this one function so every caller in this project
// still gets the same synchronous shape as every other data-source function
// here -- it just means this particular call takes as long as the real
// device takes to fetch the page (typically a few seconds), bounded by
// maxWaitMs so a slow/stuck device can't hang an x402 request forever.
async function uprockCrawl(targetUrl, { timeoutSec = 20, maxWaitMs = 20000, pollMs = 1000 } = {}) {
  if (!UPROCK_API_KEY) {
    throw new Error("UPROCK_API_KEY is not set -- sign up free at https://uprock.ai to get one");
  }

  const job = await uprockRequest("/crawl/v1/new", {
    method: "POST",
    body: JSON.stringify({ url: targetUrl, method: "GET", timeout_sec: timeoutSec }),
  });

  const jobId = job.job_id;
  let status = job.status;
  const deadline = Date.now() + maxWaitMs;

  while (status !== "completed" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const check = await uprockRequest(`/crawl/v1/status/${jobId}`);
    status = check.status;
    if (status === "failed" || status === "error") {
      throw new Error(`UpRock crawl job ${jobId} failed`);
    }
  }

  if (status !== "completed") {
    throw new Error(
      `UpRock crawl job ${jobId} did not complete within ${maxWaitMs}ms (last status: ${status})`
    );
  }

  const result = await uprockRequest(`/crawl/v1/jobs/${jobId}/download`);
  return { jobId, result };
}

// SECURITY (SSRF hardening, reviewed 2026-08-04): this route accepts a
// buyer-supplied URL and hands it to UpRock's residential/mobile device
// network -- an arbitrary-fetch primitive available to anyone holding a
// stablecoin, no identity attached. The fetch itself executes on UpRock's
// device (not this container), so it isn't a classic SSRF-into-our-own-
// docker-network vector, but nothing stopped a buyer from pointing a real
// residential device at a target's internal/loopback/link-local address
// (including cloud metadata endpoints like 169.254.169.254) with zero
// filtering. This blocks the obvious literal-hostname/IP cases. It is NOT
// a complete defense: a hostname that resolves to a private/loopback address
// only at DNS time (DNS rebinding) would slip through this check, since it
// only inspects the string the buyer supplied, not what it resolves to.
// Closing that gap needs a resolve-then-recheck step (and ideally the same
// check repeated by UpRock's own crawler); flagged here, not yet built.
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "[::1]", "::1"]);
const BLOCKED_HOSTNAME_PATTERNS = [
  /^127\./, // IPv4 loopback (127.0.0.0/8)
  /^10\./, // RFC1918 private
  /^192\.168\./, // RFC1918 private
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 private (172.16.0.0/12)
  /^169\.254\./, // link-local, incl. cloud metadata (169.254.169.254)
  /^fe80:/i, // IPv6 link-local
  /^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/i, // IPv6 unique local (fc00::/7)
];
function isBlockedTarget(hostname) {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  return BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(h));
}

export async function getUprockFetch(targetUrl) {
  if (!targetUrl) throw new Error("url query param is required");
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("url must be a valid absolute URL, e.g. https://example.com");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url must use http or https");
  }
  if (isBlockedTarget(parsed.hostname)) {
    throw new Error("url must not target a localhost, private, or link-local address");
  }

  const { jobId, result } = await uprockCrawl(parsed.toString());
  // readerContent is UpRock's cleaned "reader mode" extraction (ads/nav
  // stripped); fall back to raw body if a given page didn't produce one.
  // Capped at 20k chars so one giant page doesn't blow up the response.
  const content = (result?.readerContent || result?.mainResult?.body || "").slice(0, 20000);

  return {
    source: "uprock-real-device",
    jobId,
    url: parsed.toString(),
    statusCode: result?.mainResult?.statusCode ?? null,
    success: result?.mainResult?.success ?? null,
    content,
    fetchedAt: new Date().toISOString(),
  };
}


// --- UpRock Verify (multi-region sweep) -------------------------------------
// PATCH (built 2026-08-08, staged offline -- not yet live-tested against a
// real payment, same status every other new network/route in this project
// has carried before its first real test). Sourced from the SAME
// edge.uprock.com API as getUprockFetch above, but a different UpRock
// resource: Sweep, not Crawl. A sweep launches one crawl job per region in
// parallel and returns per-region reachability, Core Web Vitals (LCP/FCP/
// CLS/TTFB), total load time, and a screenshot per region -- this is what
// UpRock's own "Verify" product is built on top of (their own API docs
// literally title this endpoint "Create a new deploy validation sweep").
// Endpoint paths confirmed directly against UpRock's live API reference
// docs 2026-08-08 (POST /crawl/v1/sweep/new, GET /crawl/v1/sweep/{id}), not
// assumed -- the status-poll path in particular does NOT follow the same
// shape as the existing crawl-job poll above (/crawl/v1/status/{id}), so
// this deliberately does not try to reuse that helper.
//
// Uses a SEPARATE API key (UPROCK_VERIFY_API_KEY) from UPROCK_API_KEY above,
// per request: separate UpRock accounts/keys per service line make it
// possible to see exactly which product line is driving UpRock credit spend
// from UpRock's own dashboard, without digging through this app's logs.
// Falls back to UPROCK_API_KEY if a dedicated key hasn't been minted yet, so
// this route doesn't hard-fail on a missing second key -- same
// graceful-degrade posture as every other optional config in this file.
const UPROCK_VERIFY_API_KEY = process.env.UPROCK_VERIFY_API_KEY || UPROCK_API_KEY;

// Bounded on purpose: an unbounded region/tries selection would turn one
// x402-paid request into an open-ended number of UpRock-billed jobs. Default
// is 3 of UpRock's 5 available regions (NA/EU/APAC -- the same three used in
// UpRock's own createSweep API example) at 1 try per region, not their API
// default of 3 tries -- this is a reachability/screenshot check, not a
// statistical load test, and every additional try is a real additional
// billed job.
const VERIFY_ALL_REGIONS = ["NA", "EU", "APAC", "LATAM", "MEA"];
const VERIFY_DEFAULT_REGIONS = ["NA", "EU", "APAC"];
const VERIFY_DEFAULT_TRIES_PER_REGION = 1;
const VERIFY_DEFAULT_TIMEOUT_SEC = 30;
// A sweep (multi-region navigation + screenshot capture) is slower than the
// plain single-page crawl getUprockFetch polls for above, so this gets a
// longer ceiling and a longer poll interval to match -- no point polling
// every second for a job that reliably takes 15-30s per region.
const VERIFY_MAX_WAIT_MS = 45000;
const VERIFY_POLL_MS = 2000;

async function uprockSweepCreate({ url, regions, triesPerRegion, timeoutSec, apiKey }) {
  return uprockRequest(
    "/crawl/v1/sweep/new",
    {
      method: "POST",
      body: JSON.stringify({
        url,
        regions,
        tries_per_region: triesPerRegion,
        timeout_sec: timeoutSec,
        device_type: "mobile",
      }),
    },
    apiKey
  );
}

async function uprockSweepStatus(sweepId, apiKey) {
  return uprockRequest(`/crawl/v1/sweep/${sweepId}`, {}, apiKey);
}

// Polls a sweep until every region reports a terminal status, bounded by
// maxWaitMs so a slow or stuck region can't hang an x402-paid request
// forever. Returns the last status payload either way (with timedOut set) --
// the caller decides what a partial/timed-out sweep means for its response,
// rather than this helper silently throwing away partial regional data.
async function pollSweepUntilDone(sweepId, apiKey, { maxWaitMs = VERIFY_MAX_WAIT_MS, pollMs = VERIFY_POLL_MS } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let last = await uprockSweepStatus(sweepId, apiKey);

  while (Date.now() < deadline) {
    const regionStatuses = Object.values(last.results || {}).map((r) => r.status);
    const allTerminal =
      regionStatuses.length > 0 &&
      regionStatuses.every((s) => s === "completed" || s === "failed" || s === "error");
    if (allTerminal || last.status === "completed" || last.status === "failed") {
      return { ...last, timedOut: false };
    }
    await new Promise((r) => setTimeout(r, pollMs));
    last = await uprockSweepStatus(sweepId, apiKey);
  }

  return { ...last, timedOut: true };
}

// Accepts a bare domain (path param, e.g. "example.com"), not a full URL --
// reuses the same SSRF hardening as getUprockFetch above (isBlockedTarget),
// since this is the same "buyer-supplied target handed to UpRock's device
// network" shape as the fetch route, just always coerced to https:// rather
// than accepting an arbitrary scheme.
export async function getUprockVerify(domain, { regions } = {}) {
  if (!domain) throw new Error("domain is required");
  const trimmed = String(domain).trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!trimmed) throw new Error("domain must not be empty");
  if (isBlockedTarget(trimmed.split(":")[0])) {
    throw new Error("domain must not be a localhost, private, or link-local address");
  }

  const selectedRegions = Array.isArray(regions) && regions.length > 0 ? regions : VERIFY_DEFAULT_REGIONS;
  const validRegions = selectedRegions.filter((r) => VERIFY_ALL_REGIONS.includes(r));
  if (validRegions.length === 0) {
    throw new Error(`regions must be one or more of ${VERIFY_ALL_REGIONS.join(", ")}`);
  }

  if (!UPROCK_VERIFY_API_KEY) {
    throw new Error(
      "UPROCK_VERIFY_API_KEY (or UPROCK_API_KEY as a fallback) is not set -- sign up free at https://uprock.ai"
    );
  }

  const targetUrl = `https://${trimmed}`;
  const created = await uprockSweepCreate({
    url: targetUrl,
    regions: validRegions,
    triesPerRegion: VERIFY_DEFAULT_TRIES_PER_REGION,
    timeoutSec: VERIFY_DEFAULT_TIMEOUT_SEC,
    apiKey: UPROCK_VERIFY_API_KEY,
  });

  const final = await pollSweepUntilDone(created.sweep_id, UPROCK_VERIFY_API_KEY);

  // Response deliberately omits the raw screenshot payload (likely base64,
  // potentially large) -- same "don't blow up the response" discipline as
  // getUprockFetch's 20k-char content cap above. hasScreenshot tells the
  // caller one was captured; fetching the actual image bytes is a future
  // extension (e.g. a signed URL or a separate download route), not built
  // here.
  const regionResults = Object.values(final.results || {}).map((r) => {
    const job = r.jobs?.[0]; // one try per region by default -- see VERIFY_DEFAULT_TRIES_PER_REGION
    return {
      region: r.region,
      status: r.status,
      country: job?.country ?? null,
      reachable: job?.status === "completed" && !job?.error_type,
      loadTimeMs: job?.metrics?.total_load_time ?? null,
      ttfbMs: job?.metrics?.ttfb ?? null,
      lcpMs: job?.metrics?.lcp ?? null,
      clsScore: job?.metrics?.cls ?? null,
      hasScreenshot: Boolean(job?.screenshot),
      errorType: job?.error_type ?? null,
      errorMessage: job?.error_message ?? null,
    };
  });

  return {
    source: "uprock-verify-sweep",
    domain: trimmed,
    url: targetUrl,
    sweepId: created.sweep_id,
    regions: regionResults,
    completedJobs: final.completed_jobs ?? null,
    failedJobs: final.failed_jobs ?? null,
    totalJobs: final.total_jobs ?? null,
    timedOut: Boolean(final.timedOut),
    fetchedAt: new Date().toISOString(),
  };
}


// ---------------------------------------------------------------------------
// brand_verify -- composite trust & safety product ($0.23/call)
//
// Bundles three things a trust/safety, compliance, brand-protection, or
// anti-fraud buyer would otherwise have to stitch together themselves:
//   1. Domain-to-IP resolution (plain DNS lookup, done inline below)
//   2. Multi-region website verification with screenshots + Core Web Vitals
//      (reuses getUprockVerify() above -- same UpRock Sweep under the hood)
//   3. IP intelligence: geolocation + proxy/VPN detection (reuses
//      getIpGeolocation() below)
// and turns them into a single 0-100 trust score + verdict, so the caller
// gets a judgment call -- "is this site live, performant, and hosted where
// it claims to be" -- not three raw data dumps to interpret themselves.
// ---------------------------------------------------------------------------
function scoreBrandVerify({ verify, geo, dnsError }) {
    let score = 0;
    const reasons = [];

  if (verify && verify.totalJobs > 0) {
        const reachableCount = (verify.regions || []).filter((r) => r.reachable).length;
        const reachablePts = Math.round((reachableCount / verify.totalJobs) * 40);
        score += reachablePts;
        reasons.push(`${reachableCount}/${verify.totalJobs} regions reachable (+${reachablePts})`);
        if (verify.timedOut) reasons.push("sweep timed out before all regions completed");
  } else {
        reasons.push("no reachability data (+0)");
  }

  const perfSamples = (verify?.regions || []).filter((r) => r.reachable && r.loadTimeMs != null);
    if (perfSamples.length) {
          const avgLoadMs = perfSamples.reduce((sum, r) => sum + r.loadTimeMs, 0) / perfSamples.length;
          let perfPts;
          if (avgLoadMs <= 1500) perfPts = 20;
          else if (avgLoadMs <= 3000) perfPts = 14;
          else if (avgLoadMs <= 5000) perfPts = 8;
          else perfPts = 2;
          score += perfPts;
          reasons.push(`avg load ${Math.round(avgLoadMs)}ms across ${perfSamples.length} region(s) (+${perfPts})`);
    } else {
          reasons.push("no performance data (+0)");
    }

  if (dnsError) {
        reasons.push("DNS resolution failed (+0)");
  } else if (geo && !geo.isProxy) {
        score += 20;
        reasons.push(`resolves to ${geo.country || "unknown location"}, no proxy/VPN detected (+20)`);
  } else if (geo && geo.isProxy) {
        score += 5;
        reasons.push("IP flagged as proxy/VPN (+5)");
  } else {
        reasons.push("no IP intelligence available (+0)");
  }

  const screenshotCount = (verify?.regions || []).filter((r) => r.hasScreenshot).length;
    if (screenshotCount > 0) {
          score += 20;
          reasons.push(`${screenshotCount} region(s) captured screenshot proof (+20)`);
    } else {
          reasons.push("no screenshot proof captured (+0)");
    }

  score = Math.max(0, Math.min(100, score));
    let verdict;
    if (score >= 80) verdict = "high-trust";
    else if (score >= 55) verdict = "moderate-trust";
    else if (score >= 30) verdict = "low-trust";
    else verdict = "untrusted";

  return { score, verdict, reasons };
}

export async function getBrandVerify(domain, { regions } = {}) {
    const trimmed = (domain || "").trim().toLowerCase();
    if (!trimmed) throw new Error("domain is required");
    if (isBlockedTarget(trimmed)) throw new Error("target host is not allowed");

  const { lookup: dnsLookup } = await import("node:dns/promises");

  let resolvedIp = null;
    let dnsError = null;
    try {
          const result = await dnsLookup(trimmed);
          resolvedIp = result.address;
    } catch (err) {
          dnsError = err.message;
    }

  const [verifyResult, geoResult] = await Promise.allSettled([
        getUprockVerify(trimmed, { regions }),
        resolvedIp ? getIpGeolocation(resolvedIp) : Promise.resolve(null),
      ]);

  const verify = verifyResult.status === "fulfilled" ? verifyResult.value : null;
    const verifyError = verifyResult.status === "rejected" ? verifyResult.reason?.message : null;
    const geo = geoResult.status === "fulfilled" ? geoResult.value : null;
    const geoError = geoResult.status === "rejected" ? geoResult.reason?.message : null;

  const trust = scoreBrandVerify({ verify, geo, dnsError });

  return {
        source: "brand-verify-composite",
        domain: trimmed,
        resolvedIp,
        dnsError,
        trustScore: trust.score,
        verdict: trust.verdict,
        scoringReasons: trust.reasons,
        verification: verify,
        verificationError: verifyError,
        ipIntelligence: geo,
        ipIntelligenceError: geoError,
        fetchedAt: new Date().toISOString(),
  };
}


// ---------------------------------------------------------------------------
// pokt-supplier-trust -- composite trust score for a POKT Shannon supplier
// ($0.05/call)
//
// Mirrors brand_verify's pattern (on-chain data + a live reachability probe,
// rolled into one 0-100 score) but applied to POKT Network suppliers instead
// of arbitrary domains. Useful to Application/gateway operators deciding
// which suppliers to route relays to: is this operator actually staked, in
// good standing, and serving traffic on the RPC endpoints it advertises --
// a judgment neither the raw on-chain stake data nor a bare uptime check
// answers alone.
//
// Schema confirmed live 2026-08-10 (not documented anywhere): Pocketdex's
// singular `supplier` query takes an `id` argument, and `id` is exactly the
// same bech32 string as `operatorId` (verified: fetching both for the same
// row returns identical values). `serviceConfigs.nodes[].endpoints` is a
// JSON scalar (an array of {url, configs, rpcType} objects, not a GraphQL
// object type) -- querying it with a sub-selection throws
// "must not have a selection since type JSON! has no subfields", confirmed
// live before writing this, not assumed from the schema shape alone.
const SUPPLIER_TRUST_QUERY = `
  query SupplierTrust($operatorId: String!) {
      supplier(id: $operatorId) {
            operatorId
                  stakeAmount
                        stakeStatus
                              unstakingReason
                                    serviceConfigs {
                                            nodes {
                                                      serviceId
                                                                endpoints
                                                                        }
                                                                              }
                                                                                  }
                                                                                    }
                                                                                    `;

// Bounded on purpose, same discipline as every other buyer-triggered probe
// in this file (see getUprockFetch/getUprockVerify's SSRF notes above): a
// supplier can advertise many endpoints across many services, and this is
// one x402-paid call, not an unbounded crawl. Reuses isBlockedTarget() so a
// malicious/misconfigured advertised endpoint can't be used to probe this
// container's internal network.
const SUPPLIER_TRUST_PROBE_TIMEOUT_MS = 4000;
const SUPPLIER_TRUST_PROBE_MAX = 5;

async function probePoktSupplierEndpoint(url) {
    let parsed;
    try {
          parsed = new URL(url);
    } catch {
          return { url, reachable: false, error: "invalid URL" };
    }
    if (!["http:", "https:"].includes(parsed.protocol) || isBlockedTarget(parsed.hostname)) {
          return { url, reachable: false, error: "blocked target" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUPPLIER_TRUST_PROBE_TIMEOUT_MS);
    const start = Date.now();
    try {
          const res = await fetch(parsed.toString(), { method: "GET", signal: controller.signal });
          return { url, reachable: true, statusCode: res.status, responseTimeMs: Date.now() - start };
    } catch (err) {
          return { url, reachable: false, error: err.name === "AbortError" ? "timeout" : err.message };
    } finally {
          clearTimeout(timeout);
    }
}

function scorePoktSupplierTrust({ supplier, endpointResults, serviceCount }) {
    if (!supplier) {
          return {
                  score: 0,
                  verdict: "not-found",
                  reasons: ["operator not found in Pocketdex -- not a registered/staked supplier"],
          };
    }

  let score = 0;
    const reasons = [];

  if (supplier.stakeStatus === "Staked") {
        score += 40;
        reasons.push("supplier is actively staked (+40)");
  } else if (supplier.stakeStatus === "Unstaking") {
        score += 15;
        reasons.push(`supplier is unstaking (${supplier.unstakingReason || "reason unknown"}) (+15)`);
  } else {
        reasons.push(`supplier stake status is ${supplier.stakeStatus || "unknown"} (+0)`);
  }

  if (endpointResults.length > 0) {
        const reachableCount = endpointResults.filter((e) => e.reachable).length;
        const pts = Math.round((reachableCount / endpointResults.length) * 40);
        score += pts;
        reasons.push(`${reachableCount}/${endpointResults.length} advertised endpoints reachable (+${pts})`);
  } else {
        reasons.push("no advertised endpoints to probe (+0)");
  }

  if (serviceCount >= 3) {
        score += 20;
        reasons.push(`staked for ${serviceCount} distinct services (+20)`);
  } else if (serviceCount >= 1) {
        score += 10;
        reasons.push(`staked for ${serviceCount} service(s) (+10)`);
  } else {
        reasons.push("no services configured (+0)");
  }

  score = Math.max(0, Math.min(100, score));
    let verdict;
    if (score >= 80) verdict = "high-trust";
    else if (score >= 55) verdict = "moderate-trust";
    else if (score >= 30) verdict = "low-trust";
    else verdict = "untrusted";

  return { score, verdict, reasons };
}

export async function getPoktSupplierTrust(operatorId) {
    const trimmed = String(operatorId || "").trim();
    if (!trimmed) throw new Error("operatorId is required");

  const data = await poktGraphQL(SUPPLIER_TRUST_QUERY, { operatorId: trimmed });
    const supplier = data?.supplier ?? null;

  const serviceNodes = supplier?.serviceConfigs?.nodes ?? [];
    const serviceCount = serviceNodes.length;

  const allEndpointUrls = serviceNodes.flatMap((s) =>
        (Array.isArray(s.endpoints) ? s.endpoints : []).map((e) => e?.url).filter(Boolean)
                                                 );
    const probeUrls = allEndpointUrls.slice(0, SUPPLIER_TRUST_PROBE_MAX);
    const endpointResults = await Promise.all(probeUrls.map((url) => probePoktSupplierEndpoint(url)));

  const trust = scorePoktSupplierTrust({ supplier, endpointResults, serviceCount });

  return {
        source: "pokt-supplier-trust",
        operatorId: trimmed,
        found: Boolean(supplier),
        stakeStatus: supplier?.stakeStatus ?? null,
        stakedPokt: supplier ? Number(BigInt(supplier.stakeAmount ?? "0")) / 1e6 : null,
        unstakingReason: supplier?.unstakingReason ?? null,
        services: serviceNodes.map((s) => s.serviceId),
        endpointsProbed: endpointResults,
        endpointsTotalAdvertised: allEndpointUrls.length,
        trustScore: trust.score,
        verdict: trust.verdict,
        scoringReasons: trust.reasons,
        fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// x402_seller_trust -- composite trust score for an x402 SELLER (not POKT).
// Given a seller's base URL (e.g. "https://example.com:8443"), scores
// whether this looks like a real, actually-used, currently-live x402
// marketplace listing -- not a POKT supplier, and not a bare-domain brand
// check (this needs the full base URL since sellers commonly run on
// non-standard ports, same as this project's own :8443).
//
// Design doc: X402-SELLER-TRUST-ARCHITECTURE.md. Four pillars:
//   1. Bazaar usage/social proof (real settled-payment call/payer counts,
//      free and keyless from Coinbase's own discovery index) -- 35 pts
//   2. Live reachability / 402 conformance probe of the seller's own
//      advertised resources -- 25 pts
//   3. Seller's own /.well-known/x402 manifest quality/completeness -- 15 pts
//   4. Hosting legitimacy (DNS + IP intelligence, reuses brand_verify's
//      exact logic) -- 15 pts
// plus listing freshness -- 10 pts.
//
// Known limitation, disclosed in the response itself, not just here: Bazaar
// quality data only covers payments settled through Coinbase's CDP
// facilitator. A seller using a different/self-hosted facilitator (this
// project's own peaq route is a real example) will show zero Bazaar usage
// despite being legitimately paid elsewhere -- this route can't see that.
// ---------------------------------------------------------------------------

const BAZAAR_SEARCH_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search";
const BAZAAR_LOOKUP_TIMEOUT_MS = 6000;

async function queryBazaarDiscovery(hostname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BAZAAR_LOOKUP_TIMEOUT_MS);
  try {
    const url = `${BAZAAR_SEARCH_URL}?query=${encodeURIComponent(hostname)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { matched: false, error: `Bazaar search returned ${res.status}`, routes: [] };
    }
    const body = await res.json();
    const all = Array.isArray(body?.resources) ? body.resources : [];
    // /search is fuzzy/hybrid (matches descriptions too), so filter
    // client-side to only resources whose own hostname exactly matches the
    // target -- an unfiltered result set will include false positives.
    const matched = all.filter((r) => {
      try {
        return new URL(r.resource).hostname.toLowerCase() === hostname.toLowerCase();
      } catch {
        return false;
      }
    });
    return { matched: matched.length > 0, error: null, routes: matched };
  } catch (err) {
    return { matched: false, error: err.name === "AbortError" ? "timeout" : err.message, routes: [] };
  } finally {
    clearTimeout(timeout);
  }
}

const MANIFEST_FETCH_TIMEOUT_MS = 5000;

async function fetchManifestAt(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANIFEST_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSellerManifest(baseUrl) {
  const trimmedBase = baseUrl.replace(/\/$/, "");
  const manifest =
    (await fetchManifestAt(`${trimmedBase}/.well-known/x402`)) ??
    (await fetchManifestAt(`${trimmedBase}/.well-known/x402.json`));
  if (!manifest) {
    return { found: false, resources: [], resourceCount: 0, wellFormedCount: 0, hasX402Version: false };
  }
  const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
  const wellFormedCount = resources.filter((r) => {
    const accepts = Array.isArray(r.accepts) ? r.accepts : [];
    return accepts.length > 0 && accepts.every((a) => a.network && a.payTo && a.price);
  }).length;
  return {
    found: true,
    hasX402Version: Boolean(manifest.x402Version),
    resourceCount: resources.length,
    wellFormedCount,
    resources,
  };
}

// Bounded on purpose, same discipline as every other buyer-triggered probe
// in this file -- a seller can advertise many resources and this is one
// x402-paid call, not an unbounded crawl. Reuses isBlockedTarget() so a
// malicious/misconfigured advertised resource can't be used to probe this
// container's internal network.
const SELLER_TRUST_PROBE_TIMEOUT_MS = 4000;
const SELLER_TRUST_PROBE_MAX = 3;

async function probeSellerResource(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { url, checkedOk: false, error: "invalid URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol) || isBlockedTarget(parsed.hostname)) {
    return { url, checkedOk: false, error: "blocked target" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SELLER_TRUST_PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(parsed.toString(), { method: "GET", signal: controller.signal });
    const responseTimeMs = Date.now() - start;
    let hasAcceptsArray = false;
    if (res.status === 402) {
      try {
        const body = await res.json();
        hasAcceptsArray = Array.isArray(body?.accepts) && body.accepts.length > 0;
      } catch {
        hasAcceptsArray = false;
      }
    }
    return {
      url,
      checkedOk: true,
      statusCode: res.status,
      is402: res.status === 402,
      hasAcceptsArray,
      responseTimeMs,
    };
  } catch (err) {
    return { url, checkedOk: false, error: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timeout);
  }
}

function scoreX402SellerTrust({ bazaar, manifest, probeResults, dnsError, geo }) {
  if (!bazaar.matched && !manifest.found) {
    return {
      score: 0,
      verdict: "not-found",
      reasons: ["not listed on Bazaar and no live x402 manifest found at this URL"],
    };
  }

  let score = 0;
  const reasons = [];

  if (bazaar.matched) {
    const totalCalls = bazaar.routes.reduce((sum, r) => sum + (r.quality?.l30DaysTotalCalls || 0), 0);
    const uniquePayers = Math.max(0, ...bazaar.routes.map((r) => r.quality?.l30DaysUniquePayers || 0));
    let usagePts;
    if (totalCalls >= 1000 && uniquePayers >= 10) usagePts = 35;
    else if (totalCalls >= 100 && uniquePayers >= 3) usagePts = 25;
    else if (totalCalls >= 10) usagePts = 15;
    else if (totalCalls > 0) usagePts = 8;
    else usagePts = 3;
    score += usagePts;
    reasons.push(
      `${bazaar.routes.length} route(s) on Bazaar, ${totalCalls} calls / ${uniquePayers} unique payers in 30d (+${usagePts})`
    );
  } else {
    reasons.push(bazaar.error ? `Bazaar lookup failed: ${bazaar.error} (+0)` : "not listed on Bazaar (+0)");
  }

  if (probeResults.length > 0) {
    const conformant = probeResults.filter((p) => p.checkedOk && p.is402 && p.hasAcceptsArray).length;
    const pts = Math.round((conformant / probeResults.length) * 25);
    score += pts;
    reasons.push(`${conformant}/${probeResults.length} probed resource(s) returned a live 402 paywall (+${pts})`);
  } else {
    reasons.push("no resources available to probe (+0)");
  }

  if (manifest.found) {
    let manifestPts = 5;
    if (manifest.hasX402Version) manifestPts += 3;
    if (manifest.resourceCount > 0) {
      const completeness = manifest.wellFormedCount / manifest.resourceCount;
      manifestPts += Math.round(completeness * 7);
    }
    manifestPts = Math.min(15, manifestPts);
    score += manifestPts;
    reasons.push(
      `manifest live with ${manifest.resourceCount} listed resource(s), ${manifest.wellFormedCount} well-formed (+${manifestPts})`
    );
  } else {
    reasons.push("no /.well-known/x402 manifest reachable (+0)");
  }

  if (dnsError) {
    reasons.push("DNS resolution failed (+0)");
  } else if (geo && !geo.isProxy) {
    score += 15;
    reasons.push(`resolves to ${geo.country || "unknown location"}, no proxy/VPN detected (+15)`);
  } else if (geo && geo.isProxy) {
    score += 4;
    reasons.push("IP flagged as proxy/VPN (+4)");
  } else {
    reasons.push("no IP intelligence available (+0)");
  }

  const lastCalledDates = bazaar.routes
    .map((r) => r.quality?.lastCalledAt)
    .filter(Boolean)
    .map((d) => new Date(d).getTime());
  if (lastCalledDates.length > 0) {
    const mostRecent = Math.max(...lastCalledDates);
    const daysSince = (Date.now() - mostRecent) / (1000 * 60 * 60 * 24);
    let freshPts;
    if (daysSince <= 7) freshPts = 10;
    else if (daysSince <= 30) freshPts = 6;
    else if (daysSince <= 90) freshPts = 2;
    else freshPts = 0;
    score += freshPts;
    reasons.push(`last paid call ${Math.round(daysSince)} day(s) ago (+${freshPts})`);
  } else {
    reasons.push("no call history to judge freshness (+0)");
  }

  score = Math.max(0, Math.min(100, score));
  let verdict;
  if (score >= 80) verdict = "high-trust";
  else if (score >= 55) verdict = "moderate-trust";
  else if (score >= 30) verdict = "low-trust";
  else verdict = "untrusted";

  return { score, verdict, reasons };
}

export async function getX402SellerTrust(baseUrl) {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) throw new Error("baseUrl is required");
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("baseUrl must be a valid absolute URL, e.g. https://example.com:8443");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("baseUrl must use http or https");
  }
  if (isBlockedTarget(parsed.hostname)) {
    throw new Error("baseUrl must not target a localhost, private, or link-local address");
  }
  const hostname = parsed.hostname;
  const trimmedBase = trimmed.replace(/\/$/, "");

  const { lookup: dnsLookup } = await import("node:dns/promises");
  let resolvedIp = null;
  let dnsError = null;
  try {
    const result = await dnsLookup(hostname);
    resolvedIp = result.address;
  } catch (err) {
    dnsError = err.message;
  }

  const [bazaarResult, manifestResult, geoResult] = await Promise.allSettled([
    queryBazaarDiscovery(hostname),
    fetchSellerManifest(trimmedBase),
    resolvedIp ? getIpGeolocation(resolvedIp) : Promise.resolve(null),
  ]);

  const bazaar =
    bazaarResult.status === "fulfilled"
      ? bazaarResult.value
      : { matched: false, error: bazaarResult.reason?.message, routes: [] };
  const manifest =
    manifestResult.status === "fulfilled"
      ? manifestResult.value
      : { found: false, resources: [], resourceCount: 0, wellFormedCount: 0, hasX402Version: false };
  const geo = geoResult.status === "fulfilled" ? geoResult.value : null;
  const geoError = geoResult.status === "rejected" ? geoResult.reason?.message : null;

  const bazaarUrls = bazaar.routes.map((r) => r.resource).filter(Boolean);
  const manifestUrls = (manifest.resources || []).map((r) => r.resource).filter(Boolean);
  const candidateUrls = [...new Set([...bazaarUrls, ...manifestUrls])].slice(0, SELLER_TRUST_PROBE_MAX);
  const probeResults = await Promise.all(candidateUrls.map((url) => probeSellerResource(url)));

  const trust = scoreX402SellerTrust({ bazaar, manifest, probeResults, dnsError, geo });

  return {
    source: "x402-seller-trust-composite",
    baseUrl: trimmedBase,
    hostname,
    resolvedIp,
    dnsError,
    bazaarListed: bazaar.matched,
    bazaarRouteCount: bazaar.routes.length,
    bazaarTotal30dCalls: bazaar.routes.reduce((sum, r) => sum + (r.quality?.l30DaysTotalCalls || 0), 0),
    bazaarLookupError: bazaar.error,
    manifestReachable: manifest.found,
    manifestResourceCount: manifest.resourceCount || 0,
    resourcesProbed: probeResults,
    ipIntelligence: geo,
    ipIntelligenceError: geoError,
    trustScore: trust.score,
    verdict: trust.verdict,
    scoringReasons: trust.reasons,
    fetchedAt: new Date().toISOString(),
  };
}
// --- Headless-Chrome screenshot render (Puppeteer) --------------------------
// PATCH (2026-08-15): backs GET /v1/render/screenshot. Unlike every other
// route in this file, the actual rendering work happens in a SEPARATE
// container (puppeteer-render.js) -- headless Chrome's resource footprint
// (100-300MB RAM, real CPU per render) is a different order of magnitude
// than this file's lightweight RPC/API pass-throughs, so it's isolated in
// its own service instead of run in this process. See puppeteer-render.js
// for the full "why a separate container" rationale, and docker-compose.yml
// for how the two containers are wired together.
//
// SSRF hardening: reuses the exact same isBlockedTarget() denylist that
// guards getUprockFetch/getX402SellerTrust above -- a caller-supplied URL is
// checked here, BEFORE it's ever handed to the render service, not inside
// that service (same "check once, at the edge closest to the caller"
// pattern already established in this file).
const PUPPETEER_RENDER_URL = process.env.PUPPETEER_RENDER_URL || "http://puppeteer-render:3002";
// Above puppeteer-render.js's own 15s navigation timeout, so THAT service's
// more specific error (e.g. "render failed: Navigation timeout...") surfaces
// to the caller instead of this file's generic "unreachable" message racing
// it.
const RENDER_TIMEOUT_MS = 20_000;

export async function getPuppeteerScreenshot(targetUrl) {
  if (!targetUrl) throw new Error("url query param is required");
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("url must be a valid absolute URL, e.g. https://example.com");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url must use http or https");
  }
  if (isBlockedTarget(parsed.hostname)) {
    throw new Error("url must not target a localhost, private, or link-local address");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${PUPPETEER_RENDER_URL}/screenshot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: parsed.toString() }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`puppeteer-render service unreachable: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `puppeteer-render service returned HTTP ${res.status}`);
  }

  return {
    source: "puppeteer-screenshot",
    url: parsed.toString(),
    statusCode: json.statusCode ?? null,
    width: json.width,
    height: json.height,
    screenshotBase64: json.screenshotBase64,
    renderedAt: new Date().toISOString(),
  };
}

// --- HEIC to PNG conversion --------------------------------------------
// PATCH (2026-08-15): backs GET /v1/convert/heic-to-png. Straightforward
// utility conversion -- fetches a caller-supplied HEIC/HEIF image and
// returns it re-encoded as PNG, base64 in JSON (same response shape as
// getPuppeteerScreenshot() above, for the same reason: keeps every route
// on this server returning JSON rather than introducing a second, binary-
// response code path in server.js).
//
// Uses heic-convert (pure JavaScript -- wraps libheif-js, a WASM build of
// libheif, plus pngjs/jpeg-js for encoding) instead of a native binding
// like sharp's libvips. No system libraries to apk-install, no separate
// container needed the way puppeteer-render needed one above -- this runs
// fine in-process on the existing node:20-alpine image with a single
// `npm install`.
//
// SSRF hardening: reuses the exact same isBlockedTarget() denylist as
// every other buyer-supplied-URL route in this file.
import convert from "heic-convert";

// 20MB is generous for a phone photo and bounds memory: an unbounded
// upstream response decoded straight into memory is a real way to OOM
// this container, same class of risk flagged for the buyer-supplied-URL
// routes above (getUprockFetch, getPuppeteerScreenshot).
const HEIC_MAX_INPUT_BYTES = 20 * 1024 * 1024;

// Minimal, dependency-free PNG dimension reader -- IHDR is always the
// first chunk; width/height are big-endian uint32s at a fixed offset
// right after the 8-byte PNG signature + 4-byte chunk length + 4-byte
// "IHDR" tag. Avoids pulling in a second image library just to report
// width/height back to the caller.
function readPngDimensions(buffer) {
  if (buffer.length < 24) return { width: null, height: null };
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export async function getHeicToPng(targetUrl) {
  if (!targetUrl) throw new Error("url query param is required");
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("url must be a valid absolute URL, e.g. https://example.com/photo.heic");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url must use http or https");
  }
  if (isBlockedTarget(parsed.hostname)) {
    throw new Error("url must not target a localhost, private, or link-local address");
  }

  const res = await fetch(parsed.toString());
  if (!res.ok) {
    throw new Error(`failed to fetch source image: HTTP ${res.status}`);
  }
  const declaredLength = Number(res.headers.get("content-length") || 0);
  if (declaredLength > HEIC_MAX_INPUT_BYTES) {
    throw new Error(`source image is too large (${declaredLength} bytes, max ${HEIC_MAX_INPUT_BYTES})`);
  }
  const inputBuffer = Buffer.from(await res.arrayBuffer());
  if (inputBuffer.length > HEIC_MAX_INPUT_BYTES) {
    throw new Error(`source image is too large (${inputBuffer.length} bytes, max ${HEIC_MAX_INPUT_BYTES})`);
  }

  let outputBuffer;
  try {
    outputBuffer = await convert({ buffer: inputBuffer, format: "PNG" });
  } catch (err) {
    throw new Error(`HEIC decode failed: ${err.message}`);
  }

  const { width, height } = readPngDimensions(outputBuffer);

  return {
    source: "heic-to-png",
    url: parsed.toString(),
    width,
    height,
    pngBase64: outputBuffer.toString("base64"),
    convertedAt: new Date().toISOString(),
  };
}


// --- Web search (self-hosted SearXNG) --------------------------------------
// PATCH (2026-08-16): backs GET /v1/search/web. Unlike every URL-fetching
// route above, this takes a caller-supplied QUERY STRING, not a URL -- there
// is no buyer-controlled target host to SSRF-check here, since the only
// thing this route ever fetches is our own internal searxng service.
//
// Runs its own SearXNG instance (see docker-compose.yml's searxng service)
// rather than paying a third-party search API per call -- SearXNG is a free,
// open-source metasearch engine that aggregates results from 70+ upstream
// engines (Google, Bing, DuckDuckGo, etc.) with no API key. Same "own the
// infra, keep the margin" reasoning as heic-convert above, but packaged as
// its own container (like puppeteer-render) rather than an in-process npm
// package, since SearXNG ships as a ready-made Docker image -- there's
// nothing to npm-install here.
//
// Known caveat, disclosed honestly: SearXNG works by scraping the HTML
// result pages of upstream search engines. That's inherently less stable
// than a real search API -- an upstream engine changing its markup, or
// rate-limiting/blocking this box's IP, can degrade or break results
// without warning. Acceptable for this project's current volume; revisit
// (e.g. swap in a paid engine like Tavily/Brave behind the same route
// signature) if reliability becomes a real problem.
const SEARXNG_URL = process.env.SEARXNG_URL || "http://searxng:8080";
const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_RESULT_LIMIT = 10;
const SEARCH_QUERY_MAX_LEN = 500;

export async function getWebSearch(query, { limit } = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed) throw new Error("q query param is required");
  if (trimmed.length > SEARCH_QUERY_MAX_LEN) {
    throw new Error(`q must be ${SEARCH_QUERY_MAX_LEN} characters or fewer`);
  }
  const capped = Math.max(1, Math.min(Number(limit) || SEARCH_RESULT_LIMIT, SEARCH_RESULT_LIMIT));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let res;
  try {
    const url = `${SEARXNG_URL}/search?q=${encodeURIComponent(trimmed)}&format=json`;
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new Error(`searxng service unreachable: ${err.name === "AbortError" ? "timeout" : err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`searxng service returned HTTP ${res.status}`);
  }
  const json = await res.json().catch(() => ({}));
  const rawResults = Array.isArray(json.results) ? json.results : [];

  const results = rawResults.slice(0, capped).map((r) => ({
    title: r.title ?? null,
    url: r.url ?? null,
    snippet: r.content ?? null,
    engine: r.engine ?? null,
  }));

  return {
    source: "searxng",
    query: trimmed,
    resultCount: results.length,
    results,
    fetchedAt: new Date().toISOString(),
  };
}

// --- ERC-8004 agent reputation ----------------------------------------------
// PATCH (2026-08-16): backs GET /v1/agent/reputation/:agentId. Looks up an
// AI agent's on-chain identity + aggregated feedback via the ERC-8004
// "Trustless Agents" standard (eips.ethereum.org/EIPS/eip-8004) -- distinct
// from every other trust route in this file: getBrandVerify/getX402SellerTrust
// score DOMAINS/SELLERS, getPoktSupplierTrust scores POKT infrastructure
// operators, getPeaqMachineVerification verifies IoT/machine identity --
// none of them answer "does this AI AGENT have a real track record."
//
// Registry addresses confirmed directly from erc-8004/erc-8004-contracts's
// README (github.com/erc-8004/erc-8004-contracts), not assumed -- both
// registries are deployed via CREATE2 at the SAME address on every chain
// they support (Ethereum, Base, BSC, Polygon, Arbitrum, and others), which
// is why this route can support multiple chains with zero new
// contract-address configuration.
import { Interface } from "ethers";

const ERC8004_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const ERC8004_REPUTATION_REGISTRY = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

// Reuses this project's existing ETH_RPC_URL/BSC_RPC_URL -- ERC-8004 has no
// live deployment on peaq or Solana, so those two are the only chains this
// route can serve without adding a brand-new RPC env var.
function erc8004RpcUrl(chainKey) {
  if (chainKey === "eth") return ETH_RPC_URL;
  if (chainKey === "bsc") return BSC_RPC_URL;
  return null;
}

// Minimal read-only ABI -- just the functions this route calls. ethers is
// used ONLY for its ABI encoder/decoder (encodeFunctionData /
// decodeFunctionResult); the actual JSON-RPC round trip reuses this file's
// existing rpcCall() helper, the same one every other eth_call in this file
// goes through, rather than pulling in ethers' own Provider/network stack.
const ERC8004_IDENTITY_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
];
const ERC8004_REPUTATION_ABI = [
  "function getClients(uint256 agentId) view returns (address[])",
  "function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)",
];
const erc8004IdentityIface = new Interface(ERC8004_IDENTITY_ABI);
const erc8004ReputationIface = new Interface(ERC8004_REPUTATION_ABI);

async function erc8004Call(rpcUrl, to, iface, fn, args) {
  const data = iface.encodeFunctionData(fn, args);
  const resultHex = await rpcCall(rpcUrl, "eth_call", [{ to, data }, "latest"]);
  return iface.decodeFunctionResult(fn, resultHex);
}

// Bounded on purpose, same discipline as every other probe/aggregate route
// in this file -- an agent with an unusually large feedback history
// shouldn't turn one x402-paid call into unbounded client-side processing.
const ERC8004_MAX_FEEDBACK_ENTRIES = 2000;

export async function getAgentReputation(agentIdRaw, { chain = "eth" } = {}) {
  const chainKey = String(chain || "eth").toLowerCase();
  const rpcUrl = erc8004RpcUrl(chainKey);
  if (!rpcUrl) {
    throw new Error(
      "chain must be 'eth' or 'bsc' -- ERC-8004 has no live deployment on this project's other supported chains"
    );
  }

  let agentId;
  try {
    agentId = BigInt(String(agentIdRaw));
    if (agentId < 0n) throw new Error("negative");
  } catch {
    throw new Error("agentId must be a non-negative integer");
  }

  let owner;
  try {
    [owner] = await erc8004Call(rpcUrl, ERC8004_IDENTITY_REGISTRY, erc8004IdentityIface, "ownerOf", [agentId]);
  } catch {
    // Revert (ERC721NonexistentToken or equivalent) -- not a registered
    // agent. Same "not-found is a legitimate answer, not an upstream
    // failure" posture as getPeaqMachineVerification's 404 case above.
    return {
      source: "erc8004-agent-reputation",
      chain: chainKey,
      agentId: agentId.toString(),
      registered: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  const [agentURI] = await erc8004Call(rpcUrl, ERC8004_IDENTITY_REGISTRY, erc8004IdentityIface, "tokenURI", [agentId]);
  const [agentWallet] = await erc8004Call(
    rpcUrl,
    ERC8004_IDENTITY_REGISTRY,
    erc8004IdentityIface,
    "getAgentWallet",
    [agentId]
  );
  const [clients] = await erc8004Call(rpcUrl, ERC8004_REPUTATION_REGISTRY, erc8004ReputationIface, "getClients", [
    agentId,
  ]);

  // Empty clientAddresses array makes the contract itself default to its
  // full stored client list; empty tag1/tag2 strings mean "no filter" --
  // both confirmed directly from ReputationRegistryUpgradeable.sol source
  // (the contract compares keccak256(tag) against keccak256("") to decide
  // whether to skip filtering at all), not assumed from the written spec.
  const [, , values, valueDecimals, tag1s, , revokedStatuses] = await erc8004Call(
    rpcUrl,
    ERC8004_REPUTATION_REGISTRY,
    erc8004ReputationIface,
    "readAllFeedback",
    [agentId, [], "", "", false]
  );

  const cap = Math.min(values.length, ERC8004_MAX_FEEDBACK_ENTRIES);
  const truncated = values.length > ERC8004_MAX_FEEDBACK_ENTRIES;

  // Grouped by tag1 -- blending unrelated signals (e.g. "uptime" percentages
  // with "starred" 0-100 ratings) into one average would be close to
  // meaningless, same reasoning that keeps every other composite score in
  // this file (brand-verify, seller-trust, supplier-trust) broken into
  // named pillars rather than one raw blended number.
  const byTag = new Map();
  for (let i = 0; i < cap; i++) {
    if (revokedStatuses[i]) continue;
    const tag = tag1s[i] || "(untagged)";
    const decimals = Number(valueDecimals[i]);
    const normalized = Number(values[i]) / 10 ** decimals;
    const bucket = byTag.get(tag) || { tag1: tag, count: 0, sum: 0 };
    bucket.count += 1;
    bucket.sum += normalized;
    byTag.set(tag, bucket);
  }
  const feedbackByTag = Array.from(byTag.values()).map((b) => ({
    tag1: b.tag1,
    count: b.count,
    averageValue: Number((b.sum / b.count).toFixed(4)),
  }));
  const feedbackCount = feedbackByTag.reduce((sum, b) => sum + b.count, 0);

  // Best-effort: the agent's registration file (name/description/services),
  // fetched only if agentURI is a plain https:// URL -- ipfs:// and
  // data:application/json;base64 URIs are valid per the ERC-8004 spec but
  // out of scope for v1 (no IPFS gateway wired up yet). Non-fatal on
  // failure, same posture as getPeaqMachineVerification's /machines
  // enrichment call above.
  let registrationFile = null;
  if (agentURI && agentURI.startsWith("https://")) {
    try {
      const parsedUri = new URL(agentURI);
      if (!isBlockedTarget(parsedUri.hostname)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const res = await fetch(agentURI, { signal: controller.signal });
          if (res.ok) {
            const json = await res.json();
            registrationFile = {
              name: json.name ?? null,
              description: json.description ?? null,
              services: Array.isArray(json.services) ? json.services : [],
              x402Support: json.x402Support ?? null,
              active: json.active ?? null,
            };
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch {
      // Non-fatal -- enrichment only.
    }
  }

  return {
    source: "erc8004-agent-reputation",
    chain: chainKey,
    agentId: agentId.toString(),
    registered: true,
    owner,
    agentWallet: agentWallet === "0x0000000000000000000000000000000000000000" ? null : agentWallet,
    agentURI: agentURI || null,
    registrationFile,
    uniqueClients: clients.length,
    feedbackCount,
    feedbackByTag,
    feedbackTruncated: truncated,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Tier A historical/indexed chain data (2026-08-16) ----------------------
// "Tier A" = zero new dependencies, zero new containers, zero new env vars --
// reuses the exact same ETH_RPC_URL / SOL_RPC_URL already wired up above.
// Scoped to ETH + Solana only for this round (BSC and peaq deferred -- their
// free-tier indexer/API situations are unverified, see README). Both routes
// are deliberately bounded to "recent" history, not full-archive: public RPC
// providers reject eth_getLogs queries over some undocumented block-range
// ceiling (varies 100-100,000 blocks by provider, no way to know llamarpc's
// specific number without hitting it in production), and getSignaturesForAddress
// has a hard 1000-signature ceiling built into the Solana RPC spec itself.
// Rather than guess a provider's exact limit, both routes clamp their own
// request to a conservative worst-case-safe size server-side, so a caller
// can never accidentally trigger a provider-side rejection.

const ETH_LOGS_MAX_BLOCKS = 1000; // conservative floor seen across providers
const ETH_LOGS_MAX_RESULTS = 500; // cap the response payload, not just the range

function toBlockHex(n) {
  return "0x" + Math.max(0, Math.trunc(n)).toString(16);
}

// INCIDENT (2026-08-16, live-test follow-up): the block-range clamp above
// is not enough on its own. First live test against a real high-traffic
// contract (USDC) failed even at a 1000-block window:
//   RPC eth_getLogs error: query exceeds max results 20000, retry with the
//   range 25768071-25768348
// llamarpc enforces a RESULT-COUNT ceiling (20,000 logs) independent of
// block range -- a busy-enough contract can blow past that in far fewer
// than 1000 blocks (this error's own suggested retry range was ~277
// blocks). No fixed block-count cap can fully solve this: an even busier
// contract could exceed 20k logs in 10 blocks. Fix: catch this specific
// rejection and narrow the range instead of failing outright. llamarpc's
// error conveniently names an exact working range -- use it directly when
// present; fall back to halving the window (bounded attempts) for
// providers/errors that don't.
const ETH_LOGS_RETRY_RANGE_REGEX = /retry with the range[:\s]*(\d+)\s*-\s*(\d+)/i;
const ETH_LOGS_MAX_NARROW_ATTEMPTS = 5;
const ETH_LOGS_MIN_RANGE = 10; // give up narrowing below this -- contract is too hot for this endpoint right now

async function fetchEthLogsWithNarrowing(baseFilter, fromBlock, toBlock) {
  let attemptFrom = fromBlock;
  let attemptTo = toBlock;
  let lastErr;
  for (let attempt = 0; attempt < ETH_LOGS_MAX_NARROW_ATTEMPTS; attempt++) {
    try {
      const filter = { ...baseFilter, fromBlock: toBlockHex(attemptFrom), toBlock: toBlockHex(attemptTo) };
      const logs = await rpcCall(ETH_RPC_URL, "eth_getLogs", [filter]);
      return { logs, fromBlock: attemptFrom, toBlock: attemptTo };
    } catch (err) {
      lastErr = err;
      const match = err.message.match(ETH_LOGS_RETRY_RANGE_REGEX);
      const suggestedFrom = match ? parseInt(match[1], 10) : NaN;
      const suggestedTo = match ? parseInt(match[2], 10) : NaN;
      if (Number.isFinite(suggestedFrom) && Number.isFinite(suggestedTo) && suggestedTo > suggestedFrom) {
        attemptFrom = suggestedFrom;
        attemptTo = suggestedTo;
        continue;
      }
      // No usable suggested range (or the suggestion itself later failed) --
      // halve the window, anchored to the same toBlock, and try again.
      const span = attemptTo - attemptFrom;
      if (span <= ETH_LOGS_MIN_RANGE) break;
      attemptFrom = attemptTo - Math.floor(span / 2);
    }
  }
  throw lastErr;
}

export async function getEthLogs(addressRaw, { topic0: topic0Raw, blocks: blocksRaw } = {}) {
  const address = String(addressRaw || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("address must be a 0x-prefixed 20-byte Ethereum address");
  }

  let topic0;
  if (topic0Raw !== undefined && topic0Raw !== null && String(topic0Raw).trim() !== "") {
    topic0 = String(topic0Raw).trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(topic0)) {
      throw new Error("topic0 must be a 0x-prefixed 32-byte event signature hash");
    }
  }

  // Always clamp, never reject -- a caller asking for 50000 blocks just gets
  // the max safe window back rather than an error, same "forgiving input"
  // posture as getWebSearch's limit clamping above.
  const blocksRequested = Number(blocksRaw) || 500;
  const blocksSearched = Math.max(1, Math.min(Math.trunc(blocksRequested), ETH_LOGS_MAX_BLOCKS));

  const latestHex = await rpcCall(ETH_RPC_URL, "eth_blockNumber");
  const latest = parseInt(latestHex, 16);
  const fromBlock = Math.max(0, latest - blocksSearched);

  const baseFilter = { address };
  if (topic0) baseFilter.topics = [topic0];

  const { logs: rawLogs, fromBlock: actualFromBlock, toBlock: actualToBlock } = await fetchEthLogsWithNarrowing(
    baseFilter,
    fromBlock,
    latest
  );
  const narrowedDueToActivity = actualFromBlock !== fromBlock || actualToBlock !== latest;

  const truncated = rawLogs.length > ETH_LOGS_MAX_RESULTS;
  const logs = rawLogs.slice(0, ETH_LOGS_MAX_RESULTS).map((l) => ({
    address: l.address,
    topics: l.topics,
    data: l.data,
    blockNumber: parseInt(l.blockNumber, 16),
    transactionHash: l.transactionHash,
    logIndex: parseInt(l.logIndex, 16),
    removed: !!l.removed,
  }));

  return {
    source: "eth-logs",
    chain: "ethereum",
    address,
    topic0: topic0 || null,
    fromBlock: actualFromBlock,
    toBlock: actualToBlock,
    blocksSearched: actualToBlock - actualFromBlock,
    blocksRequested: blocksSearched,
    narrowedDueToActivity,
    logCount: logs.length,
    truncated,
    logs,
    note: narrowedDueToActivity
      ? `contract activity was too high for the requested ${blocksSearched}-block window -- automatically narrowed to ${actualToBlock - actualFromBlock} blocks to stay under the RPC provider's result-count ceiling; recent history only, not a full-archive query`
      : `bounded to the most recent ${ETH_LOGS_MAX_BLOCKS} blocks -- recent history only, not a full-archive query`,
    fetchedAt: new Date().toISOString(),
  };
}

const SOL_HISTORY_MAX_LIMIT = 100; // native API allows up to 1000; kept far
// smaller here since payload size scales linearly and this is priced/cached
// as a "recent activity" product, not a bulk-export one.

export async function getSolTransactionHistory(addressRaw, { limit: limitRaw } = {}) {
  const address = String(addressRaw || "").trim();
  // Loose base58 shape check only -- same light-validation posture as the
  // existing getSolBalance() above, which does no format check at all and
  // just lets a malformed address surface the RPC's own error. This adds a
  // clearer error message for the most common mistake (wrong chain's address
  // format) without trying to fully validate base58/curve-point validity.
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    throw new Error("address must be a base58 Solana address");
  }

  const limit = Math.max(1, Math.min(Math.trunc(Number(limitRaw) || 20), SOL_HISTORY_MAX_LIMIT));

  const raw = await rpcCall(SOL_RPC_URL, "getSignaturesForAddress", [address, { limit }]);
  const transactions = (Array.isArray(raw) ? raw : []).map((t) => ({
    signature: t.signature,
    slot: t.slot,
    blockTime: t.blockTime ?? null,
    confirmationStatus: t.confirmationStatus ?? null,
    err: t.err !== null && t.err !== undefined,
    memo: t.memo ?? null,
  }));

  return {
    source: "sol-history",
    chain: "solana",
    address,
    limit,
    count: transactions.length,
    transactions,
    note: "most recent transactions only -- not full history since genesis",
    fetchedAt: new Date().toISOString(),
  };
}
.toISOString(),
  };
}

// --- OFAC sanctions screening (2026-08-16) ---
//
// OFAC's own authoritative source is the SDN list, published as
// sdn_advanced.xml (~80MB, relational schema: names/addresses/documents/
// digital-currency IDs all in separate linked structures) --
// https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml.
// Parsing that directly in-process for a lightweight per-address lookup
// is more than this route needs. Instead this uses the `lists` branch of
// 0xB10C/ofac-sanctioned-digital-currency-addresses (MIT-licensed, verified
// directly against its README before building this): a GitHub Actions
// workflow re-extracts and republishes that exact same OFAC XML nightly at
// 0 UTC as plain per-asset text files, one address per line. Confirmed live
// by fetching both files directly -- ETH list is ~90 addresses, SOL list is
// a single address as of 2026-08-16.
//
// Scoped to ETH + Solana only, same "Tier A" scoping discipline as the
// historical chain-data routes above. The source covers more assets (XBT,
// LTC, BSC, TRX, ARB, etc.) if this ever needs to expand -- see README.
const OFAC_LIST_URLS = {
  ethereum:
    process.env.OFAC_ETH_LIST_URL ||
    "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt",
  solana:
    process.env.OFAC_SOL_LIST_URL ||
    "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_SOL.txt",
};
// The source regenerates once/night -- this just bounds how stale our own
// in-process copy can get between regenerations, not a real-time freshness
// guarantee. Module-level singleton (not the server.js `cached()` helper)
// because what needs caching here is the whole list, shared across every
// address lookup, not a per-request key -- the per-address answer itself
// is a free Set.has() once the list is loaded and is never worth caching
// on its own.
const OFAC_LIST_TTL_MS = 6 * 60 * 60 * 1000; // 6h
let ofacListCache = null; // { fetchedAt, sets: { ethereum: Set, solana: Set } }

async function loadOfacLists() {
  if (ofacListCache && Date.now() - ofacListCache.fetchedAt < OFAC_LIST_TTL_MS) {
    return ofacListCache;
  }
  const chains = Object.keys(OFAC_LIST_URLS);
  const texts = await Promise.all(
    chains.map(async (chain) => {
      const url = OFAC_LIST_URLS[chain];
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OFAC sanctions list fetch failed: HTTP ${res.status} (${chain})`);
      return res.text();
    })
  );
  const toSet = (text) =>
    new Set(
      text
        .split("\n")
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean)
    );
  const sets = {};
  chains.forEach((chain, i) => {
    sets[chain] = toSet(texts[i]);
  });
  ofacListCache = { fetchedAt: Date.now(), sets };
  return ofacListCache;
}

function detectAddressChain(address) {
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return "ethereum";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "solana";
  return null;
}

export async function getSanctionsCheck(addressRaw, { chain: chainRaw } = {}) {
  const address = String(addressRaw || "").trim();
  if (!address) throw new Error("address is required");

  const chain = chainRaw ? String(chainRaw).trim().toLowerCase() : detectAddressChain(address);
  if (chain !== "ethereum" && chain !== "solana") {
    throw new Error(
      "could not determine chain from address format -- pass chain=ethereum or chain=solana explicitly, or supply a 0x-prefixed Ethereum address or a base58 Solana address"
    );
  }
  if (chain === "ethereum" && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("address must be a 0x-prefixed 20-byte Ethereum address");
  }
  if (chain === "solana" && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    throw new Error("address must be a base58 Solana address");
  }

  const { sets, fetchedAt } = await loadOfacLists();
  const sanctioned = sets[chain].has(address.toLowerCase());

  return {
    source: "ofac-sanctions-check",
    chain,
    address,
    sanctioned,
    matchType: sanctioned ? "direct-sdn-list-match" : null,
    list: "OFAC Specially Designated Nationals (SDN) List -- digital currency addresses",
    listSourceUrl: OFAC_LIST_URLS[chain],
    listSyncedAt: new Date(fetchedAt).toISOString(),
    note: "direct address match against OFAC's published SDN list only -- does not perform multi-hop / indirect-exposure clustering, so funds that passed through a sanctioned address via an intermediary wallet will not be flagged here; not a substitute for a full compliance screening program",
    fetchedAt: new Date().toISOString(),
  };
}
