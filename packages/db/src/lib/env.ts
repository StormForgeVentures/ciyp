import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load the repo-root .env regardless of the cwd `pnpm --filter` runs us from.
// packages/db/src/lib/env.ts -> repo root is four levels up.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, '../../../../.env');
if (existsSync(rootEnv)) config({ path: rootEnv });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required env var ${name}. Copy the repo-root .env (see .env.example) into the worktree.`,
    );
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

/**
 * DB URL. In CI (`CI=true`) DATABASE_URL is REQUIRED — no localhost fallback, so a
 * pruned/missing var fails loud instead of silently dialing a port that isn't there
 * (turbo strict-env stripped DATABASE_URL from the test task until it was declared in
 * turbo.json — the fallback masked that as ECONNREFUSED 55322). Locally it defaults to
 * the Supabase stack (553xx, see supabase/config.toml).
 */
export function databaseUrl(): string {
  if (process.env.CI) return requireEnv('DATABASE_URL');
  return optionalEnv(
    'DATABASE_URL',
    'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
  );
}
