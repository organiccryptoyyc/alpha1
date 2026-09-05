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

## Status summary & version log

**Current backup: `v1w`** (branch `backup/verified-working-2026-08-24-v1w`, the
23rd verified-working snapshot of this repo). Full history:
`backup/verified-working-2026-08-08` through
`backup/verified-working-2026-08-23-round12-yield-opportunities` (20 branches,
one per shipped round). Starting with this one, backups also carry a short
`v1<letter>` tag -- one letter per verified-working snapshot, `a` through `z`,
then `v2.0a` through `v2.0z`, and so on if this project outlives the alphabet.

**Live and confirmed in production as of 2026-08-24:** 50 metered routes.
`/.well-known/x402` on the deployed API is the always-current, authoritative
list -- the pricing table further down this README is illustrative, not
exhaustive (it predates most of the routes below). Every dated section in
this README shipped, was pushed to `main`, redeployed via Portainer, and
live-payment-tested against the production URL before being marked done --
**except the newest one, "First real end-to-end paid Solana test pass, and
a DNS-lookup bug fix (2026-09-05)," which breaks that pattern on purpose:
it covers two separate fixes found during the project's first real paid
test pass, at two different stages -- one confirmed live via a real paid
retest, one fixed in code but not yet deployed or live-retested.** Read
that section's own "Status" notes before assuming either is live.
Most recent: 5 composite bundle routes (chain-snapshot, wallet-risk,
domain-trust, defi/precheck, pokt/pulse -- see "Composite bundle routes"
below) layered over already-shipped functions, plus an unrelated x402
client-library version bump (2.20.0 -> 2.23.0) that did not resolve the
known Solana payment-settlement issue noted there.

**Not complete: the pay.sh listing.** The proxy-route plumbing
(`/internal/paysh/*` in `server.js`, `paysh-provider.yml`,
`Dockerfile.vercel`, the `PAYSH_INTERNAL_KEY` shared-secret gate) has been in
place and unchanged since 2026-08-19 -- see "pay.sh listing: internal proxy
routes" below. The pay.sh gateway itself has never been deployed: Vercel CLI
install/login, operator keypair generation and funding,
`PAY_MPP_CHALLENGE_SECRET`/`PAY_RPC_URL` setup, `vercel link` + deploy, and
submitting the deployed gateway URL through pay.sh's "List your API" form are
all still outstanding (steps 1-5 of the deployment guide). Nine build rounds
have shipped since 2026-08-19 -- currency/PDF/OCR utilities, the roadmap
routes (stablecoin depeg, DeFi yields, protocol health, NFT analytics), SEC
EDGAR fundamentals, wallet smart-money scoring, prospect enrichment,
discoverability tuning, the 34-chain EVM expansion, marketplace copy, and
yield opportunities -- none of them touch pay.sh either way. This is the one
open item on the roadmap that needs a person at a keyboard running `vercel`
commands rather than another API build; everything else on the public
`/v1/*` catalog and the Bazaar listing is unaffected by it being unfinished.

**Where this document was updated:** this section is new as of 2026-08-23,
added to give a single at-a-glance status point now that the per-round detail
below has grown to 30+ dated sections. No application code changed with this
update -- documentation and a backup branch only.

## Composite bundle routes (2026-08-24)

Five bundle routes layered over already-shipped functions -- one call
instead of two-to-four, one verdict instead of merging several JSON
payloads client-side. No new upstream data sources; same caching/error
conventions as every other route in this catalog.

- **`GET /v1/chain-snapshot/:chain`** ($0.012) -- gas price + latest block
  (+ native balance if you pass `?address=`) for any of the 38 chains this
  API supports: eth, sol, peaq, bsc, plus the 34-chain POKT gateway map, in
  one call instead of two or three.
- **`GET /v1/wallet-risk/:chain/:address`** ($0.045) -- wallet balance +
  wallet-smart-money activity score + OFAC sanctions screening for an eth or
  sol address, one call and one verdict instead of three.
- **`GET /v1/domain-trust/:domain`** ($0.32) -- brand-verify's
  uptime/performance/IP-intel trust score plus x402-seller-trust's
  Bazaar-listing/manifest/resource-probing reputation for the same domain,
  combined into one score and verdict. Priced as a bundle ($0.32) rather
  than the sum of the two standalone routes ($0.23 + $0.27 = $0.50). Works
  for any domain, not just active x402 sellers.
- **`GET /v1/defi/precheck`** ($0.028) -- stablecoin depeg status + top DeFi
  yield pools + protocol/chain health score for one protocol or chain,
  rolled into a "anything obviously wrong before I deploy capital here"
  verdict. Priced below the sum of the three standalone routes.
- **`GET /v1/pokt/pulse`** ($0.095) -- Pocket Network (Shannon)
  service-demand + supplier landscape + tokenomics + throughput leaderboard
  in one call instead of four. Priced below the sum of the four standalone
  routes.

Shipped via PR #15 (`feature/2026-08-24-bundle-routes` -> `main`), backed up
as `backup/verified-working-2026-08-24-v1w`.

**Also this round: x402 client-library version bump, Solana settlement still
unresolved.** Bumped `@x402/core`, `@x402/evm`, `@x402/express`,
`@x402/extensions`, `@x402/svm` from `2.20.0` to `2.23.0` (PR #14) on the
theory that the real $0.25 Solana USDC payment failure against
`/v1/yield/best-opportunities/*` was a version-drift issue between this
server's dependencies and current x402 v2 client libraries. Retested after
redeploy with a real funded CDP-managed Solana test wallet across four
different client approaches (raw `ExactSvmScheme` + manual registration, the
documented `registerExactSvmScheme` helper, a CDP-account-bridged signer,
and CDP's own native `CdpX402Client`) -- all four hit the same or an
equivalent facilitator/client-side rejection
(`'paymentPayload' is invalid: must match one of [x402V2Pay...` or, for
`CdpX402Client`, "no network/scheme registered" since its default config
only registers Base). The version bump shipped regardless since it's a
reasonable dependency hygiene update on its own merits, but it did not fix
the underlying issue. Root cause is unconfirmed but is most likely a deeper
incompatibility between this server's Solana sponsored-transaction `extra`
fields (`feePayer`/`recentBlockhash`/`lastValidBlockHeight`) and what
current x402 v2 client libraries can consume -- an ecosystem-level gap, not
something fixable from this repo alone. Base now also goes through the CDP facilitator (added 2026-08-24, see
"Base mainnet payment option" below) and is unaffected -- this is specific
to the Solana leg. Polygon/Arbitrum/World are NOT yet wired in as payment
networks despite an earlier scoping pass (2026-08-04) -- that work covered
data-read routes across many chains, not payment acceptance; only Solana
and Base currently accept payment via CDP. Treating this as a known,
open item rather than continuing to debug it client-side -- see git history
around 2026-08-23/24 for the full investigation if it needs revisiting.


## Base mainnet payment option (2026-08-24)

Added Base (chain ID 8453, CAIP-2 `eip155:8453`) as a second payment
network alongside Solana on every route, routed through the same CDP
facilitator. Reuses `PEAQ_PAY_TO_ADDRESS` as the default Base payout wallet
(EVM addresses are chain-agnostic, so no new secret was needed to activate
this) -- set `PAY_TO_ADDRESS_BASE` explicitly in Portainer if a dedicated
Base wallet is preferred later.

This was built as a direct fallback after finding CDP's `/verify` endpoint
returns self-contradicting schema errors specifically for the Solana
`exact` scheme (see the "Known issue" section above and
`CDP-support-bug-report-solana-x402-verify.md`, filed with CDP support
2026-08-24) -- the identical request shape validates cleanly for EVM/Base,
confirmed via direct `/verify` testing before writing any server code.

Also fixed `toX402V1CompatShape()` in `x402Middleware.js` to translate
CAIP-2 network ids to CDP's plain wire aliases (`base`, `base-sepolia`,
`solana`, `solana-devnet`) only at the outbound CDP request boundary --
confirmed empirically that CDP's schema validation wants plain aliases, not
CAIP-2, at that specific point. This doesn't fix the Solana issue (still
open with CDP support) but makes its failure mode more informative, and is
what makes Base's request shape validate correctly.

**Status as of merge:** code is live on `main` (PR #18) and Portainer has
been redeployed. NOT yet confirmed with a real on-chain settled Base
payment -- next person to touch this should run a live payment test against
any route with a Base-capable wallet (any EVM wallet holding a small amount
of USDC on Base) before relying on this in production. Backup branch:
`backup/verified-working-2026-08-24-base-evm`.

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

**Update (2026-09-05):** a real-money test pass found this route failing
again, live -- a *different* failure than the one above (this one never
even reaches payment verification; it's a crash inside the route's own
outbound DNS-pinned fetch). The size/discovery-metadata fix above is still
correct and untouched. See "First real end-to-end paid Solana test pass,
and a DNS-lookup bug fix (2026-09-05)" further down for the new root cause
and fix.

## puppeteer-render: headless-Chrome screenshots (2026-08-15)

Added `GET /v1/render/screenshot` -- a headless-Chrome screenshot of any
caller-supplied URL (PNG, returned base64-encoded in JSON). This is the
first route on this server whose compute is heavier than a lightweight
JSON/RPC pass-through, so it's built differently from everything else here
and worth documenting.

**Separate container, not bundled into the main app.** Every other route
runs a few hundred ms and near-zero RAM inside `onchain-snapshot-api`.
Launching headless Chrome is 100-300MB RAM and real CPU per call --
running that inside the main app's process would let a burst of
screenshot requests starve or crash the JSON routes sharing that event
loop. `puppeteer-render.js` ships as its own docker-compose service
(`puppeteer-render`, no ports published, reached only by service name over
the docker network), the same isolation pattern already used for
`sol-rpc-cache` and `peaq-facilitator`. `dataSources.js`'s
`getPuppeteerScreenshot()` does the SSRF hostname check (reusing the exact
same `isBlockedTarget()` denylist that guards `getUprockFetch`) and then
calls that internal service over HTTP.

**Alpine + system Chromium, not the bundled `puppeteer` package.**
`puppeteer`'s own postinstall step downloads a Chromium build with no
prebuilt Alpine/musl binary. `puppeteer-render.Dockerfile` installs
Alpine's `chromium` apk package instead and points `puppeteer-core`
(which never tries to download its own browser) at it via
`PUPPETEER_EXECUTABLE_PATH`. Expect a noticeably longer first build for
this one service than the others in this stack.

**One long-lived browser instance, bounded concurrency.** Launching a
fresh Chrome process per request would dominate render time entirely, so
`puppeteer-render.js` keeps one browser alive across requests and opens a
new page per call. A small semaphore (`MAX_CONCURRENT_PAGES = 2`) queues
requests past that cap instead of letting an unbounded burst OOM the
container -- queued requests still complete, just serially, bounded by a
15s per-page navigation timeout.

**Pricing ($0.03/call):** unlike the UpRock-backed routes, there's no
per-call upstream credit cost here -- the compute is entirely
infrastructure this project already runs -- but a real Chrome render is
meaningfully heavier than the sub-cent RPC pass-through routes, so it sits
mid-tier rather than at the bottom. Revisit once real render volume shows
actual infra cost.

**Discovery-extension content kept deliberately minimal** (short
description, no embedded `screenshotBase64` in the example) -- directly
applying the lesson from the seller-trust root-cause writeup above: a
large/deeply nested Bazaar discovery-extension declaration was the
confirmed cause of that route's live-payment failures, independent of
price or URL structure. No reason to risk repeating it here.

**Status as of this write-up:** live-tested successfully -- the first real
payment attempt against this route settled on the first try (no repeat of
the seller-trust size-rejection failure above), confirming the minimal
discovery-extension practice holds up in production, not just in theory.

## HEIC to PNG conversion (2026-08-15)

Added `GET /v1/convert/heic-to-png` -- converts a caller-supplied HEIC/HEIF
image URL to PNG, returned base64-encoded in JSON (same response shape as
`render/screenshot` above, for the same reason: every route on this server
returns JSON, not a second binary-response code path). Built right after
`puppeteer-render`, and worth contrasting with it: this route needed none
of that architecture.

**No separate container.** Unlike Puppeteer, `heic-convert` (the npm
package backing this route) is pure JavaScript -- it wraps `libheif-js` (a
WASM build of libheif) plus `pngjs`/`jpeg-js` for encoding, with zero
native or system-library dependencies. There's no `apk add` step and no
second docker-compose service the way `puppeteer-render` needed one --
`getHeicToPng()` runs in-process in the existing `onchain-snapshot-api`
image after a single `npm install heic-convert`. This is the real
architectural distinction between the two routes shipped this session:
Puppeteer needed isolation because headless Chrome's resource footprint
(100-300MB RAM, real CPU per render) is a different order of magnitude
from this file's other routes; HEIC decoding via WASM is not.

**Size cap and SSRF hardening.** The source image is capped at 20MB
(`HEIC_MAX_INPUT_BYTES`) -- checked against the `content-length` header
where present and re-checked against the actual downloaded buffer size
either way, since an unbounded upstream response decoded straight into
memory is a real way to OOM this container, the same class of risk already
flagged for `getUprockFetch`/`getPuppeteerScreenshot`. The source URL is
checked against the same `isBlockedTarget()` denylist every other
buyer-supplied-URL route in `dataSources.js` reuses.

**Pricing ($0.005/call):** pure compute, no upstream credit cost -- same
bottom tier as `geo/ip`, priced as a cheap, boring, high-frequency utility
rather than a judgment-tier composite route.

**Discovery-extension content kept deliberately minimal**, same reasoning
as `render/screenshot` above: the seller-trust root-cause writeup earlier
in this file identified a large/deeply nested Bazaar discovery-extension
declaration as the confirmed cause of that route's live-payment failures.
`pngBase64` is left out of the example output for the same reason
`screenshotBase64` was left out of `render/screenshot`'s.

**Status as of this write-up:** built, pushed, and syntax-checked.

## Web search: self-hosted SearXNG (2026-08-16)

Added `GET /v1/search/web` -- takes a caller-supplied query string and
returns title/url/snippet/engine per result, backed by a self-hosted
[SearXNG](https://docs.searxng.org/) instance (a free, open-source,
keyless metasearch engine that aggregates 70+ upstream engines: Google,
Bing, DuckDuckGo, and others). This is the first route in this file whose
buyer input is a query string rather than a URL, so there's no
buyer-controlled target host to SSRF-check the way every UpRock/render/
HEIC route above needs -- the only thing this route ever fetches is our
own internal `searxng` container.

**Own infra, not a paid search API.** Same "own the infra, keep the
margin" reasoning as `heic-convert`, but packaged as its own container
(like `puppeteer-render`) rather than an in-process npm package, since
SearXNG ships as a ready-made Docker image with its own Python/uwsgi
runtime -- there's nothing of this project's own to build or npm-install.
`searxng-settings.yml` (mounted read-only into the container) turns on two
things that are OFF by default upstream, confirmed directly from SearXNG's
own docs, not assumed: JSON output format (`search.formats: json`) and,
since this instance is internal-only and never reachable from outside the
docker network, SearXNG's own bot-detection rate limiter (`server.limiter:
false`) -- left on, it would block this project's own JSON requests, since
it's aimed at public-facing deployments getting scraped.

**Pricing ($0.008/call):** positioned between Exa ($0.004) and Tavily
($0.01), the two closest live x402-marketplace search comparables found
during the marketplace gap-analysis research. No per-call upstream credit
cost (self-hosted, free, keyless) -- same margin story as `heic-to-png`.

**Known caveat, disclosed honestly:** SearXNG works by scraping the HTML
result pages of upstream search engines. That's inherently less stable
than a real search API -- an upstream engine changing its markup, or
rate-limiting/blocking this box's IP, can degrade or break results without
warning. Acceptable at this project's current volume; revisit (e.g. swap
in a paid engine like Tavily/Brave behind the same route signature) if
reliability becomes a real problem.

**Discovery-extension content kept deliberately minimal**, same reasoning
as every route added since the seller-trust root-cause writeup earlier in
this file.

**Status as of this write-up:** built, pushed, and syntax-checked --
NOT yet live-tested against a real payment. The `searxng` container is
also new to the stack, so its first Portainer deploy pulls the official
image fresh rather than rebuilding a locally-built image.

## Agent reputation: ERC-8004 lookup (2026-08-16)

Added `GET /v1/agent/reputation/:agentId` (optional `?chain=eth|bsc`) --
looks up an AI agent's on-chain identity and aggregated feedback via the
[ERC-8004 "Trustless Agents"](https://eips.ethereum.org/EIPS/eip-8004)
standard. Distinct from every other trust/verification route already on
this server: `brand-verify`/`x402-seller-trust` score domains and x402
sellers, `pokt-supplier-trust` scores POKT infrastructure operators, and
`peaq/machine-verify` verifies IoT/machine identity -- none of them answer
"does this AI agent have a real, on-chain track record."

**Registry addresses confirmed from source, not assumed.** ERC-8004's
Identity and Reputation registries are deployed via CREATE2 at the same
address on every supported EVM chain (confirmed live from
`erc-8004/erc-8004-contracts`'s own GitHub README across dozens of chains,
including both Ethereum and BSC mainnet, which this project already has
RPC access to) -- so this one route supports multiple chains with zero
per-chain contract-address configuration. Only `eth` and `bsc` are wired
up here since those are the only two chains this project already has an
RPC endpoint for; ERC-8004 has no live deployment on peaq or Solana.

**ABI semantics verified against the actual Solidity source**, not the
spec prose -- this project's established discipline after past incidents
(the peaq asset-name bug, POKT's empty `relays` connection) where trusting
documentation over live/source behavior caused real bugs. Specifically:
`readAllFeedback`'s empty `tag1`/`tag2` string parameters mean "no
filter" (the contract compares `keccak256(tag)` against `keccak256("")`
to decide whether to apply a filter at all), and an empty
`clientAddresses` array makes the contract default to its full stored
client list internally -- both read directly from
`ReputationRegistryUpgradeable.sol`, not assumed from the written EIP.

**Uses `ethers` for ABI encode/decode only.** Added purely for its
`Interface` class (`encodeFunctionData`/`decodeFunctionResult`) --
deliberately NOT using ethers' own Provider/network stack. The actual
JSON-RPC round trip reuses this file's existing `rpcCall()` helper, the
same one every other `eth_call` in `dataSources.js` goes through, rather
than introducing a second RPC-calling pattern. Reasoning: a silent
hand-rolled ABI-decode bug (serving a wrong reputation score with no
error) is a worse failure mode than a thrown error, so this leans on a
well-tested library for that one piece rather than hand-rolling
dynamic-array/string ABI codec logic.

**Bounded processing.** `ERC8004_MAX_FEEDBACK_ENTRIES` caps client-side
feedback aggregation at 2000 entries -- an agent with an unusually large
feedback history shouldn't turn one x402-paid call into unbounded
processing, same Three S Framework discipline already applied to every
other aggregate/composite route in this file.

**Pricing ($0.03/call):** same tier as `peaq/machine-verify`, the closest
architectural analog -- a small number of read-only `eth_call`s against a
known contract, no external paid API.

**Discovery-extension content kept deliberately minimal**, same reasoning
as every route added since the seller-trust root-cause writeup. The
example `agentId` (`47167`) is a real agent ID surfaced during the
marketplace gap-analysis research (an `agentutility`/x402.agentutility.ai
listing on x402scan), chosen as a plausible real test candidate --
though this hasn't been confirmed to actually be a minted ERC-8004 agent
on Ethereum or BSC specifically. If it isn't, the route should gracefully
return `registered: false`, which is itself a valid test of that code
path.

**Status as of this write-up:** built, pushed, and syntax-checked --
NOT yet live-tested against a real payment.

## Historical/indexed chain data: Tier A (2026-08-16)

Added two routes answering the "historical/indexed chain data" gap flagged
as recommendation #2 in the agentic-marketplace gap analysis (2026-08-15):
`GET /v1/eth/logs` and `GET /v1/sol/history/:address`. Both are a step up
from every existing chain route on this server, which are all single-value
snapshots (gas price, latest block, balance) -- these two answer a *range*
query instead.

**"Tier A" vs "Tier B."** Two architectures were researched for this gap:
a zero-dependency bounded pass-through against RPC infra this project
already has (Tier A, built here), and paid-free-tier indexed APIs like
Etherscan V2 (multichain `eth_getLogs`/`eth_getTransactionsByAddress`) and
Helius (Solana, genesis-to-now history) that need a signup and an API key
(Tier B, deferred -- see below). Tier A ships first because it needs zero
new dependencies, zero new containers, and zero new env vars: both routes
reuse the exact same `ETH_RPC_URL`/`SOL_RPC_URL` already wired up for the
snapshot routes above. That also made this the lowest-risk build round on
this project to date -- no new bind mount, no new Docker image, nothing
that could repeat the searxng crash-loop incident two sections up.

**Scoped to ETH + Solana only.** BSC and peaq were deliberately left out
of this round. BSC's raw `eth_getLogs` block-range limit isn't documented
anywhere reliable, and peaq has no confirmed indexed-data surface at all
(its only real option, Subscan, speaks a Substrate extrinsics/events
model -- structurally different from every other EVM route on this
server, not a drop-in). Revisiting both is future work, not ruled out.

**`GET /v1/eth/logs`** (`?address=...&topic0=...&blocks=...`) wraps
`eth_getLogs`. Public RPC providers reject queries over some
undocumented per-provider block-range ceiling -- real-world limits found
during research ranged from as low as ~1,000 blocks to 100,000 blocks
depending on provider, and this project's default endpoint
(`eth.llamarpc.com`) doesn't publish its own number anywhere checked.
Rather than guess and risk a live rejection in production, the route
computes its own range server-side (anchored to the current latest block,
never a caller-supplied `fromBlock`/`toBlock`) and hard-clamps it to 1,000
blocks regardless of what a caller asks for -- so a request for 50,000
blocks silently gets the max safe window back instead of an upstream
error. Results are also capped at 500 logs (`truncated: true` if a query
matched more) so one call against a high-traffic contract can't return an
unbounded payload. The response is explicit that this is "recent history,
not full-archive."

**`GET /v1/sol/history/:address`** (`?limit=...`) wraps
`getSignaturesForAddress`. Unlike `eth_getLogs`, this one has a hard,
documented ceiling built into the Solana RPC spec itself: max 1,000
signatures per call. This route defaults to 20 and clamps to a max of
100 (well under the spec ceiling, since response payload size scales
linearly with `limit` and this is priced/cached as a "recent activity"
check, not a bulk export). Each signature comes back with its slot,
block time, confirmation status, and error flag -- everything
`getSignaturesForAddress` already returns -- with no follow-up
`getTransaction` call per signature, keeping this a single RPC round
trip per request, same shape as every other route in this file.

**Pricing:** `/v1/eth/logs` at $0.012/call, `/v1/sol/history/:address` at
$0.01/call -- both above the $0.005 single-value-snapshot tier (a range
query does more work than a single read), and below the $0.03
composite-trust-score tier (no aggregation/scoring logic, just a bounded
pass-through). The ETH route is priced slightly higher than the Solana
one to reflect its extra `eth_blockNumber` call (two RPC round trips vs.
one).

**Discovery-extension content kept minimal**, same discipline as every
route added since the seller-trust root-cause writeup. `/v1/sol/history`'s
example address is Solana's own USDC mint
(`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) -- a real, well-known,
high-activity address, chosen so the example is actually testable.

### Deferred: Tier B (indexed APIs, not built this round)

Noted here for future review, per the decision to ship Tier A first:

- **Etherscan V2** -- one free API key now covers 50+ EVM chains
  (including Ethereum and BSC) via a `chainid` parameter, with no
  meaningful block-range ceiling on `getLogs` the way raw RPC has. Free
  tier is 5 req/sec shared across all chains. BSCScan's standalone API is
  deprecated in favor of this. **Open question:** some sources describe
  free-tier chain coverage as "90%, not universal" -- BSC's specific
  free-tier status wasn't independently confirmed and needs a live check
  (a real signup + a real call) before it's added to any route.
- **Helius** (Solana) -- has a purpose-built historical-data product that
  can return an address's full history since genesis, not just a recent
  window, which is a strictly stronger answer to "historical Solana data"
  than this round's `getSignaturesForAddress` wrapper. Free tier
  available. The most direct, least-caveated option of everything
  researched -- the natural first Tier B candidate if/when API keys get
  provisioned.
- **peaq** -- no confirmed mainnet Blockscout/EVM-explorer instance was
  found (`scout.agung.peaq.network` is the Agung *testnet* only). The
  only real indexed-data option is Subscan, which speaks a Substrate
  extrinsics/events model, not `eth_getLogs` -- not a drop-in alongside
  this project's other EVM routes. Needs its own design pass, not just an
  API key.
- **BSC** (Tier A) -- could still get its own bounded `eth_getLogs` route
  later using the same pattern as `/v1/eth/logs` above, once
  `BSC_RPC_URL`'s real block-range ceiling is confirmed live rather than
  assumed.

Building any of these means: signing up for a real API key, confirming
free-tier limits live (not from documentation alone -- this project's
established discipline after the ERC-8004 registry-address and peaq
asset-name lessons), and adding the new env var(s) to `docker-compose.yml`
following the same graceful-no-op-if-unset pattern as `UPROCK_API_KEY`.

## OFAC sanctions screening (2026-08-16)

Third build round of the day, following the historical chain-data round
above. Adds `GET /v1/compliance/sanctions-check/:address` — screens an
Ethereum or Solana address against OFAC's published Specially Designated
Nationals (SDN) list, direct match only.

**Data source.** OFAC's authoritative source is `sdn_advanced.xml`
(~80MB, relational schema — names, addresses, documents, and digital
currency IDs live in separate linked structures, not flat records):
<https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml>.
Parsing that directly for a lightweight per-address lookup is more than
this route needs. Instead this uses the `lists` branch of
[0xB10C/ofac-sanctioned-digital-currency-addresses](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses)
(MIT-licensed) — a GitHub Actions workflow re-extracts and republishes
that exact same OFAC XML nightly at 0 UTC as plain per-asset text files,
one address per line. Verified directly by fetching both files before
building this: the ETH list carried ~90 addresses and the SOL list
carried 1 address as of 2026-08-16.

**Scoped to ETH + Solana only**, same discipline as the historical
chain-data round. The source also covers XBT, LTC, ZEC, DASH, BTG, ETC,
BSV, BCH, XVG, USDC, USDT, XRP, TRX, ARB, and BSC — extending this route
to any of those is a config change (add a `chain` entry to
`OFAC_LIST_URLS` in `dataSources.js`), not a redesign, if demand shows up
for another chain.

**Caching.** The list is fetched once and held in an in-process
module-level cache with a 6-hour TTL, separate from the per-request
`cached()` helper used by every other route in `server.js`. That helper
caches a whole response by request key; what needs caching here is the
multi-KB list itself, shared across every address lookup regardless of
which address is asked about. Once the list is loaded, answering a
specific address is a free `Set.has()` — not worth caching again on top
of that. 6 hours just bounds how stale this server's own copy can get
between the source's nightly (0 UTC) regenerations; it isn't a real-time
freshness guarantee, and every response reports its own `listSyncedAt`
timestamp so a caller can see exactly how fresh the answer is.

**What this route does and doesn't do.** This is a *direct* address
match against the published list — nothing more. It does not do
multi-hop / indirect-exposure clustering (funds that passed through a
sanctioned address via one or more intermediary wallets are not flagged),
which is the harder, higher-value problem commercial products like
Chainalysis's Sentinel solve. Every response's `note` field says this
explicitly, and the route is priced accordingly — a real, legally
meaningful check (screening against OFAC's own public list is the
minimum bar most compliance obligations require), but not a full
compliance program on its own.

**Pricing:** $0.015/call — above the $0.01–$0.012 bounded-lookup tier
(this involves loading and holding a real government data list, not just
a stateless RPC pass-through) and below the $0.03 composite-trust-score
tier (no multi-source aggregation or scoring logic, just a set-membership
check).

**Zero new dependencies, zero new containers, zero new env vars required**
(two optional ones — `OFAC_ETH_LIST_URL` / `OFAC_SOL_LIST_URL` — let the
source URLs be overridden without a code change, same pattern as every
other externally-sourced URL in this file, but both have working
defaults baked in).

## UpRock sweep-poll backoff (2026-08-17)

Small operational fix, not a new route. UpRock flagged (unprompted, while
answering pricing questions this project asked) that this account's Sweep
jobs were averaging ~21 status-poll reads each -- a byproduct of
`pollSweepUntilDone()` in `dataSources.js` polling the sweep-status
endpoint at a flat 2-second interval against a 45-second ceiling (up to
~22 reads worst case). Reads don't cost credits, but they're a
rate-limit surface independent of job volume/credit limits, and worth
fixing before real production traffic hits `/v1/uprock/verify/:domain`.

**Fix:** the poll interval now grows (`VERIFY_POLL_BACKOFF_FACTOR = 1.3`)
from the same 2-second starting point up to a 6-second cap
(`VERIFY_POLL_MAX_MS`), instead of holding flat. Sweeps that finish
quickly -- UpRock's own quoted 15-30s window covers most of them -- see
essentially the same responsiveness as before, since the interval barely
grows in that window. Sweeps that run closer to the full 45-second
ceiling see roughly half the total reads (~10 instead of ~22).

**Pricing sanity check, while on the subject.** UpRock also confirmed
Sweep bills 3 credits/job linearly (no bundle discount at 3 regions) and
Crawl bills 1 credit/job. At their new Pro ($20/10k credits) and
Business ($99/100k credits) tiers, that works out to roughly $0.006 and
$0.003 per Sweep respectively in underlying cost, against this project's
$0.15/call price for `/v1/uprock/verify/:domain` -- a wide margin, not a
mispriced route.

Zero new dependencies, zero new env vars, zero route/pricing changes --
purely an internal polling-behavior fix.

## pay.sh listing: internal proxy routes (2026-08-19)

[pay.sh](https://pay.sh) (Solana Foundation) is a second discovery surface for
this catalog, alongside x402 Bazaar -- worth pursuing because it's Solana-
native (matches this project's primary settlement chain) and its
CRYPTO/FINANCE category already carries comparable services (Nansen, Birdeye,
Vybe Solana Analytics, smartmoney.market). Ten routes were selected for
listing -- the six POKT Shannon routes, `peaq/machine-verify`,
`compliance/sanctions-check`, `brand-verify`, and `x402/seller-trust` --
because nothing on pay.sh's current catalog covers Pocket Network, peaq
machine trust, or x402-seller trust scoring. The commodity RPC routes
(gas price, latest block, wallet balance) were deliberately left off: pay.sh
already lists Quicknode with 137 endpoints and a free tier covering that same
lane far more comprehensively.

**Why this needed new routes, not just a listing submission.** pay.sh isn't
a catalog you submit a URL to -- it's a separate payment gateway
(`pay gate api`) you run yourself, driven by a provider YAML spec, that does
its own 402 handshake on its own infrastructure and then proxies the
already-paid request to an upstream URL. Pointed straight at this app's
public `/v1/*` routes, that would fail: this app's own `buildX402Middleware()`
has no way to know pay.sh already collected payment, so it would 402 the
(already-paid) request again.

**Fix:** `/internal/paysh/*` -- ten routes in `server.js`, deliberately NOT
registered in `x402Middleware.js`'s `routes` map (so `buildX402Middleware()`
never touches them; unregistered paths pass straight through Express).
Gated instead by a shared secret only pay.sh's provider spec knows:
`X-Internal-Key`, checked against `PAYSH_INTERNAL_KEY` in a small middleware
that fails closed -- if that env var is unset, every request under
`/internal/paysh` 503s rather than silently serving the catalog for free.
Cache keys are shared with the matching public route, so a pay.sh-routed call
and a direct call for the same resource hit the same cache entry instead of
doubling upstream load.

**Setup still needed (not done by this patch):** generate a value for
`PAYSH_INTERNAL_KEY` and set it in Portainer; deploy pay.sh's gateway itself
(Vercel or GCP Cloud Run -- see `paysh-provider.yml` in this repo and
https://pay.sh/docs/building-with-pay/deployment/overview) pointed at this
app's public URL + `/internal/paysh/...` paths, with the same key injected
via the spec's `routing.auth` block; submit the deployed pay.sh gateway URL
through pay.sh's "List your API" form. None of that is required for the
existing public `/v1/*` catalog or Bazaar listing -- this is purely additive.

**Status (2026-08-22): paused here, pick up at step 5 of the deployment guide.** Steps 1-4 of `paysh-gateway-vercel-deployment-guide.md` (Vercel CLI install/login, operator keypair generation, funding it with SOL, generating `PAY_MPP_CHALLENGE_SECRET`/choosing `PAY_RPC_URL`) have NOT been executed yet -- this got shelved to build three new public routes (currency conversion, webpage-to-PDF, image OCR) instead. Nothing about that other work touches this: `paysh-provider.yml`, `Dockerfile.vercel`, and the `/internal/paysh/*` routes are all still in place, unchanged, ready to resume from step 5 (`git clone` + `vercel link`) whenever this is picked back up. **Confirmed still accurate as of 2026-08-23** -- no further pay.sh work has happened since this was written; see "Status summary & version log" near the top of this README for the running tally of what has shipped in the meantime.

## New utility routes: currency conversion, webpage-to-PDF, image OCR (2026-08-22)

Three new routes, all priced at **$0.01/call** -- a deliberate undercut of the
~$0.02 median found on live Bazaar comparables researched the same day, to
take share in categories with real (if early) proven demand rather than
match the market rate.

- **`GET /v1/currency/convert`** -- ECB daily reference rates via
  [Frankfurter](https://frankfurter.dev), a free/keyless upstream (no API
  key, no per-call credit cost -- same "own the margin" pattern as
  `search/web`'s self-hosted SearXNG). Comparables researched: Otto AI
  ($0.01, 35 calls/22 payers -- the highest payer-density signal found in
  this category), NetIntel ($0.10, 136 calls/6 payers), Vibe Springs
  ($0.02, 130 calls/7 payers).
- **`GET /v1/render/pdf`** -- webpage-to-PDF, via the existing
  `puppeteer-render` container (same headless-Chrome service backing
  `render/screenshot`; this just adds a second endpoint using Puppeteer's
  `page.pdf()`, no new container). Closest comparable: Relaystation's
  URL-to-PDF at $0.02/render, 29 calls/30d, 1 payer -- a real but still
  early niche.
- **`GET /v1/image/ocr`** -- Tesseract OCR on an image URL, also added to
  the `puppeteer-render` container (isolated from the main API process for
  the same CPU/RAM-isolation reason as the screenshot/PDF routes) rather
  than a new one. Comparables researched: mostly $0.05-0.10/call for
  scanned-PDF OCR; the plain-image-OCR niche is thinner but growing (newest
  entrant found already at 11 calls/2 payers within its first month).

All three reuse this file's existing `isBlockedTarget()` SSRF denylist
(currency conversion takes no URL, so it doesn't need it) and existing
`cached()` helper -- no new caching or security infrastructure, same
pattern as every route added since `render/screenshot`.


## Roadmap: 10 replicable data products, ranked by build difficulty (2026-08-22)

Following the currency/PDF/OCR build round, researched the top 10 aggregated-data products sold by larger companies (staking/yield aggregators, wallet-labeling services, KYB providers, terminal-style analytics, domain-authority scorers) that Alpha7 could replicate cheaply on free/keyless upstreams and existing infrastructure. Ranked here by ease-of-build/deploy-speed for a roughly one-week rollout at 1-2 shipped per day, not by demand-signal (that ranking was delivered in chat and isn't duplicated here). Two items are flagged as modifications to existing routes rather than new services, per standing principle: prefer extending a current offering over shipping a new one when the opportunity exists.

**Day 1 -- stablecoin depeg monitor (new, tiny) + x402-seller-trust economic-proof upgrade (modify existing `x402_seller_trust` route, no new route/price, adds a settlement-volume/distinct-payer signal via the same CDP discovery-API pattern already in the codebase).**

**Day 2 -- whale-transfer alert route (new thin route built on the existing `getEthLogs()`, adds a USD-value threshold filter; kept as its own listing rather than folded into `eth/logs` because the buyer intent -- "alert me to whale moves" -- differs from "give me raw logs," same reasoning that justified `seller-trust` as its own product on top of existing primitives -- flagged here for discussion, could alternatively ship as free query params on `eth/logs` instead) + domain-authority-into-brand_verify upgrade (modify existing `brand_verify` route, folds in a Tranco top-1M rank as one more composite signal, no new charge).**

**Day 3 -- DeFi/staking yield aggregation (new route, single free API at yields.llama.fi/pools, fetch+filter+sort+cache, matches the shape of existing routes closely).**

**Day 4 -- protocol/chain health composite (new route, shares the DefiLlama upstream built on Day 3, adds a fees/revenue join plus composite scoring similar to brand_verify's pattern).**

**Day 5 -- NFT collection analytics (new route, two upstreams -- CoinGecko NFT API and Magic Eden API -- normalized across chains, composite market-health scoring).**

**Days 6-7 -- SEC EDGAR company fundamentals (new route, needs a ticker-to-CIK mapping table plus XBRL facts parsing, which varies by company/taxonomy -- more edge-case handling than anything above it).**

**Beyond this week (flagged as multi-day, not forced into the 1-2/day cadence):**
- KYB/business verification composite -- new multi-route family, different query formats per country registry, fuzzy name matching, reuses the existing `getSanctionsCheck()`.
- Wallet smart-money scoring -- hardest build on the list, needs real PnL reconstruction from raw transfer/swap history; correctly last.
  - **Reviewed 2026-08-22:** Pocketdex doesn't apply here -- Shannon's GraphQL indexer only exposes Pocket Network's own chain state (suppliers/validators/relays on POKT itself), not third-party wallet activity on Ethereum or Solana. The RPC-gateway angle does apply and has already been adopted project-wide (see the Infra note below) -- POKT solves the RPC-access piece of this build but not the harder swap-decoding/historical-pricing/cost-basis-accounting design still needed.

**Progress (2026-08-22):** Day 1 shipped as 3 modifications + 1 new route (see PR #1, merged to main, backup branch `backup/verified-working-2026-08-22-round2`): x402_seller_trust gained approxSettledUsd30d, brand_verify gained a Tranco domain-rank signal, eth/logs gained optional whale-transfer filtering (decimals/tokenUsdPrice/minUsd), and GET /v1/stablecoin/depeg-check shipped as the first new route off this list. Day 3 shipped same-day as a new route (see PR #2, merged to main, backup branch `backup/verified-working-2026-08-22-round3`): GET /v1/defi/yields, sourced live from DefiLlama's free /pools index, with chain/project/symbol/stablecoin filters, a minimum-TVL floor, outlier exclusion, and apy/tvl sort -- 10min cache given the upstream's own refresh cadence. Day 4 also shipped same-day as a new route (see PR #3, merged to main, backup branch `backup/verified-working-2026-08-22-round4`): GET /v1/protocol/health, a composite 0-100 score for a single DeFi protocol (by name/slug) or a whole chain (aggregate across every protocol live on it), joining DefiLlama's free /protocols, /overview/fees, and /overview/fees?dataType=dailyRevenue endpoints -- TVL scale, 7d momentum, fee-generating efficiency, chain diversification, and token valuation sanity, same additive-scoring pattern as brand_verify's trust score. Day 5 also shipped same-day as a new route (see PR #4, merged to main, backup branch `backup/verified-working-2026-08-22-round5`): GET /v1/nft/analytics, a composite 0-100 health score for an NFT collection (by CoinGecko id/slug, or by contract address + chain) -- market cap scale, 7d floor-price momentum, 24h volume/mcap liquidity, holder-distribution ratio, and cross-collection market-cap rank, sourced from CoinGecko's free NFT API alone (the original two-upstream plan with Magic Eden was dropped once research showed CoinGecko's own /nfts/{id} endpoint already normalizes floor price, volume, holders, and rank across every chain it tracks -- fewer moving parts, consistent with the discipline applied since seller-trust's Bazaar-discovery incident). Remaining: SEC EDGAR company fundamentals (Days 6-7), KYB/business verification composite, and wallet smart-money scoring.

**Infra note (2026-08-22):** reviewed the POKT angle flagged above under wallet smart-money scoring before building anything further off this list. Pocketdex (Shannon's GraphQL indexer) turned out not to apply -- it only exposes Pocket Network's own chain state (suppliers, validators, relays/sessions on POKT itself), with no visibility into third-party wallet activity on Ethereum or Solana, so that half of the original note is corrected here rather than carried forward. The RPC-gateway angle held up under live testing: Pocket Network Foundation's free, keyless public gateway (`eth.api.pocket.network`, `solana.api.pocket.network`) served real archive-depth data (`eth_getLogs`, `eth_getBalance` at block 1,000,000, `eth_getBlockByNumber` at block 1, Solana `getSignaturesForAddress`) with no throttling under a 25-request concurrent burst, backed by 5,000+ independent node operators rather than one provider. `ETH_RPC_URL`/`SOL_RPC_URL`'s defaults in `dataSources.js` were swapped from `eth.llamarpc.com`/`api.mainnet-beta.solana.com` to POKT's public gateway on this basis (see PR #5, merged to main, backup branch `backup/verified-working-2026-08-22-round6`) -- a project-wide upgrade benefiting every existing RPC-backed route (eth/gas, eth/block, eth/balance, eth/logs, sol/*, whale-transfer filtering, ERC-8004 lookups), not just the wallet-scoring build it was originally flagged for. This only changes the code default -- the live Portainer stack's `ETH_RPC_URL`/`SOL_RPC_URL` environment variables must also be updated to the new URLs and the stack redeployed for this to take effect in production, since a set Portainer env var overrides the code default. `BSC_RPC_URL` was left on its existing public default (`bsc-dataseed.binance.org`) for now -- POKT does serve BSC (`bsc.api.pocket.network`) but that swap wasn't part of what was reviewed/approved here. Self-hosted PATH (Pocket's own gateway framework) remains a documented later option if the free tier's fair-use limit (~15-25 req/s) is ever outgrown, with published per-chain pricing (~$1.58/M relays on Ethereum, ~$5.03/M on Solana). Wallet smart-money scoring itself is unaffected in scope by this -- POKT solves the RPC-access piece but not the harder swap-decoding/historical-pricing/cost-basis-accounting design still needed before that route can be built.


No build has started on any of these 10 items -- this section is a planning note only. Each item still needs explicit go-ahead before work begins, per the research -> rank -> document -> build-on-sign-off pattern used throughout this repo's history.

## SEC EDGAR company fundamentals (2026-08-23)

New route: **`GET /v1/sec/fundamentals/:ticker`**, priced at **$0.02/call** --
in line with the other composite/aggregated-data routes (protocol-health,
NFT-collection-analytics), reflecting that this chains three upstream calls
per lookup rather than one.

Built on SEC EDGAR's free, keyless JSON APIs (`data.sec.gov`, `www.sec.gov`)
-- no API key required, just a declared `User-Agent` identifying the caller
(SEC 403s "undeclared automated tool" requests without one; set via
`SEC_EDGAR_USER_AGENT`, defaults to a contact-email-bearing string). Rate
limit is 10 req/s per IP, well above what this route needs.

Three chained calls per lookup: (1) the ticker-to-CIK map
(`company_tickers.json`, ~800KB, cached in-process for 24h -- same
shared-not-per-request caching discipline as the OFAC list loader), (2) the
submissions API for filing history and company metadata, (3) the XBRL
company-facts API for financials. Only a curated set of the most-requested
us-gaap concepts are surfaced (revenue, net income, total assets/liabilities,
stockholders' equity, basic/diluted EPS, cash) -- the raw company-facts
payload is enormous. Server-side response is cached for 6h, since filing
data only changes a few times a year per company.

Coverage caveat: SEC's ticker map only includes SEC-registered filers
(US-listed companies and some foreign private issuers), not every
exchange-listed ticker -- a lookup for an unlisted/foreign symbol returns a
clear "no SEC-registered company found" error rather than a partial result.

## Wallet smart-money scoring (2026-08-23)

New route: **`GET /v1/wallet/smart-money/:chain/:address`**, priced at
**$0.02/call**, same tier as the other composite routes. This is the last
item from the original three-item priority list (POKT RPC swap, SEC EDGAR,
wallet scoring) -- all three are now shipped.

Deliberately scoped honestly: this is **not** an entity-labeled "smart
money" database like Nansen or Arkham, which rely on curated wallet-tagging
data this project doesn't have. What it is: a transparent, documented 0-100
heuristic built entirely from the same free RPC primitives already powering
`getEthBalance`/`getSolBalance`, `eth/logs`, and `sol/history` --
current USD-denominated balance (tiered), an activity count (Ethereum nonce
as an outgoing-tx-count proxy; Solana signature count over the most recent
100 transactions), and -- Solana only, since Ethereum's JSON-RPC has no cheap
path to a wallet's last-active timestamp without an indexer -- how recently
the wallet was last active. The score breakdown and formula are returned in
the response (`scoreBreakdown`), not just asserted, matching the disclosure
pattern used by x402_seller_trust's settlement-volume signal and
brand_verify's Tranco-rank fold-in. Supports `chain=ethereum` or
`chain=solana`; an address that resolves to a contract (checked via
`eth_getCode`) is flagged rather than scored like an EOA. 5-minute cache,
shorter than the other composite routes' since balance and activity change
in real time and the whole point of this route is current state.

## Prospect enrichment for CRM/sales agents (2026-08-23)

New route: **`GET /v1/prospect/enrichment/:chain/:address`**, priced at
**$0.03/call**. Built for CRM and sales-outreach agents working web3 leads,
who typically have a wallet address on hand (from an on-chain interaction,
a Discord/Twitter tip-jar link, a token-gated signup form) and sometimes a
company domain, but not much else.

Bundles three existing signals into one call instead of three separate paid
requests: `wallet-smart-money` (is this wallet worth pursuing),
`sanctions-check` (is it clean -- a hard stop, not just a scoring input),
and, if a domain is supplied via `?domain=`, a Tranco domain-rank lookup (is
the associated company a real, established site). Domain is optional: a
wallet-only lead, the common case, still gets a full score and verdict,
just without the `domainRank` field.

Deliberately does **not** call the full `/v1/brand-verify` pipeline for the
domain check -- that route wraps UpRock's multi-region screenshots and IP
geolocation and is priced at $0.23 for that reason, a heavier trust/safety
audit that doesn't belong bundled into a lightweight lead-scoring call.
Instead it reuses `getTrancoRank()` directly, the same free, keyless Tranco
lookup already folded into `brand_verify` -- fast and appropriately scoped
for "is this a real company" rather than "is this site live, performant,
and hosted where it claims to be."

Returns a single `verdict` and `recommendedAction` (`prioritize outreach` /
`standard outreach` / `deprioritize or skip` / `block`) rather than three
raw payloads an agent would have to reconcile itself. 2-minute cache,
matching the short-lived nature of the wallet-activity score it wraps.

## Discoverability for coding/dev agents (2026-08-23)

A handful of existing routes are also useful to software-engineering and
coding agents, not just trading/monitoring bots -- `eth/gas-price`,
`eth/latest-block`, `wallet/balance/:chain/:address`, `price/:symbol`,
`eth/logs`, `protocol/health`, and `compliance/sanctions-check/:address`
cover pre-deploy gas estimation, confirmation-depth checks, funded-wallet
pre-flight checks, smart-contract test/CI verification that expected events
fired, and compliance gates in automated onboarding flows. Their
`declareDiscoveryExtension` `description` fields were rewritten this round
to name these use cases explicitly, since that's the text agent tool-search
actually matches against on Bazaar -- the routes and pricing didn't change,
only what they say about themselves.

Quickstart for an agent hitting this from code (no SDK required to see the
shape, though most agents will use an x402 client library to build the
actual payment):

```bash
# 1. First call gets a 402 with payment requirements
curl -s -D- https://<your-host>/v1/eth/gas-price -o /dev/null | grep -i payment-required

# 2. Decode the header to see price/network/description
node -e 'console.log(JSON.stringify(JSON.parse(Buffer.from(process.argv[1], "base64")), null, 2))' "<payment-required-header-value>"

# 3. Retry with an X-PAYMENT header carrying a signed payment -- most agents
#    use a client library (e.g. @x402/fetch) to build this rather than
#    hand-rolling it
```

Full protocol detail: https://docs.cdp.coinbase.com/x402/quickstart-for-buyers.

## Multi-chain EVM RPC expansion (2026-08-23)

Three new generalized routes: **`GET /v1/chain/:chain/gas-price`**,
**`GET /v1/chain/:chain/latest-block`** (both **$0.005/call**), and
**`GET /v1/chain/:chain/balance/:address`** (**$0.008/call**), where
`:chain` accepts any of 34 EVM chains beyond the eth/bsc/peaq/sol already
wired up -- Arbitrum, Avalanche, Base, Optimism, Polygon, zkSync, Linea,
Scroll, Gnosis, Celo, Kava, Moonbeam, and 22 more. Full slug list lives in
the `POKT_EVM_CHAINS` map in `dataSources.js`.

**Where these came from:** POKT Shannon's free, keyless public gateway
(`api.pocket.network` -- the same one already backing `ETH_RPC_URL` and
`BSC_RPC_URL`) publishes a registry of every chain it supports
([pokt-network/public-rpc](https://github.com/pokt-network/public-rpc)):
51 mainnet chains as of 2026-06-17, 36 of them EVM-compatible. This project
was already using 2 of those 36 (eth, bsc); this round adds the other 34 at
zero additional infra cost -- same gateway, same `rpcCall()` helper, just a
config-map entry per chain. peaq is not on this gateway (it has its own
public RPC) so it's unaffected.

**Why 3 generalized routes instead of 68 discrete ones:** the existing
per-chain pattern (`eth/gas-price`, `bsc/gas-price`, `peaq/gas-price`, ...)
made sense for 3-4 chains where each is worth surfacing as its own distinct
product in the catalog. At 34 more chains, replicating that pattern would
have meant 34 new near-identical functions in `dataSources.js` and 68 new
route entries in `x402Middleware.js` (gas-price + latest-block, each) --
mostly bloat, since the logic is byte-for-byte identical across chains.
Instead this follows the multi-chain path-param pattern already established
by `wallet/balance`, `compliance/sanctions-check`, and
`prospect/enrichment`: one route, a `:chain` param, and a config map that's
a one-line edit to extend later. eth/bsc/sol/peaq keep their existing
dedicated routes and functions unchanged -- this is additive, not a
replacement.

Before shipping, a spot-check sample of 8 chains (base, arb-one, poly, avax,
zksync-era, sei, hyperliquid, xrplevm) was verified live against the real
gateway (`eth_gasPrice`, HTTP 200, real value returned) rather than trusting
the registry file alone.

## Yield/staking opportunity recommender (2026-08-23)

Three new routes answering the single most valuable question a DeFi-facing
agent asks -- "where should I stake or add liquidity right now, and what
would I actually earn":

- **`GET /v1/yield/best-opportunities/:address`** (**$0.25/call**) -- EVM
  address, scanned for native-token balance across all 37 EVM chains this
  API supports (eth/bsc/peaq + the 34-chain POKT expansion above).
- **`GET /v1/yield/best-opportunities/solana/:address`** (**$0.25/call**)
  -- same recommendation, scoped to a single Solana address.
- **`GET /v1/yield/best-opportunities/combined/:address/:solAddress`**
  (**$0.30/call**) -- both in one request, ranked together. Priced as a
  bundle rather than the sum of the two standalone routes ($0.25 each) --
  cheaper than calling both separately.

**How it works:** for whichever chains hold a non-dust balance, prices that
balance to USD (via a new native-token CoinGecko price map -- every id
verified live 2026-08-23), pulls that chain's live yield pools from
DefiLlama (reusing `getYieldAggregation` from the 2026-08-22 DeFi yield
round -- Uniswap, PancakeSwap, Stargate, Aerodrome, and effectively every
other major DEX/lending protocol in one source), and ranks the top 3
opportunities **by projected 12-month USD earnings** globally across every
chain scanned. Each result also states the same figure in APY and in the
chain's native token, plus an estimated gas cost to enter the position
(live gas price times a documented ~150,000-gas-unit swap estimate). No KYC,
no wallet connection -- just an address.

**DefiLlama chain-name mapping:** DefiLlama's own display names diverge
from the slugs used elsewhere in this file for several chains -- verified
live against `api.llama.fi/chains` 2026-08-23: `gnosis` -> `"xDai"`,
`kaia` -> `"Klaytn"` (DefiLlama hasn't renamed it yet), `opbnb` ->
`"Op_Bnb"`, `hyperliquid` -> `"Hyperliquid L1"`. See `DEFILLAMA_CHAIN_NAME`
in `dataSources.js` for the full map.

**Not financial advice:** every response includes a `disclaimer` field --
APY is a live snapshot that changes constantly, projected earnings assume
the current rate holds for the full period, and smart-contract/
impermanent-loss/price risk all apply. The user executes and accepts any
resulting transaction themselves.

## First real end-to-end paid Solana test pass, and a DNS-lookup bug fix (2026-09-05)

Context this section assumes: a separate local test harness (not part of
this repo) was built to pay for every live route with a real, small-funds
Solana wallet and confirm actual on-chain settlement, rather than trusting
a 200 status alone. This is the first time this project's payment path was
tested end-to-end with real money rather than just reviewed. Full raw
results live outside this repo; this section only records what changed
*here* as a result.

**Fixed and verified offline, not yet live-retested after deploy:**

`resolveVerifiedDispatcher()` in `dataSources.js` (added 2026-08-27 for the
DNS-rebinding SSRF hardening -- see "Security hardening" below) pins a
caller-supplied hostname's resolved IP and hands it to `undici` via a
custom `connect.lookup` function. That custom function always answered in
the single-address callback shape (`callback(null, address, family)`),
never the array shape (`callback(null, [{address, family}])`) that Node's
own `dns.lookup()` contract requires when the caller passes `options.all`.
Node 20+ defaults `net.autoSelectFamily` to `true`, and its own
`net`/`tls` connection code (`lookupAndConnectMultiple`) calls *any*
custom lookup function -- including this one -- with `options.all` set.
The mismatch meant Node tried to connect to `undefined`, surfacing as:

```
TypeError: fetch failed
  [cause]: TypeError [ERR_INVALID_IP_ADDRESS]: Invalid IP address: undefined
```

This is exactly what a live run against `GET /v1/convert/heic-to-png`
produced (confirmed from this container's own logs, not guessed), and
this function is shared by every route in this file that fetches a
caller-supplied URL itself: `getHeicToPng`, `getImageOcr`,
`probeSellerResource` (used by `getX402SellerTrust` --
`/v1/x402/seller-trust`), `fetchManifestAt` (used by
`getX402SellerTrust`'s manifest check), `probePoktSupplierEndpoint`, and
the ERC-8004 registration-file fetch in `getAgentReputation`. It reproduced
consistently in isolated, fully offline testing (a local loopback HTTP
server, no external network involved) against the exact lookup pattern
used here -- not reliably on every single live call in production (one
live retest of `image/ocr` against a different external host succeeded
before this fix shipped), which fits a race/branch in Node's own
connection-attempt logic rather than something host-specific.

**Fix:** the custom `lookup` function now checks `options.all` and answers
in whichever shape was actually requested, matching Node's documented
`dns.lookup()` contract. No behavior change for the SSRF-hardening logic
itself (the resolve-once/pin/check-every-address logic above it is
untouched) -- only the shape of what gets handed to `undici` changed.

**Status:** fixed, deployed, and confirmed live in production. Retested
for real after deploy (2026-09-05): `GET /v1/convert/heic-to-png` settled
cleanly with a real, on-chain-verified Solana payment (transaction
`4G3GrGgZezdzqsJNPfCcQBHpnzdRL3qW8R3HvwvYv4Mr4kje5oxPU79uKUTEwVxEz7zSX9LG1LaLjASGDujgF3gC`,
payment-response header decoded, valid PNG returned) -- the DNS-lookup
fix above is confirmed working in production, not just offline.
`GET /v1/x402/seller-trust/example.com` was retested the same pass and
still failed -- but that turned out to be a completely separate,
unrelated bug, not a sign this fix is incomplete. See the next section.

## Separate seller-trust bug found during the same retest: bad discovery-extension example (2026-09-05)

Retesting `GET /v1/x402/seller-trust/example.com` after the DNS-lookup fix
above still failed, live, with what looked like the same kind of bare
Cloudflare "502: Bad Gateway" page. Pulling this container's own logs
(same method as the DNS bug above) showed the real cause has nothing to
do with DNS resolution or `undici` at all:

```
Error: baseUrl must be a valid absolute URL, e.g. https://example.com:8443
    at getX402SellerTrust (file:///app/dataSources.js:2145:11)
```

`getX402SellerTrust(baseUrl)` requires a full, absolute URL with a scheme
-- and correctly does NOT default to `https://` on its own if one is
missing, since a real seller can run on a non-default port (this box's
own listing being the obvious example, at `:8443`), so silently guessing
a scheme+port would be a real behavior change, not a safe default. But
this route's own discovery-extension declaration in `x402Middleware.js`
advertised its example path parameter as the bare string "example.com"
-- not a valid absolute URL, and not percent-encoded either, despite the
route handler's own comment requiring callers to `encodeURIComponent()` a
full "https://..." seller URL as the path segment. Both Bazaar-style
discovery crawlers and this project's own test harness pull that
advertised example verbatim to build their test/discovery call, so the
manifest itself was telling every caller to make a request that
immediately throws -- unrelated to, and pre-dating, the DNS-lookup bug
above.

**Fix:** the discovery extension's example value is now
`encodeURIComponent("https://example.com")` (`"https%3A%2F%2Fexample.com"`),
matching the format the route actually requires. No change to
`getX402SellerTrust()`'s own validation -- it was already doing the right
thing by rejecting a bare domain; the manifest's example was just wrong.

**Status:** fixed, deployed, and confirmed live in production. Retested
for real after this second deploy (2026-09-05): `GET /v1/x402/seller-trust/https%3A%2F%2Fexample.com`
settled cleanly with a real, on-chain-verified Solana payment (transaction
`pu2jkZf6F9ruyd8wJF5v44XwzRz6pZgCzze5oyiEEAcBso311jNAYNyVv5sPEky7RiQco1AW2V8221MjuNWoCQk`)
and returned a full, valid trust-score response (trustScore, verdict,
bazaarListed, ipIntelligence, and the rest) -- not just a bare 200.
`GET /v1/convert/heic-to-png` was retested the same pass too and settled
cleanly again (transaction
`5diQUYWDpnrmFW5MikrtfDkeSwhgwWnahjxPY7bwwLfTmnTVnvkf7t2G2p9wfxMsqvWMEhHcnZYMASqD5MVEjUsB`),
reconfirming the DNS-lookup fix above survived this second redeploy too.
Both known Solana bugs from this project's first full paid test pass are
now confirmed fixed in live production, not just in code.

One implementation detail worth recording rather than "fixing" again: the
live manifest's own advertised `resource` URL for this route ends up
double-percent-encoded (`https%253A%252F%252Fexample.com`, not the
single-encoded `https%3A%2F%2Fexample.com` this fix's `pathParams` value
alone would suggest), because `substitutePathParams()` in `server.js`
also runs `encodeURIComponent()` on top when building that field. That's
not a new bug: this route's own handler decodes twice (once
automatically via Express's route-param parsing, once explicitly via its
own `decodeURIComponent(req.params.encodedUrl)` call), so a
double-encoded path is exactly what a correct caller needs to supply --
confirmed by this retest actually settling and returning real data.
Left as-is: touching either the double-encode or the double-decode side
alone would break the other.

**Separately diagnosed this same pass, NOT fixed here -- left TBD
deliberately:** `GET /v1/render/pdf` failed live with a ~20.3-second-long
request ending in a bare Cloudflare "502: Bad Gateway" page (Cloudflare's
own error page, not this app's JSON error shape -- meaning the connection
itself broke, not that the app returned a clean error status). `RENDER_TIMEOUT_MS`
(20 seconds, in `dataSources.js`, guarding the call to the separate
`puppeteer-render` container) is a real, correlated data point -- the
observed failure duration matches it closely and repeated near-identically
across two separate live attempts (20326ms, then 20371ms). But this
repo's `Caddyfile` sets no explicit `reverse_proxy` timeout, so exactly
what enforces the ~20s ceiling the client actually experiences (Cloudflare's
own edge timeout vs. something else) isn't pinned down with the same
confidence as the DNS-lookup bug above -- deliberately not "fixed" by
guessing at a timeout value without being able to confirm which layer is
actually cutting the connection. Needs either a live retest with Caddy/
Cloudflare access to watch the actual cutoff, or a smaller, safer
first step: lowering `RENDER_TIMEOUT_MS` to fail fast with more headroom
and see if that alone is enough, without touching anything else. Left as
an open item for a follow-up change, not bundled into this commit.

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
