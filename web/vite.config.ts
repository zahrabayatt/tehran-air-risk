import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { codeSnippets } from './plugins/code-snippets.ts';

/**
 * The commit the site is built from, so a code link points at the exact lines shown, not at a branch
 * that moves on. `git rev-parse HEAD` is read first because it is the checked-out commit even in the
 * deploy workflow (where GITHUB_SHA is the tip of main, which may be newer); GITHUB_SHA is the fallback.
 */
function buildCommit(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch {
    // not a git checkout
  }
  const fromEnv = process.env.GITHUB_SHA ?? '';
  return /^[0-9a-f]{40}$/.test(fromEnv) ? fromEnv : 'main';
}

export default defineConfig({
  base: '/tehran-air-risk/',
  define: { __COMMIT__: JSON.stringify(buildCommit()) },
  plugins: [react(), codeSnippets({ sourceDirs: ['../training', '../pipeline'], stagesDir: 'src/lab/stages' })],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'plugins/**/*.test.ts'],
  },
});
