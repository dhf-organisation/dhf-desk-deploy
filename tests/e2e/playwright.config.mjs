// SAFETY: these tests run against a LOCAL Supabase stack only (see
// scripts/db-local-up.mjs / db-seed-synthetic.mjs), never against staging or
// production — there is no env var or flag to point BASE_URL at a shared
// backend by accident; CI always builds the app against the local stack
// before starting the server these tests hit. Keep it that way: adding a
// "just this once" override here is exactly how a test ends up sending a
// real portal OTP email to a real customer.
//
// Scope (2026-09-26): only the unauthenticated flows are covered so far
// (login pages render, portal OTP request lands in the local mail catcher,
// crm.html's auth gate redirects). Staff-login-gated flows (Diary, Jobs,
// Invoices, POS — the actual "critical flows") are blocked on the
// env-flagged test-login card (Trello: "[DevOps P2] Auth per environment") —
// see tests/e2e/README.md.
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
