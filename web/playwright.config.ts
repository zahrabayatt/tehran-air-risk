import { defineConfig, devices } from '@playwright/test';

// Tests run against the built site served by `vite preview`, with the production base path.
const PORT = 4174;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/tehran-air-risk/`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/tehran-air-risk/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
