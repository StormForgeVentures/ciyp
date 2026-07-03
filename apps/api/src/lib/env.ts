/**
 * apps/api environment. Loads the repo-root .env (regardless of the cwd the process is
 * launched from — mirrors packages/db). Every consumed var is read through a validated
 * getter; validateEnv() fails LOUD at boot with an explicit message (production-mode rule:
 * no silent fallback to a wrong value).
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// apps/api/src/lib/env.ts → repo root is four levels up.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, '../../../../.env');
if (existsSync(rootEnv)) config({ path: rootEnv });

function require_(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `Missing required env var ${name}. Copy the repo-root .env (see .env.example) into the worktree.`,
    );
  }
  return v;
}

function optional_(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : fallback;
}

export const env = {
  databaseUrl: (): string =>
    process.env.CI
      ? require_('DATABASE_URL')
      : optional_('DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'),
  supabaseUrl: (): string => optional_('SUPABASE_URL', 'http://127.0.0.1:55321'),
  supabaseAnonKey: (): string => require_('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: (): string => require_('SUPABASE_SERVICE_ROLE_KEY'),
  allowedOrigin: (): string => optional_('API_ALLOWED_ORIGIN', 'http://127.0.0.1:5173'),
  port: (): number => Number(optional_('PORT', '8787')),
};

/**
 * Store connector vault DEK — the AES-256-GCM key that encrypts coach Stripe credentials
 * (base64-encoded 32 bytes). Read lazily by store/vault at request time; validated HERE at
 * boot so a missing/short/degenerate key fails loud instead of surfacing on the first webhook
 * (production-mode "fail loud at boot" — wave-2 M-1). No silent empty-secret operation.
 */
function validateConnectorVaultKey(): void {
  const raw = process.env.CONNECTOR_VAULT_KEY;
  if (!raw || raw.trim() === '') {
    throw new Error(
      'Missing required env var CONNECTOR_VAULT_KEY. The program-access store encrypts coach ' +
        'Stripe credentials with it (AES-256-GCM). Generate one with `openssl rand -base64 32`.',
    );
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32) {
    throw new Error(
      `CONNECTOR_VAULT_KEY must decode to exactly 32 bytes (AES-256); got ${bytes.length}. ` +
        'Generate with `openssl rand -base64 32`.',
    );
  }
  // Reject an obviously degenerate key (all-identical bytes, e.g. a zero-filled placeholder).
  if (bytes.every((b) => b === bytes[0])) {
    throw new Error(
      'CONNECTOR_VAULT_KEY looks degenerate (all bytes identical). Use a random key: ' +
        '`openssl rand -base64 32`.',
    );
  }
}

/**
 * Validate everything the wave-2 apps/api surfaces need at boot. Throws with the first bad var.
 *
 * The store's MEMBER auth path now rides the same Supabase Auth vars as the admin surface
 * (SUPABASE_URL for JWKS + the anon/service keys) — the interim self-minted HS256 session
 * secret was removed (wave-2 H-1), so there is no separate SESSION_JWT_SECRET to configure.
 * The one store-specific secret is the connector vault DEK, validated below (M-1).
 */
export function validateEnv(): void {
  env.databaseUrl();
  env.supabaseUrl();
  env.supabaseAnonKey();
  env.supabaseServiceRoleKey();
  validateConnectorVaultKey();
}
