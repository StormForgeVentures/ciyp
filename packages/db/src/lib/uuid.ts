import { createHash } from 'node:crypto';

// Deterministic UUIDv5 (RFC 4122, SHA-1 namespaced) — no external dep. Used to
// give every seeded row a STABLE id so re-running the seed is idempotent
// (INSERT ... ON CONFLICT (id) DO NOTHING leaves row counts unchanged).

// A fixed namespace for the CIYP seed (a random-but-constant v4 UUID).
export const CIYP_SEED_NAMESPACE = 'b7c5f0e2-3a41-4d8e-9f6b-2c1d0a9e8f70';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/-/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Stable UUIDv5 for a name within the CIYP seed namespace. */
export function seedUuid(name: string, namespace: string = CIYP_SEED_NAMESPACE): string {
  const ns = hexToBytes(namespace);
  const hash = createHash('sha1');
  hash.update(Buffer.from(ns));
  hash.update(Buffer.from(name, 'utf8'));
  const digest = hash.digest();
  const bytes = new Uint8Array(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}
