import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  fourthDownProbs,
  fourthDownRecommendation,
  type FourthDownProbs,
  type GameContext,
  type PlayState,
} from './index.js';

// The decision-level reference cases the R export writes: nfl4th's own
// add_4th_probs on every 4th down in a fixed set of real games.
interface FourthDownCase {
  gameId: string;
  playId: number;
  playType: string | null;
  game: GameContext;
  state: PlayState;
  fourthDownProbs: FourthDownProbs | null;
}

const cases = JSON.parse(
  readFileSync(new URL('../reference/fourth_down_cases.json', import.meta.url), 'utf8'),
) as FourthDownCase[];

const label = (c: FourthDownCase) => `${c.gameId} play ${c.playId}`;
const probabilities = [
  'go_wp',
  'fg_wp',
  'punt_wp',
  'first_down_prob',
  'wp_succeed',
  'wp_fail',
  'fg_make_prob',
  'make_fg_wp',
  'miss_fg_wp',
] as const;

describe('fourth-down reference cases', () => {
  const computed = cases.filter((c) => c.fourthDownProbs !== null);
  const probs = (c: FourthDownCase) => c.fourthDownProbs!;

  it('cover both eras of each model, every roof, a playoff game, an end-of-half 4th down and a relocated team', () => {
    const seasons = computed.map((c) => c.game.season);
    expect(seasons.some((s) => s <= 2017)).toBe(true);
    expect(seasons.some((s) => s >= 2018 && s < 2020)).toBe(true);
    expect(seasons.some((s) => s >= 2020)).toBe(true);
    expect(new Set(computed.map((c) => c.game.roof))).toEqual(
      new Set(['outdoors', 'dome', 'closed', 'open']),
    );
    expect(computed.some((c) => c.game.seasonType === 'POST')).toBe(true);
    // The 6-second runoff ends the half, so every branch flips to the 3rd quarter.
    expect(computed.some((c) => c.state.qtr === 2 && c.state.quarterSecondsRemaining <= 6)).toBe(
      true,
    );
    // pbp's code for a team the schedule still calls SD.
    expect(computed.some((c) => c.gameId.includes('_SD_') && c.state.posteam === 'LAC')).toBe(true);
  });

  it('cover goal-to-go, a field goal beyond 58 yards, a punt from inside the 40, a no-play and a yard line with no punt distribution', () => {
    expect(computed.some((c) => c.state.ydstogo === c.state.yardline100)).toBe(true);
    expect(computed.some((c) => c.playType === 'field_goal' && c.state.yardline100 > 40)).toBe(
      true,
    );
    expect(computed.some((c) => c.playType === 'punt' && c.state.yardline100 < 40)).toBe(true);
    expect(computed.some((c) => c.playType === 'no_play')).toBe(true);
    expect(computed.some((c) => probs(c).punt_wp === null)).toBe(true);
  });

  it('cover the kneel-out after a conversion, after a failure, and one only the runoff brings into reach', () => {
    expect(computed.some((c) => probs(c).wp_succeed === 1)).toBe(true);
    expect(computed.some((c) => probs(c).wp_fail === 0)).toBe(true);
    // Over 2 minutes left at the snap, under 2 once the kick's 6 seconds run off.
    expect(
      computed.some(
        (c) =>
          c.state.qtr === 4 && c.state.quarterSecondsRemaining >= 120 && probs(c).make_fg_wp === 0,
      ),
    ).toBe(true);
  });

  // One test per game, so no single test carries all 169 cases' 59,000 model
  // predictions: CI runs every package's tasks at once and is many times slower
  // than a laptop here. A game takes up to 15 seconds on CI, and the first also
  // loads the models.
  const games = [...new Set(cases.map((c) => c.gameId))];
  it.each(games)(
    'match nfl4th add_4th_probs in %s: probabilities within 1e-6, go_boost within 1e-4 points',
    (gameId) => {
      const misses = cases
        .filter((c) => c.gameId === gameId)
        .flatMap((c) => {
          const got = fourthDownProbs(c.game, c.state);
          if (c.fourthDownProbs === null || got === null) {
            return got === c.fourthDownProbs
              ? []
              : [
                  `${label(c)}: expected ${JSON.stringify(c.fourthDownProbs)}, got ${JSON.stringify(got)}`,
                ];
          }
          const want = c.fourthDownProbs;
          const off = (key: keyof FourthDownProbs, tolerance: number) => {
            const [g, w] = [got[key], want[key]];
            if (g === null || w === null)
              return g === w ? [] : [`${label(c)} ${key}: ${g} vs ${w}`];
            const diff = Math.abs(g - w);
            return diff <= tolerance ? [] : [`${label(c)} ${key}: off by ${diff}`];
          };
          return [...probabilities.flatMap((key) => off(key, 1e-6)), ...off('go_boost', 1e-4)];
        });
      expect(misses).toEqual([]);
    },
    60_000,
  );
});

describe('fourthDownProbs is null where nfl4th computes nothing', () => {
  const computed = cases.find((c) => c.fourthDownProbs !== null && c.state.qtr === 3)!;
  const { game, state } = computed;

  it('computes the base case', () => {
    expect(fourthDownProbs(game, state)).not.toBeNull();
  });

  it('before 2014', () => {
    expect(fourthDownProbs({ ...game, season: 2013 }, state)).toBeNull();
  });

  it('without a spread', () => {
    expect(fourthDownProbs({ ...game, spreadLine: null }, state)).toBeNull();
  });

  it('without a total', () => {
    expect(fourthDownProbs({ ...game, totalLine: null }, state)).toBeNull();
  });

  it('in overtime', () => {
    expect(fourthDownProbs(game, { ...state, qtr: 5 })).toBeNull();
  });

  it('with 15 or fewer game seconds left', () => {
    expect(fourthDownProbs(game, { ...state, qtr: 4, quarterSecondsRemaining: 15 })).toBeNull();
    expect(fourthDownProbs(game, { ...state, qtr: 4, quarterSecondsRemaining: 16 })).not.toBeNull();
  });

  it('with no possession team', () => {
    expect(fourthDownProbs(game, { ...state, posteam: '' })).toBeNull();
  });

  it('on any down but the 4th', () => {
    for (const down of [1, 2, 3]) expect(fourthDownProbs(game, { ...state, down })).toBeNull();
  });
});

describe('fourthDownRecommendation', () => {
  it('goes when going for it gains win probability', () => {
    expect(fourthDownRecommendation({ go_boost: 0.1, fg_wp: 0.5, punt_wp: 0.6 })).toBe('go');
  });

  it('punts when the punt beats the field goal', () => {
    expect(fourthDownRecommendation({ go_boost: -1, fg_wp: 0.4, punt_wp: 0.5 })).toBe('punt');
  });

  it('kicks the field goal on a tie', () => {
    expect(fourthDownRecommendation({ go_boost: -1, fg_wp: 0.5, punt_wp: 0.5 })).toBe('field_goal');
  });

  it('kicks the field goal without a punt_wp', () => {
    expect(fourthDownRecommendation({ go_boost: -1, fg_wp: 0.1, punt_wp: null })).toBe(
      'field_goal',
    );
  });
});
