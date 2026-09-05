// renderRequestGuard.test.mjs
//
// Offline, zero-dependency reproduction of the hang runWithHardCap() guards
// against, and confirmation the fix resolves it -- same verification method
// used for the DNS-lookup dispatcher fix elsewhere in this project's
// history (an isolated repro of the bug, then proof the fix resolves it,
// before either was written into a file actually exposed to production).
//
// Run: node renderRequestGuard.test.mjs

import assert from "node:assert/strict";
import { runWithHardCap } from "./renderRequestGuard.js";

function fakeRes() {
  const calls = [];
  const res = {
    // Mirrors real Express: res.json(body) alone (no .status() call first)
    // sends 200, exactly like the success path in runWithHardCap does.
    _status: 200,
    status(code) {
      res._status = code;
      return res;
    },
    json(body) {
      calls.push({ status: res._status, body });
      return res;
    },
    calls,
  };
  return res;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// 1. Fast path: real work finishes well inside the cap. The hard cap must
//    never fire, and the client gets exactly the real success response --
//    `run` never touches `res` itself, just returns the payload.
await test("fast success path: hard cap does not interfere", async () => {
  const res = fakeRes();
  await runWithHardCap({
    res,
    ms: 200,
    label: "test-fast",
    run: async () => {
      await sleep(10);
      return { ok: true };
    },
  });
  assert.equal(res.calls.length, 1, "exactly one response sent");
  assert.equal(res.calls[0].status, 200);
  assert.deepEqual(res.calls[0].body, { ok: true });
});

// 2. THE BUG: work that hangs forever (reproducing an unbounded page.pdf()
//    call) must not hang the request forever -- the hard cap must fire and
//    respond exactly once, and onTimeout must run so the caller can force-
//    release whatever it's holding (a Chrome page, a Tesseract worker).
await test("hung work: hard cap fires exactly once with a 504", async () => {
  const res = fakeRes();
  let onTimeoutCalled = false;
  let releaseWork = () => {}; // holds the "abandoned" work open past the cap firing
  const workPromise = new Promise((_resolve) => {
    releaseWork = _resolve;
  });

  // Deliberately NOT awaited yet: runWithHardCap's own promise won't settle
  // until `run` does, and `run` is what's hanging on workPromise here --
  // that mirrors a real abandoned page.pdf() call, which also keeps running
  // (and keeps its enclosing async function pending) well after the hard
  // cap has already answered the client.
  const guardDone = runWithHardCap({
    res,
    ms: 50,
    label: "test-hang",
    run: async () => {
      await workPromise; // simulates page.pdf() that never resolves on its own
      return { ok: true }; // must never actually reach res in this test
    },
    onTimeout: () => {
      onTimeoutCalled = true;
    },
  });

  // Wait past the 50ms cap so it fires, without releasing the hung work yet.
  await sleep(80);
  assert.equal(res.calls.length, 1, "exactly one response sent (the 504)");
  assert.equal(res.calls[0].status, 504);
  assert.match(res.calls[0].body.error, /hard cap/);
  assert.equal(onTimeoutCalled, true, "onTimeout cleanup ran so the caller can force-release its resource");

  // Now let the abandoned work actually settle late (as it would once
  // onTimeout's page.close()/worker.terminate() forces page.pdf() to
  // reject/resolve) -- THE FIX's whole point is that this must NOT send a
  // second response.
  releaseWork();
  await guardDone;
  assert.equal(res.calls.length, 1, "late completion of abandoned work must not double-respond");
});

// 3. Real work throws a genuine error BEFORE the cap fires -- the caller's
//    own specific error message must still reach the client (not a generic
//    hard-cap message), and the hard cap must be cleared (never fires
//    later, no leaked timer, no second response).
await test("real error before cap: specific error reaches the client, cap does not also fire", async () => {
  const res = fakeRes();
  await runWithHardCap({
    res,
    ms: 50,
    label: "test-real-error",
    run: async () => {
      await sleep(5);
      throw new Error("Navigation timeout of 15000 ms exceeded");
    },
    formatError: (err) => ({ status: 502, body: { error: `pdf render failed: ${err.message}` } }),
  });
  assert.equal(res.calls.length, 1, "exactly one response sent (the real error, not the generic cap message)");
  assert.equal(res.calls[0].status, 502);
  assert.match(res.calls[0].body.error, /Navigation timeout/);

  // Confirm the hard-cap timer was really cleared, not just "didn't fire
  // yet" -- wait past its own ms window and re-check nothing else arrived.
  await sleep(80);
  assert.equal(res.calls.length, 1, "hard cap must not fire after the real work already responded");
});

// 4. Work that hangs past the cap and THEN throws late (mirroring
//    page.pdf() rejecting with "Target closed" once onTimeout forces
//    page.close()) -- must not double-respond either, symmetric with test 2
//    but exercising the error branch instead of the success branch.
await test("hung work that later throws: still must not double-respond", async () => {
  const res = fakeRes();
  let rejectWork = () => {};
  const workPromise = new Promise((_resolve, _reject) => {
    rejectWork = _reject;
  });

  const guardDone = runWithHardCap({
    res,
    ms: 50,
    label: "test-hang-then-error",
    run: async () => {
      await workPromise;
      return { ok: true };
    },
  });

  await sleep(80);
  assert.equal(res.calls.length, 1);
  assert.equal(res.calls[0].status, 504);

  rejectWork(new Error("Protocol error: Target closed"));
  await guardDone.catch(() => {}); // runWithHardCap itself swallows this; nothing to catch in practice
  assert.equal(res.calls.length, 1, "late rejection of abandoned work must not send a second response");
});

console.log(process.exitCode ? "\nSOME TESTS FAILED" : "\nALL TESTS PASSED");
