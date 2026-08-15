// puppeteer-render.js
//
// Internal-only headless-Chrome rendering service backing the main API's
// GET /v1/render/screenshot route. Not reachable from outside the docker
// network -- no ports published in docker-compose.yml, same isolation
// pattern as sol-rpc-cache.mjs and peaq-facilitator.js.
//
// WHY A SEPARATE CONTAINER: every other route in this project is a
// lightweight JSON pass-through (a few hundred ms, near-zero RAM). Launching
// headless Chrome is a different order of magnitude -- 100-300MB RAM and
// real CPU per render. Running it inside the main app's process would let a
// burst of screenshot requests starve or crash the JSON routes sharing that
// event loop/container. Isolating it here means the worst case (Chrome
// wedged, OOM, crash-loop) only takes this service down -- Docker's restart
// policy brings it back without ever touching onchain-snapshot-api.
//
// WHY puppeteer-core + system chromium (not the full `puppeteer` package):
// `puppeteer`'s postinstall step downloads its own bundled Chromium build,
// which has no prebuilt binary for Alpine/musl. Alpine's own `apk add
// chromium` package works fine on musl. `puppeteer-core` skips the
// postinstall download entirely and is pointed at that system binary via
// PUPPETEER_EXECUTABLE_PATH (set in puppeteer-render.Dockerfile).
//
// CONCURRENCY: one Chrome instance launches once at boot and stays alive --
// launching a fresh browser process per request would dominate render time.
// A small semaphore caps how many pages can be open at once
// (MAX_CONCURRENT_PAGES) so a burst of requests queues briefly instead of
// piling on and OOMing the container; queued requests still complete, just
// serially past the cap, bounded by NAV_TIMEOUT_MS per page.
//
// SECURITY: the caller-supplied URL is only navigated to and screenshotted,
// never executed server-side beyond what any browser does loading a page.
// This service deliberately does NOT re-check the SSRF hostname denylist --
// that's enforced one layer up, in dataSources.js's getPuppeteerScreenshot(),
// before this service is ever called, mirroring how getUprockFetch enforces
// it before calling out to UpRock. This service trusts its caller (the main
// API container, internal-network-only, no published ports here) the same
// way sol-rpc-cache and peaq-facilitator already do.

import express from "express";
import puppeteer from "puppeteer-core";

const PORT = process.env.PORT || 3002;
const EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser";
const MAX_CONCURRENT_PAGES = 2;
const NAV_TIMEOUT_MS = 15_000;
const VIEWPORT = { width: 1280, height: 800 };

const app = express();
app.use(express.json());

let browser = null;
let activePages = 0;
const waiters = [];

function acquireSlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (activePages < MAX_CONCURRENT_PAGES) {
        activePages++;
        resolve();
        return true;
      }
      return false;
    };
    if (!tryAcquire()) waiters.push(tryAcquire);
  });
}

function releaseSlot() {
  activePages--;
  while (waiters.length) {
    const next = waiters.shift();
    if (next()) break;
  }
}

async function ensureBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await puppeteer.launch({
    executablePath: EXECUTABLE_PATH,
    headless: true,
    // --no-sandbox/--disable-setuid-sandbox: required to run Chrome as a
    // non-privileged user inside a container without extra capabilities.
    // --disable-dev-shm-usage: /dev/shm is tiny by default in Docker;
    // without this flag Chrome can crash on pages with heavier content.
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  browser.on("disconnected", () => {
    console.error("[puppeteer-render] browser disconnected -- will relaunch on next request");
    browser = null;
  });
  return browser;
}

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/screenshot", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "url is required" });

  await acquireSlot();
  let page;
  try {
    const b = await ensureBrowser();
    page = await b.newPage();
    await page.setViewport(VIEWPORT);
    const response = await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: NAV_TIMEOUT_MS,
    });
    const buffer = await page.screenshot({ type: "png" });
    res.json({
      statusCode: response ? response.status() : null,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      screenshotBase64: buffer.toString("base64"),
    });
  } catch (err) {
    console.error("[puppeteer-render] render failed:", err.message);
    res.status(502).json({ error: `render failed: ${err.message}` });
  } finally {
    if (page) await page.close().catch(() => {});
    releaseSlot();
  }
});

app.listen(PORT, () => {
  console.log(
    `[puppeteer-render] listening on :${PORT}, executable=${EXECUTABLE_PATH}, maxConcurrentPages=${MAX_CONCURRENT_PAGES}`
  );
});
