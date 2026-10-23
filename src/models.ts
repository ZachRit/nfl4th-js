import { readFileSync } from 'node:fs';
import { loadBooster, type Booster } from './xgboost.js';

// Each model is read on its first use and kept for the life of the process.
function lazy<T>(load: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= load());
}

const modelFile = (file: string) => new URL(`../models/${file}`, import.meta.url);
const booster = (file: string) => lazy<Booster>(() => loadBooster(modelFile(file)));

export const epModel = booster('ep_model.json.gz');
export const wpSpreadModel = booster('wp_model_spread.json.gz');
export const wpModel = booster('wp_model.json.gz');
export const fdModel = booster('fd_model.json.gz');
export const twoPointModel = booster('two_pt_model.json.gz');

// nfl4th's field-goal make probability at each yard line from 1 to 99, keyed
// by its fg_model_roof level: the outdoors flag, then the 2020-on flag.
interface FgTable {
  yardline100: number[];
  makeProb: Record<'00' | '01' | '10' | '11', number[]>;
}

export const fgTable = lazy(
  () => JSON.parse(readFileSync(modelFile('fg_table.json'), 'utf8')) as FgTable,
);

// nfl4th's punt_df: where a punt from each yard line ends up, from the
// receiving team's view, with the chance of each outcome and whether the
// receiver muffs it. Yard lines inside the 31 have no rows.
export interface PuntOutcome {
  yardline100: number;
  yardlineAfter: number;
  pct: number;
  muff: number;
}

export const puntTable = lazy(() => {
  const rows = JSON.parse(readFileSync(modelFile('punt_table.json'), 'utf8')) as PuntOutcome[];
  const byYardline = new Map<number, PuntOutcome[]>();
  for (const r of rows) {
    const outcomes = byYardline.get(r.yardline100) ?? [];
    outcomes.push(r);
    byYardline.set(r.yardline100, outcomes);
  }
  return byYardline;
});
