/**
 * Generates a new Solana keypair for the facilitator fee payer
 * and saves it to facilitator-keypair.json
 */
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { writeFileSync } from "fs";

// Generate extractable Ed25519 keypair via WebCrypto
const keyPair = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  true, // extractable
  ["sign", "verify"]
);

// Export PKCS8 private key — Ed25519 seed is at bytes 16–48
const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
const seed   = new Uint8Array(pkcs8).slice(16, 48);

// Export raw public key (32 bytes)
const pubRaw  = await crypto.subtle.exportKey("raw", keyPair.publicKey);
const pubBytes = new Uint8Array(pubRaw);

// 64-byte keypair: [seed (32) + pubkey (32)]
const combined = new Uint8Array(64);
combined.set(seed, 0);
combined.set(pubBytes, 32);

const signer = await createKeyPairSignerFromBytes(combined);
writeFileSync("facilitator-keypair.json", JSON.stringify(Array.from(combined)));

console.log("✅ Facilitator keypair generated!");
console.log("   Address :", signer.address);
console.log("   Saved to: C:\\x402-facilitator\\facilitator-keypair.json");
console.log("");
console.log(`   Visit https://faucet.solana.com and paste: ${signer.address}`);
