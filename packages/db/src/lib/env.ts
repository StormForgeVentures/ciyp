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

/** Local Supabase DB URL (555xx ports). */
export function databaseUrl(): string {
  return optionalEnv(
    'DATABASE_URL',
    'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
  );
}
