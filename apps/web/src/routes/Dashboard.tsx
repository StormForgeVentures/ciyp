/**
 * Dashboard v1 — a placeholder shell that renders seed-backed tenant identity + a few live counts
 * (PRD-006a FR-7). Proves live-DB binding on the real seed; no analytics (P1). Empty/loading/error
 * states included; a brand-new tenant with zero config renders zeros, not a crash.
 */
import { StatusBadge, EmptyState, ErrorState, LoadingState, PageHeader, StatCard } from '../components/ui.js';
import { useDashboard, useMe } from '../lib/queries.js';

export function Dashboard() {
  const me = useMe();
  // A pure superadmin with no tenant selected has no dashboard scope — guide them to Tenants
  // instead of firing a request that 400s.
  const hasScope = !!(me.data?.acting || me.data?.admin);
  const q = useDashboard(hasScope);

  if (me.data && !hasScope)
    return (
      <div className="stack">
        <PageHeader title="Dashboard" subtitle="No instance selected" />
        <div className="card">
          <EmptyState
            title="Pick a tenant"
            message="You're signed in as a platform operator. Open Tenants and switch into an instance to see its dashboard."
          />
        </div>
      </div>
    );

  if (me.isLoading || q.isLoading) return <LoadingState label="Loading dashboard…" />;
  if (q.isError || !q.data)
    return <ErrorState message={(q.error as Error)?.message ?? 'Failed to load'} onRetry={() => q.refetch()} />;

  const { tenant, counts, walletBalanceCredits } = q.data;

  return (
    <div className="stack">
      <PageHeader
        title={tenant.displayName}
        subtitle={`Instance overview · ${tenant.slug}`}
        actions={<StatusBadge status={tenant.status} />}
      />
      <div className="stat-row">
        <StatCard label="Members" value={counts.members} />
        <StatCard label="Library items" value={counts.libraryItems} />
        <StatCard label="Team" value={counts.team} />
        <StatCard label="Wallet (credits)" value={walletBalanceCredits.toLocaleString()} />
      </div>
      {counts.members === 0 && counts.libraryItems === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing here yet"
            message="This instance has no members or library content. Content appears as the coach onboards members and uploads resources."
          />
        </div>
      ) : null}
    </div>
  );
}
