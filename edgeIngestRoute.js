import express from "express";

// edgeIngestRoute.js -- internal write endpoint for the Pi collector.
//
// Deliberately NOT registered in x402Middleware.js's routes map -- same
// pattern as /internal/paysh/*: an internal, shared-secret-gated route, not
// part of the paid public catalog. If EDGE_INTERNAL_KEY is unset, every
// request here 503s rather than silently accepting unauthenticated writes.
//
// Reuses server.js's own constantTimeEqual() (added there 2026-08-27 for
// /internal/paysh) rather than defining a second copy -- pass it in from
// server.js. See INTEGRATION.md for the exact registerEdgeIngestRoute() call
// site, right after the last /internal/paysh/* route.

const MAX_MEASUREMENTS_PER_REQUEST = 1000; // server-side cap, independent of the Pi's own maxBatchSize

/**
 * @param {import('express').Express} app
 * @param {ReturnType<typeof import('./edgeStore.js').createEdgeStore>} edgeStore
 * @param {(a: unknown, b: unknown) => boolean} constantTimeEqual - server.js's existing helper
 */
export function registerEdgeIngestRoute(app, edgeStore, constantTimeEqual) {
  function requireEdgeKey(req, res, next) {
    const expected = process.env.EDGE_INTERNAL_KEY;
    if (!expected) {
      return res.status(503).json({ error: "EDGE_INTERNAL_KEY is not configured" });
    }
    if (!constantTimeEqual(req.headers["x-internal-key"], expected)) {
      return res.status(401).json({ error: "invalid or missing X-Internal-Key" });
    }
    next();
  }
  app.use("/internal/edge", requireEdgeKey);

  app.post("/internal/edge/ingest", express.json(), (req, res) => {
    const { vantage, measurements } = req.body || {};
    if (typeof vantage !== "string" || vantage.length === 0) {
      return res.status(400).json({ error: "missing vantage" });
    }
    if (!Array.isArray(measurements) || measurements.length === 0) {
      return res.status(400).json({ error: "missing measurements array" });
    }
    if (measurements.length > MAX_MEASUREMENTS_PER_REQUEST) {
      return res.status(413).json({ error: `too many measurements in one request (max ${MAX_MEASUREMENTS_PER_REQUEST})` });
    }

    // the Pi already stamps vantage per-record; this just backfills it if a
    // future collector variant omits it, using the top-level field as default
    const withVantage = measurements.map((m) => ({ vantage, ...m }));
    const accepted = edgeStore.append(withVantage);

    res.json({ accepted, rejected: measurements.length - accepted });
  });
}
