import type { HistoryInfo, ModelInfo, ProfileInfo } from './types';

const MONTH_LETTERS = 'JFMAMJJASOND';
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];

/** Share of cell-days above the threshold over every square and the whole history, computed from history.json. */
export function pooledRate(history: HistoryInfo): number {
  const years = history.by_year.pooled ?? [];
  const days = years.reduce((s, y) => s + y.days, 0);
  return days === 0 ? 0 : years.reduce((s, y) => s + y.days * y.rate, 0) / days;
}

export interface MonthBar {
  month: number;
  label: string;
  /** Percent of days above the threshold, 0 to 100. */
  percent: number;
}

/** Percent of days above the threshold in each calendar month, for one square. */
export function monthlySeries(history: HistoryInfo, cellId: string): MonthBar[] {
  const rows = history.by_month[cellId];
  if (!rows) return [];
  return [...rows]
    .sort((a, b) => a.month - b.month)
    .map((r) => ({ month: r.month, label: MONTH_LETTERS[r.month - 1], percent: r.rate * 100 }));
}

const monthYear = (iso: string) => {
  const [y, m] = iso.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
};

/** "August 2022 to November 2026" and the number of days each square has. */
export function spanOfHistory(profile: ProfileInfo): { range: string; daysPerSquare: number } {
  return {
    range: `${monthYear(profile.labelled_range.start)} to ${monthYear(profile.labelled_range.end)}`,
    daysPerSquare: Math.round(profile.usable_cell_days / profile.cell_count),
  };
}

const INPUT_LABELS: Array<[RegExp, string]> = [
  [/^pm2_5_/, 'PM2.5 so far today'],
  [/^pm10_/, 'PM10 so far today'],
  [/^no2_/, 'NO2 so far today'],
  [/^so2_/, 'SO2 so far today'],
  [/^co_/, 'CO so far today'],
  [/^o3_/, 'O3 so far today'],
  [/^temp_/, 'temperature'],
  [/^rh_/, 'humidity'],
  [/^wind_/, 'wind speed'],
  [/^precip_/, 'precipitation'],
  [/^season_/, 'time of year'],
];

/** Plain-language list of what the frozen model reads, from its own feature list (never typed). */
export function describeInputs(features: string[]): string {
  const out: string[] = [];
  for (const f of features) {
    const label = INPUT_LABELS.find(([re]) => re.test(f))?.[1] ?? f;
    if (!out.includes(label)) out.push(label);
  }
  return out.join(', ');
}

type ResultModel = Pick<ModelInfo, 'cost' | 'baselines' | 'beats_baselines'>;

/** The honest result in one sentence, from model.json. */
export function resultSentence(model: ResultModel): string {
  const f = (x: number) => x.toFixed(3);
  const head =
    `On days it never trained on, the model's cost was ${f(model.cost.held_out)}, against ` +
    `${f(model.baselines.overall.held_out_cost)} for always guessing the overall rate and ` +
    `${f(model.baselines.monthly.held_out_cost)} for guessing each month's usual rate. Lower is better.`;
  return model.beats_baselines
    ? `${head} It beats both.`
    : `${head} It does not beat both simple guesses, so read its forecasts with that in mind.`;
}
