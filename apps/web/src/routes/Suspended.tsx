/**
 * Suspended-instance state (PRD-006a AC-5/FR-6). A suspended tenant's coach still authenticates,
 * but the routed section is replaced by this full-screen state and every write API returns 403.
 */
import { Badge } from '../components/ui.js';

export function Suspended() {
  return (
    <div className="suspended">
      <div className="suspended-card">
        <Badge tone="danger">Suspended</Badge>
        <h1 className="page-title">Instance suspended</h1>
        <p className="muted">
          This coaching instance is currently suspended. Sign-in still works so you can reach
          support, but configuration and member-facing surfaces are paused. Contact the CIYP
          platform team to reactivate.
        </p>
      </div>
    </div>
  );
}
