import {
  calculateWinProbability,
  endGame,
  flipHalf,
  flipTeam,
  kneelsOut,
  nfl4thComputes,
  prepareState,
  runoff,
  type DecisionState,
} from './decision-state.js';
import { fgMakeProbability } from './field-goal.js';
import { modelRoof, type GameContext, type PlayState } from './game-state.js';
import { fdModel, puntTable } from './models.js';
import { getTwoPointWp } from './two-point.js';

/** nfl4th's fourth-down decision, in nfl4th's own names. */
export interface FourthDownProbs {
  /** The gain in win probability from going for it over the better kick, in percentage points. */
  go_boost: number;
  /** Win probability if the team goes for it. */
  go_wp: number;
  /** Win probability if it attempts a field goal. */
  fg_wp: number;
  /** Win probability if it punts; null where nfl4th has no punt distribution for the yard line. */
  punt_wp: number | null;
  /** Chance a go-for-it attempt converts. */
  first_down_prob: number;
  /** Win probability after converting. */
  wp_succeed: number;
  /** Win probability after failing. */
  wp_fail: number;
  /** Chance the field goal is good. */
  fg_make_prob: number;
  /** Win probability after a make. */
  make_fg_wp: number;
  /** Win probability after a miss. */
  miss_fg_wp: number;
}

/**
 * nfl4th's add_4th_probs (R/wrapper.R) on one 4th down. Null wherever nfl4th
 * computes nothing: before 2014, without a spread or total, in overtime, with
 * 15 or fewer game seconds left, with no possession team, or on any other down.
 */
export function fourthDownProbs(game: GameContext, state: PlayState): FourthDownProbs | null {
  if (state.down !== 4 || !nfl4thComputes(game, state)) return null;
  const s = prepareState(game, state);
  const go = getGoWp(game, s);
  const fg = getFgWp(game, s);
  const puntWp = getPuntWp(game, s);
  // add_4th_probs counts a missing punt_wp as 0.
  const goBoost = 100 * (go.go_wp - Math.max(fg.fg_wp, puntWp ?? 0));
  return { go_boost: goBoost, ...go, ...fg, punt_wp: puntWp };
}

/**
 * The model's call: go when going for it gains win probability, otherwise the
 * better kick, a tie going to the field goal and a missing punt_wp counting as
 * no punt.
 */
export function fourthDownRecommendation(
  probs: Pick<FourthDownProbs, 'go_boost' | 'fg_wp' | 'punt_wp'>,
): 'go' | 'field_goal' | 'punt' {
  if (probs.go_boost > 0) return 'go';
  return probs.punt_wp !== null && probs.punt_wp > probs.fg_wp ? 'punt' : 'field_goal';
}

// nfl4th's get_go_wp (R/decision_functions.R). fd_model gives the chance of
// each gain from -10 to 65 yards; a gain past the goal line is a touchdown.
// nfl4th's runoff input is fixed at 0, as add_4th_probs leaves it, so only
// the 6-second runoff moves the clock.
function getGoWp(game: GameContext, s: DecisionState) {
  const spread = game.spreadLine!;
  const total = game.totalLine!;
  const home = s.posteam === game.homeTeam;
  const roof = modelRoof(game.roof);
  // Column order is get_go_wp's select.
  const gainProbs = fdModel().predict([
    s.down,
    s.ydstogo,
    s.yardline100,
    game.season > 2013 && game.season <= 2017 ? 1 : 0,
    game.season > 2017 ? 1 : 0,
    roof === 'outdoors' ? 1 : 0,
    roof === 'retractable' ? 1 : 0,
    roof === 'dome' ? 1 : 0,
    home ? spread : -spread,
    total,
    home ? (total + spread) / 2 : (total - spread) / 2,
  ]);
  const byGain = new Map<number, number>();
  gainProbs.forEach((p, i) => {
    const gain = Math.min(i - 10, s.yardline100);
    byGain.set(gain, (byGain.get(gain) ?? 0) + p);
  });

  const other = home ? game.awayTeam : game.homeTeam;
  let goWp = 0;
  const pct = [0, 0];
  const wtWp = [0, 0];
  for (const [gain, prob] of byGain) {
    const turnover = gain < s.ydstogo;
    const spot = s.yardline100 - gain;
    const yardline100 = turnover ? 100 - spot : spot;
    const scoreDifferential = turnover ? -s.scoreDifferential : s.scoreDifferential;
    const next: DecisionState = {
      ...runoff(s),
      posteam: turnover ? other : s.posteam,
      down: 1,
      yardline100,
      scoreDifferential: yardline100 === 0 ? scoreDifferential + 6 : scoreDifferential,
      ydstogo: yardline100 < 10 ? yardline100 : 10,
    };
    const flipped = flipHalf(game, next);
    let wp: number;
    if (flipped.yardline100 === 0) {
      // A touchdown takes the better of kicking and going for two. One that
      // ends the 1st half was flipped to the 3rd quarter and keeps its 6 points.
      const td = getTwoPointWp(game, next);
      wp = td.wp_go1 > td.wp_go2 ? td.wp_go1 : td.wp_go2;
    } else {
      wp = calculateWinProbability(game, flipped);
    }
    // Kneel-out after a conversion wins the game, after a failure loses it.
    if (!turnover && flipped.yardline100 > 0 && kneelsOut(game, flipped)) wp = 1;
    else if (turnover) wp = endGame(game, flipped, wp);

    const t = turnover ? 1 : 0;
    goWp += prob * wp;
    pct[t]! += prob;
    wtWp[t]! += prob * wp;
  }
  return {
    go_wp: goWp,
    first_down_prob: pct[0]!,
    wp_succeed: wtWp[0]! / pct[0]!,
    wp_fail: wtWp[1]! / pct[1]!,
  };
}

// nfl4th's get_fg_wp (R/decision_functions.R).
function getFgWp(game: GameContext, s: DecisionState) {
  const yardline = s.yardline100;
  // Beyond a 58-yard try (the 40) the make probability decays linearly from
  // the 40's, reaching zero at a 70-yard try (the 53).
  let fgMakeProb: number;
  if (yardline >= 53) fgMakeProb = 0;
  else if (yardline > 40) fgMakeProb = ((53 - yardline) / 13) * fgMakeProbability(game, 40);
  else fgMakeProb = fgMakeProbability(game, yardline);

  const receiver = flipTeam(game, s);
  const wpAt = (next: DecisionState) => {
    const flipped = flipHalf(game, next);
    return endGame(game, flipped, calculateWinProbability(game, flipped));
  };
  // A make: the other team receives a touchback down 3 more.
  const makeFgWp = wpAt({
    ...receiver,
    yardline100: 75,
    scoreDifferential: receiver.scoreDifferential - 3,
  });
  // A miss: the other team takes over at the spot of the kick, 8 yards behind
  // the line, held between its own 20 and the 1.
  const missFgWp = wpAt({
    ...receiver,
    yardline100: Math.max(Math.min(100 - yardline - 8, 80), 1),
  });
  return {
    fg_make_prob: fgMakeProb,
    make_fg_wp: makeFgWp,
    miss_fg_wp: missFgWp,
    fg_wp: fgMakeProb * makeFgWp + (1 - fgMakeProb) * missFgWp,
  };
}

// nfl4th's get_punt_wp (R/decision_functions.R): the win probability averaged
// over punt_df's outcomes for the yard line, null where it has none.
function getPuntWp(game: GameContext, s: DecisionState): number | null {
  const outcomes = puntTable().get(s.yardline100);
  if (!outcomes) return null;
  const receiver = flipTeam(game, s);
  let puntWp = 0;
  for (const o of outcomes) {
    const returnTd = o.yardlineAfter === 100;
    const muff = o.muff === 1;
    // A return touchdown has the kicking team receive down 7 more; a muff
    // gives it the ball where the receiver touched it.
    let yardline100 = 100 - o.yardlineAfter;
    if (muff) yardline100 = 100 - yardline100;
    if (returnTd) yardline100 = 75;
    let scoreDifferential = returnTd ? -receiver.scoreDifferential - 7 : receiver.scoreDifferential;
    if (muff) scoreDifferential = -scoreDifferential;
    const flipped = flipHalf(game, {
      ...receiver,
      posteam: returnTd || muff ? s.originalPosteam : receiver.posteam,
      yardline100,
      scoreDifferential,
      ydstogo: yardline100 < 10 ? yardline100 : receiver.ydstogo,
    });
    puntWp += o.pct * endGame(game, flipped, calculateWinProbability(game, flipped));
  }
  return puntWp;
}
