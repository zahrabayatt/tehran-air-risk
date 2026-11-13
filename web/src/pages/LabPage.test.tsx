import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STEPS } from '../lab/steps';
import type { StepModule } from '../lab/steps';
import { LabPage, stepFromParam } from './LabPage';

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="lab/:step?" element={<LabPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('stepFromParam', () => {
  it('is the step number, and 1 for anything else', () => {
    expect(stepFromParam('5')).toBe(5);
    expect(stepFromParam('17')).toBe(17);
    for (const bad of [undefined, '', '0', '18', '2.5', 'abc']) expect(stepFromParam(bad)).toBe(1);
  });
});

describe('LabPage', () => {
  it('lists the 17 steps under their seven section names and marks the open one', async () => {
    open('/lab/4');
    const nav = screen.getByRole('navigation', { name: 'Steps' });
    expect(within(nav).getAllByRole('link')).toHaveLength(17);
    for (const name of ['The problem', 'The model', 'The cost', 'Training', 'Better inputs', 'Fitting well', 'The result']) {
      expect(within(nav).getByText(name)).toBeTruthy();
    }
    expect(within(nav).getByRole('link', { name: /Sigmoid/ }).getAttribute('aria-current')).toBe('page');
    expect(await screen.findByRole('heading', { level: 2, name: 'Sigmoid' })).toBeTruthy();
    expect(screen.getByText('Step 4 of 17')).toBeTruthy();
  });

  it('step 1 has a next link and no back link', async () => {
    open('/lab');
    await screen.findByRole('heading', { level: 2, name: 'Data' });
    const row = screen.getByRole('navigation', { name: 'Previous and next step' });
    expect(within(row).queryByText(/^←/)).toBeNull();
    const next = within(row).getByRole('link');
    expect(next.getAttribute('href')).toBe('/lab/2');
    expect(next.textContent).toBe('Next: The question and its timing →');
  });

  it('a middle step has both, and step 17 has no next link', async () => {
    const { unmount } = open('/lab/9');
    await screen.findByRole('heading', { level: 2, name: 'Gradient descent' });
    let row = screen.getByRole('navigation', { name: 'Previous and next step' });
    expect(within(row).getByRole('link', { name: '← Logistic loss and cost' }).getAttribute('href')).toBe('/lab/8');
    expect(within(row).getByRole('link', { name: 'Next: Vectorization →' }).getAttribute('href')).toBe('/lab/10');
    unmount();
    open('/lab/17');
    await screen.findByRole('heading', { level: 2, name: "Today's forecast" });
    row = screen.getByRole('navigation', { name: 'Previous and next step' });
    expect(within(row).queryByText(/^Next:/)).toBeNull();
    expect(within(row).getByRole('link', { name: '← Held-out result' }).getAttribute('href')).toBe('/lab/16');
    expect(within(row).getByRole('link', { name: 'Back to the forecast →' }).getAttribute('href')).toBe('/');
  });

  it('offers the code and math tabs, and scikit-learn only where the step has it', async () => {
    open('/lab/1');
    await screen.findByRole('heading', { level: 2, name: 'Data' });
    expect(screen.getByRole('tab', { name: 'The code' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'The math' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'scikit-learn' })).toBeNull();
  });

  it('a step that fails to load shows the error message', async () => {
    vi.spyOn(STEPS[2], 'load').mockRejectedValue(new Error('chunk 3 is missing'));
    open('/lab/3');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This step did not load.');
    expect(alert.textContent).toContain('chunk 3 is missing');
  });

  it('a step whose data does not load shows the error message', async () => {
    const broken: StepModule = {
      html: '<div id="main"><section class="card"><h2>Broken</h2></section></div>',
      mathHtml: '',
      skHtml: '',
      mount: (ctx) => {
        void ctx.load('lab-days');
        return () => {};
      },
    };
    vi.spyOn(STEPS[1], 'load').mockResolvedValue(broken);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    open('/lab/2');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load lab-days.json (404).'));
    vi.unstubAllGlobals();
  });

  it('stops the step it leaves', async () => {
    const stop = vi.fn();
    const mod: StepModule = { html: '<div id="main"></div>', mathHtml: '', skHtml: '', mount: () => stop };
    vi.spyOn(STEPS[0], 'load').mockResolvedValue(mod);
    const { unmount } = open('/lab/1');
    await waitFor(() => expect(document.getElementById('main')).toBeTruthy());
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
