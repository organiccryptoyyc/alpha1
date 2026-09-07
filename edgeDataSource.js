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

// PATCH: rpc-forecast / rpc-anomaly -- both backed by a locally-run Chronos-2
// (amazon/chronos-2, Apache-2.0) sidecar, see chronos-forecast.py /
// chronos-forecast.Dockerfile and its service block in docker-compose.yml.
// Internal-only, reached by service name over the docker network -- same
// pattern as SOL_RPC_URL/PUPPETEER_RENDER_URL/SEARXNG_URL elsewhere in this
// project. CHRONOS_URL only needs setting in Portainer if this is ever
// pointed somewhere else; the code default matches the compose service name.
const CHRONOS_URL = process.env.CHRONOS_URL || "http://chronos-forecast:8000";

// Hourly buckets keep a single call's series short enough for Chronos-2's
// 8,192-step context cap even at the full 400-day retention window (400 * 24
// = 9,600 possible hourly buckets) -- maxBuckets below trims further, to the
// most recent ~83 days, which is plenty of daily/weekly seasonal signal
// without pushing months of data through the model on every call.
const FORECAST_BUCKET_MS = 60 * 60 * 1000;
const FORECAST_MAX_BUCKETS = 2000;
const MIN_BUCKETS_FOR_FORECAST = 20;

// NOTE: the exact column names Chronos-2's predict_df() uses for each
// quantile (literally "0.1"/"0.9", or "q0.1", or something else) aren't
// pinned down here -- confirm with one real POST /forecast call against the
// built chronos-forecast container before trusting expectedRange below, and
// adjust the band?.["0.1"] / band?.["0.9"] keys in getEdgeRpcAnomaly to match
// whatever comes back.
async function callChronosForecast(series, horizon, quantiles) {
  const res = await fetch(`${CHRONOS_URL}/forecast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      series: series.map((b) => ({ timestamp: new Date(b.ts).toISOString(), value: b.avgLatencyMs })),
      horizon,
      quantiles,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`chronos-forecast ${res.status}: ${text}`);
  }
  const { forecast } = await res.json();
  return forecast;
}

function loadRecentSeries(chain, provider, vantage) {
  return edgeStore
    .timeSeries({ chain, provider, vantage, bucketMs: FORECAST_BUCKET_MS, maxBuckets: FORECAST_MAX_BUCKETS })
    .filter((b) => b.avgLatencyMs !== null);
}

export async function getEdgeRpcForecast(chain, { provider = null, vantage = null, horizon = 12 } = {}) {
  if (!provider) return { error: "provider is required (see /v1/edge/rpc-performance/:chain for available provider names)" };

  const series = loadRecentSeries(chain, provider, vantage);
  if (series.length < MIN_BUCKETS_FOR_FORECAST) {
    return {
      chain,
      provider,
      forecast: [],
      note: `not enough history yet for a useful forecast (have ${series.length} hourly buckets with successful readings, need ${MIN_BUCKETS_FOR_FORECAST})`,
    };
  }

  const clampedHorizon = Math.min(Math.max(Number(horizon) || 12, 1), 168); // cap at 7 days out -- confidence past that is low at hourly granularity
  const forecast = await callChronosForecast(series, clampedHorizon, [0.1, 0.5, 0.9]);
  return { chain, provider, bucketed: "1h", horizon: clampedHorizon, forecast };
}

export async function getEdgeRpcAnomaly(chain, { provider = null, vantage = null } = {}) {
  if (!provider) return { error: "provider is required (see /v1/edge/rpc-performance/:chain for available provider names)" };

  const series = loadRecentSeries(chain, provider, vantage);
  if (series.length < MIN_BUCKETS_FOR_FORECAST + 1) {
    return { chain, provider, anomaly: false, note: "not enough history yet to evaluate an anomaly" };
  }

  const latest = series[series.length - 1];
  const history = series.slice(0, -1);
  const [band] = await callChronosForecast(history, 1, [0.1, 0.9]);
  const low = band?.["0.1"];
  const high = band?.["0.9"];
  const anomaly = typeof low === "number" && typeof high === "number" && (latest.avgLatencyMs < low || latest.avgLatencyMs > high);

  return {
    chain,
    provider,
    anomaly,
    latest: { measuredAt: new Date(latest.ts).toISOString(), avgLatencyMs: latest.avgLatencyMs },
    expectedRange: { low, high },
  };
}
