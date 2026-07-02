/**
 * TanStack Router route tree for the authenticated console. The shell (AppShell) is the root
 * component (sidebar + topbar + Outlet); sections mount as children. Placeholder sections belong
 * to later waves but are routed now so the nav is complete.
 */
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from './components/AppShell.js';
import { Dashboard } from './routes/Dashboard.js';
import { Tenants } from './routes/Tenants.js';
import { Team } from './routes/Team.js';
import { Placeholder } from './routes/Placeholder.js';

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Dashboard });
const instanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/instance',
  component: () => <Placeholder title="Instance" note="Instance config authoring lands in PRD-006b." />,
});
const agentStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agent-studio',
  component: () => <Placeholder title="Agent Studio" note="Coach-authored agents land in PRD-006c." />,
});
const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  component: () => <Placeholder title="Library" note="Corpus management lands in PRD-005b." />,
});
const walletRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wallet',
  component: () => <Placeholder title="Wallet" note="Wallet & AI economy land in PRD-007a." />,
});
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: Team });
const tenantsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tenants', component: Tenants });

const routeTree = rootRoute.addChildren([
  indexRoute,
  instanceRoute,
  agentStudioRoute,
  libraryRoute,
  walletRoute,
  settingsRoute,
  tenantsRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
