// dataSources.js
// Thin wrappers around cheap/free upstream data sources. Kept separate from
// server.js so you can swap in a POKT gateway endpoint, Alchemy, Infura, or
// your own Umbrel-hosted node without touching the payment/route logic.
//
// Uses Node's built-in global fetch (stable since Node 18) instead of the
// node-fetch package — one less dependency to install/break.

const ETH_RPC_URL = process.env.ETH_RPC_URL || "https://eth.llamarpc.com";
const SOL_RPC_URL = process.env.SOL_RPC_URL || "https://api.mainnet-beta.solana.com";
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

// CoinGecko free tier — fine for a cached, low-frequency lookup. Swap for a
// paid tier if you outgrow the rate limit.
export async function getTokenPrice(symbol) {
  const idMap = {
    eth: "ethereum",
    sol: "solana",
    btc: "bitcoin",
    usdc: "usd-coin",
    pokt: "pocket-network",
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

async function uprockRequest(path, options = {}) {
  const res = await fetch(`${UPROCK_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(UPROCK_API_KEY ? { authorization: `Bearer ${UPROCK_API_KEY}` } : {}),
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
