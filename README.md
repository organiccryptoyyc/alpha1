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

## Routes and pricing

| Route | Price | What it returns |
|---|---|---|
| `GET /v1/eth/gas-price` | $0.005 | Current Ethereum gas price (wei + gwei) |
| `GET /v1/eth/latest-block` | $0.005 | Latest Ethereum block number |
| `GET /v1/sol/latest-block` | $0.005 | Latest Solana slot |
| `GET /v1/price/:symbol` | $0.005 | USD price for eth/sol/btc/usdc/pokt |
| `GET /v1/wallet/balance/:chain/:address` | $0.008 | Balance for an eth or sol address |
| `GET /health` | free | Liveness check, not metered |

Adjust the `routes` config in `x402Middleware.js` as you learn what agents
will actually pay for each route — each entry's `accepts.price` sets the
amount and `extensions` (via `declareDiscoveryExtension()`) controls what
Bazaar shows for that route.
