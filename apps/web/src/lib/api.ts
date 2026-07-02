/**
 * Typed client for the apps/api admin surface. Attaches the verified session bearer and, when a
 * superadmin has switched, the X-Acting-Tenant header (honored server-side ONLY for operators).
 * Throws ApiError with the status so callers can branch on 401/403/404.
 */
import { supabase } from './supabase.js';

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let actingTenantId: string | null = null;
export function setActingTenant(id: string | null): void {
  actingTenantId = id;
}
export function getActingTenant(): string | null {
  return actingTenantId;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (actingTenantId) headers['X-Acting-Tenant'] = actingTenantId;
  return headers;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() });
  return handle<T>(res);
}

export async function apiSend<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      /* non-json error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// ── Response shapes (mirror the apps/api routes) ───────────────────────────────
export type NavSection =
  | 'dashboard'
  | 'instance'
  | 'agent_studio'
  | 'library'
  | 'wallet'
  | 'settings'
  | 'tenants';

export interface Me {
  email: string;
  isSuperadmin: boolean;
  admin: {
    role: 'owner' | 'team';
    displayName: string;
    tenantId: string;
    tenantDisplayName: string;
    tenantStatus: 'active' | 'paused';
  } | null;
  acting: {
    tenantId: string;
    actingAsSuperadmin: boolean;
    tenantDisplayName: string;
    tenantStatus: 'active' | 'paused';
  } | null;
  authorizedSections: NavSection[];
}

export interface TenantRow {
  id: string;
  slug: string;
  display_name: string;
  status: 'active' | 'paused';
  created_at: string;
  member_count: number;
  admin_count: number;
}

export interface TeamRow {
  id: string;
  email: string;
  display_name: string;
  role: 'owner' | 'team';
  created_at: string;
}

export interface Dashboard {
  tenant: {
    id: string;
    slug: string;
    displayName: string;
    status: 'active' | 'paused';
    branding: Record<string, unknown>;
  };
  counts: { members: number; libraryItems: number; team: number };
  walletBalanceCredits: number;
}
