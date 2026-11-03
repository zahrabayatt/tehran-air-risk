/** Commit the site was built from, set by `define` in vite.config.ts. Falls back to "main" outside a git checkout. */
declare const __COMMIT__: string;

/** Test-only clock: set by Playwright before the page loads (see src/forecast/now.ts). Never set in production. */
interface Window {
  __TAR_NOW__?: string;
}
