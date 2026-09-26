// Regression guard for the auth gate at the top of crm.html (see its own
// "AUTH GATE" comment): an unauthenticated visitor must never reach the
// 229KB main CRM script, only the login page. This is also what let the
// 2026-09-25 refactor survey correctly rule out splitting crm.html's script
// (verified empirically then; this makes sure it stays true).
import { test, expect } from '@playwright/test';

test('an unauthenticated visitor to crm.html is redirected to the staff login page', async ({ page }) => {
  await page.goto('/crm.html');
  // Asserting on the resulting URL is unreliable across static servers (some
  // canonicalize /index.html to /) — what actually matters is that the
  // visitor ends up looking at the login screen, not the CRM.
  await expect(page.locator('.g_id_signin')).toBeVisible();
  await expect(page.locator('#login-page')).toBeVisible();
});
