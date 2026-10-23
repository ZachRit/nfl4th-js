import {
  isHome,
  modelRoof,
  modelState,
  type GameContext,
  type ModelState,
  type PlayState,
} from './game-state.js';
import { epModel } from './models.js';

// nflfastR's make_model_mutations (R/helper_add_nflscrapr_mutations.R): era
// one-hots by season.
function epFeatures(game: GameContext, state: ModelState): number[] {
  const { season } = game;
  const roof = modelRoof(game.roof);
  // Column order is nflfastR's ep_model_select (R/helper_add_ep_wp.R).
  return [
    state.halfSecondsRemaining,
    state.yardline100,
    isHome(game, state),
    roof === 'retractable' ? 1 : 0,
    roof === 'dome' ? 1 : 0,
    roof === 'outdoors' ? 1 : 0,
    state.ydstogo,
    season <= 2001 ? 1 : 0,
    season > 2001 && season <= 2005 ? 1 : 0,
    season > 2005 && season <= 2013 ? 1 : 0,
    season > 2013 && season <= 2017 ? 1 : 0,
    season > 2017 ? 1 : 0,
    state.down === 1 ? 1 : 0,
    state.down === 2 ? 1 : 0,
    state.down === 3 ? 1 : 0,
    state.down === 4 ? 1 : 0,
    state.posteamTimeoutsRemaining,
    state.defteamTimeoutsRemaining,
  ];
}

/** nflfastR's `calculate_expected_points` (R/ep_wp_calculators.R): the possession team's expected points. */
export function expectedPoints(game: GameContext, state: PlayState): number {
  return modelExpectedPoints(game, modelState(state));
}

export function modelExpectedPoints(game: GameContext, state: ModelState): number {
  const [td, oppTd, fg, oppFg, safety, oppSafety] = epModel().predict(epFeatures(game, state));
  return -3 * oppFg! + -2 * oppSafety! + -7 * oppTd! + 3 * fg! + 2 * safety! + 7 * td!;
}
