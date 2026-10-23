import {
  calculateWinProbability,
  flipHalf,
  nfl4thComputes,
  prepareState,
  type DecisionState,
} from './decision-state.js';
import { fgMakeProbability } from './field-goal.js';
import { modelRoof, type GameContext, type PlayState } from './game-state.js';
import { twoPointModel } from './models.js';

/** nfl4th's two-point decision on an extra-point try, in nfl4th's own names. */
export interface TwoPointProbs {
  /** Chance the kick is good. */
  conv_1pt: number;
  /** Chance a two-point try converts. */
  conv_2pt: number;
  /** Win probability when kicking. */
  wp_go1: number;
  /** Win probability when going for two. */
  wp_go2: number;
}

/**
 * nfl4th's get_2pt_wp (R/decision_functions.R), as add_2pt_probs runs it on an
 * extra-point try. Null wherever nfl4th computes nothing: before 2014, without
 * a spread or total, in overtime, with 15 or fewer game seconds left, or with
 * no possession team.
 */
export function twoPointProbs(game: GameContext, state: PlayState): TwoPointProbs | null {
  if (!nfl4thComputes(game, state)) return null;
  return getTwoPointWp(game, prepareState(game, state));
}

/**
 * nfl4th's get_2pt_wp (R/decision_functions.R) on a state whose possession
 * team has just scored a touchdown, its score already counted. add_2pt_probs
 * runs it on the try itself, and get_go_wp on each touchdown a go-for-it
 * attempt can end in, after that attempt's runoff.
 */
export function getTwoPointWp(game: GameContext, s: DecisionState): TwoPointProbs {
  const spread = game.spreadLine!;
  const total = game.totalLine!;
  // prepare_df's posteam_spread and posteam_total, the original team's.
  const home = s.originalPosteam === game.homeTeam;
  const roof = modelRoof(game.roof);

  // Column order is get_2pt_wp's select, era2 fixed at 0.
  const conv2pt = twoPointModel().predict([
    0,
    game.season > 2013 && game.season <= 2017 ? 1 : 0,
    game.season > 2017 ? 1 : 0,
    roof === 'outdoors' ? 1 : 0,
    roof === 'retractable' ? 1 : 0,
    roof === 'dome' ? 1 : 0,
    home ? spread : -spread,
    total,
    home ? (total + spread) / 2 : (total - spread) / 2,
  ])[0]!;
  // The kick is a field goal from the 15.
  const conv1pt = fgMakeProbability(game, 15);

  // The other team receives a touchback after the try scores 0, 1 or 2.
  const receiver = s.posteam === game.homeTeam ? game.awayTeam : game.homeTeam;
  const wpAfter = (points: number) =>
    calculateWinProbability(
      game,
      flipHalf(game, {
        ...s,
        posteam: receiver,
        scoreDifferential: -s.scoreDifferential - points,
        yardline100: 75,
        down: 1,
        ydstogo: 10,
      }),
    );
  const wp0 = wpAfter(0);
  const wp1 = wpAfter(1);
  const wp2 = wpAfter(2);

  return {
    conv_1pt: conv1pt,
    conv_2pt: conv2pt,
    wp_go1: conv1pt * wp1 + (1 - conv1pt) * wp0,
    wp_go2: conv2pt * wp2 + (1 - conv2pt) * wp0,
  };
}
