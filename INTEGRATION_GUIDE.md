# x402 Facilitator Integration Guide

Turn any HTTP endpoint into a **paid API** that accepts Solana USDC payments — no subscriptions, no API keys, no payment processors.

This guide shows how to integrate with our self-hosted x402 facilitator running at `http://localhost:4402` (replace with your deployed URL in production).

---

## How It Works

```
Client                  Your Server               Facilitator
  │                          │                         │
  │── GET /your-endpoint ───►│                         │
  │◄─ 402 Payment Required ──│ (payTo, price, network) │
  │                          │                         │
  │── POST /verify ─────────────────────────────────►  │
  │◄─ { isValid: true } ───────────────────────────── │
  │                          │                         │
  │── GET /your-endpoint ───►│                         │
  │   (with payment header)  │                         │
  │                          │── POST /settle ────────►│
  │                          │◄─ { success: true } ────│
  │◄─ 200 + data ────────────│                         │
```

1. Client hits your endpoint → gets a **402** with payment instructions
2. Client SDK builds + partially signs a Solana USDC transaction
3. Facilitator **verifies** the tx is valid with correct amount/recipient
4. Facilitator **settles** the tx (signs as fee payer + submits to Solana)
5. Your server receives confirmation → returns protected data

---

## Prerequisites

- Node.js 18+
- A Solana wallet address to receive USDC (your `payTo` address)
- Devnet: USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Mainnet: USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

---

## Step 1 — Install the SDK

```bash
npm install @x402/express @x402/svm @x402/core
```

---

## Step 2 — Configure Your Server

```js
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();

// ── x402 configuration ───────────────────────────────────────────────────────
const FACILITATOR_URL  = "http://localhost:4402";       // replace with deployed URL
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

### Mainnet configuration

```js
const NETWORK    = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC_MINT  = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
```

---

## Step 3 — Protect Multiple Routes

You can gate as many routes as you want, each with different prices:

```js
app.use(paymentMiddleware(
  {
    "GET /api/basic":    { accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo: PAYMENT_ADDRESS, asset: USDC_MINT }], description: "Basic data" },
    "GET /api/premium":  { accepts: [{ scheme: "exact", price: "$0.05",  network: NETWORK, payTo: PAYMENT_ADDRESS, asset: USDC_MINT }], description: "Premium data" },
    "POST /api/compute": { accepts: [{ scheme: "exact", price: "$0.10",  network: NETWORK, payTo: PAYMENT_ADDRESS, asset: USDC_MINT }], description: "Compute job" },
  },
  resourceServer
));
```

---

## Step 4 — Client Integration

Clients use the `@x402/fetch` + `@x402/svm` libraries to pay automatically:

```bash
npm install @x402/fetch @x402/svm @solana/kit
```

```js
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { readFileSync } from "fs";

// Load client keypair (must have devnet USDC)
const raw    = JSON.parse(readFileSync("my-keypair.json", "utf-8"));
const signer = await createKeyPairSignerFromBytes(Uint8Array.from(raw));

const NETWORK     = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const SOLANA_RPC  = "https://api.devnet.solana.com";

// Create x402-enabled fetch
const client    = new x402Client().register(NETWORK, new ExactSvmScheme(signer, { rpcUrl: SOLANA_RPC }));
const paidFetch = wrapFetchWithPayment(fetch, client);

// Use exactly like normal fetch — payment is handled automatically
const response = await paidFetch("http://your-server.com/your-paid-endpoint");
const data     = await response.json();
console.log(data);
```

---

## Facilitator API Reference

The facilitator exposes three endpoints your resource server calls automatically. You don't need to call these directly, but here they are for reference:

### `GET /supported`
Returns the payment schemes and networks this facilitator supports.

**Response:**
```json
{
  "kinds": [{ "x402Version": 2, "scheme": "exact", "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "extra": { "feePayer": "BZDTTtv..." } }],
  "extensions": [],
  "signers": { "exact": ["BZDTTtv..."] }
}
```

### `POST /verify`
Verifies a client payment payload before settlement.

**Request:**
```json
{
  "paymentPayload": { ... },
  "paymentRequirements": { ... }
}
```

**Response:**
```json
{ "isValid": true, "payer": "3pN49tj..." }
```

### `POST /settle`
Signs + submits the Solana transaction and confirms settlement.

**Response:**
```json
{ "success": true, "txHash": "5xyz...", "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" }
```

---

## Supported Networks

| Network         | CAIP-2 ID                                          | USDC Mint |
|-----------------|----------------------------------------------------|-----------|
| Solana Devnet   | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`         | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Solana Mainnet  | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`         | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

---

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid_exact_svm_payload_transaction_fee_payer_transferring_funds` | Client and facilitator using same wallet | Use a separate wallet for the facilitator fee payer |
| `Failed to initialize: no supported payment kinds` | Facilitator URL wrong or down | Check `FACILITATOR_URL` in `.env` and ensure facilitator is running |
| `404 on /supported` | Facilitator doesn't implement x402 API | Only use x402-compatible facilitators |
| `402 {}` on paid request | Verify returned `isValid: false` | Check client has sufficient USDC balance and correct network |

---

## Quick Start Checklist

- [ ] Install `@x402/express`, `@x402/svm`, `@x402/core`
- [ ] Set `FACILITATOR_URL` to our facilitator endpoint
- [ ] Set `PAYMENT_ADDRESS` to your Solana wallet (receives USDC)
- [ ] Wrap your routes with `paymentMiddleware`
- [ ] Test with `npm test` using a funded devnet wallet

---

## Need Help?

- x402 Protocol docs: https://x402.org
- Solana devnet faucet: https://faucet.solana.com
- Devnet USDC faucet: https://faucet.circle.com
