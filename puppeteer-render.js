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
// serially past the cap, bounded by REQUEST_TIMEOUT_MS per page (see
// renderRequestGuard.js -- NAV_TIMEOUT_MS alone used to be the only bound
// here, but it only covers page.goto(), not the render/OCR step after it,
// which is exactly the gap that let a slow page pin a slot open forever).
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
import { createWorker } from "tesseract.js";
import { runWithHardCap } from "./renderRequestGuard.js";

const PORT = process.env.PORT || 3002;
const EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser";
const MAX_CONCURRENT_PAGES = 2;
const NAV_TIMEOUT_MS = 15_000;
// BUG FIX (2026-09-05): NAV_TIMEOUT_MS above only bounds page.goto() --
// page.pdf(), page.screenshot(), and worker.recognize() (OCR) have no
// timeout of their own. A page that navigates fine but then hangs while
// doing the real work could previously run forever, pinning one of only
// MAX_CONCURRENT_PAGES semaphore slots shut for good -- see
// renderRequestGuard.js for the full mechanism and why this was worth
// fixing regardless of what exactly produces the render/pdf Cloudflare-502
// symptom documented in this project's README. Set comfortably above
// NAV_TIMEOUT_MS (room for the render/OCR step itself once navigation
// succeeds) and comfortably below the main app's own RENDER_TIMEOUT_MS
// (dataSources.js, 20s) -- so THIS service's own specific error always wins
// that race and reaches the caller, instead of the request hanging here
// while the caller gives up first and gets nothing.
const REQUEST_TIMEOUT_MS = 18_000;
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
  const startedAt = Date.now();
  try {
    await runWithHardCap({
      res,
      ms: REQUEST_TIMEOUT_MS,
      label: "screenshot render",
      onTimeout: () => {
        // Force-close the page so a page.screenshot() hung past the cap
        // rejects promptly instead of grinding on in the background forever
        // -- this is what actually frees the semaphore slot back up soon
        // after the client gets its 504, instead of holding it forever (see
        // renderRequestGuard.js for why that matters more than "one slow
        // request").
        if (page) page.close().catch(() => {});
      },
      run: async () => {
        const b = await ensureBrowser();
        page = await b.newPage();
        await page.setViewport(VIEWPORT);
        const response = await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: NAV_TIMEOUT_MS,
        });
        console.log(`[puppeteer-render] screenshot nav complete for ${url} at ${Date.now() - startedAt}ms`);
        const buffer = await page.screenshot({ type: "png" });
        console.log(`[puppeteer-render] screenshot capture complete for ${url} at ${Date.now() - startedAt}ms`);
        return {
          statusCode: response ? response.status() : null,
          width: VIEWPORT.width,
          height: VIEWPORT.height,
          screenshotBase64: buffer.toString("base64"),
        };
      },
      formatError: (err) => ({ status: 502, body: { error: `render failed: ${err.message}` } }),
    });
  } finally {
    if (page) await page.close().catch(() => {});
    releaseSlot();
  }
});

app.post("/pdf", async (req, res) => {
  const { url, format, landscape } = req.body || {};
  if (!url) return res.status(400).json({ error: "url is required" });

  await acquireSlot();
  let page;
  const startedAt = Date.now();
  try {
    await runWithHardCap({
      res,
      ms: REQUEST_TIMEOUT_MS,
      label: "pdf render",
      onTimeout: () => {
        // Same reasoning as /screenshot above: force the page closed so a
        // page.pdf() hung past the cap rejects promptly instead of holding
        // this request's semaphore slot shut indefinitely.
        if (page) page.close().catch(() => {});
      },
      run: async () => {
        const b = await ensureBrowser();
        page = await b.newPage();
        await page.setViewport(VIEWPORT);
        const response = await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: NAV_TIMEOUT_MS,
        });
        console.log(`[puppeteer-render] pdf nav complete for ${url} at ${Date.now() - startedAt}ms`);
        const buffer = await page.pdf({
          format: format || "Letter",
          landscape: !!landscape,
          printBackground: true,
        });
        console.log(`[puppeteer-render] pdf generation complete for ${url} at ${Date.now() - startedAt}ms`);
        return {
          statusCode: response ? response.status() : null,
          format: format || "Letter",
          pdfBase64: buffer.toString("base64"),
        };
      },
      formatError: (err) => ({ status: 502, body: { error: `pdf render failed: ${err.message}` } }),
    });
  } finally {
    if (page) await page.close().catch(() => {});
    releaseSlot();
  }
});

// OCR worker: lazily created on first request and kept alive, same pattern
// as ensureBrowser() above -- creating a fresh Tesseract worker per request
// would dominate OCR time. Reuses the same acquireSlot()/releaseSlot()
// semaphore as Chrome pages above as a simple, single concurrency guard for
// this container's real CPU/RAM work, even though OCR isn't a Chrome page.
let ocrWorker = null;
async function ensureOcrWorker() {
  if (ocrWorker) return ocrWorker;
  ocrWorker = await createWorker("eng");
  return ocrWorker;
}

app.post("/ocr", async (req, res) => {
  const { imageBase64 } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required" });

  await acquireSlot();
  const startedAt = Date.now();
  try {
    await runWithHardCap({
      res,
      ms: REQUEST_TIMEOUT_MS,
      label: "ocr",
      onTimeout: () => {
        // worker.recognize() has no timeout of its own, and unlike a Chrome
        // page there's no cheap "just this request's work" handle to close
        // -- ocrWorker is a single shared, reused instance (see
        // ensureOcrWorker() below), not created fresh per request. The only
        // way to actually stop a hung recognize() call is to terminate the
        // whole worker; null it out here first so the next request
        // transparently creates a fresh one instead of reusing a worker
        // whose in-flight call this just killed out from under it.
        const stuckWorker = ocrWorker;
        ocrWorker = null;
        if (stuckWorker) stuckWorker.terminate().catch(() => {});
      },
      run: async () => {
        const worker = await ensureOcrWorker();
        const buffer = Buffer.from(imageBase64, "base64");
        const { data } = await worker.recognize(buffer);
        console.log(`[puppeteer-render] ocr complete at ${Date.now() - startedAt}ms`);
        return { text: data.text, confidence: data.confidence };
      },
      formatError: (err) => ({ status: 502, body: { error: `ocr failed: ${err.message}` } }),
    });
  } finally {
    releaseSlot();
  }
});

app.listen(PORT, () => {
  console.log(
    `[puppeteer-render] listening on :${PORT}, executable=${EXECUTABLE_PATH}, maxConcurrentPages=${MAX_CONCURRENT_PAGES}`
  );
});
