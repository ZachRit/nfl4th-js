// The plain inputs every model takes, read from a play and its game.

export interface GameContext {
  season: number;
  seasonType: 'REG' | 'POST';
  homeTeam: string; // same team-code convention as PlayState.posteam
  awayTeam: string;
  spreadLine: number | null; // nflverse convention: positive means the home team is favored
  totalLine: number | null;
  roof: string | null; // nflverse values: outdoors | dome | closed | open (null is treated as retractable, as nfl4th does)
  homeOpeningKickoff: boolean;
}

export interface PlayState {
  posteam: string;
  qtr: number;
  quarterSecondsRemaining: number;
  down: number;
  ydstogo: number;
  yardline100: number;
  scoreDifferential: number; // posteam minus defteam
  posteamTimeoutsRemaining: number;
  defteamTimeoutsRemaining: number;
}

// The state the nflfastR models score, with the clock held as nflfastR's
// half_seconds_remaining and game_seconds_remaining. nfl4th moves the clock of
// a hypothetical state directly, so the quarter alone no longer derives it.
export interface ModelState {
  posteam: string;
  qtr: number;
  halfSecondsRemaining: number;
  gameSecondsRemaining: number;
  down: number;
  ydstogo: number;
  yardline100: number;
  scoreDifferential: number;
  posteamTimeoutsRemaining: number;
  defteamTimeoutsRemaining: number;
}

// nfl4th's prepare_df (R/helpers.R).
export function modelState(state: PlayState): ModelState {
  const halfSecondsRemaining =
    state.qtr === 2 || state.qtr === 4
      ? state.quarterSecondsRemaining
      : state.quarterSecondsRemaining + 900;
  return {
    posteam: state.posteam,
    qtr: state.qtr,
    halfSecondsRemaining,
    gameSecondsRemaining: state.qtr <= 2 ? halfSecondsRemaining + 1800 : halfSecondsRemaining,
    down: state.down,
    ydstogo: state.ydstogo,
    yardline100: state.yardline100,
    scoreDifferential: state.scoreDifferential,
    posteamTimeoutsRemaining: state.posteamTimeoutsRemaining,
    defteamTimeoutsRemaining: state.defteamTimeoutsRemaining,
  };
}

// nflfastR's make_model_mutations (R/helper_add_nflscrapr_mutations.R), and
// nfl4th's get_games_file (R/helpers.R): a roof that is null, open or closed
// counts as retractable.
export function modelRoof(roof: string | null): string {
  return roof === null || roof === 'open' || roof === 'closed' ? 'retractable' : roof;
}

// nflfastR's make_model_mutations (R/helper_add_nflscrapr_mutations.R).
export function isHome(game: GameContext, state: Pick<ModelState, 'posteam'>): number {
  return state.posteam === game.homeTeam ? 1 : 0;
}
