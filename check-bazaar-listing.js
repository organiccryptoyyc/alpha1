// check-bazaar-listing.js
// There is no manual "submit to Bazaar" step — the CDP facilitator lists a
// service the first time it *settles* (not just verifies) a real payment
// against it (see x402Middleware.js: bazaarResourceServerExtension +
// declareDiscoveryExtension() on each route). This script just confirms the
// listing actually showed up.
//
// Usage: node check-bazaar-listing.js https://your-domain.example.com
//
// Run it AFTER your API has served at least one paid request through the
// CDP facilitator. Before that first real settlement, your service will not
// appear here yet — that's expected, not a bug. New/updated resources can
// also take up to ~10 minutes to show up (results are served from a cache).
//
// Uses Node's built-in global fetch (stable since Node 18).
//
// Endpoint reference: https://docs.cdp.coinbase.com/x402/bazaar
// (the old /platform/v2/x402/bazaar/list path used here previously does not
// exist in the current API — this was silently broken).
const BAZAAR_RESOURCES_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node check-bazaar-listing.js <your-public-base-url>");
    process.exit(1);
  }

  const matches = [];
  let offset = 0;
  const limit = 100; // max page size the paginated catalog will return per request
  let total = Infinity;

  while (offset < total) {
    const url = `${BAZAAR_RESOURCES_URL}?limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Bazaar discovery request failed: HTTP ${res.status}`);
      process.exit(1);
    }
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    total = data.pagination?.total ?? items.length;
    for (const item of items) {
      if (typeof item.resource === "string" && item.resource.startsWith(target)) {
        matches.push(item);
      }
    }
    if (items.length === 0) break;
    offset += limit;
  }

  if (matches.length > 0) {
    console.log(`Found ${matches.length} listing(s) for ${target}:`);
    console.log(JSON.stringify(matches, null, 2));
  } else {
    console.log(
      `No listings found yet for ${target}. Either no payment has settled ` +
        `through the CDP facilitator yet, the bazaarResourceServerExtension ` +
        `+ declareDiscoveryExtension() wiring isn't in place on the route ` +
        `that was called, or the catalog cache (~10 min) hasn't caught up ` +
        `yet. Check https://docs.cdp.coinbase.com/x402/bazaar for the ` +
        `current response shape if this script's parsing is out of date.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
