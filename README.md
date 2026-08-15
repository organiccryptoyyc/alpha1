# On-chain snapshot API (x402-metered, Umbrel-hosted)

A small data API that sells cheap, deterministic on-chain snapshots — ETH gas
price, latest block on Ethereum and Solana, token prices, wallet balances —
for fractions of a cent per call. Payment and customer acquisition are both
automatic: it's paywalled with the [x402 protocol](https://docs.cdp.coinbase.com/x402/welcome)
(HTTP 402, paid in USDC on Solana) and auto-listed on
[x402 Bazaar](https://docs.cdp.coinbase.com/x402/bazaar), the directory AI
agents crawl to find paid APIs. You don't market this to humans; agents find
and pay for it on their own.

## Why this shape

- **Data is cheap to produce.** Everything here is sourced from free public
RPC endpoints and CoinGecko's free tier, then cached for a few seconds.
Your cost per request is close to zero; your revenue per request is $0.005–
$0.008.
- **Pricing clears the fee floor.** Solana settlement runs about $0.00025/tx,
and Coinbase's CDP facilitator charges $0.001/tx after the first 1,000
free calls each month. Pricing at $0.005–$0.008 leaves real margin instead
of donating it to fees.
- **Distribution is structural, not manual.** Bazaar lists your service the
first time the CDP facilitator settles a real payment against it — there's
no submission form. Once listed, it's also reachable through Bazaar's MCP
server, so agents running inside Claude or any other MCP client can find
and call it too.

## What this is not

A guaranteed income stream. This makes money only at real volume — a million
calls at $0.005 nets roughly $3,700 after fees. The honest path is: ship it,
watch actual usage, adjust price and add routes based on what agents actually
query, and only invest in your own RPC infrastructure (see the POKT note
below) once volume justifies it.

## 1. Get a Solana wallet

Any standard Solana address works — Phantom, Solflare, or one generated
headlessly with `@solana/web3.js`. This is where USDC payments land. Put it
in `.env` as `PAY_TO_ADDRESS`. You do not need to run any wallet software on
the Umbrel box itself; it's just a receiving address.

## 2. Get CDP facilitator credentials

Create a free account at https://portal.cdp.coinbase.com/, generate an API
key, and put the ID/secret in `.env`. The CDP facilitator is what settles
payments and is also what auto-lists you on Bazaar — using the generic public
facilitator instead works for payments but skips the Bazaar listing.

## 3. Configure and build

```bash
cp .env.example .env
# edit .env: PAY_TO_ADDRESS, CDP_API_KEY_ID, CDP_API_KEY_SECRET
```

This project is on the current v2 x402 SDK (`@x402/express`, `@x402/core`,
`@x402/svm`, `@x402/extensions`, `@coinbase/x402`) — the original
`x402-express` v1 package this started on is legacy (security patches only)
and, more importantly, its `bazaar: { discoverable: true }` flag never
actually enabled Bazaar listing on v1; that requires the v2
`bazaarResourceServerExtension` + `declareDiscoveryExtension()` wiring that's
now in `x402Middleware.js`. `x402Middleware.js` is the one file to update if
the package names or config shape change again — nothing else in this
project touches x402 directly. The SDK ecosystem still moves fast, so check
https://docs.cdp.coinbase.com/x402/quickstart-for-sellers and
https://docs.cdp.coinbase.com/x402/migration-guide before going live if time
has passed since this was last touched.

## 4. Deploy on Umbrel

Umbrel doesn't need this to be an official app-store listing — it runs plain
Docker containers fine. Easiest path:

1. Install **Portainer** from the Umbrel App Store (one click).
2. `docker-compose.yml` is what you paste/upload into the Portainer stack
editor — but `build: .` means Docker also needs the `Dockerfile`,
`package.json`, `server.js`, `dataSources.js`, and `x402Middleware.js`
sitting next to it in the same build context, not just the compose file
by itself. The reliable way to get that: push this project to a git repo
and use Portainer's **Repository** stack option (URL + compose path)
instead of the Web editor/Upload option, which only takes the one
compose file and won't have a Dockerfile to build from. **Do not commit
`.env`** to that repo — it has a live CDP API key/secret in it. Either
`.gitignore` it and place `.env` on the Umbrel box next to the cloned
repo after deploy, or drop the `env_file:` line from `docker-compose.yml`
and set `PAY_TO_ADDRESS` / `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` /
etc. as stack-level environment variables in Portainer's UI instead.
3. Deploy the stack. The API listens on `127.0.0.1:4021` on the Umbrel box.
4. Install a reverse proxy app (Nginx Proxy Manager or Caddy, both in the
Umbrel App Store) to put a real hostname and TLS in front of port 4021.
You need a public HTTPS URL — agents and the CDP facilitator won't reach a
bare local IP.

Hardware needs are trivial: this is a cached JSON API, not a blockchain
node. Any Umbrel box (Raspberry Pi 4 or better, Umbrel Home, or a repurposed
PC) handles this without strain.

**Redeploying after a code change (Repository-type stacks):** in Portainer's
stack page, use the plain **"Pull and redeploy"** button. Leave the
**"Re-pull image and redeploy"** toggle in its confirmation dialog **off** —
that toggle runs `docker compose pull` against every service's `image:` tag
first, including the ones this project builds locally from source (`caddy`,
`sol-rpc-cache`, `peaq-facilitator`). Those have no matching image in any
registry, so the toggle fails the whole redeploy with `pull access denied
... repository does not exist`. The plain button already does a git pull of
the build context and rebuilds via each service's `build:` directive, which
is what you want.

## 5. Confirm the Bazaar listing

Once your public URL is live and has served at least one real paid request:

```bash
node check-bazaar-listing.js https://your-domain.example.com
```

No listing yet means no payment has settled through the CDP facilitator yet
— that's expected until real traffic arrives, not a misconfiguration.

## 6. Optional: replace the free RPC endpoints with a POKT gateway

`dataSources.js` defaults to public Ethereum/Solana RPC endpoints, which are
fine for low volume but rate-limited. Once you have enough call volume that
reliability matters, stake POKT and run a gateway (see Pocket Network's
docs) and point `ETH_RPC_URL` / `SOL_RPC_URL` at it instead. This turns POKT
from a side idea into the actual infrastructure layer underneath your data
product, without changing anything else in this repo.

## Pending: BNB Smart Chain (BSC) as a payment network

As of `alpha8`, BSC data routes (`GET /v1/bsc/gas-price`,
`GET /v1/bsc/latest-block`, and a `bsc` option on
`/v1/wallet/balance/:chain/:address`) are live and sellable today through the
existing Solana/peaq payment rails — see `dataSources.js`.

**BSC as a third *payment* network is scaffolded in `x402Middleware.js` but
deliberately parked, not active.** Two things are blocking it, both
documented in detail in that file's BSC section:

1. **Binance's hosted x402 facilitator ("B402") isn't self-serve.** Unlike
Coinbase's CDP (free API key signup) or this project's own self-hosted peaq
facilitator (no auth), B402 requires an approved partner-developer
application — business name, contact email, a BSC payout wallet, a
1024-bit RSA keypair, and this server's outbound IP whitelisted — filed
separately for sandbox and production, with every API call then signed
RSA-SHA256. That application has to be filed by the account owner; see
[developers.binance.com](https://developers.binance.com) → Agentic
Payments → "Apply partner developer account."
2. **The obvious asset choice doesn't behave as documented.** Binance's docs
list `USD1` as supporting the same EIP-3009 signing flow already proven on
Solana and peaq. Querying the live USD1 contract directly (not trusting
the docs) shows it actually reverts on the EIP-3009 check — real support
is EIP-2612 permit + Permit2, a different, not-yet-live-tested signing
path (the installed `@x402/evm` SDK does support it in principle).

`buildBinanceFacilitatorConfig()` in `x402Middleware.js` returns `null` on
purpose, which keeps `BSC_ENABLED` false regardless of whether
`BSC_PAY_TO_ADDRESS` is set — so this is safe to leave deployed indefinitely
with zero risk of accidentally advertising a payment option this server
can't actually settle. Reactivating it later needs: (1) B402 partner
credentials, (2) an RSA-SHA256 request-signing implementation in that
function, (3) a real end-to-end payment test before trusting it — no other
code changes required.

## Security hardening (2026-08-04)

An external review of this project's architecture doc surfaced eight points -- idempotency/replay, cache-vs-metering wording, settlement-before-fetch (no refund path on upstream failure), the real-device fetch route's open SSRF surface, key-custody documentation, missing rate limiting, routes-as-code-vs-data, and horizontal-scaling caveats. Rate limiting (`express-rate-limit`, 120 req/min/IP, `/health` exempt), an SSRF denylist on `/v1/uprock/fetch` (blocks localhost/private/link-local targets), a `trust proxy` misconfiguration found while wiring up the rate limiter, and two documentation fixes are live as of this commit. Settlement-before-fetch and idempotency/replay are real, unresolved gaps -- the first needs a design decision (deferred-settle vs. refund) before a code fix, the second needs an adversarial test before it can be called handled. Full writeup with status per item: `ARCHITECTURE.md` §10.

## x402scan discovery fix (2026-08-13)

x402scan.com's own resync was reporting `15 registered, 1 removed, 5 skipped`
instead of the full 20-route catalog. Two separate bugs, both now fixed and
verified live:

1. **Unsubstituted path-param templates.** `/.well-known/x402` and
`/openapi.json` were advertising raw Express route templates
(`/v1/price/:symbol`) instead of a real example URL, so any crawler that
took the manifest at face value literally requested `:symbol` as the
param — producing the `"Unsupported symbol: :symbol"` / bad-peaq-DID
errors visible in production logs. Fixed by substituting each route's
Bazaar-declared example values into both discovery documents
(`substitutePathParams()` in `server.js`).
2. **The discovery crawl itself was tripping our own rate limiter.**
x402scan's crawler fans out to every declared route in one pass to read
its 402 challenge, and re-runs on every manual resync. At
`express-rate-limit`'s old 120 req/min/IP ceiling, that fanout got a
`429` instead of a `402` on the last 5 routes of the 20-route catalog —
confirmed directly via x402scan's own "Add API" checker, which reported
`[429] Endpoint did not return a 402 payment challenge` on exactly
`pokt/throughput`, `pokt/validators`, `uprock/fetch`,
`uprock/verify/{domain}`, and `brand-verify/{domain}`. x402scan's
discovery spec calls this out by name: "429 responses are upstream
provider limits, not generated by x402scan." Fixed by raising the limit
to 600 req/min/IP — a 402 preflight never reaches a real paid data fetch
(payment middleware gates everything below the limiter), so this is cheap
to serve and still meaningfully throttles a real scraper.

Verified: both x402scan's "Add API" checker (`/resources/register`) and a
manual resync on the server's own x402scan page show all **20 registered,
0 removed, 0 skipped**. If this regresses after adding new routes, check
both of the above first — a new parameterized route needs a
`pathParams`/`queryParams` example wired into its
`declareDiscoveryExtension()` call (see `x402Middleware.js`), and a bigger
route catalog may need the rate limit raised again.

## seller-trust payment failures -- root cause and fix (2026-08-15)

`/v1/x402/seller-trust` (the composite trust-score route for x402 sellers,
not to be confused with `/v1/pokt/supplier-trust`) failed on every live
payment attempt from the day it was built until this date -- always the
same generic CDP facilitator error, `'paymentPayload' is invalid: must
match one of [x402V2Pay...`. Chasing the real cause took a long elimination
sequence across two sessions; recorded here so nobody repeats it.

**Hypotheses tested and ruled out, in order, each with a live payment
retest:**

1. **Price ceiling.** Bisected the price down from $0.27 to $0.232 in five
steps -- all failed identically. Then matched the price exactly to
`/v1/brand-verify` ($0.23, same atomic amount) -- still failed, which
disproved price as a factor outright (brand-verify itself works fine at
that price).
2. **Query string in the resource URL.** Restructured the route from
`?url=` to a `/:encodedUrl` path segment (see the `96e98e3` /
`79d6e10` commits) on the theory that CDP's facilitator rejects any
resource URL containing a query string. Still failed. Directly
disproved later by noticing `/v1/uprock/fetch?url=...` -- a route with
a real, unencoded query string -- settles fine.
3. **Percent-encoded characters.** The `:encodedUrl` path segment
necessarily contains `%3A%2F%2F` (an encoded URL-in-a-URL). Removed
every literal `%` character from the route's *static* description and
`pathParams` example text (commit `0d97b8f`) on the theory that CDP or
the SDK chokes on percent sequences somewhere in the declaration.
Still failed.
4. **Port number / self-reference.** Tested with `https://example.com`
(no port, not the seller's own host) instead of the real self-referential
`organiccryptoyyc.com:8443` argument. Still failed identically, ruling
out both port numbers and self-referential URLs as factors.
5. **Root cause, confirmed:** the *size and nesting depth* of the
route's Bazaar discovery-extension content (`description` +
`output.example`). seller-trust's declaration carried a ~700-character
description and a deeply nested example object (`resourcesProbed[]`,
`ipIntelligence{}`, `scoringReasons[]`) -- by far the largest discovery
payload on this server. Stripping it down to a minimal declaration
matching `/v1/geo/ip`'s style (one-line description, a 3-field example --
commit `fd64c6e`) fixed it immediately; the very next live test settled
on the first try, self-referential URL and all.

**Important: this was a discovery-metadata problem only, not a functional
one.** The actual JSON the route returns to a paying caller was never
touched -- `getX402SellerTrust()` in `dataSources.js` still returns the
full composite object (bazaarListed, resourcesProbed, ipIntelligence,
trustScore, scoringReasons, etc.) exactly as before. Only the
`declareDiscoveryExtension()` example shown to Bazaar crawlers was
trimmed.

**Open question / follow-up:** the exact size threshold where CDP's
facilitator (or the SDK's payload construction) starts rejecting large
discovery-extension content was not isolated -- only that "very large"
fails and "minimal" works. If a richer Bazaar listing is wanted later,
bisect the `output.example` size upward from the current minimal version
and retest with a real payment after each step, the same way this was
found. Don't assume a size that "looks reasonable" is safe without a live
test -- every earlier theory in this list looked equally reasonable and
was wrong.

Live-verified working call, for reference:
```
node pay-test-debug.mjs "/v1/x402/seller-trust/https%3A%2F%2Forganiccryptoyyc.com%3A8443"
```

## Routes and pricing

| Route | Price | What it returns |
|---|---|---|
| `GET /v1/eth/gas-price` | $0.005 | Current Ethereum gas price (wei + gwei) |
| `GET /v1/eth/latest-block` | $0.005 | Latest Ethereum block number |
| `GET /v1/sol/latest-block` | $0.005 | Latest Solana slot |
| `GET /v1/price/:symbol` | $0.005 | USD price for eth/sol/btc/usdc/pokt |
| `GET /v1/wallet/balance/:chain/:address` | $0.008 | Balance for an eth, sol, peaq, or bsc address |
| `GET /v1/bsc/gas-price` | $0.005 | Current BNB Smart Chain gas price (wei + gwei) |
| `GET /v1/bsc/latest-block` | $0.005 | Latest BNB Smart Chain block number |
| `GET /health` | free | Liveness check, not metered |

This table is not exhaustive — peaq and POKT Shannon routes were added after
this section was last updated; see the live catalog at
`/.well-known/x402` on the deployed API for the complete, always-current
list. Adjust the `routes` config in `x402Middleware.js` as you learn what
agents will actually pay for each route — each entry's `accepts` sets the
price(s)/network(s) and `extensions` (via `declareDiscoveryExtension()`)
controls what Bazaar shows for that route.
