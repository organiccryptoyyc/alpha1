// edgeStore.js -- server-side store for Pi-measured RPC/gateway telemetry.
//
// Same discipline as the OFAC route already in this project: a plain
// in-process array, loaded from disk at boot, no DB engine. At the
// original volume this was sized for (one Pi, a handful of endpoints, 30s
// probe interval -> a few thousand rows/day, 30 days retention -> roughly
// 100-150K records resident) that's genuinely enough.
//
// PATCH (retention 30 -> 400 days, added alongside chronos-forecast): at a
// few thousand rows/day, 400 days puts resident record count in the low
// millions rather than ~150K -- still fine for one process on this box (8
// cores / 16.5GB), but it moves closer to the ceiling this comment already
// flagged. The trigger for actually migrating to a real time-series DB
// isn't 400 days by itself, it's 400 days *combined* with the planned
// network-expansion phase (more contributor Pis = more vantage points =
// multiplied row count) -- worth re-checking _debugRecordCount() and this
// process's RSS after a few weeks at the new retention, and definitely
// before onboarding outside vantage points.
//
// This file owns exactly one concern: store measurements, answer questions
// about them (latest, aggregated-over-a-window, and bucketed-time-series).
// Nothing here is x402-aware or Express-aware -- see edgeIngestRoute.js and
// edgeDataSource.js for those layers.

import { existsSync, mkdirSync } from "node:fs";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const REQUIRED_FIELDS = ["vantage", "chain", "provider", "ts", "success", "timeout"];

export function createEdgeStore({ filePath, retentionMs, trimIntervalMs = 60 * 60 * 1000 }) {
  let records = [];

  function loadFromDisk() {
    if (!existsSync(filePath)) return;
    const text = readFileSync(filePath, "utf8");
    const cutoff = Date.now() - retentionMs;
    records = text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((r) => r && typeof r.ts === "number" && r.ts >= cutoff);
    console.log(`[edgeStore] loaded ${records.length} measurements from disk`);
  }

  function persistCompacted() {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const lines = records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
    writeFileSync(filePath, lines, "utf8");
  }

  function validate(rec) {
    if (typeof rec !== "object" || rec === null) return false;
    for (const f of REQUIRED_FIELDS) {
      if (!(f in rec)) return false;
    }
    if (typeof rec.vantage !== "string" || rec.vantage.length === 0 || rec.vantage.length > 64) return false;
    if (typeof rec.chain !== "string" || rec.chain.length === 0 || rec.chain.length > 32) return false;
    if (typeof rec.provider !== "string" || rec.provider.length === 0 || rec.provider.length > 64) return false;
    if (typeof rec.ts !== "number" || !Number.isFinite(rec.ts)) return false;
    if (typeof rec.success !== "boolean" || typeof rec.timeout !== "boolean") return false;
    if (rec.latencyMs !== null && typeof rec.latencyMs !== "number") return false;
    // don't accept future-dated or absurdly stale readings -- a misbehaving
    // or malicious client shouldn't be able to poison the window
    const now = Date.now();
    if (rec.ts > now + 60_000 || rec.ts < now - retentionMs) return false;
    return true;
  }

  /** Appends valid records, silently drops invalid ones, returns count accepted. */
  function append(candidateRecords) {
    const accepted = [];
    for (const rec of candidateRecords) {
      if (!validate(rec)) continue;
      const clean = {
        vantage: rec.vantage,
        chain: rec.chain,
        provider: rec.provider,
        ts: rec.ts,
        success: rec.success,
        timeout: rec.timeout,
        latencyMs: rec.latencyMs ?? null,
        errorCode: typeof rec.errorCode === "string" ? rec.errorCode.slice(0, 128) : null,
      };
      accepted.push(clean);
    }
    if (accepted.length === 0) return 0;
    records.push(...accepted);
    const lines = accepted.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(filePath, lines, "utf8");
    return accepted.length;
  }

  function trim() {
    const cutoff = Date.now() - retentionMs;
    const before = records.length;
    records = records.filter((r) => r.ts >= cutoff);
    if (records.length !== before) persistCompacted();
  }

  /** Latest reading per provider for a chain (optionally filtered to one provider/vantage). */
  function latest({ chain, provider = null, vantage = null }) {
    const matches = records.filter(
      (r) => r.chain === chain && (!provider || r.provider === provider) && (!vantage || r.vantage === vantage)
    );
    const byProvider = new Map();
    for (const r of matches) {
      const key = `${r.vantage}:${r.provider}`;
      const cur = byProvider.get(key);
      if (!cur || r.ts > cur.ts) byProvider.set(key, r);
    }
    return [...byProvider.values()].sort((a, b) => b.ts - a.ts);
  }

  /** Aggregated stats per provider over a trailing window, ranked by avg latency among successes. */
  function performance({ chain, windowMs, provider = null, vantage = null }) {
    const cutoff = Date.now() - windowMs;
    const matches = records.filter(
      (r) =>
        r.chain === chain &&
        r.ts >= cutoff &&
        (!provider || r.provider === provider) &&
        (!vantage || r.vantage === vantage)
    );

    const byProvider = new Map();
    for (const r of matches) {
      const key = `${r.vantage}:${r.provider}`;
      if (!byProvider.has(key)) {
        byProvider.set(key, { vantage: r.vantage, provider: r.provider, samples: [] });
      }
      byProvider.get(key).samples.push(r);
    }

    const results = [...byProvider.values()].map(({ vantage: v, provider: p, samples }) => {
      const n = samples.length;
      const successes = samples.filter((s) => s.success);
      const timeouts = samples.filter((s) => s.timeout);
      const latencies = successes.map((s) => s.latencyMs).filter((v) => typeof v === "number").sort((a, b) => a - b);
      const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
      const p50 = latencies.length ? latencies[Math.floor(latencies.length * 0.5)] : null;
      const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null;
      return {
        vantage: v,
        provider: p,
        sampleCount: n,
        successRate: n ? +(successes.length / n).toFixed(4) : null,
        timeoutRate: n ? +(timeouts.length / n).toFixed(4) : null,
        avgLatencyMs: avg,
        p50LatencyMs: p50,
        p95LatencyMs: p95,
      };
    });

    results.sort((a, b) => {
      // rank by success rate first, then avg latency -- a fast-but-flaky
      // provider should never outrank a reliable one
      if ((b.successRate ?? 0) !== (a.successRate ?? 0)) return (b.successRate ?? 0) - (a.successRate ?? 0);
      return (a.avgLatencyMs ?? Infinity) - (b.avgLatencyMs ?? Infinity);
    });

    return results;
  }

  /**
   * Time-bucketed history for one (chain, provider[, vantage]) combination --
   * feeds the forecast/anomaly endpoints (see edgeDataSource.js). Same
   * per-bucket stats as performance() above, sliced into fixed-width buckets
   * across the store's retention window instead of one aggregate for a
   * single trailing window. maxBuckets bounds how much history a single
   * call hands to the Chronos-2 sidecar, independent of EDGE_RETENTION_DAYS
   * -- retention controls how much we keep, this controls how much of that
   * one call is allowed to read.
   */
  function timeSeries({ chain, provider, vantage = null, bucketMs = 60 * 60 * 1000, maxBuckets = 2000 }) {
    const matches = records.filter(
      (r) => r.chain === chain && r.provider === provider && (!vantage || r.vantage === vantage)
    );
    if (matches.length === 0) return [];

    const byBucket = new Map();
    for (const r of matches) {
      const bucketTs = Math.floor(r.ts / bucketMs) * bucketMs;
      if (!byBucket.has(bucketTs)) byBucket.set(bucketTs, []);
      byBucket.get(bucketTs).push(r);
    }

    return [...byBucket.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-maxBuckets)
      .map(([ts, samples]) => {
        const successes = samples.filter((s) => s.success);
        const latencies = successes.map((s) => s.latencyMs).filter((v) => typeof v === "number");
        return {
          ts,
          avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
          successRate: +(successes.length / samples.length).toFixed(4),
          sampleCount: samples.length,
        };
      });
  }

  loadFromDisk();
  const trimTimer = setInterval(trim, trimIntervalMs);
  trimTimer.unref?.();

  return { append, latest, performance, timeSeries, trim, _debugRecordCount: () => records.length };
}

// Module-level singleton, same pattern as `const cache = new NodeCache(...)`
// in server.js -- both server.js (for the ingest route) and edgeDataSource.js
// (for the two public routes) import this same instance rather than each
// creating their own. Config comes from env vars with graceful defaults,
// matching every other constant in dataSources.js (e.g. ETH_RPC_URL).
export const edgeStore = createEdgeStore({
  filePath: process.env.EDGE_DATA_PATH || "./data/edge-measurements.ndjson",
  // Code-level fallback bumped 30 -> 400 alongside the Portainer stack
  // variable of the same name, so an unset env var lands on the new
  // intended steady-state rather than silently reverting to the old one.
  retentionMs: (Number(process.env.EDGE_RETENTION_DAYS) || 400) * 24 * 60 * 60 * 1000,
});
