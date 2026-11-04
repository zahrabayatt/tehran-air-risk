import sample from '../../public/data/sample.json';
import profile from '../../public/data/profile.json';
import model from '../../../model/model.json';
import predictions from '../../../data/predictions.json';
import type { LabInputs, LabModel, PredictionEntry } from './context';
import { makeCtx } from './context';
import type { Sample } from './engine';

/** The real sample, frozen model and forecast log, for tests. */
export const inputs: LabInputs = {
  sample: sample as unknown as Sample,
  model: model as unknown as LabModel,
  selection: { rows: profile.splits.selection.rows, positives: profile.splits.selection.positives },
  predictions: (predictions as unknown as { entries: PredictionEntry[] }).entries,
};

export const ctx = makeCtx(inputs);
