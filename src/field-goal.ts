import type { GameContext } from './game-state.js';
import { fgTable } from './models.js';

// nfl4th's fg_model (an mgcv GAM) at a yard line, read from the exported
// table. Its roof level is get_games_file's fg_model_roof (R/helpers.R): 1 for
// an outdoors roof, else 0, followed by 1 from 2020 on, else 0.
export function fgMakeProbability(game: GameContext, yardline100: number): number {
  const level = `${game.roof === 'outdoors' ? 1 : 0}${game.season >= 2020 ? 1 : 0}` as const;
  const table = fgTable();
  return table.makeProb[level][table.yardline100.indexOf(yardline100)]!;
}
