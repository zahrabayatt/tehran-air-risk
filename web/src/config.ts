// Site-wide constants. Change a value here and every page follows.
export const AUTHOR = 'Zahra Bayat';
/** Repository link. Leave empty to hide the GitHub links. */
export const GITHUB_URL = '';
/** Link to the sibling project. Leave empty to hide the "Other project" link. */
export const HOUSE_URL = '';

/** When the daily workflow runs, in UTC. A test checks it against the cron in .github/workflows/daily.yml. */
export const DAILY_RUN_UTC = '13:30';
/** Tehran is UTC+03:30 all year (no daylight saving since 2022). */
const TEHRAN_OFFSET_MIN = 210;
/** The same moment in Tehran time, derived from DAILY_RUN_UTC. */
export const DAILY_RUN_TEHRAN = (() => {
  const [h, m] = DAILY_RUN_UTC.split(':').map(Number);
  const t = (h * 60 + m + TEHRAN_OFFSET_MIN) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
})();
