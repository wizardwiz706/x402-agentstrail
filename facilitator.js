/**
 * x402 Self-Hosted Facilitator — Solana Devnet
 *
 * Exposes three endpoints required by the x402 protocol:
 *   GET  /supported  – returns supported payment kinds, extensions, signers
 *   POST /verify     – verifies a client payment payload
 *   POST /settle     – signs + submits the Solana tx and settles the payment
 *
 * The facilitator keypair acts as the fee payer for all Solana transactions.
 * It needs devnet SOL (not USDC) to pay tx fees.
 */

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { readFileSync } from "fs";
import { createDecipheriv, scryptSync } from "crypto";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactSvmScheme } from "@x402/svm/exact/facilitator";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { VersionedTransaction, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const PORT              = process.env.PORT              || 4402;
const NETWORK           = process.env.NETWORK           || "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const SOLANA_RPC_URL    = process.env.SOLANA_RPC_URL    || "https://api.devnet.solana.com";
const KEYPAIR_PATH      = process.env.FACILITATOR_KEYPAIR_PATH;
const CORS_ORIGIN       = process.env.CORS_ORIGIN       || "*";

// ── Load facilitator keypair ──────────────────────────────────────────────────
// Three methods (in priority order):
//   1. FACILITATOR_KEYPAIR_ENCRYPTED + KEYPAIR_PASSPHRASE — AES-256-GCM encrypted (most secure)
//   2. FACILITATOR_KEYPAIR_JSON — raw JSON array in env var (for Coolify/Railway)
//   3. FACILITATOR_KEYPAIR_PATH — path to JSON file on disk (local dev only)
const KEYPAIR_JSON      = process.env.FACILITATOR_KEYPAIR_JSON;
const KEYPAIR_ENCRYPTED = process.env.FACILITATOR_KEYPAIR_ENCRYPTED;
const KEYPAIR_PASS      = process.env.KEYPAIR_PASSPHRASE;

let rawKeypair;
if (KEYPAIR_ENCRYPTED && KEYPAIR_PASS) {
  // Decrypt: base64 blob = salt(32) + iv(12) + authTag(16) + ciphertext
  const buf  = Buffer.from(KEYPAIR_ENCRYPTED, "base64");
  const salt = buf.subarray(0, 32);
  const iv   = buf.subarray(32, 44);
  const tag  = buf.subarray(44, 60);
  const enc  = buf.subarray(60);
  const key  = scryptSync(KEYPAIR_PASS, salt, 32);
  const dec  = createDecipheriv("aes-256-gcm", key, iv);
  dec.setAuthTag(tag);
  rawKeypair = JSON.parse(Buffer.concat([dec.update(enc), dec.final()]).toString());
  console.log("Keypair loaded from encrypted env var");
} else if (KEYPAIR_JSON) {
  rawKeypair = JSON.parse(KEYPAIR_JSON);
  console.log("Keypair loaded from FACILITATOR_KEYPAIR_JSON env var");
} else if (KEYPAIR_PATH) {
  rawKeypair = JSON.parse(readFileSync(KEYPAIR_PATH, "utf-8"));
  console.log("Keypair loaded from file:", KEYPAIR_PATH);
} else {
  console.error("No keypair configured. Set one of:");
  console.error("  FACILITATOR_KEYPAIR_ENCRYPTED + KEYPAIR_PASSPHRASE");
  console.error("  FACILITATOR_KEYPAIR_JSON");
  console.error("  FACILITATOR_KEYPAIR_PATH");
  process.exit(1);
}
const keypair      = await createKeyPairSignerFromBytes(Uint8Array.from(rawKeypair));
const FEE_PAYER_PK = new PublicKey(keypair.address);
const connection   = new Connection(SOLANA_RPC_URL, "confirmed");
console.log("Facilitator fee payer :", keypair.address);

// ── Build the x402 facilitator ───────────────────────────────────────────────
const svmSigner   = toFacilitatorSvmSigner(keypair, { defaultRpcUrl: SOLANA_RPC_URL });
const svmScheme   = new ExactSvmScheme(svmSigner);
const facilitator = new x402Facilitator().register(NETWORK, svmScheme);

// ── Sponsor Policy ────────────────────────────────────────────────────────────
// Allowed USDC mints (devnet + mainnet). Override via ALLOWED_ASSETS env var.
const ALLOWED_ASSETS = new Set(
  process.env.ALLOWED_ASSETS
    ? process.env.ALLOWED_ASSETS.split(",").map(s => s.trim())
    : [
        "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // devnet USDC
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // mainnet USDC
      ]
);

// Allowed CAIP-2 networks. Override via ALLOWED_NETWORKS env var.
const ALLOWED_NETWORKS = new Set(
  process.env.ALLOWED_NETWORKS
    ? process.env.ALLOWED_NETWORKS.split(",").map(s => s.trim())
    : [NETWORK]
);

// Optional payTo allowlist — if set, only these recipient addresses are permitted.
// Leave ALLOWED_PAY_TO unset in .env to allow any recipient.
const ALLOWED_PAY_TO = process.env.ALLOWED_PAY_TO
  ? new Set(process.env.ALLOWED_PAY_TO.split(",").map(s => s.trim()))
  : null;

if (!ALLOWED_PAY_TO) {
  console.warn("⚠  ALLOWED_PAY_TO is not set — any wallet can receive payments via this facilitator.");
  console.warn("   Set ALLOWED_PAY_TO in .env to restrict recipients (strongly recommended for mainnet).");
}

// Minimum payment: 10,000 atomic units = 0.01 USDC (6 decimals)
const MIN_PAYMENT_ATOMIC = 10_000n;

// ── Transaction inspection ────────────────────────────────────────────────────
const TX_ALLOWED_PROGRAMS = new Set([
  "11111111111111111111111111111111",               // System Program
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  // SPL Token
  "ComputeBudget111111111111111111111111111111",    // Compute Budget
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bv",  // Associated Token Account
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",  // Memo v2 (used by @x402/svm)
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",  // Memo v1
]);

const MAX_CU           = parseInt(process.env.MAX_COMPUTE_UNITS             ?? "200000", 10);
const MAX_PRIORITY_FEE = BigInt(process.env.MAX_PRIORITY_FEE_MICROLAMPORTS  ?? "50000");
const LOW_SOL_WARN     = parseFloat(process.env.LOW_BALANCE_THRESHOLD_SOL   ?? "0.05");
const ALERT_WEBHOOK    = process.env.ALERT_WEBHOOK_URL;  // Discord/Slack webhook for low-balance alerts

/** Returns a policy error string on violation, or null if all checks pass. */
function inspectTransaction(paymentPayload) {
  const txBase64 =
    paymentPayload?.payload?.transaction ??
    paymentPayload?.transaction ??
    null;
  if (!txBase64) return "policy:transaction_missing";

  let tx;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
  } catch {
    return "policy:transaction_parse_error";
  }

  // 1. No address lookup tables
  if (tx.message.addressTableLookups?.length > 0) {
    return "policy:address_lookup_tables_not_allowed";
  }

  const staticKeys = tx.message.staticAccountKeys;
  let tokenTransfers = 0;

  for (const ix of tx.message.compiledInstructions) {
    const programId = staticKeys[ix.programIdIndex].toBase58();

    // 2. Allowed programs only
    if (!TX_ALLOWED_PROGRAMS.has(programId)) {
      console.warn(`[tx-inspect] Unknown program: ${programId}`);
      return "policy:program_not_allowed";
    }

    const data = Buffer.from(ix.data);

    if (programId === "ComputeBudget111111111111111111111111111111") {
      const type = data[0];
      // 3. Compute unit limit cap
      if (type === 2 && data.length >= 5) {
        if (data.readUInt32LE(1) > MAX_CU) return "policy:compute_units_exceeded";
      }
      // 4. Priority fee cap
      if (type === 3 && data.length >= 9) {
        if (data.readBigUInt64LE(1) > MAX_PRIORITY_FEE) return "policy:priority_fee_exceeded";
      }
    }

    if (programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
      const type = data[0];
      if (type === 3 || type === 12) tokenTransfers++; // Transfer / TransferChecked
    }
  }

  // 5. Max 1 token transfer per tx
  if (tokenTransfers > 1) return "policy:too_many_transfers";

  return null; // passed
}

// Middleware: inspect tx bytes on /verify and /settle before the x402 SDK sees them
function txInspectionMiddleware(req, res, next) {
  const { paymentPayload } = req.body ?? {};
  if (!paymentPayload) return next();
  const error = inspectTransaction(paymentPayload);
  if (error) {
    console.warn(`[tx-inspect] BLOCKED: ${error}`);
    return res.status(400).json({ error });
  }
  next();
}

facilitator.onBeforeVerify(async ({ requirements }) => {
  // 1. Network allowlist
  if (!ALLOWED_NETWORKS.has(requirements.network)) {
    console.warn(`[policy] BLOCKED network_not_allowed: ${requirements.network}`);
    return { abort: true, reason: "policy:network_not_allowed" };
  }

  // 2. Asset allowlist — USDC only
  if (!ALLOWED_ASSETS.has(requirements.asset)) {
    console.warn(`[policy] BLOCKED asset_not_allowed: ${requirements.asset}`);
    return { abort: true, reason: "policy:asset_not_allowed" };
  }

  // 3. Minimum payment: 0.01 USDC
  try {
    const amountStr = String(requirements.maxAmountRequired ?? requirements.amount ?? 0);
    if (BigInt(amountStr) < MIN_PAYMENT_ATOMIC) {
      console.warn(`[policy] BLOCKED amount_below_min: ${amountStr}`);
      return { abort: true, reason: "policy:amount_below_min" };
    }
  } catch {
    return { abort: true, reason: "policy:invalid_amount" };
  }

  // 4. PayTo allowlist (optional — only enforced if ALLOWED_PAY_TO is set in .env)
  if (ALLOWED_PAY_TO && !ALLOWED_PAY_TO.has(requirements.payTo)) {
    console.warn(`[policy] BLOCKED recipient_not_allowed: ${requirements.payTo}`);
    return { abort: true, reason: "policy:recipient_not_allowed" };
  }
});

// ── Express server ────────────────────────────────────────────────────────────
const app = express();
app.use(helmet());
app.use(cors({
  origin: CORS_ORIGIN === "*" ? "*" : CORS_ORIGIN.split(",").map(s => s.trim()),
  methods: ["GET", "POST"],
}));
app.use(express.json({ limit: "64kb" }));

// Rate limiting — 120 req/min per IP (configurable via RATE_LIMIT_GLOBAL)
const limiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_GLOBAL ?? "120", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "policy:rate_limit_exceeded" },
});
app.use(limiter);

// Stricter limit on /settle — 30/min per IP (configurable via RATE_LIMIT_SETTLE)
const settleLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_SETTLE ?? "30", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "policy:rate_limit_exceeded" },
});

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// GET /health — fee payer SOL balance + liveness
app.get("/health", async (_req, res) => {
  try {
    const lamports   = await connection.getBalance(FEE_PAYER_PK);
    const solBalance = lamports / LAMPORTS_PER_SOL;
    const lowBalance = solBalance < LOW_SOL_WARN;
    if (lowBalance) console.warn(`⚠  Fee payer balance low: ${solBalance.toFixed(4)} SOL`);
    res.json({
      status:          lowBalance ? "degraded" : "ok",
      feePayerAddress: keypair.address,
      feePayerBalance: `${solBalance.toFixed(4)} SOL`,
      lowBalance,
      network:         NETWORK,
      timestamp:       new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: "error", error: err.message });
  }
});

// GET /supported — tells the resource server what this facilitator supports
app.get("/supported", (_req, res) => {
  res.json(facilitator.getSupported());
});

// POST /verify — verifies a client payment payload
app.post("/verify", txInspectionMiddleware, async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const result = await facilitator.verify(paymentPayload, paymentRequirements);
    console.log("[verify] result:", JSON.stringify(result));
    res.json(result);
  } catch (err) {
    console.error("[verify] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /settle — signs, submits the Solana tx and returns settlement result
app.post("/settle", settleLimiter, txInspectionMiddleware, async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const result = await facilitator.settle(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (err) {
    console.error("[settle] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  console.log(`\nx402 Facilitator (Solana) → http://localhost:${PORT}`);
  console.log(`  Network   : ${NETWORK}`);
  console.log(`  RPC       : ${SOLANA_RPC_URL}`);
  console.log(`  Endpoints : GET /supported  POST /verify  POST /settle  GET /health\n`);
  try {
    const lamports = await connection.getBalance(FEE_PAYER_PK);
    const sol = lamports / LAMPORTS_PER_SOL;
    console.log(`  Fee payer balance: ${sol.toFixed(4)} SOL`);
    if (sol < LOW_SOL_WARN) {
      console.warn(`  ⚠  LOW BALANCE — top up fee payer with SOL\n`);
      sendBalanceAlert(sol);
    }
  } catch (e) {
    console.warn("  ⚠  Could not fetch fee payer balance:", e.message);
  }
});

// ── Low-balance alert ─────────────────────────────────────────────────────────
let lastAlertTime = 0;
async function sendBalanceAlert(solBalance) {
  if (!ALERT_WEBHOOK) return;
  if (Date.now() - lastAlertTime < 600_000) return; // max 1 alert per 10 min
  lastAlertTime = Date.now();
  try {
    await fetch(ALERT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `⚠️ **x402 Facilitator Low Balance**\nFee payer \`${keypair.address}\` has **${solBalance.toFixed(4)} SOL** remaining (threshold: ${LOW_SOL_WARN} SOL).\nTop up immediately to avoid failed settlements.`,
      }),
    });
  } catch (e) { console.warn("Failed to send alert:", e.message); }
}

function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down...`);
  server.close(() => { console.log("Server closed."); process.exit(0); });
  setTimeout(() => { console.error("Forced exit."); process.exit(1); }, 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
