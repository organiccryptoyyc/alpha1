#!/usr/bin/env python3
"""chronos-forecast.py -- internal-only sidecar wrapping amazon/chronos-2.

Same isolation pattern as sol-rpc-cache.mjs / peaq-facilitator.js /
puppeteer-render.js: no ports published to the host, reachable from
onchain-snapshot-api only by service name over the docker network (see
docker-compose.yml). Kept to Python's standard library for the HTTP layer
(http.server) rather than adding Flask/FastAPI -- chronos-forecasting +
pandas (+ the torch they pull in) are already the unavoidable heavy
dependencies here, and a web framework on top buys nothing at this traffic
level: one internal caller, a handful of chains, a request every few
minutes at most.

Endpoints:
  GET  /health   -> {"ok": true/false}          -- used by the Dockerfile HEALTHCHECK
  POST /forecast -> quantile forecast for one time series

See edgeDataSource.js's getEdgeRpcForecast/getEdgeRpcAnomaly for the caller
side, and edgeStore.js's timeSeries() for how the input series is built from
the Pi-measured data this stack already collects.
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pandas as pd
from chronos import Chronos2Pipeline

PORT = int(os.environ.get("PORT", "8000"))
MODEL_ID = os.environ.get("CHRONOS_MODEL", "amazon/chronos-2")
MIN_POINTS = 20  # below this a forecast isn't worth trusting -- caller (edgeDataSource.js) should short-circuit before this, this is just a second line of defense

_pipeline = None


def load_model():
    global _pipeline
    print(f"[chronos-forecast] loading {MODEL_ID} on CPU...", flush=True)
    _pipeline = Chronos2Pipeline.from_pretrained(MODEL_ID, device_map="cpu")
    print("[chronos-forecast] model loaded, ready", flush=True)


def run_forecast(series, horizon, quantiles):
    """series: list of {"timestamp": ISO-8601 string, "value": number}, oldest first."""
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime([p["timestamp"] for p in series]),
            "target": [p["value"] for p in series],
        }
    )
    df["item_id"] = "series"
    pred_df = _pipeline.predict_df(df, prediction_length=horizon, quantile_levels=quantiles)
    return json.loads(pred_df.to_json(orient="records"))


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[chronos-forecast] {self.address_string()} - {fmt % args}", flush=True)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": _pipeline is not None})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/forecast":
            return self._send_json(404, {"error": "not found"})
        if _pipeline is None:
            return self._send_json(503, {"error": "model not loaded yet"})

        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            return self._send_json(400, {"error": "invalid JSON body"})

        series = body.get("series")
        horizon = int(body.get("horizon", 12))
        quantiles = body.get("quantiles", [0.1, 0.5, 0.9])

        if not isinstance(series, list) or len(series) < MIN_POINTS:
            return self._send_json(
                400, {"error": f"series must be an array of at least {MIN_POINTS} points"}
            )

        try:
            result = run_forecast(series, horizon, quantiles)
        except Exception as exc:  # internal sidecar -- caller just needs to know it failed, detail goes to the log
            print(f"[chronos-forecast] forecast error: {exc}", flush=True)
            return self._send_json(500, {"error": "forecast failed"})

        self._send_json(200, {"forecast": result})


if __name__ == "__main__":
    load_model()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[chronos-forecast] listening on :{PORT}", flush=True)
    server.serve_forever()
