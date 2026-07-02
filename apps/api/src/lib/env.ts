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
  supabaseServiceRoleKey: (): string => require_('SUPABASE_SERVICE_ROLE_KEY'),
  /** HS256 secret Supabase Auth signs session JWTs with; apps/api verifies with it. */
  supabaseJwtSecret: (): string => require_('SUPABASE_JWT_SECRET'),
  allowedOrigin: (): string => optional_('API_ALLOWED_ORIGIN', 'http://127.0.0.1:5173'),
  port: (): number => Number(optional_('PORT', '8787')),
};

/** Validate everything the admin surface needs at boot. Throws with the first missing name. */
export function validateEnv(): void {
  env.databaseUrl();
  env.supabaseUrl();
  env.supabaseServiceRoleKey();
  env.supabaseJwtSecret();
}
