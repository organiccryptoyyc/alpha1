// edgeDataSource.js -- dataSources.js-style functions for the two public routes.
// Kept as its own file rather than appended into dataSources.js -- imports
// the edgeStore singleton directly, so server.js just adds one more import
// line (`import { getEdgeRpcPulse, getEdgeRpcPerformance } from
// "./edgeDataSource.js";`) alongside its existing dataSources.js import,
// with zero changes to dataSources.js itself.
//
// The window-parsing and "windowMs" naming intentionally mirrors how every
// other range-query route in this project (eth/logs, sol/history) already
// clamps caller input server-side rather than trusting it -- same discipline.

import { edgeStore } from "./edgeStore.js";

const WINDOW_MS = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};
const DEFAULT_WINDOW = "24h";

export function parseWindow(raw) {
  if (!raw) return { key: DEFAULT_WINDOW, ms: WINDOW_MS[DEFAULT_WINDOW] };
  const key = String(raw).toLowerCase();
  if (!(key in WINDOW_MS)) return null; // caller sends a bad value -> route returns 400, doesn't guess
  return { key, ms: WINDOW_MS[key] };
}

// export async function, matching dataSources.js's inline export style
// throughout (e.g. getEthGasPrice, getPoktPulse) even though these two are
// synchronous under the hood -- server.js's route handlers `await` every
// data-source call uniformly, so this keeps the call sites identical.

export async function getEdgeRpcPulse(chain, { provider = null, vantage = null } = {}) {
  const readings = edgeStore.latest({ chain, provider, vantage });
  if (readings.length === 0) {
    return { chain, readings: [], note: "no measurements yet for this chain from any configured vantage point" };
  }
  return {
    chain,
    readings: readings.map((r) => ({
      vantage: r.vantage,
      provider: r.provider,
      measuredAt: new Date(r.ts).toISOString(),
      ageSeconds: Math.round((Date.now() - r.ts) / 1000),
      success: r.success,
      timeout: r.timeout,
      latencyMs: r.latencyMs,
      errorCode: r.errorCode,
    })),
  };
}

export async function getEdgeRpcPerformance(chain, windowKey, { provider = null, vantage = null } = {}) {
  const window = parseWindow(windowKey);
  if (!window) return null; // signal to the route handler: bad window value

  const ranked = edgeStore.performance({ chain, windowMs: window.ms, provider, vantage });
  if (ranked.length === 0) {
    return {
      chain,
      window: window.key,
      providers: [],
      note: "no measurements in this window for this chain from any configured vantage point",
    };
  }

  return {
    chain,
    window: window.key,
    recommended: ranked[0] ? { vantage: ranked[0].vantage, provider: ranked[0].provider } : null,
    providers: ranked.map((p, i) => ({
      rank: i + 1,
      vantage: p.vantage,
      provider: p.provider,
      sampleCount: p.sampleCount,
      successRate: p.successRate,
      timeoutRate: p.timeoutRate,
      avgLatencyMs: p.avgLatencyMs,
      p50LatencyMs: p.p50LatencyMs,
      p95LatencyMs: p.p95LatencyMs,
    })),
  };
}
