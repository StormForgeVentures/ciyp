import { defineConfig, devices } from '@playwright/test';
import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Single repo-root .env carries SEED_ADMIN_PASSWORD + VITE_/API vars.
dotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @ciyp/api dev',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @ciyp/web dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
