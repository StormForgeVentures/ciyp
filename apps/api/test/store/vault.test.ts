// Interim connector vault — AES-256-GCM round-trip + tamper/wrong-key rejection.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

// TEST-ONLY DEK (not a real credential); generated fresh per run.
const VAULT_KEY = randomBytes(32).toString("base64");

let encryptSecret: (s: string) => Buffer;
let decryptSecret: (b: Buffer) => string;

beforeAll(async () => {
  process.env.CONNECTOR_VAULT_KEY = VAULT_KEY;
  const mod = await import("../../src/store/vault.js");
  encryptSecret = mod.encryptSecret;
  decryptSecret = mod.decryptSecret;
});

describe("connector vault", () => {
  it("round-trips a secret (never stored as plaintext bytes)", () => {
    const secret = "restricted-key-plaintext-probe-value";
    const blob = encryptSecret(secret);
    expect(blob.includes(Buffer.from(secret))).toBe(false); // ciphertext, not plaintext
    expect(decryptSecret(blob)).toBe(secret);
  });

  it("round-trips a JSON bundle (restricted key + webhook secret)", () => {
    const bundle = JSON.stringify({
      restrictedKey: "rk_x",
      webhookSecret: "whsec_y",
    });
    expect(decryptSecret(encryptSecret(bundle))).toBe(bundle);
  });

  it("rejects a tampered ciphertext byte (GCM auth failure)", () => {
    const blob = encryptSecret("sensitive");
    // Flip a byte inside the ciphertext region (past iv[12]+tag[16]) — a non-trailing
    // mutation of the actual encrypted bytes; GCM must reject it.
    const tampered = Buffer.from(blob);
    const idx = blob.length - 2;
    tampered[idx] = (tampered[idx]! ^ 0xff) & 0xff;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects decryption under a different key", async () => {
    const blob = encryptSecret("sensitive");
    process.env.CONNECTOR_VAULT_KEY = randomBytes(32).toString("base64");
    // Re-import to pick up the new key (module reads env at call time, so same module works).
    expect(() => decryptSecret(blob)).toThrow();
    process.env.CONNECTOR_VAULT_KEY = VAULT_KEY; // restore for other tests
  });

  it("fails loudly on a malformed key length", () => {
    process.env.CONNECTOR_VAULT_KEY = Buffer.alloc(16).toString("base64"); // 16 bytes ≠ 32
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    process.env.CONNECTOR_VAULT_KEY = VAULT_KEY;
  });
});
