/**
 * @ciyp/web — coach/admin console shell (PRD-001a scaffold: boots to an empty shell page).
 * The real console (auth, nav, tenant scoping) lands in PRD-006a. Coach/admin only —
 * member web is the template's PWA (decision #11).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { tokens } from '@ciyp/ui-tokens';

const queryClient = new QueryClient();

function Shell() {
  return (
    <main
      style={{
        fontFamily: tokens.type['font.body'],
        color: tokens.color['text.primary'],
        background: tokens.color['bg.subtle'],
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div>
        <h1 style={{ fontSize: tokens.type['size.xl'] }}>CIYP Admin</h1>
        <p style={{ color: tokens.color['text.secondary'] }}>
          Shell scaffold — the console lands with PRD-006a.
        </p>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  </StrictMode>,
);
