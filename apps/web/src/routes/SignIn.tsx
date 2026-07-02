/**
 * Sign-in — real Supabase Auth (email/password). This is the front door of the security spine:
 * nothing in the console renders until a session exists (AC-6). Errors surface inline; the
 * submit button carries a loading state.
 */
import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/session.js';
import { Button, Field } from '../components/ui.js';
import { useTheme } from '../lib/theme.js';

export function SignIn() {
  const { signIn } = useAuth();
  const { theme, toggle } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    if (error) {
      setError('Incorrect email or password.');
      setBusy(false);
    }
    // On success the AuthProvider flips session → the app swaps to the shell.
  }

  return (
    <div className="signin">
      <form className="signin-card" onSubmit={onSubmit} aria-labelledby="signin-title">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="signin-brand" id="signin-title">
            <span className="brand-dot" aria-hidden />
            CIYP Console
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>
        </div>
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error ? (
          <div className="field-error" role="alert">
            {error}
          </div>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
