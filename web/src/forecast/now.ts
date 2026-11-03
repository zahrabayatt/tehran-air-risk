/**
 * The page's clock. A test sets `window.__TAR_NOW__` (an ISO time string) before the page loads, with Playwright's
 * `addInitScript`; nothing in the address or the UI can change it. Without it, or with an unreadable value, the real
 * time is used.
 */
export function resolveNow(override: unknown, real: Date = new Date()): Date {
  if (typeof override !== 'string' || override === '') return real;
  const t = Date.parse(override);
  return Number.isNaN(t) ? real : new Date(t);
}
