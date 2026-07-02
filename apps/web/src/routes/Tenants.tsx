/**
 * Tenants — superadmin-only tenant management (PRD-006a FR-4/5). List all instances, create a
 * shell tenant (writes a platform-default app_config), suspend/reactivate, and switch into a
 * tenant (which sets the "acting in" scope; every subsequent change is audit-logged server-side).
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui.js';
import { useCreateTenant, useSetTenantStatus, useTenants } from '../lib/queries.js';
import { ApiError, setActingTenant } from '../lib/api.js';

export function Tenants() {
  const q = useTenants(true);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  function switchInto(id: string) {
    setActingTenant(id);
    localStorage.setItem('ciyp.actingTenant', id);
    qc.invalidateQueries();
    navigate({ to: '/' });
  }

  return (
    <div className="stack">
      <PageHeader
        title="Tenants"
        subtitle="Every coaching instance on the platform"
        actions={
          <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Close' : 'New tenant'}</Button>
        }
      />

      {showCreate ? <CreateTenantForm onDone={() => setShowCreate(false)} /> : null}

      <div className="card">
        {q.isLoading ? (
          <LoadingState label="Loading tenants…" />
        ) : q.isError ? (
          <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        ) : !q.data || q.data.tenants.length === 0 ? (
          <EmptyState title="No tenants yet" message="Create the first coaching instance to get started." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Status</th>
                <th>Members</th>
                <th>Team</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.tenants.map((t) => (
                <TenantRowView key={t.id} tenant={t} onSwitch={() => switchInto(t.id)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TenantRowView({
  tenant,
  onSwitch,
}: {
  tenant: { id: string; slug: string; display_name: string; status: 'active' | 'paused'; member_count: number; admin_count: number };
  onSwitch: () => void;
}) {
  const setStatus = useSetTenantStatus();
  const next = tenant.status === 'active' ? 'paused' : 'active';
  return (
    <tr>
      <td>
        <div>{tenant.display_name}</div>
        <div className="muted">{tenant.slug}</div>
      </td>
      <td>
        <StatusBadge status={tenant.status} />
      </td>
      <td>{tenant.member_count}</td>
      <td>{tenant.admin_count}</td>
      <td>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onSwitch}>
            Switch in
          </Button>
          <Button
            variant={next === 'paused' ? 'danger' : 'ghost'}
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: tenant.id, status: next })}
          >
            {next === 'paused' ? 'Suspend' : 'Reactivate'}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function CreateTenantForm({ onDone }: { onDone: () => void }) {
  const create = useCreateTenant();
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ slug: slug.trim(), displayName: displayName.trim() });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError('That slug is already taken.');
      else if (err instanceof ApiError && err.status === 400)
        setError('Slug must be lowercase letters, numbers and hyphens.');
      else setError('Could not create the tenant.');
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <div className="row">
        <Badge tone="accent">New</Badge>
        <strong>Create a coaching instance</strong>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <Field
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Acme Coaching"
            required
          />
        </div>
        <div className="grow">
          <Field
            label="Slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="acme-coaching"
            required
          />
        </div>
      </div>
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="row">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create tenant'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
