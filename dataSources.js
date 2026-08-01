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
