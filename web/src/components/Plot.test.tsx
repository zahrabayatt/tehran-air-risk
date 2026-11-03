import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Plot, emptyPlot, type PlotSpec } from './Plot';

const fixture: PlotSpec = {
  ...emptyPlot(),
  points: [
    { cx: 100, cy: 200, r: 3, fill: 'var(--ac)', stroke: 'none', op: 0.8 },
    { cx: 150, cy: 120, r: 3, fill: 'var(--ac)', stroke: 'none', op: 0.8 },
  ],
  lines: [{ d: 'M100 200 L150 120', stroke: 'var(--ink)', width: 2, dash: '' }],
  bars: [{ x: 300, y: 150, w: 20, h: 100, fill: 'var(--ac)', stroke: 'none', op: 0.9 }],
  texts: [{ x: 200, y: 40, anchor: 'middle', size: 14, t: 'Fixture title' }],
  xTicks: [{ x: 100, y1: 40, y2: 320, ty: 336, label: '0' }],
  yTicks: [{ x1: 60, x2: 680, y: 300, tx: 54, ty: 304, label: '10' }],
  legend: ['Training points'],
  xLabel: 'Area (m²)',
  yLabel: 'Price',
};

describe('Plot', () => {
  it('renders an accessible SVG with the given label', () => {
    render(<Plot spec={fixture} label="Fixture plot" />);
    const svg = screen.getByRole('img', { name: 'Fixture plot' });
    expect(svg.getAttribute('viewBox')).toBe('0 0 720 400');
  });

  it('draws one element per spec item', () => {
    const { container } = render(<Plot spec={fixture} label="Fixture plot" />);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelectorAll('path')).toHaveLength(1);
    expect(container.querySelectorAll('rect')).toHaveLength(1);
    expect(screen.getByText('Fixture title')).toBeTruthy();
    expect(screen.getByText('Area (m²)')).toBeTruthy();
    expect(screen.getByText('Price')).toBeTruthy();
    expect(screen.getByText('Training points')).toBeTruthy();
  });

  it('never passes NaN or Infinity to the SVG', () => {
    const bad: PlotSpec = {
      ...fixture,
      points: [...fixture.points, { cx: NaN, cy: 10, r: 3, fill: 'red', stroke: 'none', op: 1 }],
      lines: [...fixture.lines, { d: 'M0 0 L NaN Infinity', stroke: 'red', width: 1, dash: '' }],
      bars: [...fixture.bars, { x: 0, y: 0, w: Infinity, h: 4, fill: 'red', stroke: 'none', op: 1 }],
    };
    const { container } = render(<Plot spec={bad} label="Bad plot" />);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelectorAll('path')).toHaveLength(1);
    expect(container.querySelectorAll('rect')).toHaveLength(1);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('renders an empty spec without a legend', () => {
    const { container } = render(<Plot spec={emptyPlot()} label="Empty" />);
    expect(container.querySelector('figcaption')).toBeNull();
    expect(screen.getByRole('img', { name: 'Empty' })).toBeTruthy();
  });
});
