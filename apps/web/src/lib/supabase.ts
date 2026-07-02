/**
 * Supabase Auth client for the coach/admin console. Browser-side: only the anon key ships in the
 * bundle (VITE_-prefixed). Sessions persist + auto-refresh; the access token is forwarded to
 * apps/api as a Bearer, where it is verified and the tenant scope resolved server-side.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see .env.example).');
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
