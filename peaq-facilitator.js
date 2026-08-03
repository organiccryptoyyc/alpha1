// peaq-facilitator.js
//
// Self-hosted x402 v2 facilitator for peaq (EVM, chain ID 3338).
//
// WHY THIS EXISTS: neither hosted facilitator we can reach supports peaq.
// CDP's facilitator's supported-network list (docs.cdp.coinbase.com/x402/
// network-support, re-checked live 2026-08-03) covers Base/Polygon/Arbitrum/
// World/Solana only -- no peaq. PayAI's own /supported response doesn't
// advertise eip155:3338 either, despite peaq's docs claiming PayAI as its
// official facilitator (confirmed live in an earlier session). And peaq's
// own reference facilitator (github.com/peaqnetwork/x402-peaq) can't be
// pointed to directly -- its package.json pins the OLD pre-v2 `x402` package
// (v0.7), its GET /supported advertises `x402Version: 1` with a bare
// `network: "peaq"` string, and its /verify+/settle parse old-shape
// payloads. None of that matches what this repo's v2 resource server (or
// any v2 HTTPFacilitatorClient, including our own) speaks or sends.
//
// WHAT THIS IS INSTEAD: a from-scratch v2-native facilitator, built from the
// SAME first-party SDK modules x402Middleware.js already uses to REGISTER
// the exact-EVM scheme on the resource-server side -- just their
// facilitator-side counterparts:
//   - @x402/core/facilitator's x402Facilitator class is the facilitator-side
//     mirror of x402ResourceServer: protocol bookkeeping, scheme/network
//     dispatch, GET /supported response shape.
//   - @x402/evm/exact/facilitator's registerExactEvmScheme + ExactEvmScheme
//     do the actual EIP-3009/Permit2 verify+settle work against whatever EVM
//     chain the signer below is pointed at.
// The three HTTP routes below (GET /supported, POST /verify, POST /settle)
// match the exact wire contract @x402/core's HTTPFacilitatorClient expects --
// read directly from that client's source (node_modules/@x402/core/dist/cjs/
// server/index.js) rather than guessed, since this facilitator-side surface
// isn't documented on docs.cdp.coinbase.com the way the resource-server side
// is.
//
// LIVE-TESTED 2026-08-03: an earlier version of this file was NOT
// live-tested and shipped with a real bug (see the publicActions comment
// below) -- caught via a real end-to-end payment test that failed with
// "invalid_exact_evm_signature", root-caused by reproducing the exact
// failure locally with the real SDK classes and a mocked signer, then fixed.
//
// SECURITY: FACILITATOR_PRIVATE_KEY controls a wallet that submits real
// on-chain settlement transactions on peaq and therefore needs its own
// native PEAQ balance for gas. It is a DIFFERENT key from whatever wallet
// PEAQ_PAY_TO_ADDRESS belongs to -- that one only ever RECEIVES USDC
// payments and never signs anything. Fund this facilitator's wallet with a
// small amount of PEAQ only (gas money), not a wallet holding real value
// beyond that.

import express from "express";
import { createWalletClient, http as viemHttp, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";

const PORT = process.env.PORT || 3333;
const FACILITATOR_PRIVATE_KEY = process.env.FACILITATOR_PRIVATE_KEY;
// Same chain ID (3338) already verified and used as PEAQ_MAINNET in
// x402Middleware.js. Public RPC by default; override once you have a
// dedicated/paid RPC endpoint for production settlement volume.
const PEAQ_RPC_URL = process.env.PEAQ_RPC_URL || "https://peaq.api.onfinality.io/public";

// peaq mainnet chain definition for viem. Not one of viem's built-in chains
// (as of writing), so declared inline.
const peaqChain = {
  id: 3338,
  name: "peaq",
  nativeCurrency: { name: "peaq", symbol: "PEAQ", decimals: 18 },
  rpcUrls: { default: { http: [PEAQ_RPC_URL] } },
};

// Graceful-when-unconfigured, matching every other optional env var in this
// repo (PAY_TO_ADDRESS, PEAQ_PAY_TO_ADDRESS, UPROCK_API_KEY all warn instead
// of crashing): if no key is set yet, boot anyway with an empty supported
// list instead of crash-looping. Lets this service, and the rest of the
// docker-compose stack, come up cleanly before a funded wallet exists --
// deploy the plumbing today, flip it live later with just an env var.
let facilitator = null;
let signerAddress = null;

if (FACILITATOR_PRIVATE_KEY) {
  const account = privateKeyToAccount(FACILITATOR_PRIVATE_KEY);
  signerAddress = account.address;

  // IMPORTANT: createWalletClient() alone only exposes WALLET actions
  // (writeContract, sendTransaction, signTypedData, ...). The facilitator-side
  // exact-EVM scheme also needs PUBLIC read actions -- getCode (used to tell
  // an EOA from a contract wallet before choosing ECDSA vs ERC-1271
  // verification) and readContract/waitForTransactionReceipt (used during
  // settle) -- none of which exist on a plain wallet client. Without
  // `.extend(publicActions)`, `signer.getCode` is undefined, calling it
  // throws inside verifyEIP3009's try/catch, and that gets silently swallowed
  // into `{ isValid: false, invalidReason: "invalid_exact_evm_signature" }`
  // for EVERY payment, even ones with a perfectly valid signature -- this bit
  // us in production on 2026-08-03 and cost a live end-to-end payment test
  // before it was caught by reproducing the exact failure locally with the
  // real SDK classes and a mocked signer.
  const walletClient = createWalletClient({
    account,
    chain: peaqChain,
    transport: viemHttp(PEAQ_RPC_URL),
  }).extend(publicActions);

  // toFacilitatorEvmSigner (from @x402/evm's top-level export) expects a
  // signer-shaped object with a top-level `.address` plus the client
  // methods (writeContract, signTypedData, readContract, getCode, ...) that
  // ExactEvmScheme's verify/settle paths call. viem's createWalletClient()
  // exposes those methods as own properties but keeps the address nested
  // under `.account.address`, not top-level -- so it's added explicitly here.
  const signerForFacilitator = toFacilitatorEvmSigner({
    ...walletClient,
    address: account.address,
  });

  facilitator = new x402Facilitator();
  registerExactEvmScheme(facilitator, {
    networks: ["eip155:3338"],
    signer: signerForFacilitator,
  });

  console.log(
    `[peaq-facilitator] Configured. Signing address: ${signerAddress} -- ` +
      "this address must hold native PEAQ for gas before it can settle a " +
      "real payment. Send a small amount, confirm the balance, then run a " +
      "real end-to-end payment test before pointing production traffic here."
  );
} else {
  console.warn(
    "[peaq-facilitator] FACILITATOR_PRIVATE_KEY is not set -- starting " +
      "anyway with an empty supported list (GET /supported returns no " +
      "kinds) instead of crash-looping. Set FACILITATOR_PRIVATE_KEY once " +
      "you have a peaq wallet funded with native PEAQ for gas, then " +
      "redeploy this service to activate it."
  );
}

const app = express();
app.use(express.json());

app.get("/supported", (req, res) => {
  res.json(facilitator ? facilitator.getSupported() : { kinds: [], extensions: [], signers: {} });
});

app.post("/verify", async (req, res) => {
  if (!facilitator) {
    return res.status(503).json({
      isValid: false,
      invalidReason: "facilitator_not_configured",
      invalidMessage: "FACILITATOR_PRIVATE_KEY is not set on this facilitator instance.",
    });
  }
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    // x402Facilitator.verify() itself does NOT throw for ordinary
    // invalid-payment cases (bad signature, expired, insufficient balance,
    // etc.) -- it returns a normal { isValid: false, ... } object, same as
    // every other facilitator's /verify. This catch block is only for
    // malformed requests or truly unexpected errors (e.g. RPC unreachable),
    // which is why it responds 400 rather than a 200 + isValid:false.
    const result = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (err) {
    console.error("[peaq-facilitator] verify error:", err);
    res.status(400).json({
      isValid: false,
      invalidReason: "invalid_request",
      invalidMessage: err.message,
    });
  }
});

app.post("/settle", async (req, res) => {
  if (!facilitator) {
    return res.status(503).json({
      success: false,
      errorReason: "facilitator_not_configured",
      errorMessage: "FACILITATOR_PRIVATE_KEY is not set on this facilitator instance.",
      transaction: "",
      network: "eip155:3338",
    });
  }
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    // Same reasoning as /verify above: real settlement failures (on-chain
    // revert, insufficient facilitator gas, RPC hiccup) come back from
    // ExactEvmScheme's own settle path as a normal { success: false, ... }
    // object (it catches its own errors -- see mapSettleError in
    // @x402/evm's source), not a thrown exception. This catch is only for
    // malformed requests.
    const result = await facilitator.settle(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (err) {
    console.error("[peaq-facilitator] settle error:", err);
    res.status(400).json({
      success: false,
      errorReason: "invalid_request",
      errorMessage: err.message,
      transaction: "",
      network: "eip155:3338",
    });
  }
});

// Not part of the x402 protocol -- just lets Portainer/Docker healthchecks
// and a human confirm the service booted and report which address (if any)
// is currently configured to sign settlements, without needing to know the
// x402 wire format.
app.get("/health", (req, res) => {
  res.json({ status: "ok", configured: Boolean(facilitator), signerAddress });
});

app.listen(PORT, () => {
  console.log(`[peaq-facilitator] Listening on :${PORT}, peaq RPC=${PEAQ_RPC_URL}`);
});
