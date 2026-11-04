import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import history from '../../public/data/history.json';
import profile from '../../public/data/profile.json';
import { pooledRate } from '../forecast/summary';
import { DEPLOYED_FEATURES, DataPage, percent } from './DataPage';

const count = (n: number) => n.toLocaleString('en-US');
const rows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);

describe('percent', () => {
  it('shows one decimal and never a bare zero for a small positive rate', () => {
    expect(percent(0.0506)).toBe('5.1%');
    expect(percent(0.4607)).toBe('46.1%');
    expect(percent(0)).toBe('0%');
    expect(percent(0.0019)).toBe('0.2%');
    expect(percent(0.00004)).toBe('<0.1%');
  });

  it('recovers the day count first, so a stored four-decimal rate does not round twice', () => {
    // 7 of 1,552 days is 0.451%, stored as 0.0045: rounding the stored value again would show 0.4%.
    expect(percent(0.0045, 1552)).toBe('0.5%');
    // 85 of 2,208 days is 3.85% only after rounding; the true share is 3.8%.
    expect(percent(0.0385, 2208)).toBe('3.8%');
    expect(percent(0.0715, 11436)).toBe('7.2%');
    expect(percent(0, 1552)).toBe('0%');
  });
});

describe('DataPage', () => {
  it('says the values are modelled, and names the sources, licences, period and resolution', () => {
    render(<DataPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Modeled air, not measured air' })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open-Meteo Air Quality API' });
    expect(link.getAttribute('href')).toBe('https://open-meteo.com/en/docs/air-quality-api');
    expect(screen.getAllByText(/CC-BY 4\.0/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ODbL/).length).toBeGreaterThan(0);
    expect(screen.getByText('August 4, 2022 to November 2, 2026')).toBeTruthy();
    expect(screen.getByText('About 44 by 36 km, a 12-cell map grid')).toBeTruthy();
    expect(screen.queryByText(/45 km/)).toBeNull();
  });

  it('shows the real data-quality numbers, including zero missing hours', () => {
    render(<DataPage />);
    const dl = screen.getByRole('region', { name: 'Data quality' });
    const text = dl.textContent ?? '';
    expect(text).toContain(count(profile.usable_cell_days));
    expect(text).toContain(count(profile.missing_hours.hours_checked));
    expect(profile.missing_hours.count).toBe(0);
    const missing = within(dl).getByText('Missing hours').nextElementSibling;
    expect(missing?.textContent).toBe('0');
    const excluded = within(dl).getByText(/Days excluded/).nextElementSibling;
    // 12 cells x every day from the first to the last labelled date, less the cell-days that were labelled.
    const days = (Date.parse(profile.labelled_range.end) - Date.parse(profile.labelled_range.start)) / 86_400_000 + 1;
    expect(days).toBe(1552);
    expect(excluded?.textContent).toBe(String(profile.cell_count * days - profile.usable_cell_days));
    expect(excluded?.textContent).toBe('0');
    expect(text).not.toContain('75');
  });

  it('lists the funnel from labelled cell-days to the dataset with the DST-era rows dropped', () => {
    render(<DataPage />);
    const list = screen.getByRole('list', { name: 'From labelled days to model rows' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain(count(profile.usable_cell_days));
    expect(items[1].textContent).toContain(count(profile.rows.labelled_windows));
    expect(items[2].textContent).toContain('576');
    expect(items[2].textContent).toContain(count(profile.rows.dataset));
    expect(items[3].textContent).toContain(`Removed ${count(profile.rows.incomplete_inputs_dropped)}`);
    expect(profile.rows.dst_dropped).toBe(576);
    expect(profile.rows.labelled_windows - profile.rows.dst_dropped - profile.rows.incomplete_inputs_dropped).toBe(profile.rows.dataset);
  });

  it('shows the three splits with their sizes and date ranges, in time order', () => {
    render(<DataPage />);
    const table = screen.getByRole('table', { name: 'How days are split' });
    const body = rows(table);
    expect(body).toHaveLength(3);
    const parts = [profile.splits.train, profile.splits.selection, profile.splits.held_out];
    parts.forEach((s, i) => {
      expect(body[i].textContent).toContain(count(s.rows));
      expect(body[i].textContent).toContain(s.start);
      expect(body[i].textContent).toContain(s.end);
    });
    expect(parts[0].end < parts[1].start).toBe(true);
    expect(parts[1].end < parts[2].start).toBe(true);
    expect(parts[0].rows + parts[1].rows + parts[2].rows).toBe(profile.rows.dataset);
  });

  it('warns that the selection months are one warm half-year with 85 positive days', () => {
    render(<DataPage />);
    expect(Math.round(profile.splits.selection.rows * profile.splits.selection.positive_rate)).toBe(85);
    expect(screen.getAllByText(/85 positive days/).length).toBeGreaterThan(0);
  });

  it('shows yearly rates for all labelled days, labelled as such, and the pooled rate from the data', () => {
    render(<DataPage />);
    const table = screen.getByRole('table', { name: 'Positive days by year' });
    const body = rows(table);
    expect(body).toHaveLength(profile.yearly.length);
    expect(body[0].textContent).toContain('2022');
    expect(body[0].textContent).toContain(percent(profile.yearly[0].rate, profile.yearly[0].days));
    expect(body[3].textContent).toContain('9.3%');
    expect(body[3].textContent).toContain('60.5%');
    expect(pooledRate(history as never)).toBeCloseTo(0.07, 3);
    expect(screen.getAllByText(/7\.0%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/all labelled days/i).length).toBeGreaterThan(0);
  });

  it('shows pooled rates for the 12 calendar months', () => {
    render(<DataPage />);
    const body = rows(screen.getByRole('table', { name: 'Positive days by calendar month' }));
    expect(body).toHaveLength(12);
    expect(body[0].textContent).toContain('January');
    expect(body[0].textContent).toContain(percent(history.by_month.pooled[0].rate, history.by_month.pooled[0].days));
  });

  it('shows one row per cell with days, rate and mean PM2.5, strongest first', () => {
    render(<DataPage />);
    const body = rows(screen.getByRole('table', { name: 'Each map square' }));
    expect(body).toHaveLength(profile.cell_count);
    expect(body[0].textContent).toContain('West Tehran');
    expect(body[0].textContent).toContain('46.1%');
    expect(body[0].textContent).toContain('38.49');
    expect(body[body.length - 1].textContent).toContain('Far East');
    expect(body[body.length - 1].textContent).toContain('0.2%');
    const southeast = body.find((r) => r.textContent?.includes('Far Southeast'))!;
    expect(southeast.textContent).toContain('0.5%');
    expect(body[0].textContent).toContain(count(profile.cells[0].labelled_days));
  });

  it('lists the inputs, and the deployed features are the ones in model/model.json', () => {
    const model = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', '..', 'model', 'model.json'), 'utf8'));
    expect(DEPLOYED_FEATURES).toEqual(model.features);
    render(<DataPage />);
    const table = screen.getByRole('table', { name: 'Fields used' });
    expect(rows(table).length).toBeGreaterThanOrEqual(4);
    expect(within(table).getByText(/never an input/)).toBeTruthy();
  });

  it('states the threshold without an official category, and cites the EPA breakpoint', () => {
    const { container } = render(<DataPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('above 35.4 μg/m³');
    expect(text).toContain('89 FR 16202');
    expect(text).toContain('Appendix G to 40 CFR Part 58');
    expect(text).not.toMatch(/moderate|unhealthy|sensitive groups/i);
  });

  it('states the limitations in plain words', () => {
    render(<DataPage />);
    const limits = screen.getByRole('list', { name: 'Limitations' });
    const text = limits.textContent ?? '';
    expect(text).toMatch(/modeled/i);
    expect(text).toMatch(/not station measurements/i);
    expect(text).toMatch(/may differ/i);
    expect(text).toMatch(/identical/i);
    expect(text).toMatch(/not an official alert or medical advice/i);
    expect(text).toMatch(/warm months|warm half-year/i);
  });

  it('shows no placeholders, empty numbers, or excluded metric names', () => {
    const { container } = render(<DataPage />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\[[a-z ]+\]/i);
    expect(text).not.toMatch(/NaN|undefined|null/);
    expect(text).not.toMatch(/\b(MSE|RMSE|MAE|Accuracy|Recall|F1|ROC)\b/);
  });
});
