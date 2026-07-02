import { describe, expect, it } from 'vitest';
import { app } from '../src/index.js';

describe('api scaffold', () => {
  it('GET /health returns ok with the scaffold wiring proven', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      scaffold: { partsUnionLoaded: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.scaffold.partsUnionLoaded).toBe(true);
  });
});
