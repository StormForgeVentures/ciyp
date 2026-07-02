/**
 * Admin-shell E2E against the LIVE stack: real Supabase Auth sign-in (GoTrue) → apps/api →
 * seeded DB → back. Proves the full vertical slice the unit tests can't: the browser sign-in
 * flow, nav gating by role, seed-backed dashboard, and the superadmin switch banner. Also
 * captures 375/768/1280 screenshots for the Figma self-diff.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '';
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('unauthenticated visitors land on sign-in (AC-6 UI)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('CIYP Console')).toBeVisible();
});

test('owner signs in and sees the seed-backed dashboard + config nav (no Tenants)', async ({ page }) => {
  await signIn(page, 'owner@luminify.example');

  // Seed-backed identity + counts (5 members in the Luminify seed).
  await expect(page.getByRole('heading', { name: 'Luminify' })).toBeVisible();
  await expect(page.getByText('Members')).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Instance' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Agent Studio' })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Tenants/ })).toHaveCount(0);

  for (const [w, h, tag] of [
    [375, 812, 'mobile'],
    [768, 1024, 'tablet'],
    [1280, 900, 'desktop'],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.screenshot({ path: `${SHOTS}dashboard-${tag}.png`, fullPage: true });
  }
});

test('delegated team member has no Instance / Agent Studio / Tenants nav (AC-2)', async ({ page }) => {
  await signIn(page, 'team@luminify.example');
  await expect(page.getByRole('heading', { name: 'Luminify' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Instance' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Agent Studio' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /Tenants/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
});

test('superadmin sees Tenants, lists instances, and switches in (acting banner)', async ({ page }) => {
  await signIn(page, 'super@luminify.example');

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: /Tenants/ })).toBeVisible();

  await nav.getByRole('link', { name: /Tenants/ }).click();
  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  const luminifyRow = page.getByRole('row', { name: /Luminify/ });
  await expect(luminifyRow).toBeVisible();

  await luminifyRow.getByRole('button', { name: 'Switch in' }).click();
  await expect(page.getByText(/Acting in/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Luminify' })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${SHOTS}tenants-switched-desktop.png`, fullPage: true });
});
