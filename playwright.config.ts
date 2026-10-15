import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testIgnore: ['**/recovery/**'], timeout: 90000, workers: 1,
  use: { baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:3022', trace: 'off' },
  reporter: 'list',
  webServer: process.env.TEST_BASE_URL ? undefined : {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3022',
    url: 'http://127.0.0.1:3022', reuseExistingServer: false, timeout: 120000,
  },
});
