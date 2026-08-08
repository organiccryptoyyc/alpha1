// allowlist.js
// PATCH (built 2026-08-08, staged offline -- not yet applied to the live
// repo). Optional participant-allowlisting gate for the metered routes in
// this API. Off by default (ALLOWLIST_MODE unset or "off") -- a brand new
// feature, and every other optional feature in this project defaults to a
// no-op until explicitly configured, so this one does too.
//
// Deliberate exception to that "fail open when unconfigured" norm: once
// ALLOWLIST_MODE=enforce is actually set, an empty/missing ALLOWLIST_KEYS
// list fails CLOSED (blocks everyone), not open. Every other optional
// feature in this codebase (PEAQ_PAY_TO_ADDRESS, BSC_PAY_TO_ADDRESS,
// CDP_EVM_PAY_TO_ADDRESS, etc.) fails open when unconfigured, because the
// failure mode there is "a payment option isn't offered yet" -- harmless.
// Here, failing open when misconfigured would mean "access control is
// silently not controlling access," which defeats the one thing this
// feature exists to do. So: unset entirely -> off (matches the project's
// usual norm). Explicitly turned on but misconfigured -> closed (the one
// deliberate departure from that norm, and the correct one for a gate
// rather than a feature toggle).
//
// Gating mechanism: a caller-supplied header (X-Alpha7-Key), checked
// against ALLOWLIST_KEYS (comma-separated), NOT the on-chain x402 payer
// address. Wallet-address-based gating (tying the allowlist to whoever
// actually signs the payment) would be the more airtight version of this,
// but doing that correctly requires knowing exactly how the installed
// @x402/express / @x402/core version exposes the verified payer address in
// the request lifecycle -- not yet confirmed for this project's installed
// SDK version. TODO before relying on this for anything higher-stakes than
// "keep casual scrapers off the paid routes": verify that exposure point
// and consider switching the check to the settled payer address instead of
// a shared header key -- the same way peaq's USDC name mismatch and World
// Chain's chain id both got caught by verifying against a live source
// instead of trusting an assumption, this deserves the same treatment
// before anyone leans on it for real access control.
//
// Placement matters: mount this BEFORE buildX402Middleware() in server.js,
// not after. Rejecting here means a blocked caller never even gets a 402
// payment prompt for a route they're not allowed to use -- if this ran
// after the payment middleware instead, a non-allowlisted caller could
// still pay first and get blocked second, which is both a worse experience
// and pointless cost exposure for them. Also deliberately mounted AFTER the
// free discovery routes (/health, /.well-known/x402, /openapi.json) in
// server.js are registered -- those stay unmetered AND ungated on purpose,
// same reasoning as their own "free so an agent can read the price list
// before paying" comment: an allowlisted-only agent still needs to be able
// to see what's for sale before deciding whether it's worth requesting
// access.

const ALLOWLIST_MODE = (process.env.ALLOWLIST_MODE || "off").toLowerCase();
const ALLOWLIST_KEYS = new Set(
  (process.env.ALLOWLIST_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
);

// NOTE: this was originally written as a flat if/else-if chain keyed only on
// ALLOWLIST_MODE, with an `else if (ALLOWLIST_MODE !== "off")` catch-all
// meant to warn about typo'd mode values. Caught by actually running this
// (not just reading it) before shipping: that catch-all also matched the
// perfectly valid "enforce mode WITH keys configured" case, since nothing
// upstream of it excluded "enforce", producing a false "not a recognized
// value -- treating as off" warning on a correctly configured deployment.
// The gating logic in allowlistMiddleware() below was never affected by
// this (it checks ALLOWLIST_MODE directly, not this log block) -- this was
// a misleading-log bug, not a security bug -- but a misleading log next to
// a correctly working enforce deployment would send whoever reads it
// chasing a nonexistent misconfiguration. Restructured to nest the
// "enforce" branch explicitly instead of relying on an exclusion catch-all.
if (ALLOWLIST_MODE === "off") {
  // Default, no-op state -- nothing worth logging.
} else if (ALLOWLIST_MODE === "log") {
  console.warn(
    "[allowlist] NOTE: ALLOWLIST_MODE=log -- requests are being checked and " +
      "logged, but NOT blocked. Use this to see who's calling before " +
      "switching to ALLOWLIST_MODE=enforce."
  );
} else if (ALLOWLIST_MODE === "enforce") {
  if (ALLOWLIST_KEYS.size === 0) {
    console.warn(
      "[allowlist] WARNING: ALLOWLIST_MODE=enforce but ALLOWLIST_KEYS is empty -- " +
        "every metered request will be rejected until at least one key is set. " +
        "This is fail-closed by design, not a bug -- see the header comment in allowlist.js."
    );
  }
  // Else: enforce mode, properly configured -- nothing to warn about.
} else {
  console.warn(
    `[allowlist] WARNING: ALLOWLIST_MODE="${ALLOWLIST_MODE}" is not a recognized ` +
      `value ("off", "log", or "enforce") -- treating as "off".`
  );
}

export function allowlistMiddleware() {
  return function allowlist(req, res, next) {
    if (ALLOWLIST_MODE !== "log" && ALLOWLIST_MODE !== "enforce") {
      return next();
    }

    const suppliedKey = req.get("X-Alpha7-Key");
    const allowed = Boolean(suppliedKey && ALLOWLIST_KEYS.has(suppliedKey));

    if (ALLOWLIST_MODE === "log") {
      console.log(
        `[allowlist] ${allowed ? "ALLOWED" : "WOULD BLOCK"} ${req.method} ${req.path} ` +
          `(key ${suppliedKey ? "present" : "missing"})`
      );
      return next();
    }

    // ALLOWLIST_MODE === "enforce" from here down.
    if (!allowed) {
      return res.status(403).json({
        error: "not allowlisted",
        detail: "This API requires an allowlisted participant key (X-Alpha7-Key header). Contact the operator for access.",
      });
    }
    return next();
  };
}
