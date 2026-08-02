// server.js
// Metered on-chain data snapshot API.
//
// Flow: agent requests a route -> gets HTTP 402 with price -> pays in USDC on
// Solana -> retries with payment proof -> gets JSON back. No API keys, no
// signup, no dashboard to build. The x402 middleware handles the paywall;
// this file just defines what data each dollar buys and caches upstream
// calls so ten thousand requests don't turn into ten thousand RPC calls.

import express from "express";
import NodeCache from "node-cache";
import { buildX402Middleware } from "./x402Middleware.js";
import {
  getEthGasPrice,
  getEthLatestBlock,
  getSolLatestBlock,
  getEthBalance,
  getSolBalance,
  getTokenPrice,
  getPoktServiceDemand,
  getUprockFetch,
} from "./dataSources.js";

const app = express();
const PORT = process.env.PORT || 4021;

// Short TTLs: long enough to absorb bursts of agent traffic hitting the same
// route within a few seconds, short enough that the data stays honest.
const cache = new NodeCache({ stdTTL: 8, checkperiod: 4 });

async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit) return hit;
  const value = await fn();
  cache.set(key, value, ttl);
  return value;
}

// Free health check — not metered, so uptime monitors and Bazaar's crawler
// can confirm the service is alive without paying for it.
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Metered routes below this line.
app.use(buildX402Middleware());

app.get("/v1/eth/gas-price", async (req, res, next) => {
  try {
    res.json(await cached("eth:gas", 5, getEthGasPrice));
  } catch (err) {
    next(err);
  }
});

app.get("/v1/eth/latest-block", async (req, res, next) => {
  try {
    res.json(await cached("eth:block", 8, getEthLatestBlock));
  } catch (err) {
    next(err);
  }
});

app.get("/v1/sol/latest-block", async (req, res, next) => {
  try {
    res.json(await cached("sol:slot", 3, getSolLatestBlock));
  } catch (err) {
    next(err);
  }
});

app.get("/v1/price/:symbol", async (req, res, next) => {
  try {
    const { symbol } = req.params;
    res.json(await cached(`price:${symbol}`, 15, () => getTokenPrice(symbol)));
  } catch (err) {
    next(err);
  }
});

app.get("/v1/wallet/balance/:chain/:address", async (req, res, next) => {
  try {
    const { chain, address } = req.params;
    const key = `bal:${chain}:${address}`;
    const fn =
      chain === "eth"
        ? () => getEthBalance(address)
        : chain === "sol"
        ? () => getSolBalance(address)
        : null;
    if (!fn) return res.status(400).json({ error: "chain must be 'eth' or 'sol'" });
    res.json(await cached(key, 6, fn));
  } catch (err) {
    next(err);
  }
});

// POKT Shannon relay-demand ranking. Longer TTL (60s) than the RPC routes
// above — the underlying EMA only moves meaningfully on the order of tens of
// seconds to minutes, so a tighter cache would just burn indexer load for no
// fresher data.
app.get("/v1/pokt/service-demand", async (req, res, next) => {
  try {
    const limit = req.query.limit;
    res.json(await cached(`pokt:demand:${limit || 10}`, 60, () => getPoktServiceDemand(limit)));
  } catch (err) {
    next(err);
  }
});

// UpRock real-device fetch. Longer TTL (180s) than everything else on
// purpose: each crawl job costs real UpRock credits, so a repeat request for
// the same URL inside the cache window is free margin instead of a repeat
// charge against your UpRock balance.
app.get("/v1/uprock/fetch", async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "url query param is required" });
    res.json(await cached(`uprock:${url}`, 180, () => getUprockFetch(url)));
  } catch (err) {
    next(err);
  }
});

// Centralized error handler — never leak stack traces to paying callers.
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(502).json({ error: "upstream data source failed", detail: err.message });
});

app.listen(PORT, () => {
  console.log(`Snapshot API listening on :${PORT}`);
});
