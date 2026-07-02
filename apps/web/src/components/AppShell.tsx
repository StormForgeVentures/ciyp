/**
 * The console frame every admin surface mounts into (PRD-006a UI/UX). Dark sidebar (nav gated by
 * the server's authorizedSections — nav absence is backed by API 403s), light content, a topbar
 * with the superadmin tenant switcher + "acting in" banner, theme toggle, and sign-out. When the
 * signed-in coach's tenant is suspended, the routed section is replaced by the suspended state.
 */
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/session.js';
import { useTheme } from '../lib/theme.js';
import { useMe, useTenants } from '../lib/queries.js';
import { setActingTenant, getActingTenant, type NavSection } from '../lib/api.js';
import { ErrorState, LoadingState } from './ui.js';
import { Suspended } from '../routes/Suspended.js';

const SECTIONS: { key: NavSection; path: string; label: string }[] = [
  { key: 'dashboard', path: '/', label: 'Dashboard' },
  { key: 'instance', path: '/instance', label: 'Instance' },
  { key: 'agent_studio', path: '/agent-studio', label: 'Agent Studio' },
  { key: 'library', path: '/library', label: 'Library' },
  { key: 'wallet', path: '/wallet', label: 'Wallet' },
  { key: 'settings', path: '/settings', label: 'Settings' },
  { key: 'tenants', path: '/tenants', label: 'Tenants' },
];

const ACTING_KEY = 'ciyp.actingTenant';

export function AppShell() {
  const me = useMe();
  const { signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const qc = useQueryClient();

  if (me.isLoading) return <FrameFallback>{<LoadingState label="Loading console…" />}</FrameFallback>;
  if (me.isError || !me.data)
    return (
      <FrameFallback>
        <ErrorState message={(me.error as Error)?.message ?? 'Failed to load session'} onRetry={() => me.refetch()} />
      </FrameFallback>
    );

  const data = me.data;
  const sections = SECTIONS.filter((s) => data.authorizedSections.includes(s.key));

  const activeTenantName =
    data.acting?.tenantDisplayName ?? data.admin?.tenantDisplayName ?? 'CIYP';
  const suspendedForCoach =
    !data.isSuperadmin && data.admin?.tenantStatus === 'paused';

  function switchTenant(id: string | null) {
    setActingTenant(id);
    if (id) localStorage.setItem(ACTING_KEY, id);
    else localStorage.removeItem(ACTING_KEY);
    qc.invalidateQueries();
    navigate({ to: '/' });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-dot" aria-hidden />
          <span>{activeTenantName}</span>
        </div>
        <nav className="nav" aria-label="Primary">
          {sections.map((s) => (
            <Link
              key={s.key}
              to={s.path}
              className="nav-item"
              activeProps={{ className: 'nav-item is-active' }}
              activeOptions={{ exact: s.path === '/' }}
            >
              <span className="nav-dot" aria-hidden />
              <span>{s.label}</span>
              {s.key === 'tenants' ? <span aria-hidden>⚿</span> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-card">
            <span className="user-name">{data.email}</span>
            <span className="user-sub">{data.isSuperadmin ? 'Superadmin' : (data.admin?.role ?? '')}</span>
          </div>
          <button type="button" className="nav-item" onClick={() => void signOut()}>
            <span className="nav-dot" aria-hidden />
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <span className="topbar-tenant">{activeTenantName}</span>
          </div>
          <div className="row">
            {data.isSuperadmin ? (
              <TenantSwitcher
                current={getActingTenant()}
                onChange={switchTenant}
              />
            ) : null}
            <button
              type="button"
              className="icon-btn"
              onClick={toggle}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            >
              {theme === 'light' ? '☾' : '☀'}
            </button>
          </div>
        </div>

        {data.acting?.actingAsSuperadmin ? (
          <div className="acting-banner" role="status">
            <span aria-hidden>⚿</span>
            Acting in <strong>{data.acting.tenantDisplayName}</strong>
            {data.acting.tenantStatus === 'paused' ? ' (suspended)' : ''} — every change is audit-logged.
            <button
              type="button"
              className="btn btn-ghost"
              style={{ minHeight: 28, marginLeft: 'auto', padding: '0 12px' }}
              onClick={() => switchTenant(null)}
            >
              Exit
            </button>
          </div>
        ) : null}

        <div className="content">{suspendedForCoach ? <Suspended /> : <Outlet />}</div>
      </main>
    </div>
  );
}

function TenantSwitcher({
  current,
  onChange,
}: {
  current: string | null;
  onChange: (id: string | null) => void;
}) {
  const tenants = useTenants(true);
  return (
    <select
      className="input"
      aria-label="Switch tenant"
      value={current ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      style={{ minWidth: 180 }}
    >
      <option value="">Platform (no tenant)</option>
      {tenants.data?.tenants.map((t) => (
        <option key={t.id} value={t.id}>
          {t.display_name}
          {t.status === 'paused' ? ' — suspended' : ''}
        </option>
      ))}
    </select>
  );
}

function FrameFallback({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-dot" aria-hidden />
          CIYP
        </div>
      </aside>
      <main className="main">
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
