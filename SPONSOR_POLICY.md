# Sponsor Policy

The facilitator does not blindly sign every transaction that comes in. Every payment is validated against a strict policy before the facilitator sponsors fees and submits it on-chain.

---

## Solana Policy

### Asset Allowlist

Only USDC is accepted by default:

| Token | Mint Address |
|-------|-------------|
| USDC (Devnet)  | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| USDC (Mainnet) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

Configurable via `ALLOWED_ASSETS` environment variable (comma-separated mint addresses).

### Network Allowlist

Only networks registered in `.env` are accepted:

| Network | CAIP-2 ID |
|---------|-----------|
| Solana Devnet  | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |

Configurable via `ALLOWED_NETWORKS` environment variable (comma-separated CAIP-2 IDs).

### Minimum Payment

| Rule | Value |
|------|-------|
| Minimum payment (atomic units) | `10,000` (= 0.01 USDC, 6 decimals) |

Payments below this amount are rejected with `policy:amount_below_min`.

### Recipient Allowlist (Optional)

If `ALLOWED_PAY_TO` is set in `.env`, only those wallet addresses may appear as the `payTo` recipient. This prevents strangers from pointing their servers at your facilitator and having you pay their tx fees.

Leave `ALLOWED_PAY_TO` unset to allow any recipient address.

```env
# .env — optional: restrict which wallets can receive payments via this facilitator
ALLOWED_PAY_TO=BqVq3uwK1Lo4qVwmrNscWvyHAghPJcmmEck5961kaNCG,AnotherAddress123...
```

### Other Validations (enforced by @x402/svm SDK)

These are enforced automatically by the underlying x402 SDK during `verify()`:

- Recipient must match the `payTo` address in payment requirements
- Mint must match the `asset` in payment requirements
- Amount must be >= the required `amount`
- Facilitator fee payer must NOT be the same wallet as the client payer

---

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| All endpoints (`/supported`, `/verify`, `/settle`) | 60 requests / minute / IP |
| `/settle` only (each call costs fee payer SOL) | 20 requests / minute / IP |

Rate limit exceeded returns HTTP 429:
```json
{ "error": "policy:rate_limit_exceeded" }
```

---

## Policy Error Codes

| Error Code | Cause |
|------------|-------|
| `policy:network_not_allowed` | CAIP-2 network not in `ALLOWED_NETWORKS` |
| `policy:asset_not_allowed` | Token mint not in `ALLOWED_ASSETS` |
| `policy:amount_below_min` | Payment below 0.01 USDC (10,000 atomic units) |
| `policy:invalid_amount` | Amount field is not a valid number |
| `policy:recipient_not_allowed` | `payTo` address not in `ALLOWED_PAY_TO` |
| `policy:rate_limit_exceeded` | Too many requests from this IP |

---

## Configuration Reference

All policy rules are configurable via `.env`:

```env
# Comma-separated USDC mint addresses to accept (default: devnet + mainnet USDC)
ALLOWED_ASSETS=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# Comma-separated CAIP-2 networks to accept (default: value of NETWORK env var)
ALLOWED_NETWORKS=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1

# Optional: restrict which payTo addresses are allowed (leave unset for open)
ALLOWED_PAY_TO=YourWalletAddress1,YourWalletAddress2
```

---

## Transaction Inspection (Parity with Dexter)

Every payment transaction is deserialized and inspected before the x402 SDK processes it. This closes all gaps with Dexter's production facilitator:

| Check | Limit | Configurable |
|-------|-------|--------------|
| Allowed programs | SPL Token, ComputeBudget, System, ATA, Memo only | No |
| Compute unit limit | 200,000 CU max | `MAX_COMPUTE_UNITS` |
| Priority fee | 50,000 microlamports max | `MAX_PRIORITY_FEE_MICROLAMPORTS` |
| Address lookup tables | Rejected outright | No |
| Token transfers per tx | 1 max | No |

Transactions failing any of these checks are rejected before an RPC call is made.

---

## Policy Error Codes

| Code | Source | Cause |
|------|--------|-------|
| `policy:network_not_allowed` | onBeforeVerify | Network not in `ALLOWED_NETWORKS` |
| `policy:asset_not_allowed` | onBeforeVerify | Mint not in `ALLOWED_ASSETS` |
| `policy:amount_below_min` | onBeforeVerify | Payment below 0.01 USDC |
| `policy:invalid_amount` | onBeforeVerify | Amount field unparseable |
| `policy:recipient_not_allowed` | onBeforeVerify | `payTo` not in `ALLOWED_PAY_TO` |
| `policy:rate_limit_exceeded` | Rate limiter | >120/min global or >30/min on /settle |
| `policy:transaction_missing` | Tx inspect | No transaction bytes found in payload |
| `policy:transaction_parse_error` | Tx inspect | Transaction bytes could not be deserialized |
| `policy:address_lookup_tables_not_allowed` | Tx inspect | Transaction uses ALTs |
| `policy:program_not_allowed` | Tx inspect | Unknown program in instructions |
| `policy:compute_units_exceeded` | Tx inspect | CU limit > 200,000 |
| `policy:priority_fee_exceeded` | Tx inspect | Priority fee > 50,000 microlamports |
| `policy:too_many_transfers` | Tx inspect | More than 1 SPL Token transfer |

---

## Configuration Reference

All policy parameters are set in `.env`. No code changes needed — just update `.env` and restart.

```env
# Network + RPC
PORT=4402
NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
FACILITATOR_KEYPAIR_PATH=/path/to/keypair.json

# Allowlists
ALLOWED_NETWORKS=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
ALLOWED_ASSETS=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
ALLOWED_PAY_TO=YourWallet1,YourWallet2

# Transaction inspection limits
MAX_COMPUTE_UNITS=200000
MAX_PRIORITY_FEE_MICROLAMPORTS=50000
LOW_BALANCE_THRESHOLD_SOL=0.05

# Rate limiting
RATE_LIMIT_GLOBAL=120
RATE_LIMIT_SETTLE=30

# CORS (comma-separated origins, or * for open)
CORS_ORIGIN=https://yourdomain.com
```


| Network | CAIP-2 ID |
|---------|-----------|
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Solana Mainnet *(add when ready)* | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |

Configure via `ALLOWED_NETWORKS` in `.env` (comma-separated).

---

### 2. Asset Allowlist

Only USDC is accepted by default:

| Token | Network | Mint Address |
|-------|---------|--------------|
| USDC | Solana Devnet | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| USDC | Solana Mainnet | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

Configure via `ALLOWED_ASSETS` in `.env` (comma-separated mint addresses).

Any payment specifying a different token mint is rejected with `policy:asset_not_allowed`.

---

### 3. Minimum Payment

| Parameter | Value |
|-----------|-------|
| Minimum payment (atomic units) | `10,000` |
| Minimum payment (human) | `0.01 USDC` |

Payments below this threshold are rejected with `policy:amount_below_min`.

USDC has 6 decimal places: 1 USDC = 1,000,000 atomic units.

---

### 4. PayTo Allowlist (Optional)

By default, any recipient address is permitted. To restrict which wallets can receive payments through this facilitator, set `ALLOWED_PAY_TO` in `.env`:

```env
ALLOWED_PAY_TO=BqVq3uwK1Lo4qVwmrNscWvyHAghPJcmmEck5961kaNCG,AnotherWallet...
```

If a payment target is not in the allowlist, it is rejected with `policy:recipient_not_allowed`.

**Use case:** Run a private facilitator that only processes payments to your own wallets.

---

### 5. Rate Limiting

To protect the fee payer wallet from being drained:

| Endpoint | Limit |
|----------|-------|
| `GET /supported` | 60 requests/min per IP |
| `POST /verify` | 60 requests/min per IP |
| `POST /settle` | **20 requests/min per IP** |

`/settle` has a stricter limit because each call costs the fee payer real SOL in transaction fees.

Exceeded requests are rejected with HTTP 429 and `policy:rate_limit_exceeded`.

---

### 6. Payload Size Limit

Request bodies are capped at **64KB**. Oversized requests are rejected with HTTP 413.

This prevents memory exhaustion attacks.

---

## SDK-Level Checks (enforced by `@x402/svm`)

In addition to the above, the `ExactSvmScheme.verify()` enforces these on every transaction:

| Check | Rule |
|-------|------|
| Recipient | Must match `payTo` in payment requirements |
| Mint | Must match `asset` in payment requirements |
| Amount | Must be >= `maxAmountRequired` |
| Fee payer | Must NOT be the payer (client and facilitator must be different wallets) |
| Transaction validity | Must be a valid, partially-signed Solana transaction |

---

## Error Codes

| Code | Meaning |
|------|---------|
| `policy:network_not_allowed` | Payment network not in allowlist |
| `policy:asset_not_allowed` | Token mint not in allowlist |
| `policy:amount_below_min` | Payment below 0.01 USDC minimum |
| `policy:invalid_amount` | Amount field could not be parsed |
| `policy:recipient_not_allowed` | `payTo` address not in allowlist |
| `policy:rate_limit_exceeded` | Too many requests from this IP |
| `invalid_exact_svm_payload_transaction_fee_payer_transferring_funds` | Client and facilitator using same wallet |

---

## Configuration Reference

All policy parameters are set in `.env`:

```env
# Comma-separated CAIP-2 networks (default: devnet only)
ALLOWED_NETWORKS=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1

# Comma-separated USDC mint addresses (default: devnet + mainnet USDC)
ALLOWED_ASSETS=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# Optional: restrict payTo addresses (leave unset to allow all)
# ALLOWED_PAY_TO=YourWallet1,YourWallet2
```

No code changes needed — just update `.env` and restart the facilitator.
