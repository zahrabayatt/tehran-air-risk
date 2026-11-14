import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import data from '../../public/data/data-page.json';
import { DataPage, isShaded, tenth } from './DataPage';
import { cautiousRuns } from '../lab/cautious';

const count = (n: number) => n.toLocaleString('en-US');

describe('the reliability helpers', () => {
  it('rounds a share to a number of dots out of ten', () => {
    expect(tenth(0)).toBe(0);
    expect(tenth(0.26)).toBe(3);
    expect(tenth(0.96)).toBe(10);
  });

  it('shades a row only when unhealthy air came clearly more often than the top of the range', () => {
    expect(isShaded({ from: 0.2, to: 0.3, yes: 40, no: 67 })).toBe(true); // 37% against 30%
    expect(isShaded({ from: 0.3, to: 0.4, yes: 24, no: 40 })).toBe(false); // 38%, inside the range
    expect(isShaded({ from: 0.0, to: 0.1, yes: 47, no: 3610 })).toBe(false);
    expect(isShaded({ from: 0.9, to: 1.0, yes: 93, no: 4 })).toBe(false);
  });

  it('works out the cautious runs of consecutive shaded rows, as Lab step 16 does', () => {
    const bands = data.calib.map((c) => ({ lo: c.from, hi: c.to, s: c.yes / (c.yes + c.no), n: c.yes + c.no }));
    expect(cautiousRuns(bands)).toEqual([
      { from: 2, to: 3 },
      { from: 4, to: 9 },
    ]);
  });
});

describe('DataPage', () => {
  it('leads with the source line and shows four facts from the data', () => {
    render(<DataPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Where the forecast comes from' })).toBeTruthy();
    expect(document.body.textContent).toContain('None of it is a reading from one of Tehran');
    const facts = within(screen.getByRole('list', { name: 'Four facts' })).getAllByRole('listitem');
    expect(facts).toHaveLength(4);
    expect(facts[0].textContent).toContain('CAMS');
    expect(facts[0].textContent).toContain('modelled air, not station readings');
    expect(facts[1].textContent).toContain('Aug 2022 to Nov 2026');
    expect(facts[2].textContent).toContain('12 squares');
    expect(facts[2].textContent).toContain('Tehran falls in four');
    expect(facts[3].textContent).toContain('18,624');
    expect(facts[3].textContent).toContain('1,552 in each square');
    expect(data.facts.square_days).toBe(18624);
  });

  it('draws the reliability check as ten dots per row, shading the rows where unhealthy air came clearly more often', () => {
    render(<DataPage />);
    expect(screen.getByRole('heading', { name: 'Can you trust "about 3 in 10"?' })).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: 'What the model said, and how often unhealthy air came' })).getAllByRole('listitem');
    expect(rows).toHaveLength(data.calib.length);
    rows.forEach((row, i) => {
      const c = data.calib[i];
      expect(row.querySelectorAll('.dots')).toHaveLength(2);
      row.querySelectorAll('.dots').forEach((d) => expect(d.querySelectorAll('i')).toHaveLength(10));
      expect(row.textContent).toContain(`${c.yes} of ${c.yes + c.no}`);
      expect(row.classList.contains('off')).toBe(isShaded(c));
    });
    // 2 to 3 in 10 through 7 to 8 in 10 are shaded; the two ends are not.
    expect(rows[0].classList.contains('off')).toBe(false);
    expect(rows[2].textContent).toContain('2 to 3 in 10');
    expect(rows[2].classList.contains('off')).toBe(true);
    expect(rows[7].textContent).toContain('7 to 8 in 10');
    expect(rows[7].classList.contains('off')).toBe(true);
    expect(rows[9].textContent).toContain('9 in 10 or more');
    expect(rows[9].classList.contains('off')).toBe(false);
    // the "unhealthy came" dots in row 5 (4 to 5 in 10): 27 of 41 days
    expect(rows[4].querySelectorAll('.dots')[1].querySelectorAll('i.on')).toHaveLength(tenth(27 / 41));
  });

  it('states the finding as runs of shaded rows, names the others, and keeps the cost comparison folded', () => {
    render(<DataPage />);
    const note = document.getElementById('calibnote')!;
    expect(note.textContent).toContain('Too cautious');
    expect(note.textContent).toContain('from 2 to 3 in 10 and from 4 to 9 in 10');
    expect(note.textContent).not.toContain('2 to 9');
    expect(note.textContent).not.toContain('close only at the two ends');
    // the bands that are not shaded are named, the 3 to 4 band among them
    expect(note.textContent).toContain('3 to 4 in 10');
    expect(note.textContent).toContain('1 to 2 in 10');
    expect(note.textContent).not.toMatch(/right on \d+ of \d+/i);
    const details = screen.getByText('Compared with simple guesses').closest('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain(data.cost.held_out.toFixed(3));
    expect(details.textContent).toContain(data.baselines.overall.toFixed(3));
    expect(details.textContent).toContain(data.baselines.monthly.toFixed(3));
  });

  it('shows the month chart for West Tehran and switches square', () => {
    render(<DataPage />);
    const pick = screen.getByRole('combobox', { name: /Square/ }) as HTMLSelectElement;
    expect(pick.value).toBe('west-tehran');
    const chart = () => screen.getByRole('img', { name: /share of unhealthy days by month/ });
    expect(chart().getAttribute('aria-label')).toBe('West Tehran: share of unhealthy days by month');
    expect(chart().querySelectorAll('.mo')).toHaveLength(12);
    expect(chart().textContent).toContain('89'); // January and December, 0.879 and 0.887
    fireEvent.change(pick, { target: { value: 'north-tehran' } });
    expect(chart().getAttribute('aria-label')).toBe('North Tehran: share of unhealthy days by month');
    expect(chart().textContent).not.toContain('89');
  });

  it('writes "under 1%" for exactly the three cleanest squares, and a real percentage elsewhere', () => {
    render(<DataPage />);
    const list = screen.getByRole('list', { name: 'Share of unhealthy days in each square' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(12);
    expect(items.filter((li) => li.textContent?.includes('under 1%'))).toHaveLength(3);
    const find = (name: string) => items.find((li) => li.textContent?.includes(name))!;
    expect(find('Far East').textContent).toContain('under 1%');
    expect(find('Far Northeast').textContent).toContain('under 1%');
    expect(find('Far Southeast').textContent).toContain('under 1%');
    expect(find('Northeast Tehran').textContent).toContain('1%');
    expect(find('West Tehran').textContent).toContain('46%');
    expect(items[0].textContent).toContain('West Tehran'); // most often first
    expect(list.textContent).not.toContain('0%');
  });

  it('shows how the days are used with the version 2 split and says the test year is a second look', () => {
    render(<DataPage />);
    const s = data.splits;
    const section = screen.getByRole('heading', { name: 'How the days are used' }).closest('section')!;
    expect(section.textContent).toContain(count(s.train.rows));
    expect(section.textContent).toContain(count(s.selection.rows));
    expect(section.textContent).toContain(count(s.held_out.rows));
    expect(s.held_out.rows).toBe(4368);
    expect(section.textContent).not.toContain('4,380');
    expect(section.textContent).toContain('second look');
    expect(section.textContent).toContain('was already used once');
  });

  it('counts the steps from hours to forecast days, ending with the weather step from the data', () => {
    render(<DataPage />);
    const steps = within(screen.getByRole('list', { name: 'From hours to forecast days' })).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0].textContent).toContain(count(data.facts.square_days));
    expect(steps[1].textContent).toContain(count(data.rows.labelled_windows));
    expect(steps[2].textContent).toContain(count(data.rows.dataset));
    expect(steps[3].textContent).toContain(count(data.rows.with_weather));
    expect(data.rows.with_weather).toBe(data.splits.train.rows + data.splits.selection.rows + data.splits.held_out.rows);
    expect(document.body.textContent).not.toContain('11,556');
  });

  it('lists what the forecast cannot see and folds the sources away', () => {
    render(<DataPage />);
    expect(screen.getByRole('heading', { name: 'What the forecast cannot see' })).toBeTruthy();
    expect(document.body.textContent).toContain('not an official alert or medical advice');
    const details = screen.getByText('Sources and licences').closest('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('CC-BY 4.0');
    expect(details.textContent).toContain('ODbL');
    expect(details.textContent).toContain('US EPA');
  });

  it('no longer has the year, data-quality or fields tables', () => {
    render(<DataPage />);
    expect(screen.queryByRole('table', { name: 'Positive days by year' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Data quality' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Fields used' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Each map square' })).toBeNull();
  });

  it('has no placeholders, em dashes, or excluded metric names', () => {
    const { container } = render(<DataPage />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\[[a-z ]+\]/i);
    expect(text).not.toMatch(/NaN|undefined|null/);
    expect(text).not.toContain('\u2014');
    expect(text).not.toMatch(/\b(MSE|RMSE|MAE|Accuracy|Precision|Recall|F1|ROC|AUC|L1|L2)\b/);
    expect(text).not.toMatch(/polluted/i);
  });
});
