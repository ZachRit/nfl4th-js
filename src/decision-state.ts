import { modelState, type GameContext, type ModelState, type PlayState } from './game-state.js';
import { modelExpectedPoints } from './expected-points.js';
import { wpModel } from './models.js';
import { modelVegasWinProbability } from './win-probability.js';

// A play as nfl4th's prepare_df (R/helpers.R) leaves it, and the hypothetical
// states its decision functions derive from it. posteam moves with each
// hypothetical possession; originalPosteam is the team making the decision.
// posteamTimeoutsRemaining and defteamTimeoutsRemaining stay the original
// play's, as nfl4th never swaps them: only its expected points read them.
export interface DecisionState extends ModelState {
  originalPosteam: string;
  homeTimeoutsRemaining: number;
  awayTimeoutsRemaining: number;
  homeReceive2hKo: number;
  // The original play's, never recomputed after the clock moves.
  elapsedShare: number;
}

/**
 * Whether nfl4th computes anything for a play: prepare_nflfastr_data
 * (R/helpers.R) keeps regulation plays with a possession team and more than
 * 15 game seconds left, and nothing is computed before 2014 or without both
 * lines.
 */
export function nfl4thComputes(game: GameContext, state: PlayState): boolean {
  return (
    game.season >= 2014 &&
    game.spreadLine !== null &&
    game.totalLine !== null &&
    state.qtr <= 4 &&
    modelState(state).gameSecondsRemaining > 15 &&
    (state.posteam === game.homeTeam || state.posteam === game.awayTeam)
  );
}

// nfl4th's prepare_df (R/helpers.R), which scores every play as a 4th down.
export function prepareState(game: GameContext, state: PlayState): DecisionState {
  const s = modelState(state);
  const home = state.posteam === game.homeTeam;
  return {
    ...s,
    down: 4,
    originalPosteam: state.posteam,
    homeTimeoutsRemaining: home ? state.posteamTimeoutsRemaining : state.defteamTimeoutsRemaining,
    awayTimeoutsRemaining:
      state.posteam === game.awayTeam
        ? state.posteamTimeoutsRemaining
        : state.defteamTimeoutsRemaining,
    homeReceive2hKo: state.qtr <= 2 ? (game.homeOpeningKickoff ? -1 : 1) : 0,
    elapsedShare: (3600 - s.gameSecondsRemaining) / 3600,
  };
}

// nfl4th's flip_half (R/helpers.R): a state at the end of the 1st half moves
// to the 3rd quarter's opening possession.
export function flipHalf(game: GameContext, s: DecisionState): DecisionState {
  if (!(s.qtr === 2 && s.halfSecondsRemaining === 0)) return s;
  const posteam = game.homeOpeningKickoff ? game.awayTeam : game.homeTeam;
  return {
    ...s,
    posteam,
    qtr: 3,
    down: 1,
    ydstogo: 10,
    yardline100: 75,
    halfSecondsRemaining: 1800,
    gameSecondsRemaining: 1800,
    scoreDifferential: posteam !== s.posteam ? -s.scoreDifferential : s.scoreDifferential,
    homeReceive2hKo: 0,
  };
}

// nfl4th's own home-team model, fed as calculate_win_probability builds its
// inputs (R/apply_win_prob.R). spread_time and Diff_Time_Ratio use the
// original play's elapsed share, as nfl4th never recomputes it.
function homeWinProbability(game: GameContext, s: DecisionState): number {
  const home = s.posteam === game.homeTeam;
  const ep = modelExpectedPoints(game, s);
  const homeScoreDifferential = home ? s.scoreDifferential : -s.scoreDifferential;
  const decay = Math.exp(-4 * s.elapsedShare);
  // Column order is nfl4th's wp_model_select (R/apply_win_prob.R), which names
  // home_timeouts_remaining twice; dplyr keeps one, so the model has 11.
  return wpModel().predict([
    s.homeReceive2hKo,
    game.spreadLine! * decay,
    home ? 1 : 0,
    s.halfSecondsRemaining,
    s.gameSecondsRemaining,
    homeScoreDifferential / decay,
    homeScoreDifferential,
    home ? ep : -ep,
    s.ydstogo,
    home ? s.yardline100 : 100 - s.yardline100,
    s.homeTimeoutsRemaining,
  ])[0]!;
}

/**
 * nfl4th's calculate_win_probability (R/apply_win_prob.R): the original
 * possession team's win probability in a state, the average of nfl4th's
 * home-team model and nflfastR's vegas_wp, each flipped to that team.
 */
export function calculateWinProbability(game: GameContext, s: DecisionState): number {
  const homeWp = homeWinProbability(game, s);
  const vegasWp = modelVegasWinProbability(game, {
    ...s,
    posteamTimeoutsRemaining:
      s.posteam === game.awayTeam ? s.awayTimeoutsRemaining : s.homeTimeoutsRemaining,
    defteamTimeoutsRemaining:
      s.posteam === game.homeTeam ? s.awayTimeoutsRemaining : s.homeTimeoutsRemaining,
  });
  const fromHome = s.originalPosteam === game.awayTeam ? 1 - homeWp : homeWp;
  const fromPosteam = s.posteam !== s.originalPosteam ? 1 - vegasWp : vegasWp;
  return (fromHome + fromPosteam) / 2;
}

// The kneel-out rule nfl4th's end_game_fn (R/helpers.R) and get_go_wp
// (R/decision_functions.R) share: a leading possession team can run out the
// clock against the timeouts its opponent has left.
export function kneelsOut(game: GameContext, s: DecisionState): boolean {
  const defteamTimeouts =
    s.posteam === game.homeTeam ? s.awayTimeoutsRemaining : s.homeTimeoutsRemaining;
  return (
    s.scoreDifferential > 0 &&
    ((s.gameSecondsRemaining < 120 && defteamTimeouts === 0) ||
      (s.gameSecondsRemaining < 80 && defteamTimeouts === 1) ||
      (s.gameSecondsRemaining < 40 && defteamTimeouts === 2))
  );
}

// nfl4th's end_game_fn (R/helpers.R): a leading possession team that can kneel
// out the clock leaves the original team no chance.
export function endGame(game: GameContext, s: DecisionState, wp: number): number {
  return kneelsOut(game, s) ? 0 : wp;
}

// The 6-second runoff every nfl4th decision function charges.
export function runoff(s: DecisionState): DecisionState {
  return {
    ...s,
    halfSecondsRemaining: Math.max(s.halfSecondsRemaining - 6, 0),
    gameSecondsRemaining: Math.max(s.gameSecondsRemaining - 6, 0),
  };
}

// nfl4th's flip_team (R/helpers.R): the other team takes over 1st and 10 after
// the runoff.
export function flipTeam(game: GameContext, s: DecisionState): DecisionState {
  return {
    ...runoff(s),
    posteam: s.posteam === game.homeTeam ? game.awayTeam : game.homeTeam,
    scoreDifferential: -s.scoreDifferential,
    down: 1,
    ydstogo: 10,
  };
}
