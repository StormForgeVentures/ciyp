/**
 * Settings → Team (PRD-006a Settings-lite v1): owner adds a member by email + role. A delegated
 * team member who reaches this screen gets a 403 from the API, rendered as a no-access state
 * (nav absence is the first gate; the API 403 is the real one — AC-2).
 */
import { useState, type FormEvent } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
} from '../components/ui.js';
import { useAddTeamMember, useMe, useTeam } from '../lib/queries.js';
import { ApiError } from '../lib/api.js';

export function Team() {
  const me = useMe();
  const isOwnerOrSuper = me.data?.admin?.role === 'owner' || me.data?.isSuperadmin;
  const q = useTeam(!!isOwnerOrSuper);

  return (
    <div className="stack">
      <PageHeader title="Settings" subtitle="Team & access" />

      {!isOwnerOrSuper ? (
        <div className="card">
          <EmptyState
            title="Team management is owner-only"
            message="Your role can view the console but not manage the team. Ask an owner for changes."
          />
        </div>
      ) : (
        <>
          <AddMemberForm />
          <div className="card">
            {q.isLoading ? (
              <LoadingState label="Loading team…" />
            ) : q.isError ? (
              (q.error as ApiError).status === 403 ? (
                <EmptyState title="Team management is owner-only" />
              ) : (
                <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
              )
            ) : !q.data || q.data.team.length === 0 ? (
              <EmptyState title="No team members yet" message="Add a coach or teammate by email." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Email</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.team.map((m) => (
                    <tr key={m.id}>
                      <td>{m.display_name}</td>
                      <td className="muted">{m.email}</td>
                      <td>
                        <Badge tone={m.role === 'owner' ? 'accent' : 'info'}>{m.role}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AddMemberForm() {
  const add = useAddTeamMember();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await add.mutateAsync({ email: email.trim(), displayName: displayName.trim() });
      setEmail('');
      setDisplayName('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError('That email is already on the team.');
      else if (err instanceof ApiError && err.status === 403) setError('This instance is suspended.');
      else setError('Could not add the member.');
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <strong>Add a team member</strong>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <Field
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jordan Coach"
            required
          />
        </div>
        <div className="grow">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jordan@example.com"
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
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add member'}
        </Button>
      </div>
    </form>
  );
}
