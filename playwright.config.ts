import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.API_BASE_URL ?? 'http://127.0.0.1:4100/api/v1/',
    extraHTTPHeaders: { Accept: 'application/json' },
  },
  webServer: {
    command: 'npm run start:prod',
    url: 'http://127.0.0.1:4100/api/v1/health',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '4100',
      MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/tourvex_test',
      // Backend-API-minted Clerk test session tokens carry no azp claim (test-only opt-out).
      CLERK_AUTHORIZED_PARTIES: '*',
      PAYMENTS_MOCK: 'true',
      SUPPLIERS_MOCK: 'true',
    },
  },
});
