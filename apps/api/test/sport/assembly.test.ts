/**
 * Host cache identity / eviction / invalidation / old-host-until-ready (PRD-002b AC-1..3).
 * Uses an injected version source + build fn (no live rebuild) for determinism.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHostCache, type SportHost } from '../../src/lib/sport/assembly.js';
import type { CiypScope } from '../../src/lib/sport/scope-resolver.js';

const scope = (t: string): CiypScope => ({ tenantId: t, context: 'coach' });

function fakeHost(tenantId: string, version: string): SportHost {
  return {
    tenantId,
    configVersion: version,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    slotResolver: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embedder: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reranker: {} as any,
    getModelSlot: () => async () => null,
  };
}

describe('assembly host cache', () => {
  it('AC-1: distinct tenants get distinct host instances; the same (tenant,version) is cached', async () => {
    const versions: Record<string, string> = { A: '1', B: '1' };
    const cache = createHostCache({
      readConfigVersion: async (t) => versions[t]!,
      buildHost: (t, v) => fakeHost(t, v),
    });
    const a1 = await cache.hostFor(scope('A'));
    const a2 = await cache.hostFor(scope('A'));
    const b1 = await cache.hostFor(scope('B'));
    expect(a1).toBe(a2); // identity: cached
    expect(a1).not.toBe(b1); // A's host is not B's
    expect(a1.tenantId).toBe('A');
    expect(b1.tenantId).toBe('B');
  });

  it('AC-2: invalidate(A) rebuilds A on next hostFor; B is untouched', async () => {
    const versions: Record<string, string> = { A: '1', B: '1' };
    let builds = 0;
    const cache = createHostCache({
      readConfigVersion: async (t) => versions[t]!,
      buildHost: (t, v) => {
        builds++;
        return fakeHost(t, v);
      },
    });
    const a1 = await cache.hostFor(scope('A'));
    const b1 = await cache.hostFor(scope('B'));
    expect(builds).toBe(2);

    cache.invalidate('A');
    versions.A = '2'; // config write bumped the version
    const a2 = await cache.hostFor(scope('A'));
    const b2 = await cache.hostFor(scope('B'));
    expect(a2).not.toBe(a1); // fresh host
    expect(a2.configVersion).toBe('2');
    expect(b2).toBe(b1); // B's cached host unchanged
    expect(builds).toBe(3);
  });

  it('AC-2b: a version bump WITHOUT invalidate serves the old host until the rebuild lands (old-until-ready)', async () => {
    const versions: Record<string, string> = { A: '1' };
    const cache = createHostCache({
      readConfigVersion: async (t) => versions[t]!,
      buildHost: (t, v) => fakeHost(t, v),
    });
    const a1 = await cache.hostFor(scope('A'));
    versions.A = '2'; // config write, but no invalidate() called
    const servedDuringRebuild = await cache.hostFor(scope('A'));
    expect(servedDuringRebuild).toBe(a1); // old host until the background v2 build is ready
    await new Promise((r) => setTimeout(r, 5)); // let the background build settle
    const a2 = await cache.hostFor(scope('A'));
    expect(a2.configVersion).toBe('2'); // subsequent turns get the fresh host
    expect(a2).not.toBe(a1);
  });

  it('AC-3: at the bound, the LRU evicts the least-recently-used host and emits a trace', async () => {
    const onEvict = vi.fn();
    const cache = createHostCache({
      readConfigVersion: async () => '1',
      buildHost: (t, v) => fakeHost(t, v),
      max: 2,
      onEvict,
    });
    await cache.hostFor(scope('A'));
    await cache.hostFor(scope('B'));
    await cache.hostFor(scope('A')); // touch A → B is now LRU
    await cache.hostFor(scope('C')); // over bound → evict B
    expect(cache.size()).toBe(2);
    expect(onEvict).toHaveBeenCalledWith('B', '1');
    expect(cache.keys()).toEqual(['A:1', 'C:1']);
  });

  it('old-host-until-ready: concurrent turns during a rebuild get the old host, not a block', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const versions: Record<string, string> = { A: '1' };
    let buildCount = 0;
    const cache = createHostCache({
      readConfigVersion: async () => versions.A!,
      buildHost: async (t, v) => {
        buildCount++;
        if (v === '2') await gate; // stall the v2 rebuild
        return fakeHost(t, v);
      },
    });
    const a1 = await cache.hostFor(scope('A'));
    versions.A = '2'; // config write → rebuild pending
    // Kick off the (stalled) rebuild AND a concurrent turn: the concurrent turn gets the
    // OLD host immediately rather than blocking on the in-flight v2 build.
    const pendingBuild = cache.hostFor(scope('A'));
    const concurrent = await cache.hostFor(scope('A'));
    expect(concurrent).toBe(a1); // old host served during rebuild
    release();
    await pendingBuild;
    await new Promise((r) => setTimeout(r, 10)); // let the background v2 build settle into the LRU
    const a2 = await cache.hostFor(scope('A'));
    expect(a2.configVersion).toBe('2'); // new host live once ready
    expect(buildCount).toBe(2);
  });
});
