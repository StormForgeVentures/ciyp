/**
 * Placeholder sections (Instance / Agent Studio / Library / Wallet). These surfaces land in later
 * waves (PRD-006b/c, 005b, 007a); the shell mounts them now so the nav + routing are complete and
 * the empty state is a real handled state, not a blank screen.
 */
import { EmptyState, PageHeader } from '../components/ui.js';

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="stack">
      <PageHeader title={title} />
      <div className="card">
        <EmptyState title="Coming soon" message={note} />
      </div>
    </div>
  );
}
