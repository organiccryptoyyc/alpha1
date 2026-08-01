// sol-rpc-cache.mjs
//
// Tiny caching reverse-proxy for Solana JSON-RPC, used only to work around a
// bug in @x402/svm 2.20.0 (the latest version as of this writing).
//
// The bug: @x402/svm's server-side "exact" scheme calls rpc.getLatestBlockhash()
// fresh, with zero caching, every single time it builds a payment-required
// challenge - including internally, a second time, when it re-checks a
// client's retried request against "currently valid" requirements. Since
// Solana's latest blockhash changes roughly every ~400-600ms, and @x402/core's
// matching logic (paymentRequirementsMatchAccepted) does a strict deep-equal
// on the entire "extra" object (which includes recentBlockhash), the client's
// payment - built against the blockhash from the FIRST 402 response - almost
// never matches the freshly-refetched blockhash the server compares against
// on the retry. Server rejects with "No matching payment requirements" on
// essentially every attempt. This isn't a bug in our server code, our wallet,
// or our funds - it's a race condition baked into the installed SDK version.
//
// The fix, without patching vendored node_modules code (which would just get
// overwritten on the next `npm install`/image rebuild): put this cache in
// front of the real RPC endpoint and point SOL_RPC_URL at it instead. It
// caches getLatestBlockhash responses for a short TTL (comfortably inside
// Solana's ~60-90 second blockhash validity window), so the challenge and the
// retry that follows a few seconds later see the SAME blockhash and the
// match succeeds. Every other RPC method passes straight through, untouched.
//
// No npm dependencies - runs on Node's built-in http/fetch so the Docker
// image for this service is just `FROM node:20-alpine`.

import http from "node:http";

const PORT = process.env.PORT || 3000;
const UPSTREAM_RPC_URL = process.env.UPSTREAM_RPC_URL;
const BLOCKHASH_TTL_MS = 20_000; // well under Solana's ~60-90s validity window

if (!UPSTREAM_RPC_URL) {
    console.error("[sol-rpc-cache] UPSTREAM_RPC_URL is not set - refusing to start.");
    process.exit(1);
}

// Keyed by JSON.stringify(params) so different commitment levels etc. get
// their own cache entry, even though in practice this scheme always calls
// with the same params.
const blockhashCache = new Map(); // paramsKey -> { result, expiresAt }

function readBody(req) {
    return new Promise((resolve, reject) => {
          const chunks = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          req.on("error", reject);
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "text/plain" });
          res.end("Method not allowed - this is a Solana JSON-RPC proxy\n");
          return;
    }

                                   let bodyText;
    try {
          bodyText = await readBody(req);
    } catch (err) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Failed to read request body\n");
          return;
    }

                                   let parsed;
    try {
          parsed = JSON.parse(bodyText);
    } catch {
          // Not JSON (or a batch we don't specially handle) - just forward as-is.
      return forward(bodyText, res);
    }

                                   const isGetLatestBlockhash = !Array.isArray(parsed) && parsed.method === "getLatestBlockhash";

                                   if (isGetLatestBlockhash) {
                                         const paramsKey = JSON.stringify(parsed.params ?? []);
                                         const cached = blockhashCache.get(paramsKey);
                                         const now = Date.now();

      if (cached && cached.expiresAt > now) {
              console.log(`[sol-rpc-cache] HIT getLatestBlockhash (age ${Math.round((now - cached.cachedAt) / 1000)}s)`);
              const responseBody = JSON.stringify({ ...cached.result, id: parsed.id });
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(responseBody);
              return;
      }

      console.log("[sol-rpc-cache] MISS getLatestBlockhash - fetching fresh from upstream");
                                         try {
                                                 const upstreamRes = await fetch(UPSTREAM_RPC_URL, {
                                                           method: "POST",
                                                           headers: { "Content-Type": "application/json" },
                                                           body: bodyText,
                                                 });
                                                 const upstreamJson = await upstreamRes.json();

                                           if (upstreamRes.ok && upstreamJson && !upstreamJson.error) {
                                                     blockhashCache.set(paramsKey, {
                                                                 result: upstreamJson,
                                                                 cachedAt: now,
                                                                 expiresAt: now + BLOCKHASH_TTL_MS,
                                                     });
                                           }

                                           res.writeHead(upstreamRes.status, { "Content-Type": "application/json" });
                                                 res.end(JSON.stringify(upstreamJson));
                                         } catch (err) {
                                                 console.error("[sol-rpc-cache] Upstream fetch failed:", err.message);
                                                 res.writeHead(502, { "Content-Type": "application/json" });
                                                 res.end(JSON.stringify({ error: "sol-rpc-cache: upstream fetch failed" }));
                                         }
                                         return;
                                   }

                                   // Every other method: pure passthrough, no caching.
                                   return forward(bodyText, res);
});

async function forward(bodyText, res) {
    try {
          const upstreamRes = await fetch(UPSTREAM_RPC_URL, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: bodyText,
          });
          const buf = Buffer.from(await upstreamRes.arrayBuffer());
          res.writeHead(upstreamRes.status, {
                  "Content-Type": upstreamRes.headers.get("content-type") || "application/json",
          });
          res.end(buf);
    } catch (err) {
          console.error("[sol-rpc-cache] Passthrough fetch failed:", err.message);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "sol-rpc-cache: upstream fetch failed" }));
    }
}

server.listen(PORT, () => {
    console.log(`[sol-rpc-cache] Listening on :${PORT}, upstream=${UPSTREAM_RPC_URL}, blockhash TTL=${BLOCKHASH_TTL_MS}ms`);
});
