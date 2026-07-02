import { defineConfig } from 'vitest/config';

// The Sport runtime suite includes live-DB tests that share a fixed two-tenant fixture
// (spr-* ids). Run test FILES serially so one file's seed/teardown never races another's
// (skill-memory: shared-DB fixtures must not overlap). Within a file, tests are ordered.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
