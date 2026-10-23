import {
  isHome,
  modelState,
  type GameContext,
  type ModelState,
  type PlayState,
} from './game-state.js';
import { wpSpreadModel } from './models.js';

function wpSpreadFeatures(game: GameContext, state: ModelState): number[] {
  const home = isHome(game, state);
  const gameSeconds = state.gameSecondsRemaining;
  // nfl4th's calculate_win_probability (R/apply_win_prob.R): the team that
  // didn't take the opening kickoff receives the second-half kickoff.
  const receive2hKo =
    state.qtr <= 2 &&
    ((game.homeOpeningKickoff && state.posteam === game.awayTeam) ||
      (!game.homeOpeningKickoff && state.posteam === game.homeTeam))
      ? 1
      : 0;
  // nflfastR's calculate_win_probability (R/ep_wp_calculators.R). A null
  // spread stays missing (NaN), as R's NA does.
  const spread = game.spreadLine ?? NaN;
  const posteamSpread = home === 1 ? spread : -1 * spread;
  const elapsedShare = (3600 - gameSeconds) / 3600;
  const spreadTime = posteamSpread * Math.exp(-4 * elapsedShare);
  const diffTimeRatio = state.scoreDifferential / Math.exp(-4 * elapsedShare);
  // Column order is nflfastR's wp_spread_model_select (R/helper_add_ep_wp.R).
  return [
    receive2hKo,
    spreadTime,
    home,
    state.halfSecondsRemaining,
    gameSeconds,
    diffTimeRatio,
    state.scoreDifferential,
    state.down,
    state.ydstogo,
    state.yardline100,
    state.posteamTimeoutsRemaining,
    state.defteamTimeoutsRemaining,
  ];
}

/** nflfastR's spread-adjusted win probability (`vegas_wp`) for the possession team. */
export function vegasWinProbability(game: GameContext, state: PlayState): number {
  return modelVegasWinProbability(game, modelState(state));
}

export function modelVegasWinProbability(game: GameContext, state: ModelState): number {
  return wpSpreadModel().predict(wpSpreadFeatures(game, state))[0]!;
}
