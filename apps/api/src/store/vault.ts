/**
 * Interim connector vault (PRD-008a §1.1). Envelope-style symmetric encryption for the
 * coach's restricted Stripe key + webhook signing secret, stored as bytea in
 * tenant_integrations.access_token_enc.
 *
 * INTERIM SEAM — the full PRD-005c connector vault (KMS-backed DEK, rotation, MCP
 * catalog) drops in behind the CoachStripeConnector port in wave 4. Here the DEK is a
 * single AES-256 key supplied by env (CONNECTOR_VAULT_KEY, base64 32 bytes); rotate by
 * re-encrypting under 005c. Never plaintext at rest (schema invariant, migration 121000).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "./env.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function dek(): Buffer {
  const buf = Buffer.from(requireEnv("CONNECTOR_VAULT_KEY"), "base64");
  if (buf.length !== 32) {
    throw new Error(
      "CONNECTOR_VAULT_KEY must be base64-encoded 32 bytes (AES-256). Interim connector " +
        "vault DEK; PRD-005c replaces it with a KMS-backed key.",
    );
  }
  return buf;
}

/** Encrypt a UTF-8 secret → iv(12) || authTag(16) || ciphertext, for bytea storage. */
export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, dek(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

/** Decrypt an iv||tag||ciphertext blob; throws (GCM auth) on tamper or wrong key. */
export function decryptSecret(blob: Buffer): string {
  if (blob.length < IV_LEN + TAG_LEN + 1)
    throw new Error("connector vault blob malformed (too short)");
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, dek(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8",
  );
}
