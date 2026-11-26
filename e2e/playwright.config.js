// @ts-check
const { defineConfig } = require('@playwright/test');

// The suite runs only against the local throwaway setup: the Vite dev server
// and the local backend. Anything that is not localhost is refused here, and
// every request to another host is blocked inside the tests (see helpers.js).
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173/ripfit-app/';
const API_URL = process.env.E2E_API_URL || 'http://localhost:3000/api/v1';
for (const u of [BASE_URL, API_URL]) {
  const host = new URL(u).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    throw new Error(`E2E refuses to run against ${u}: local hosts only.`);
  }
}

// Chromium only. By default it uses the Google Chrome already installed on
// this machine (channel "chrome"), so no browser download is needed. Set
// E2E_BROWSER_CHANNEL=chromium to use Playwright's own Chromium instead
// (after `npx playwright install chromium`).
const channel = process.env.E2E_BROWSER_CHANNEL || 'chrome';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  // One shared test user and one active workout at a time: run in order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    channel: channel === 'chromium' ? undefined : channel,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Clicks are real taps for the page, so audio starts as on a phone.
    launchOptions: { args: ['--autoplay-policy=user-gesture-required'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true } },
  ],
});
