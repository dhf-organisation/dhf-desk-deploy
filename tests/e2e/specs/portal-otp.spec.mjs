// Requests a real OTP through the app against the LOCAL Supabase stack, then
// confirms it actually arrived — not just that the UI optimistically moved
// on — by reading it back from Mailpit, the local stack's mail catcher
// (see db-local-up.mjs's own comment: nothing here can reach a real inbox,
// db-check-messaging-safe.mjs enforces that before this suite ever runs).
// A fresh, unique email per run avoids collisions with a previous run's mail.
import { test, expect } from '@playwright/test';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

test('requesting a portal code sends a real email via the local mail catcher', async ({ page, request }) => {
  const email = `e2e-${Date.now()}@example.invalid`;

  await page.goto('/portal.html');
  await page.locator('#pf-email').fill(email);
  await page.locator('#pf-send-btn').click();

  // The app's own success path: it moves straight to the code-entry screen.
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.locator('#pf-code')).toBeVisible();

  // Confirm the email actually landed, polling briefly — Mailpit ingests
  // near-instantly but this isn't guaranteed to be synchronous with the API
  // response above.
  await expect(async () => {
    const res = await request.get(`${MAILPIT_URL}/api/v1/messages`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const match = (body.messages || []).find((m) => (m.To || []).some((t) => t.Address === email));
    expect(match, `no message to ${email} in Mailpit yet`).toBeTruthy();
  }).toPass({ timeout: 10_000 });
});
