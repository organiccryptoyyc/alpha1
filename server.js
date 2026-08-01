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

// Centralized error handler — never leak stack traces to paying callers.
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(502).json({ error: "upstream data source failed", detail: err.message });
});

app.listen(PORT, () => {
  console.log(`Snapshot API listening on :${PORT}`);
});
