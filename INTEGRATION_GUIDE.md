# x402.agentstrail.ai — Integration Guide

Turn any HTTP endpoint into a **paid API** in minutes. Clients pay in USDC on Solana — no subscriptions, no API keys, no payment processors. Works with AI agents, scripts, browsers, or any HTTP client.

| | |
|---|---|
| **Live facilitator** | `https://x402.agentstrail.ai` |
| **Health check** | [`GET /health`](https://x402.agentstrail.ai/health) |
| **Supported networks** | [`GET /supported`](https://x402.agentstrail.ai/supported) |
| **Networks** | Solana devnet + Solana mainnet |
| **Status** | Live — tested, on-chain verified |

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Quick Path — @agentstrail/x402 (recommended)](#quick-path--agentstrailx402-recommended)
3. [Full Path — Raw @x402/* SDK](#full-path--raw-x402-sdk)
4. [Dynamic Pricing](#dynamic-pricing)
5. [Multiple Routes](#multiple-routes)
6. [Client Integration (How Agents Pay)](#client-integration-how-agents-pay)
7. [Going to Mainnet](#going-to-mainnet)
8. [Testing & Verification](#testing--verification)
9. [Facilitator API Reference](#facilitator-api-reference)
10. [Common Errors](#common-errors)
11. [Checklist](#checklist)

---

## How It Works

```
Your Client / Agent          Your Server              x402.agentstrail.ai      Solana
        │                        │                            │                    │
        │── GET /paid-route ────►│                            │                    │
        │◄── 402 + payment info ─│  (what to pay, who, where) │                    │
        │                        │                            │                    │
        │ (client builds + signs Solana USDC tx off-chain)    │                    │
        │                        │                            │                    │
        │── GET /paid-route ────►│                            │                    │
        │   + X-PAYMENT header   │── POST /verify ───────────►│                    │
        │                        │◄── valid ──────────────────│                    │
        │                        │── POST /settle ───────────►│── submit tx ──────►│
        │                        │                            │◄── confirmed ──────│
        │                        │◄── settled ────────────────│                    │
        │◄── 200 + data ─────────│                            │                    │
```

**What the facilitator does:**
- `/verify` — checks the transaction is correctly formed (correct amount, correct recipient, correct USDC mint)
- `/settle` — signs as fee payer, submits the transaction to Solana, waits for confirmation

**What your server does:**
- Returns a `402 Payment Required` with payment requirements (handled automatically by the middleware)
- On retry with payment header: calls the facilitator, gets settlement proof, then runs your route handler

**Fees:** The facilitator pays Solana transaction gas fees (SOL). You pay nothing extra to use it.

---

## Quick Path — @agentstrail/x402 (recommended)

One package. ~10 lines. USDC mint and network defaults handled for you.

### 1. Prerequisites

- Node.js 18+
- A Solana wallet address to receive USDC (**not** a private key — just the public address)
- For devnet testing: free devnet USDC from [faucet.circle.com](https://faucet.circle.com)

### 2. Install

```bash
npm install @agentstrail/x402 express dotenv
```

`@agentstrail/x402` wraps `@x402/express`, `@x402/core`, and `@x402/svm` — no need to install them separately.

### 3. Protect a route

```js
import "dotenv/config";
import express from "express";
import { x402Middleware } from "@agentstrail/x402/server";

const app = express();
app.use(express.json());

const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS; // your Solana wallet

app.get("/api/data",
  x402Middleware({
    payTo:  PAYMENT_ADDRESS,  // 👈 your wallet — USDC lands here
    amount: "0.01",           // 👈 price in USD (1 cent per call)
  }),
  (req, res) => {
    // This only runs after successful payment
    res.json({ data: "your protected content here" });
  }
);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(3000, () => console.log("Running on http://localhost:3000"));
```

Defaults used automatically:
- Facilitator: `https://x402.agentstrail.ai`
- Network: Solana devnet
- USDC mint: auto-detected for the chosen network

### 4. Full options reference

```js
x402Middleware({
  // Required
  payTo:   "YourSolanaWalletAddress",  // base58 public key — receives USDC

  // Required — static or dynamic price
  amount:  "0.01",                     // fixed: USD string
  // amount: (req) => "0.05",          // dynamic: function that returns USD string

  // Optional — network (defaults to Solana devnet)
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",  // devnet
  // network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",  // mainnet

  // Optional — USDC mint (auto-detected from network)
  asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",

  // Optional — override the facilitator (defaults to x402.agentstrail.ai)
  facilitatorUrl: "https://x402.agentstrail.ai",

  // Optional — shown in the 402 response (helps clients know what they're paying for)
  description: "Real-time crypto market data",

  // Optional — response MIME type
  mimeType: "application/json",

  // Optional — called after every successful payment
  onSettlement: ({ transaction, payer, network }) => {
    console.log(`Paid: ${transaction} from ${payer}`);
    // Great place to log to your DB, fire a webhook, send analytics, etc.
  },
})
```

### 5. .env file

```env
# Your Solana wallet address — where USDC lands
PAYMENT_ADDRESS=YourSolanaWalletAddressHere

# Price per call in USD (optional — default 0.01)
PRICE_USDC=0.01

# Network (optional — defaults to Solana devnet)
# NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1   # devnet
# NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp    # mainnet

PORT=3000
```

---

## Full Path — Raw @x402/* SDK

Use this if you need fine-grained control: custom lifecycle hooks, existing setup that already imports from `@x402/express`, or multi-network configurations.

### Install

```bash
npm install @x402/express @x402/svm @x402/core dotenv express
```

### Server setup

```js
import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();

const FACILITATOR_URL = "https://x402.agentstrail.ai";
const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS;
const NETWORK         = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; // Solana devnet
const USDC_MINT       = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const PRICE_USDC      = "0.01";

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer    = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactSvmScheme());

// Optional lifecycle hooks
resourceServer.onAfterSettle(async (ctx) => {
  console.log(`Settled: ${ctx.result.transaction} from ${ctx.result.payer}`);
});

app.use(paymentMiddleware(
  {
    "GET /api/data": {
      accepts: [{
        scheme:  "exact",
        price:   `$${PRICE_USDC}`,
        network: NETWORK,
        payTo:   PAYMENT_ADDRESS,
        asset:   USDC_MINT,
      }],
      description: "Real-time crypto data",
      mimeType:    "application/json",
    },
  },
  resourceServer
));

app.get("/api/data", (req, res) => {
  res.json({ data: "your content" });
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.listen(3000, () => console.log("Running on http://localhost:3000"));
```

### Available lifecycle hooks

```js
resourceServer.onAfterSettle(async (ctx) => {
  // ctx.result.transaction — Solana tx signature
  // ctx.result.payer       — client's public key
  // ctx.result.network     — CAIP-2 network ID
});

resourceServer.onAfterVerify(async (ctx) => {
  // ctx.result.isValid, ctx.result.payer
});

resourceServer.onVerifyFailure(async (ctx) => {
  // ctx.error
});

resourceServer.onSettleFailure(async (ctx) => {
  // ctx.error
});
```

### Mainnet (raw SDK)

```js
const NETWORK   = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
```

---

## Dynamic Pricing

Charge based on input size — ideal for LLM, compute, or data-volume endpoints.

### With @agentstrail/x402

```js
import { x402Middleware, dynamicPricing } from "@agentstrail/x402/server";

const app = express();
app.use(express.json());

// $0.01 per 1,000 input characters, min $0.001, max $10
const pricing = dynamicPricing({
  unitSize:    1000,
  ratePerUnit: 0.01,
  minUsd:      0.001,
  maxUsd:      10.00,
});

app.post("/api/analyze",
  x402Middleware({
    payTo:  process.env.PAYMENT_ADDRESS,
    amount: (req) => pricing.calculate(req.body.text),  // price scales with input
  }),
  (req, res) => {
    res.json({ result: analyze(req.body.text) });
  }
);
```

### Custom logic

```js
// Any function that returns a USD string works
x402Middleware({
  payTo:  process.env.PAYMENT_ADDRESS,
  amount: async (req) => {
    if (req.query.tier === "premium") return "0.10";
    if (Number(req.query.rows) > 1000)  return "0.05";
    return "0.01";
  },
})
```

---

## Multiple Routes

```js
// With @agentstrail/x402 — one middleware instance per route
app.get("/api/basic",
  x402Middleware({ payTo: PAYMENT_ADDRESS, amount: "0.001", description: "Basic" }),
  handlerBasic
);

app.get("/api/premium",
  x402Middleware({ payTo: PAYMENT_ADDRESS, amount: "0.05", description: "Premium" }),
  handlerPremium
);

app.post("/api/compute",
  x402Middleware({ payTo: PAYMENT_ADDRESS, amount: "0.10", description: "Compute" }),
  handlerCompute
);
```

```js
// With raw @x402/* SDK — all routes in one paymentMiddleware call
app.use(paymentMiddleware(
  {
    "GET /api/basic":    { accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAYMENT_ADDRESS, asset: USDC_MINT }], description: "Basic" },
    "GET /api/premium":  { accepts: [{ scheme: "exact", price: "$0.05",  network: NETWORK, payTo: PAYMENT_ADDRESS, asset: USDC_MINT }], description: "Premium" },
    "POST /api/compute": { accepts: [{ scheme: "exact", price: "$0.10",  network: NETWORK, payTo: PAYMENT_ADDRESS, asset: USDC_MINT }], description: "Compute" },
  },
  resourceServer
));
```

---

## Client Integration (How Agents Pay)

Clients call your API with a payment-aware fetch wrapper. The SDK:
1. Makes the request, gets a `402` response
2. Reads the `PAYMENT-REQUIRED` header — learns what to pay, to whom, on which network
3. Builds + signs a Solana USDC transaction off-chain
4. Retries the request with `X-PAYMENT` header containing the signed tx
5. Returns the `200` response to your code

**All of this happens transparently inside a single `await paidFetch(url)` call.**

### Using @agentstrail/x402/client

```bash
npm install @agentstrail/x402 @solana/kit
```

```js
import { wrapFetch } from "@agentstrail/x402/client";
import { readFileSync } from "fs";

// Load 64-byte Solana keypair — must have devnet USDC
const raw    = JSON.parse(readFileSync("my-keypair.json", "utf-8"));

const paidFetch = await wrapFetch(fetch, {
  walletPrivateKey: Uint8Array.from(raw),
  // Optional:
  // network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",  // default: Solana devnet
  // rpcUrl:  "https://devnet.helius-rpc.com/?api-key=...", // custom RPC (optional)
});

// Exactly like fetch — payment happens automatically
const response = await paidFetch("https://your-server.com/api/data");
const data     = await response.json();
console.log(data);
```

### Using a base58 private key (env var)

```js
import { wrapFetch } from "@agentstrail/x402/client";
import { getBase58Codec } from "@solana/kit";

const bytes = getBase58Codec().decode(process.env.SOLANA_PRIVATE_KEY);

const paidFetch = await wrapFetch(fetch, {
  walletPrivateKey: bytes,
});
```

### Using raw @x402/fetch SDK

```bash
npm install @x402/fetch @x402/svm @solana/kit
```

```js
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { readFileSync } from "fs";

const raw    = JSON.parse(readFileSync("keypair.json", "utf-8"));
const signer = await createKeyPairSignerFromBytes(Uint8Array.from(raw));

const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const client    = new x402Client()
  .register(NETWORK, new ExactSvmScheme(signer, { rpcUrl: "https://api.devnet.solana.com" }));
const paidFetch = wrapFetchWithPayment(fetch, client);

const response = await paidFetch("https://your-server.com/api/data");
```

### Get devnet USDC for testing

1. **Keypair:** `solana-keygen new --outfile my-keypair.json` (or any existing devnet wallet)
2. **Devnet SOL** (for network fees): [faucet.solana.com](https://faucet.solana.com) — paste your address, select Devnet
3. **Devnet USDC**: [faucet.circle.com](https://faucet.circle.com) — select Solana, paste your address

---

## Going to Mainnet

Change the `NETWORK` on your server and fund your client wallet with real USDC.

### Server change

```env
# .env — switch this one line
# NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1   # devnet (comment out)
NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp     # mainnet (uncomment)
```

If using `@agentstrail/x402`, the USDC mint is auto-detected. If using the raw SDK, also update:

```js
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // mainnet USDC
```

### Supported networks

| Network | CAIP-2 ID | USDC Mint |
|---|---|---|
| **Solana Devnet** | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| **Solana Mainnet** | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

### Client change

Replace the devnet keypair with a mainnet keypair that holds real USDC. The client SDK reads the required network from the `PAYMENT-REQUIRED` header automatically — no code change needed.

---

## Testing & Verification

### 1. Check the facilitator is alive

```bash
curl https://x402.agentstrail.ai/health
```

Expected: `{ "status": "ok" }` or `"degraded"` (low SOL on fee payer — still works).

### 2. Check your server is alive

```bash
curl http://localhost:3000/health
```

### 3. Confirm 402 is returned (unpaid request)

```bash
curl -i http://localhost:3000/api/data
```

Look for `HTTP/1.1 402 Payment Required` and a `PAYMENT-REQUIRED` header with a base64 blob.

### 4. Run a full payment test

```js
// test.js
import { wrapFetch } from "@agentstrail/x402/client";
import { readFileSync } from "fs";

const raw       = JSON.parse(readFileSync("my-keypair.json", "utf-8"));
const paidFetch = await wrapFetch(fetch, {
  walletPrivateKey: Uint8Array.from(raw),
});

const res  = await paidFetch("http://localhost:3000/api/data");
const data = await res.json();

console.log("Status:", res.status); // should be 200
console.log("Data:",   data);
```

```bash
node test.js
```

### 5. Verify on-chain

Grab the transaction signature from your `onSettlement` log, then check:
- Devnet: [explorer.solana.com/?cluster=devnet](https://explorer.solana.com/?cluster=devnet)
- Mainnet: [explorer.solana.com](https://explorer.solana.com)

---

## Facilitator API Reference

Your middleware calls these automatically. Reference only.

### `GET /health`

```bash
curl https://x402.agentstrail.ai/health
```

```json
{ "status": "ok", "networks": ["solana:EtWTR...", "solana:5eykt..."], "feePayer": "BZDTTtv..." }
```

### `GET /supported`

Returns supported payment schemes and networks.

```bash
curl https://x402.agentstrail.ai/supported
```

```json
{
  "kinds": [{ "x402Version": 2, "scheme": "exact", "network": "solana:EtWTR...", "extra": { "feePayer": "BZDTTtv..." } }],
  "extensions": [],
  "signers": { "exact": ["BZDTTtv..."] }
}
```

### `POST /verify`

Validates a client payment payload before settlement.

**Response:**
```json
{ "isValid": true, "payer": "3pN49tj..." }
// or
{ "isValid": false, "invalidReason": "incorrect_amount" }
```

### `POST /settle`

Signs as fee payer, submits to Solana, waits for confirmation.

**Response:**
```json
{ "success": true, "transaction": "5gsFTuo...", "network": "solana:EtWTR..." }
// or
{ "success": false, "errorReason": "transaction_expired" }
```

---

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `Failed to initialize: no supported payment kinds` | Facilitator URL wrong or unreachable | Verify `https://x402.agentstrail.ai/health` is reachable from your server |
| `404 on /supported` | Wrong facilitator URL | Only use x402-compatible facilitators; check for trailing slashes |
| `isValid: false` — `incorrect_amount` | Mismatch between what server expects and what client signed | Ensure client reads the `PAYMENT-REQUIRED` header and doesn't override amounts |
| `isValid: false` — `incorrect_recipient` | USDC going to wrong wallet | Check `payTo` matches your actual receiving wallet |
| Perpetual `402` — never reaching 200 | Client wallet has 0 USDC | Fund with devnet USDC at [faucet.circle.com](https://faucet.circle.com) |
| `ECONNREFUSED` calling facilitator | Server can't reach `x402.agentstrail.ai` | Check outbound HTTPS from your server; check firewall rules |
| `invalid_exact_svm_payload_transaction_fee_payer_transferring_funds` | Test client wallet = facilitator fee payer | Use a separate wallet for test payments |
| `[x402] No USDC mint known for network` | Unknown network string in `@agentstrail/x402` | Use one of the two built-in network IDs, or pass `asset` explicitly |
| Server starts but 402 never fires | `app.use(paymentMiddleware(...))` placed after route definition | Express middleware runs in order — the payment middleware must be declared **before** the route handler |

---

## Checklist

### Server setup
- [ ] `PAYMENT_ADDRESS` set to your Solana wallet (base58 public key)
- [ ] `NETWORK` matches your target (`devnet` for testing, `mainnet` for production)
- [ ] `GET /health` returns `200`
- [ ] `GET /paid-route` (no payment header) returns `HTTP 402`
- [ ] `PAYMENT-REQUIRED` header is present in the 402 response
- [ ] `onSettlement` callback fires and logs the transaction

### Client / test
- [ ] Keypair has a small amount of SOL on the same network (for signatures)
- [ ] Keypair has USDC on the same network
- [ ] Full payment test returns `HTTP 200` with your data
- [ ] Transaction visible on Solana Explorer

### Production readiness
- [ ] Switch `NETWORK` to `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet)
- [ ] Client funded with real USDC
- [ ] Endpoint publicly accessible (not `localhost`)
- [ ] `onSettlement` logs to persistent storage (DB, file, webhook)
- [ ] Price set to what you actually want to charge

---

## Need Help?

| Resource | URL |
|---|---|
| Facilitator health | https://x402.agentstrail.ai/health |
| Supported networks | https://x402.agentstrail.ai/supported |
| x402 protocol spec | https://x402.org |
| Solana devnet faucet | https://faucet.solana.com |
| Devnet USDC faucet | https://faucet.circle.com |
| Solana devnet explorer | https://explorer.solana.com/?cluster=devnet |
| Agentstrail marketplace | https://discover.agentstrail.ai |

```js
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();

// ── x402 configuration ───────────────────────────────────────────────────────
const FACILITATOR_URL  = "https://x402.agentstrail.ai"; // live facilitator
const PAYMENT_ADDRESS  = "YOUR_SOLANA_WALLET_ADDRESS";  // where USDC gets sent to you
const NETWORK          = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; // Solana devnet
const USDC_MINT        = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // devnet USDC
const PRICE_USDC       = "0.01"; // $0.01 per call — change to whatever you want

// ── Wire up the facilitator + payment middleware ─────────────────────────────
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactSvmScheme());

app.use(paymentMiddleware(
  {
    // Protect any route by adding it here:
    "GET /your-paid-endpoint": {
      accepts: [{
        scheme:   "exact",
        price:    `$${PRICE_USDC}`,
        network:  NETWORK,
        payTo:    PAYMENT_ADDRESS,
        asset:    USDC_MINT,
      }],
      description: "Your endpoint description",
      mimeType:    "application/json",
    },
  },
  resourceServer
));

// ── Your protected route ─────────────────────────────────────────────────────
app.get("/your-paid-endpoint", (req, res) => {
  res.json({ message: "You paid! Here is your data.", timestamp: Date.now() });
});

// ── Free routes work normally ────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
```


