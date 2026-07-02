/**
 * Store/connector env accessors. Fail loud with an explicit message (production-mode
 * rule: every env var validated with a clear failure). Secrets are referenced by NAME
 * only — never written to source or logs.
 */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required env var ${name}. Program-access store / interim coach-Stripe ` +
        `connector cannot operate without it (see handoff: interim vault + session config).`,
    );
  }
  return v;
}

/** Local dev falls back to the Supabase stack (553xx); prod/CI must set DATABASE_URL. */
export function databaseUrl(): string {
  const v = process.env.DATABASE_URL;
  if (v && v.trim() !== "") return v;
  if (process.env.CI) return requireEnv("DATABASE_URL");
  return "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
}
