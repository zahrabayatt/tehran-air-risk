import { describe, expect, it } from 'vitest';
import history from '../../public/data/history.json';
import profile from '../../public/data/profile.json';
import { describeInputs, monthlySeries, pooledRate, resultSentence, spanOfHistory } from './summary';

describe('pooledRate', () => {
  it('is computed from the data: 7.0% over all 12 squares', () => {
    expect(pooledRate(history as never)).toBeCloseTo(0.07, 3);
  });
});

describe('monthlySeries', () => {
  it('has 12 months of percentages for one cell', () => {
    const s = monthlySeries(history as never, 'west-tehran');
    expect(s).toHaveLength(12);
    expect(s.map((m) => m.label).join('')).toBe('JFMAMJJASOND');
    expect(Math.max(...s.map((m) => m.percent))).toBeGreaterThan(50);
  });
  it('is empty for an unknown cell', () => {
    expect(monthlySeries(history as never, 'nowhere')).toEqual([]);
  });
});

describe('spanOfHistory', () => {
  it('names the months and the number of days per square', () => {
    const s = spanOfHistory(profile as never);
    expect(s.range).toBe('August 2022 to November 2026');
    expect(s.daysPerSquare).toBe(1552);
  });
});

describe('describeInputs', () => {
  it('describes the features the frozen model really uses', () => {
    expect(describeInputs(['pm2_5_mean', 'pm2_5_max', 'pm2_5_last', 'season_sin', 'season_cos'])).toBe('PM2.5 so far today, time of year');
  });
  it('lists weather and other pollutants when a model uses them', () => {
    expect(describeInputs(['pm2_5_mean', 'no2_mean', 'temp_mean', 'wind_mean', 'season_sin'])).toBe(
      'PM2.5 so far today, NO2 so far today, temperature, wind speed, time of year',
    );
  });
  it('shows an unknown feature by its code name rather than dropping it', () => {
    expect(describeInputs(['mystery'])).toBe('mystery');
  });
});

describe('resultSentence', () => {
  const model = {
    cost: { held_out: 0.15 },
    baselines: { overall: { held_out_cost: 0.31 }, monthly: { held_out_cost: 0.295 } },
    beats_baselines: true,
  };
  it('reports a win in lower cost', () => {
    const s = resultSentence(model);
    expect(s).toContain('0.15');
    expect(s).toContain('0.31');
    expect(s).toMatch(/lower is better/i);
    expect(s).toMatch(/beats both/i);
  });
  it('says plainly when the model does not win', () => {
    const s = resultSentence({ ...model, cost: { held_out: 0.4 }, beats_baselines: false });
    expect(s).toMatch(/does not beat/i);
  });
  it('never uses excluded metrics', () => {
    expect(resultSentence(model)).not.toMatch(/accuracy|precision|recall|f1|auc|confusion/i);
  });
});
