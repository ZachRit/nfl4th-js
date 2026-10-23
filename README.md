# nfl4th-js

A TypeScript port of [nfl4th](https://github.com/nflverse/nfl4th)'s fourth-down and extra-point models for Node, together with the [nflfastR](https://github.com/nflverse/nflfastR) expected-points and spread-adjusted win-probability models they call. Every function takes plain inputs and needs no database or R installation. On every committed reference case, the outputs match the R packages within 1e-6 (`go_boost` within 1e-4 percentage points).

It ports these pinned versions:

| R package | Version |
| --- | --- |
| nfl4th | 1.0.7 |
| nflfastR | 6.0.0 |
| fastrmodels | 2.1.0 |

`models/versions.json` records the full R session the models were exported from.

## Install

```sh
npm install nfl4th-js
```

The package is ESM only and runs on Node 22 or later. It doesn't run in browsers or edge runtimes: it reads its models from disk with `node:fs`, and they unzip to 88 MB of JSON.

## Usage

Every function takes a `GameContext` and a `PlayState`, which follow nflverse's play-by-play conventions:

```js
import {
  expectedPoints,
  vegasWinProbability,
  fourthDownProbs,
  fourthDownRecommendation,
  twoPointProbs,
  MODEL_VERSION,
} from 'nfl4th-js';

const game = {
  season: 2024,
  seasonType: 'REG', // or 'POST'
  homeTeam: 'KC',
  awayTeam: 'BUF',
  spreadLine: 2.5, // positive: the home team is favored; null if unknown
  totalLine: 47.5, // null if unknown
  roof: 'outdoors', // outdoors | dome | closed | open, or null
  homeOpeningKickoff: false,
};

// BUF, down 3, 4th and 2 at KC's 40 with 5:00 left in the 4th quarter.
const state = {
  posteam: 'BUF',
  qtr: 4,
  quarterSecondsRemaining: 300,
  down: 4,
  ydstogo: 2,
  yardline100: 40, // yards from the opponent's end zone
  scoreDifferential: -3, // posteam minus defteam
  posteamTimeoutsRemaining: 2,
  defteamTimeoutsRemaining: 3,
};
```

### `expectedPoints(game, state)`

nflfastR's `calculate_expected_points`: the expected points of the possession team's next score.

```js
expectedPoints(game, state); // 0.9552473283838481
```

### `vegasWinProbability(game, state)`

nflfastR's spread-adjusted win probability, the `vegas_wp` from `calculate_win_probability`, for the possession team.

```js
vegasWinProbability(game, state); // 0.3372766375541687
```

### `fourthDownProbs(game, state)`

nfl4th's `add_4th_probs` on a single 4th down. It returns `go_boost`, the win probability going for it gains over the better kick, in percentage points. It also returns `go_wp`, `fg_wp` and `punt_wp`, the win probability of each choice, along with the pieces behind them. nfl4th's heuristics are kept as they are, and each one names its R function in a comment in `src/`.

```js
fourthDownProbs(game, state);
// {
//   go_boost: 6.024457177415915,
//   go_wp: 0.34625459484431137,
//   first_down_prob: 0.5744678273404134,
//   wp_succeed: 0.4765132298949547,
//   wp_fail: 0.17040562499895087,
//   fg_make_prob: 0.500586828513016,
//   make_fg_wp: 0.41453322768211365,
//   miss_fg_wp: 0.15718477964401245,
//   fg_wp: 0.2860100230701522,
//   punt_wp: 0.22644513870053437
// }
```

Inside the opponent's 31, `punt_wp` is `null`, because nfl4th's punt table has no rows there. The whole result is `null` wherever nfl4th computes nothing:

- on any down but the 4th
- before 2014
- without a spread or total
- in overtime
- with 15 or fewer game seconds left
- with no possession team

### `fourthDownRecommendation(probs)`

The model's call from a `fourthDownProbs` result. It returns `'go'` when `go_boost` is positive. Otherwise it returns the better kick: a tie goes to the field goal, and a `null` `punt_wp` counts as no punt.

```js
fourthDownRecommendation(fourthDownProbs(game, state)); // 'go'
```

### `twoPointProbs(game, state)`

nfl4th's `add_2pt_probs` on a single try after a touchdown. It returns `conv_1pt` and `conv_2pt`, the chances that the kick and a two-point try succeed. It also returns `wp_go1` and `wp_go2`, the possession team's win probability for each choice. The state is the try itself, with the touchdown already in the score. It's `null` in the same cases as `fourthDownProbs`, except that the down doesn't matter.

```js
twoPointProbs(game, { ...state, yardline100: 2, ydstogo: 2, scoreDifferential: -2 });
// {
//   conv_1pt: 0.940748246698021,
//   conv_2pt: 0.5147400498390198,
//   wp_go1: 0.3245481943672752,
//   wp_go2: 0.33706582968716425
// }
```

### `MODEL_VERSION`

A string that names the models and the computation. It changes whenever a model file or the computation changes, and only then. Stamp values you store with it, and recompute them when it changes.

### Types

`GameContext`, `PlayState`, `FourthDownProbs` and `TwoPointProbs` are exported as TypeScript types.

### Performance

Each model is read and parsed on first use (about half a second for the 4th-down models on a laptop), then kept for the life of the process. After that, each function is pure and synchronous.

## Accuracy

`npm test` checks the port against the R packages' own outputs, committed under `reference/`:

- `state_cases.json` holds nflfastR's expected points and `vegas_wp` for 2,584 states. The states are sampled from real 2014–2025 plays, plus 50 with the roof removed and 50 with the spread removed. Every value matches within 1e-6.
- `two_point_cases.json` holds nfl4th's `add_2pt_probs` on every extra-point try in a fixed set of real games, which `export/export.R` lists. Tries nfl4th skips are included as cases with null outputs. Every value matches within 1e-6.
- `fourth_down_cases.json` holds nfl4th's `add_4th_probs` on every 4th down in the same games. Every probability matches within 1e-6, and `go_boost` matches within 1e-4 percentage points.

The cases are plain JSON, so a port in another language can test against the same files.

## How it works

`models/` holds the five xgboost models nfl4th uses, as gzipped xgboost JSON:

- `ep_model` and `wp_model_spread`, from fastrmodels
- `wp_model`, `fd_model` and `two_pt_model`, from nfl4th

It also holds two lookup tables from nfl4th:

- `fg_table.json`, its field-goal make probability for each `yardline_100` from 1 to 99 at each of its four roof and era levels. The model behind it is a GAM over those two inputs alone, so the table is exact.
- `punt_table.json`, its punt outcomes

`src/xgboost.ts` evaluates a tree ensemble from xgboost's JSON model format the same way xgboost's CPU predictor does:

- Features are cast to float32.
- A missing value follows its node's default direction.
- Margins are summed per class in float32, starting from the intercept.
- Logistic or softmax is applied last.

## Re-exporting the models

The export is run by hand, never in CI. `export/Dockerfile` pins R 4.6.1 by image digest, and pins every CRAN package through a dated Posit Package Manager snapshot. `export/export.R` stops if any pinned version differs. From the repository root:

```sh
docker build --platform linux/amd64 -t nfl4th-js-export export
docker run --rm --platform linux/amd64 -v "$PWD:/out" nfl4th-js-export
```

The run rewrites `models/` and `reference/`, so `git status` shows any change. Two inputs aren't pinned by the image:

- nfl4th downloads `fd_model` and `wp_model` from its unversioned `model_archive` release, so `versions.json` records their SHA-256.
- The reference states come from nflverse's play-by-play releases, which nflverse can rebuild. A play is picked by a hash of its `(game_id, play_id)`, so a rebuild changes the sample only when it changes a sampled play's inputs.

Run with the argument `seasons`, the export instead scores every 4th down and extra-point try from 2014 on with nfl4th's own functions. It writes them to `seasons/nfl4th.parquet` (not committed), so a full run of the port can be compared against nfl4th:

```sh
docker run --rm --platform linux/amd64 -v "$PWD:/out" nfl4th-js-export seasons
```

## Credit

This package is a port. The models and the logic come from:

- [nflfastR](https://github.com/nflverse/nflfastR) (MIT, Sebastian Carl and Ben Baldwin)
- [fastrmodels](https://github.com/nflverse/fastrmodels) (MIT, Sebastian Carl and Ben Baldwin)
- [nfl4th](https://github.com/nflverse/nfl4th) (MIT, Ben Baldwin)

See `NOTICE` for their license terms. Play-by-play data behind the reference cases: [nflverse](https://github.com/nflverse) (CC-BY 4.0).

## License

MIT. See `LICENSE`.
