import { defineConfig } from 'vitest/config';

// Unit tests live under src/; the Playwright E2E under e2e/ is run by `pnpm e2e`, never vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
