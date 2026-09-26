// Read-only: just checks the login screens render, nothing is submitted.
// Covers index.html (staff desktop) and staff.html (mechanics mobile) —
// portal.html has its own OTP-specific test.
import { test, expect } from '@playwright/test';

test('index.html shows the staff Google sign-in screen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');

  await expect(page.locator('#login-page')).toBeVisible();
  await expect(page.locator('.g_id_signin')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  expect(errors).toEqual([]);
});

test('staff.html shows its own Google sign-in screen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/staff.html');

  await expect(page.locator('.g_id_signin')).toBeVisible();
  expect(errors).toEqual([]);
});
