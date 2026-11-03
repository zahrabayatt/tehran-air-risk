/**
 * The page's clock. Tests set it with `?now=<ISO time>` in the address (after the #); everyone else gets the
 * real time. An unreadable value is ignored.
 */
export function resolveNow(search: string, real: Date = new Date()): Date {
  const raw = new URLSearchParams(search).get('now');
  if (!raw) return real;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? real : new Date(t);
}
