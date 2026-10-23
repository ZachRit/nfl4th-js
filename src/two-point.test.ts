import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { twoPointProbs, type GameContext, type PlayState, type TwoPointProbs } from './index.js';

// The decision-level reference cases the R export writes: nfl4th's own
// add_2pt_probs on every extra-point try in a fixed set of real games.
interface TwoPointCase {
  gameId: string;
  playId: number;
  game: GameContext;
  state: PlayState;
  twoPointProbs: TwoPointProbs | null;
}

const cases = JSON.parse(
  readFileSync(new URL('../reference/two_point_cases.json', import.meta.url), 'utf8'),
) as TwoPointCase[];

const label = (c: TwoPointCase) => `${c.gameId} play ${c.playId}`;
const outputs = ['conv_1pt', 'conv_2pt', 'wp_go1', 'wp_go2'] as const;

describe('two-point reference cases', () => {
  it('cover both eras of each model, every roof, a playoff game, an end-of-half try and a relocated team', () => {
    const seasons = cases.map((c) => c.game.season);
    expect(seasons.some((s) => s <= 2017)).toBe(true);
    expect(seasons.some((s) => s >= 2018 && s < 2020)).toBe(true);
    expect(seasons.some((s) => s >= 2020)).toBe(true);
    expect(new Set(cases.map((c) => c.game.roof))).toEqual(
      new Set(['outdoors', 'dome', 'closed', 'open']),
    );
    expect(cases.some((c) => c.game.seasonType === 'POST')).toBe(true);
    expect(
      cases.some(
        (c) => c.state.qtr === 2 && c.state.quarterSecondsRemaining === 0 && c.twoPointProbs,
      ),
    ).toBe(true);
    // pbp's code for a team the schedule still calls SD.
    expect(cases.some((c) => c.gameId.includes('_SD_') && c.state.posteam === 'LAC')).toBe(true);
  });

  // The first call loads the models, and CI runners are slower than a laptop.
  it('match nfl4th add_2pt_probs within 1e-6', () => {
    const misses = cases.flatMap((c) => {
      const got = twoPointProbs(c.game, c.state);
      if (c.twoPointProbs === null || got === null) {
        return got === c.twoPointProbs
          ? []
          : [
              `${label(c)}: expected ${JSON.stringify(c.twoPointProbs)}, got ${JSON.stringify(got)}`,
            ];
      }
      return outputs
        .map((key) => ({ key, diff: Math.abs(got[key] - c.twoPointProbs![key]) }))
        .filter(({ diff }) => !(diff <= 1e-6))
        .map(({ key, diff }) => `${label(c)} ${key}: off by ${diff}`);
    });
    expect(misses).toEqual([]);
  }, 30_000);
});

describe('twoPointProbs is null where nfl4th computes nothing', () => {
  const computed = cases.find((c) => c.twoPointProbs !== null && c.state.qtr === 3)!;
  const { game, state } = computed;

  it('computes the base case', () => {
    expect(twoPointProbs(game, state)).not.toBeNull();
  });

  it('before 2014', () => {
    expect(twoPointProbs({ ...game, season: 2013 }, state)).toBeNull();
  });

  it('without a spread', () => {
    expect(twoPointProbs({ ...game, spreadLine: null }, state)).toBeNull();
  });

  it('without a total', () => {
    expect(twoPointProbs({ ...game, totalLine: null }, state)).toBeNull();
  });

  it('in overtime', () => {
    expect(twoPointProbs(game, { ...state, qtr: 5 })).toBeNull();
  });

  it('with 15 or fewer game seconds left', () => {
    expect(twoPointProbs(game, { ...state, qtr: 4, quarterSecondsRemaining: 15 })).toBeNull();
    expect(twoPointProbs(game, { ...state, qtr: 4, quarterSecondsRemaining: 16 })).not.toBeNull();
  });

  it('with no possession team', () => {
    expect(twoPointProbs(game, { ...state, posteam: '' })).toBeNull();
  });
});
