import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectedPoints, vegasWinProbability, type GameContext, type PlayState } from './index.js';

// The state-level reference cases the R export writes: nflfastR's own
// calculate_expected_points and calculate_win_probability on sampled states.
interface StateCase {
  gameId: string;
  playId: number;
  variant: 'sampled' | 'no_roof' | 'no_spread';
  game: GameContext;
  state: PlayState;
  expectedPoints: number;
  vegasWinProbability: number;
}

const cases = JSON.parse(
  readFileSync(new URL('../reference/state_cases.json', import.meta.url), 'utf8'),
) as StateCase[];

const label = (c: StateCase) => `${c.gameId} play ${c.playId} (${c.variant})`;

describe('state reference cases', () => {
  it('cover every era, roof, quarter and season type', () => {
    const sampled = cases.filter((c) => c.variant === 'sampled');
    expect(new Set(sampled.map((c) => c.game.season <= 2017))).toEqual(new Set([true, false]));
    expect(new Set(sampled.map((c) => c.game.roof))).toEqual(
      new Set(['outdoors', 'dome', 'closed', 'open']),
    );
    expect(new Set(sampled.map((c) => c.state.qtr))).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(sampled.map((c) => c.game.seasonType))).toEqual(new Set(['REG', 'POST']));
    expect(cases.filter((c) => c.variant === 'no_roof').length).toBeGreaterThan(0);
    expect(cases.filter((c) => c.variant === 'no_spread').length).toBeGreaterThan(0);
  });

  // Each of these two first loads its model, and CI runners are slower than a laptop.
  it('match nflfastR expected points within 1e-6', () => {
    const misses = cases
      .map((c) => ({ c, diff: Math.abs(expectedPoints(c.game, c.state) - c.expectedPoints) }))
      .filter(({ diff }) => !(diff <= 1e-6))
      .map(({ c, diff }) => `${label(c)}: off by ${diff}`);
    expect(misses).toEqual([]);
  }, 30_000);

  it('match nflfastR vegas_wp within 1e-6', () => {
    const misses = cases
      .map((c) => ({
        c,
        diff: Math.abs(vegasWinProbability(c.game, c.state) - c.vegasWinProbability),
      }))
      .filter(({ diff }) => !(diff <= 1e-6))
      .map(({ c, diff }) => `${label(c)}: off by ${diff}`);
    expect(misses).toEqual([]);
  }, 30_000);
});
