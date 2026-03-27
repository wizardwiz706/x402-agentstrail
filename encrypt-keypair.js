/**
 * encrypt-keypair.js — Encrypt your facilitator keypair for safe storage in env vars.
 *
 * Usage:
 *   node encrypt-keypair.js <keypair.json> <passphrase>
 *
 * Output:
 *   A base64 string you paste into FACILITATOR_KEYPAIR_ENCRYPTED env var.
 *   Store the passphrase separately in KEYPAIR_PASSPHRASE env var.
 *
 * The passphrase should be long and random (e.g. 32+ chars).
 * Even if an attacker gets the encrypted blob, they can't use it without the passphrase.
 */

import { readFileSync } from "fs";
import { randomBytes, createCipheriv, scryptSync } from "crypto";

const [,, keypairFile, passphrase] = process.argv;

if (!keypairFile || !passphrase) {
  console.error("Usage: node encrypt-keypair.js <keypair.json> <passphrase>");
  console.error("  e.g. node encrypt-keypair.js facilitator-keypair.json 'my-very-long-random-passphrase'");
  process.exit(1);
}

if (passphrase.length < 16) {
  console.error("ERROR: Passphrase must be at least 16 characters.");
  process.exit(1);
}

const plaintext = readFileSync(keypairFile, "utf-8");

// Derive a 256-bit key from the passphrase using scrypt
const salt = randomBytes(32);
const key  = scryptSync(passphrase, salt, 32);

// Encrypt with AES-256-GCM (authenticated encryption)
const iv     = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const enc    = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
const tag    = cipher.getAuthTag();

// Output: salt(32) + iv(12) + authTag(16) + ciphertext → base64
const blob = Buffer.concat([salt, iv, tag, enc]).toString("base64");

console.log("\n✅ Keypair encrypted successfully.\n");
console.log("Set these two env vars in Coolify (separately!):\n");
console.log(`FACILITATOR_KEYPAIR_ENCRYPTED=${blob}\n`);
console.log(`KEYPAIR_PASSPHRASE=${passphrase}\n`);
console.log("─────────────────────────────────────────────────");
console.log("WHY THIS HELPS:");
console.log("  • The encrypted blob is useless without the passphrase");
console.log("  • Store them in different places if possible:");
console.log("    - FACILITATOR_KEYPAIR_ENCRYPTED → Coolify env var");
console.log("    - KEYPAIR_PASSPHRASE → separate secrets manager, or");
console.log("      a different Coolify shared variable");
console.log("  • If your server is compromised but the attacker only");
console.log("    gets filesystem access (not Coolify dashboard),");
console.log("    they get nothing — the key lives only in memory.");
