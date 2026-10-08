import { ADAPTIVE } from './config';
import type { Difficulty } from './types';

export const LEVELS: Difficulty[] = ['easy', 'intermediate', 'advanced'];

export interface AdaptiveState {
  level: Difficulty;
  /** Recent graded results (true = correct), newest last. */
  window: boolean[];
}

export function initialAdaptive(level: Difficulty = 'easy'): AdaptiveState {
  return { level, window: [] };
}

/**
 * Moves the level up after consistent success and down after repeated
 * struggle, using a short rolling window. Returns the change, if any.
 */
export function updateAdaptive(state: AdaptiveState, correct: boolean): { state: AdaptiveState; change?: 'up' | 'down' } {
  const window = [...state.window, correct].slice(-ADAPTIVE.window);
  const idx = LEVELS.indexOf(state.level);
  if (window.length >= ADAPTIVE.window) {
    const acc = window.filter(Boolean).length / window.length;
    if (acc >= ADAPTIVE.stepUpAt && idx < LEVELS.length - 1) return { state: { level: LEVELS[idx + 1], window: [] }, change: 'up' };
    if (acc <= ADAPTIVE.stepDownAt && idx > 0) return { state: { level: LEVELS[idx - 1], window: [] }, change: 'down' };
  }
  return { state: { level: state.level, window } };
}

/** Level for the next new word: mostly the current level, sometimes one below (consolidate) or above (stretch). */
export function targetLevel(level: Difficulty, adaptive: boolean, rng: () => number): Difficulty {
  if (!adaptive) return level;
  const idx = LEVELS.indexOf(level);
  const r = rng();
  if (r < ADAPTIVE.below && idx > 0) return LEVELS[idx - 1];
  if (r > 1 - ADAPTIVE.above && idx < LEVELS.length - 1) return LEVELS[idx + 1];
  return level;
}
