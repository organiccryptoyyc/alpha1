# chronos-forecast integration + retention bump (400 days)

This bundle adds two new paid endpoints (`GET /v1/edge/rpc-forecast/:chain`,
`GET /v1/edge/rpc-anomaly/:chain`) backed by a locally-run Chronos-2
time-series model, and raises `EDGE_RETENTION_DAYS` from 30 to 400.

## What's in this zip

New files (drop into the repo root, alongside the other `*.Dockerfile` /
top-level service files):
- `chronos-forecast.py` — the sidecar itself (stdlib HTTP server, no web
  framework — matches sol-rpc-cache.mjs's "zero deps beyond what's
  unavoidable" style)
- `chronos-forecast.Dockerfile` — builds it, bakes the model weights in at
  build time so the container needs no internet access at runtime
- `chronos-forecast-requirements.txt` — its two Python deps
  (chronos-forecasting, pandas; torch is installed separately as a CPU-only
  wheel in the Dockerfile)

Full-file replacements (overwrite these five in the repo — every change is
additive, nothing existing was removed, see the `diffs_*.patch` files if you
want to review line-by-line before overwriting):
- `docker-compose.yml` — new `chronos-forecast` service, `CHRONOS_URL` +
  bumped `EDGE_RETENTION_DAYS` default on `onchain-snapshot-api`
- `server.js` — two new route handlers
- `edgeDataSource.js` — `getEdgeRpcForecast` / `getEdgeRpcAnomaly`
- `edgeStore.js` — new `timeSeries()` aggregator + updated retention
  comments/default
- `x402Middleware.js` — pricing/catalog entries for the two new routes
  ($0.06 forecast, $0.05 anomaly — above rpc-pulse's $0.015 and
  rpc-performance's $0.045, reflecting the actual inference cost; adjust
  once you have real usage data, same as every other price in this file)

All five modified files passed `node --check` and the compose file parses
clean as YAML. `chronos-forecast.py` passed `python3 -m py_compile`. None of
that proves it works end to end against a real container build — see
"Before you trust it" below.

## Apply it (run once, on genxv2, in your local alpha1 clone)

```bash
cd /path/to/your/alpha1/clone
git checkout edge-pulse
git pull

# unzip this bundle's contents into the repo root, overwriting the five
# files listed above and adding the three new chronos-forecast* files
unzip -o /path/to/chronos-forecast-bundle.zip -d .

git add chronos-forecast.py chronos-forecast.Dockerfile chronos-forecast-requirements.txt \
        docker-compose.yml server.js edgeDataSource.js edgeStore.js x402Middleware.js
git status   # confirm only those 8 files are staged before committing
git commit -m "Add chronos-forecast sidecar (rpc-forecast/rpc-anomaly); bump EDGE_RETENTION_DAYS to 400"
git push
```

First push may re-trigger the credential-manager login popup, same as the
original edge-pulse push.

## In Portainer, after the push

1. Set the stack's `EDGE_RETENTION_DAYS` environment variable to `400`
   (Stacks -> onchain-snapshot-api -> Environment variables). The compose
   file now defaults to 400 if this is ever unset, but Portainer's own
   stack-level value takes priority over that default, so it needs updating
   there too, not just in git.
2. Click **Pull and redeploy**. This will build the new `chronos-forecast`
   image (expect the first build to take a while — downloading a CPU
   PyTorch wheel plus the Chronos-2 weights) alongside the existing five
   services.
3. Confirm all 7 containers come up healthy (`onchain-snapshot-chronos-forecast`
   included) before testing the new routes.

## Before you trust it

- **Quantile column names are unverified.** Chronos-2's `predict_df()`
  output column names for each quantile (`"0.1"` / `"0.9"`, or something
  else) were inferred from the model's documentation, not from a real run.
  After the container is up, do one manual `POST /forecast` against
  `chronos-forecast` directly (from inside the docker network, e.g. via
  `docker exec` into `onchain-snapshot-api` and `curl
  http://chronos-forecast:8000/forecast -d '...'`) and check the actual
  response shape. If the keys differ, `getEdgeRpcAnomaly` in
  `edgeDataSource.js` needs its `band?.["0.1"]` / `band?.["0.9"]` lookups
  updated to match.
- **Retention math, not just a number.** `edgeStore.js`'s comment block now
  flags this directly: at "a few thousand rows/day," 400 days moves the
  resident record count from roughly 100-150K (at 30 days) into the low
  millions. That's fine today on this box (8 cores / 16.5GB, shared across
  all 7 containers), but check `edgeStore`'s `_debugRecordCount()` and this
  process's memory usage a few weeks after the bump, and definitely before
  the planned network-expansion phase adds more contributor Pis on top of
  the longer window.
- **Test with a real payment before calling it done** — same discipline the
  edge-pulse rollout used for rpc-pulse/rpc-performance. `rpc-forecast` and
  `rpc-anomaly` are both in the priced `routes` catalog now, which is also
  what triggers their first Bazaar listing (only on a real settled payment,
  not just a verify).
