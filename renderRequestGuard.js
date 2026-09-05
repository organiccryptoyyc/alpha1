// renderRequestGuard.js
//
// BUG FIX (2026-09-05): backs the render/pdf timeout investigation left open
// in this project's README ("Separately diagnosed this same pass, NOT fixed
// here -- left TBD deliberately"). Reading puppeteer-render.js turned up a
// real, confirmable-from-the-code defect independent of anything Cloudflare/
// Caddy-side: NAV_TIMEOUT_MS there only bounds page.goto() (navigation).
// Neither page.pdf(), page.screenshot(), nor Tesseract's worker.recognize()
// has any timeout of their own -- a page that navigates fine but then hangs
// while doing the real work (heavy web fonts, a runaway script, an infinite
// CSS animation, print-media quirks, a corrupt/huge image for OCR) could
// previously run forever with nothing to stop it.
//
// That's worse than "one slow request": every route in puppeteer-render.js
// shares the same MAX_CONCURRENT_PAGES semaphore (acquireSlot/releaseSlot).
// A hung page.pdf() call never reaches its own `finally { releaseSlot() }`,
// so after just MAX_CONCURRENT_PAGES stuck requests this entire service
// silently stops accepting ANY new render/screenshot/OCR work -- no crash,
// no error logged anywhere, every future request just queues forever behind
// `waiters`. This is very plausibly the actual mechanism behind the
// render/pdf failures seen in production (a slow-to-render page eating a
// concurrency slot that never comes back), independent of whatever exactly
// produces the Cloudflare-branded 502 the client sees -- see this project's
// README for the honest confidence level on that last part.
//
// Zero external dependencies on purpose (no express/puppeteer/tesseract
// imports) so this can be unit-tested in complete isolation -- see
// renderRequestGuard.test.mjs for an offline reproduction of the hang this
// guards against and confirmation the fix resolves it, the same
// verification method already used for the DNS-lookup dispatcher fix
// elsewhere in this project's history.
//
// Contract, deliberately narrow so callers can't get the double-response
// case wrong the way an earlier draft of this fix almost did: `run()` just
// performs the real work and either returns the success payload (an object
// to send as JSON) or throws. It never touches `res` itself. This function
// alone decides whether/when a response is sent, and guarantees exactly one
// response reaches the client no matter which of these fires first: `run`
// resolving, `run` rejecting, or the hard cap tripping.
export async function runWithHardCap({ res, ms, label, run, onTimeout, formatError }) {
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    console.error(
      `[puppeteer-render] ${label} exceeded ${ms}ms hard cap -- responding 504; abandoned work will be force-cleaned once it actually settles`
    );
    try {
      res.status(504).json({ error: `${label} exceeded ${ms}ms hard cap` });
    } catch (e) {
      // Best-effort: the connection may already be gone. Nothing more useful
      // to do here -- this timer's whole job was to answer the client, and
      // that's no longer possible.
    }
    if (onTimeout) {
      try {
        onTimeout();
      } catch (e) {
        console.error(`[puppeteer-render] onTimeout cleanup for ${label} itself threw:`, e.message);
      }
    }
  }, ms);

  try {
    const result = await run();
    if (settled) return; // hard cap already answered the client first
    settled = true;
    clearTimeout(timer);
    res.json(result);
  } catch (err) {
    if (settled) return; // hard cap already answered the client first
    settled = true;
    clearTimeout(timer);
    console.error(`[puppeteer-render] ${label} failed:`, err.message);
    const { status, body } = formatError ? formatError(err) : { status: 502, body: { error: err.message } };
    res.status(status).json(body);
  }
}
