/**
 * @ciyp/api — engine entrypoint. Scaffold (PRD-001a FR-2): boots with a health route only,
 * proving the workspace + shared-contract wiring. The Sport runtime, routes, and workers
 * land in PRD-002/003+.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { AGENTS_SCAFFOLD_VERSION } from '@ciyp/agents';
import { PROMPTS_SCAFFOLD_VERSION } from '@ciyp/prompts';
import { MessagePart } from '@ciyp/shared';

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    ok: true,
    scaffold: {
      agents: AGENTS_SCAFFOLD_VERSION,
      prompts: PROMPTS_SCAFFOLD_VERSION,
      // Proves the frozen parts union is importable + parseable at the engine edge.
      partsUnionLoaded: MessagePart.safeParse({ type: 'text', text: 'ok' }).success,
    },
  }),
);

const port = Number(process.env.PORT ?? 8787);

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port });
  // eslint-disable-next-line no-console
  console.log(`ciyp api scaffold listening on :${port}`);
}

export { app };
