import type { Stage } from '../types';
import { COST } from './cost';
import { GENERALIZING } from './general';
import { MODEL } from './model';
import { PROBLEM } from './problem';
import { RESULT } from './result';
import { TRAINING } from './training';

/** The 17 steps in teaching order. A step uses only what the steps before it introduced. */
export const STAGES: Stage[] = [...PROBLEM, ...MODEL, ...COST, ...TRAINING, ...GENERALIZING, ...RESULT];
