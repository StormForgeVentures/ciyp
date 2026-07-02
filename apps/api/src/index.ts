/**
 * @ciyp/api — engine entrypoint. Boots the health route plus the wave-2 surfaces:
 * the admin console API (PRD-006a) and the program-access store (PRD-008a). The Sport
 * runtime (PRD-002) is wired internally (lib/sport) and invoked by those surfaces.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { TOOL_NAMES } from '@ciyp/agents';
import { PROMPT_BASELINES } from '@ciyp/prompts';
import { MessagePart } from '@stormforgeventures/ciyp-shared';
import { adminRoute } from './routes/admin.js';
import { createStoreRoutes, defaultStoreDeps } from './store/index.js';
import { env, validateEnv } from './lib/env.js';

const app = new Hono();

// PRD-006a: the coach/admin console (apps/web) is a browser SPA on a different origin — allow it
// to send the session bearer + the acting-tenant header. Scoped to the configured origin only.
app.use(
  '/admin/*',
  cors({
    origin: env.allowedOrigin(),
    allowHeaders: ['Authorization', 'Content-Type', 'X-Acting-Tenant'],
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  }),
);

// Admin API surface (own module tree — see routes/admin.ts).
app.route('/admin', adminRoute);

// PRD-008a program-access store: checkout-session, entitlement, Stripe webhook (own module tree).
app.route('/', createStoreRoutes(defaultStoreDeps()));

app.get('/health', (c) =>
  c.json({
    ok: true,
    scaffold: {
      // Proves the ported pure brain + prompt corpus import + load at the engine edge.
      agentsToolCount: TOOL_NAMES.length,
      promptBaselineCount: PROMPT_BASELINES.length,
      // Proves the frozen parts union is importable + parseable at the engine edge.
      partsUnionLoaded: MessagePart.safeParse({ type: 'text', text: 'ok' }).success,
    },
  }),
);

const port = env.port();

if (process.env.NODE_ENV !== 'test') {
  validateEnv(); // fail loud at boot if a required var is missing (production-mode rule)
  serve({ fetch: app.fetch, port });
  // eslint-disable-next-line no-console
  console.log(`ciyp api listening on :${port}`);
}

export { app };
