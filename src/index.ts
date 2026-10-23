export type { GameContext, PlayState } from './game-state.js';
export { expectedPoints } from './expected-points.js';
export { vegasWinProbability } from './win-probability.js';
export { twoPointProbs, type TwoPointProbs } from './two-point.js';
export { fourthDownProbs, fourthDownRecommendation, type FourthDownProbs } from './fourth-down.js';

/**
 * Identifies the models and the computation behind every output. Change it
 * whenever a model file or the computation changes, and only then: stored
 * values stamped with another version are recomputed.
 */
export const MODEL_VERSION = '1';
