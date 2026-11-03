import sample from '../../public/data/sample.json';
import model from '../../../model/model.json';
import predictions from '../../../data/predictions.json';
import type { LabInputs, LabModel, PredictionEntry } from './context';
import { makeCtx } from './context';
import type { Sample } from './engine';

/** The real sample, frozen model and forecast log, for tests. */
export const inputs: LabInputs = {
  sample: sample as unknown as Sample,
  model: model as unknown as LabModel,
  predictions: (predictions as unknown as { entries: PredictionEntry[] }).entries,
};

export const ctx = makeCtx(inputs);
