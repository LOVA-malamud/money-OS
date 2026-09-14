import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5183',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'mobile-chromium', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
    { name: 'mobile-webkit', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 1024 } } },
  ],
  webServer: [
    { command: 'node --import tsx tests/local-server.ts', url: 'http://127.0.0.1:54321/health', reuseExistingServer: false, timeout: 90_000 },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5183 --strictPort',
      url: 'http://127.0.0.1:5183', reuseExistingServer: false, timeout: 60_000,
      env: { VITE_LOCAL_TEST: 'true', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'local-fixture-only' },
    },
  ],
});
