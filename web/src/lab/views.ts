import { costByLambda, costVsGuesses, frozenWeights, pipeline, probabilitiesByOutcome, sandboxSplit } from './views/result';
import { costMap, costOfW, logisticSurface, lossCurves, squaredSurface, squaredVsLogistic } from './views/cost';
import { polyBoundary, seasonAlone, seasonCircle, weightBars } from './views/general';
import { boundarySeason, boundaryWind, probabilityCurve, scoreLine, sigmoidCurve } from './views/model';
import { balance, labels, months, series, timeline, todayTomorrow, whyNotLinear } from './views/problem';
import { costByIteration, learningRates, parameters, scaleHistogram, scaleTraining, shapes } from './views/training';

/**
 * Every plot of the Lab, by name. The functions live in views/, split by part of the course:
 * problem.ts (steps 1 to 3), model.ts (4 to 6), cost.ts (7 to 9), training.ts (10 to 13),
 * general.ts (14 and 15) and result.ts (16 and 17).
 */
export const VIEWS = {
  series,
  months,
  todayTomorrow,
  timeline,
  labels,
  balance,
  whyNotLinear,
  sigmoidCurve,
  probabilityCurve,
  scoreLine,
  boundaryWind,
  boundarySeason,
  squaredVsLogistic,
  squaredSurface,
  logisticSurface,
  lossCurves,
  costOfW,
  costMap,
  costByIteration,
  parameters,
  shapes,
  learningRates,
  scaleHistogram,
  scaleTraining,
  seasonCircle,
  seasonAlone,
  polyBoundary,
  weightBars,
  costVsGuesses,
  probabilitiesByOutcome,
  costByLambda,
  sandboxSplit,
  pipeline,
  frozenWeights,
};
