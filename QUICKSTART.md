# From Free API → Paid API in 10 Minutes

**What you need to start:**
- Your existing Express API running somewhere
- A computer with Node.js installed

---

## Step 1 — Get a Solana Wallet (2 min)

1. Go to [phantom.app](https://phantom.app) → Download → Install browser extension
2. Create new wallet → save your seed phrase somewhere safe
3. Click your wallet name at the top → **Copy Address**
   - Looks like: `BqVq3uwK1Lo4qVwmrNscWvyHAghPJcmmEck5961kaNCG`
   - This is where your **USDC payments will land**

---

## Step 2 — Get Test USDC (devnet, free) (2 min)

1. Go to [faucet.circle.com](https://faucet.circle.com)
2. Select **Solana** → **Devnet**
3. Paste your wallet address → Request tokens
4. You'll receive **free devnet USDC** for testing

---

## Step 3 — Install x402 Packages (1 min)

Open terminal **in your project folder**:

```bash
npm install @x402/express @x402/svm @x402/core
```

---

## Step 4 — Update Your server.js (3 min)

**Your current server.js (before):**
```js
import express from "express";
const app = express();

app.get("/data", (req, res) => {
  res.json({ result: "your data here" });
});

app.listen(3000);
```

**Your server.js (after) — only add the highlighted lines:**
```js
import express from "express";

// ── ADD THESE ──────────────────────────────────────────────
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const facilitator = new HTTPFacilitatorClient({
  url: "https://x402.agentstrail.ai"   // ← your facilitator, already live
});
const resourceServer = new x402ResourceServer(facilitator)
  .register("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", new ExactSvmScheme());

app.use(paymentMiddleware({
  "GET /data": {
    accepts: [{
      scheme:  "exact",
      price:   "$0.01",                                          // ← your price
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",      // devnet
      payTo:   "YOUR_WALLET_ADDRESS",                           // ← paste from Step 1
      asset:   "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // devnet USDC
    }]
  }
}, resourceServer));
// ── END OF ADDITIONS ───────────────────────────────────────

// YOUR EXISTING ROUTE — nothing changes here
app.get("/data", (req, res) => {
  res.json({ result: "your data here" });
});

app.listen(3000);
```

---

## Step 5 — Restart Your Server

```bash
node server.js
```

Test it's working:
```bash
curl http://localhost:3000/data
```

You should now get a **402 Payment Required** response. ✅ Your API is now gated.

---

## Step 6 — Register on Agentstrail (1 min)

1. Go to [discover.agentstrail.ai/onboard](https://discover.agentstrail.ai/onboard)
2. Scroll to **Submit Your Endpoint**
3. Paste your public API URL (e.g. `https://myapi.com/data`)
4. Click **Submit**

Agentstrail verifies your 402 response → lists your API publicly → AI agents start discovering and paying for it.

---

## Step 7 — Watch USDC Arrive in Your Wallet

Every time someone calls your API:
- They pay 0.01 USDC automatically
- `x402.agentstrail.ai` verifies + settles it on Solana
- USDC lands directly in your Phantom wallet

Check your earnings at [discover.agentstrail.ai/seller](https://discover.agentstrail.ai/seller)

---

## Going to Mainnet (real money)

When ready, change 2 values in your server:

```js
network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",        // mainnet
asset:   "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",   // mainnet USDC
```

---

## Reference

| Item | Value |
|------|-------|
| Facilitator URL | `https://x402.agentstrail.ai` |
| Devnet network ID | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Mainnet network ID | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Devnet USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Mainnet USDC mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Wallet (Phantom) | [phantom.app](https://phantom.app) |
| Devnet USDC faucet | [faucet.circle.com](https://faucet.circle.com) |
| Devnet SOL faucet | [faucet.solana.com](https://faucet.solana.com) |
| Seller dashboard | [discover.agentstrail.ai/seller](https://discover.agentstrail.ai/seller) |
| Register endpoint | [discover.agentstrail.ai/onboard](https://discover.agentstrail.ai/onboard) |

---

**Total time: ~10 minutes. Zero payment processor accounts. USDC goes straight to your wallet.**
