/**
 * Console UI primitives — the first product-wrapper layer for apps/web. Every visual value is a
 * ui-tokens CSS variable (via the classes in styles/global.css); feature screens compose these
 * and never author raw colors/spacing. Carries the full state matrix the design contract asks
 * for: buttons (hover/active/disabled), inputs (focus/error/disabled), badges, and the
 * empty/loading/error state surfaces every screen needs.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button({
  variant = 'primary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return <button className={`btn btn-${variant} ${className ?? ''}`} {...rest} />;
}

export function Field({
  label,
  error,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input className={`input ${error ? 'is-error' : ''}`} aria-invalid={!!error} {...rest} />
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

type BadgeTone = 'positive' | 'warning' | 'danger' | 'info' | 'accent';
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" aria-hidden />
      {children}
    </span>
  );
}

/** active → positive badge, paused → danger badge. Reused across tenants + dashboard. */
export function StatusBadge({ status }: { status: 'active' | 'paused' }) {
  return status === 'active' ? (
    <Badge tone="positive">Active</Badge>
  ) : (
    <Badge tone="danger">Suspended</Badge>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden />
      <div>{label}</div>
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="state-icon" aria-hidden />
      <div className="state-title">{title}</div>
      {message ? <div>{message}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <div className="state-icon" aria-hidden />
      <div className="state-title">Something went wrong</div>
      <div>{message}</div>
      {onRetry ? (
        <Button variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
