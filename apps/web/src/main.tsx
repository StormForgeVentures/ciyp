/**
 * @ciyp/web — coach/admin console (PRD-006a). Coach/admin only (decision #11: member web is the
 * template PWA). Boot order: ThemeProvider (injects ui-tokens vars) → Query → Auth → gate. No
 * session → the sign-in screen (AC-6 UI). With a session → the TanStack Router console.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './auth/session.js';
import { ThemeProvider } from './lib/theme.js';
import { SignIn } from './routes/SignIn.js';
import { LoadingState } from './components/ui.js';
import { setActingTenant } from './lib/api.js';
import { router } from './router.js';
import './styles/global.css';

// Restore a superadmin's acting-tenant scope across reloads before the first request fires.
const savedActing = localStorage.getItem('ciyp.actingTenant');
if (savedActing) setActingTenant(savedActing);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Root() {
  const { session, loading } = useAuth();
  if (loading)
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <LoadingState label="Starting…" />
      </div>
    );
  if (!session) return <SignIn />;
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
