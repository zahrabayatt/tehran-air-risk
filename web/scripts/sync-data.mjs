// Copies the files the site reads from the repository root into web/public/data:
//   model/model.json       the frozen model (Model Lab, Task 7)
//   data/predictions.json  the daily forecasts and their outcomes (Forecast page)
// Run automatically by the predev and prebuild scripts, so `pnpm dev` and `pnpm build` always use the
// current files. The copies are git-ignored: do not edit or commit them.
// (grid.json is not copied; it is written from pipeline/grid.py by `python -m pipeline.export_grid`
// and committed, because the build job has no Python.)
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const publicData = resolve(here, '..', 'public', 'data');

const FILES = [
  { from: ['model', 'model.json'], hint: 'Train the model first.' },
  { from: ['data', 'predictions.json'], hint: 'Run `python -m pipeline.predict` first.' },
];

mkdirSync(publicData, { recursive: true });
for (const f of FILES) {
  const source = resolve(root, ...f.from);
  const name = f.from[f.from.length - 1];
  if (!existsSync(source)) {
    console.error(`sync-data: ${source} not found. ${f.hint}`);
    process.exit(1);
  }
  copyFileSync(source, resolve(publicData, name));
  console.log(`sync-data: copied ${f.from.join('/')} to web/public/data/${name}`);
}
