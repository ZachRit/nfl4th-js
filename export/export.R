# Exports every model and table nfl4th-js evaluates, plus the reference cases
# its tests check against. Run by hand through the Dockerfile beside this
# script (see the README); it writes into /out, the repository root.
# Run with the argument `seasons`, it writes only the whole-season scores below.

suppressPackageStartupMessages({
  library(dplyr)
})

out_dir <- "/out"
models_dir <- file.path(out_dir, "models")
reference_dir <- file.path(out_dir, "reference")
dir.create(models_dir, showWarnings = FALSE)
dir.create(reference_dir, showWarnings = FALSE)

# The versions this export is pinned to. A rebuilt image that resolves any
# other version stops here rather than writing different files.
pinned <- c(
  nfl4th = "1.0.7",
  nflfastR = "6.0.0",
  fastrmodels = "2.1.0",
  nflreadr = "1.5.1",
  xgboost = "3.2.1.1",
  jsonlite = "2.0.0",
  nanoparquet = "0.5.2",
  mgcv = "1.9.4"
)
for (pkg in names(pinned)) {
  got <- as.character(packageVersion(pkg))
  if (got != pinned[[pkg]]) {
    stop(sprintf("%s is %s, the export is pinned to %s", pkg, got, pinned[[pkg]]))
  }
}
if (getRversion() != "4.6.1") stop("R is ", getRversion(), ", the export is pinned to 4.6.1")

write_json <- function(x, path) {
  jsonlite::write_json(x, path, auto_unbox = TRUE, digits = NA, na = "null", null = "null")
}

# ---- whole seasons ----------------------------------------------------------

# `seasons` mode scores every 4th down and extra-point try from 2014 through
# the latest season with nfl4th's own wrappers, to check a full run of the
# port against, and writes only seasons/nfl4th.parquet, keyed on (game_id,
# play_id). The plays are picked as the decision cases below pick them; nfl4th
# leaves the ones it skips null.
if (identical(commandArgs(trailingOnly = TRUE), "seasons")) {
  seasons_dir <- file.path(out_dir, "seasons")
  dir.create(seasons_dir, showWarnings = FALSE)
  # nflreadr memoises every season it loads, which 13 seasons of pbp outgrow.
  options(nflreadr.cache = "off")
  scored <- lapply(2014:nflreadr::most_recent_season(), function(season) {
    pbp <- nflreadr::load_pbp(season) |> as.data.frame()
    fourth <- nfl4th::add_4th_probs(pbp |> filter(down == 4)) |>
      select(
        game_id, play_id, go_boost, go_wp, fg_wp, punt_wp, first_down_prob, wp_succeed,
        wp_fail, fg_make_prob, make_fg_wp, miss_fg_wp
      )
    tries <- nfl4th::add_2pt_probs(pbp |> filter(!is.na(extra_point_result) | !is.na(two_point_conv_result))) |>
      select(game_id, play_id, conv_1pt, conv_2pt, wp_go1, wp_go2)
    full_join(fourth, tries, by = c("game_id", "play_id")) |> mutate(season = as.integer(season))
  }) |>
    bind_rows() |>
    mutate(play_id = as.integer(play_id)) |>
    arrange(game_id, play_id)
  if (anyDuplicated(scored[c("game_id", "play_id")])) stop("a play is scored twice")
  nanoparquet::write_parquet(scored, file.path(seasons_dir, "nfl4th.parquet"))
  quit(save = "no")
}

# ---- xgboost models ---------------------------------------------------------

# Each booster is saved in xgboost's JSON model format, then gzipped with no
# name or timestamp in the header so the bytes depend only on the model.
save_booster <- function(booster, name) {
  path <- file.path(models_dir, paste0(name, ".json"))
  xgboost::xgb.save(booster, path)
  system2("gzip", c("-9nf", path))
}

save_booster(nflfastR:::load_model("ep"), "ep_model")
save_booster(nflfastR:::load_model("wp_spread"), "wp_model_spread")
# nfl4th downloads these two from its model_archive release on first use.
save_booster(nfl4th:::wp_model(), "wp_model")
save_booster(nfl4th:::fd_model(), "fd_model")
save_booster(xgboost::xgb.load.raw(nfl4th:::two_pt_model), "two_pt_model")

# ---- lookup tables ----------------------------------------------------------

# nfl4th's field-goal model is an mgcv GAM over an integer yard line and a
# 4-level factor (outdoors flag, then 2020+ flag), so a table of its response
# at every yard line is exact.
fg_levels <- levels(nfl4th:::fg_model$model$fg_model_roof)
fg_table <- lapply(fg_levels, function(level) {
  newdata <- data.frame(
    yardline_100 = 1:99,
    fg_model_roof = factor(level, levels = fg_levels)
  )
  as.numeric(mgcv::predict.bam(nfl4th:::fg_model, newdata = newdata, type = "response"))
})
names(fg_table) <- fg_levels
write_json(list(yardline100 = 1:99, makeProb = fg_table), file.path(models_dir, "fg_table.json"))

punt <- nfl4th:::punt_df |>
  as.data.frame() |>
  transmute(
    yardline100 = as.integer(yardline_100),
    yardlineAfter = as.integer(yardline_after),
    pct,
    muff = as.integer(muff)
  )
write_json(punt, file.path(models_dir, "punt_table.json"))

# ---- state-level reference cases --------------------------------------------

# States sampled from real 2014-2025 plays. A play is chosen by a hash of its
# (game_id, play_id) rather than by row position, so the sample doesn't move
# when nflverse adds or drops other plays.
state_columns <- c(
  "game_id", "play_id", "season", "season_type", "home_team", "away_team",
  "spread_line", "total_line", "roof", "home_opening_kickoff", "posteam", "qtr",
  "quarter_seconds_remaining", "down", "ydstogo", "yardline_100",
  "score_differential", "posteam_timeouts_remaining", "defteam_timeouts_remaining"
)
sample_every <- 200L
states <- lapply(2014:2025, function(season) {
  nflreadr::load_pbp(season) |>
    as.data.frame() |>
    select(all_of(state_columns)) |>
    filter(
      !is.na(posteam), posteam != "", qtr <= 4, !is.na(quarter_seconds_remaining),
      !is.na(down), !is.na(ydstogo), !is.na(yardline_100), !is.na(score_differential),
      !is.na(posteam_timeouts_remaining), !is.na(defteam_timeouts_remaining)
    ) |>
    filter(strtoi(substr(cli::hash_md5(paste(game_id, play_id)), 1, 7), 16L) %% sample_every == 0L)
}) |>
  bind_rows() |>
  arrange(game_id, play_id)

roofs <- unique(states$roof)
if (!all(c("outdoors", "dome", "closed", "open") %in% roofs)) stop("the sample misses a roof value")
if (!all(c(1, 2, 3, 4) %in% states$qtr)) stop("the sample misses a quarter")
if (!all(c(2014, 2025) %in% states$season)) stop("the sample misses an era")

# Two slices of the sample again with an input removed. pbp fills roof on every
# play, so the no-roof slice checks nflfastR's NA-is-retractable rule; the
# no-spread slice checks a missing feature's default direction through vegas_wp.
states <- bind_rows(
  states |> mutate(variant = "sampled"),
  states |> slice_head(n = 50) |> mutate(roof = NA_character_, variant = "no_roof"),
  states |> slice_head(n = 50) |> mutate(spread_line = NA_real_, variant = "no_spread")
)

# The nflfastR inputs, derived the way nfl4th derives them before calling
# nflfastR (prepare_df in R/helpers.R, calculate_win_probability in
# R/apply_win_prob.R).
model_inputs <- states |>
  mutate(
    half_seconds_remaining = if_else(qtr == 2 | qtr == 4, quarter_seconds_remaining, quarter_seconds_remaining + 900),
    game_seconds_remaining = if_else(qtr <= 2, half_seconds_remaining + 1800, half_seconds_remaining),
    receive_2h_ko = case_when(
      qtr <= 2 & home_opening_kickoff == 1 & posteam == away_team ~ 1,
      qtr <= 2 & home_opening_kickoff == 0 & posteam == home_team ~ 1,
      TRUE ~ 0
    )
  )

ep <- nflfastR::calculate_expected_points(model_inputs)$ep
vegas_wp <- nflfastR::calculate_win_probability(model_inputs)$vegas_wp

cases <- lapply(seq_len(nrow(states)), function(i) {
  s <- states[i, ]
  list(
    gameId = s$game_id,
    playId = s$play_id,
    variant = s$variant,
    game = list(
      season = s$season,
      seasonType = s$season_type,
      homeTeam = s$home_team,
      awayTeam = s$away_team,
      spreadLine = s$spread_line,
      totalLine = s$total_line,
      roof = s$roof,
      homeOpeningKickoff = s$home_opening_kickoff == 1
    ),
    state = list(
      posteam = s$posteam,
      qtr = s$qtr,
      quarterSecondsRemaining = s$quarter_seconds_remaining,
      down = s$down,
      ydstogo = s$ydstogo,
      yardline100 = s$yardline_100,
      scoreDifferential = s$score_differential,
      posteamTimeoutsRemaining = s$posteam_timeouts_remaining,
      defteamTimeoutsRemaining = s$defteam_timeouts_remaining
    ),
    expectedPoints = ep[[i]],
    vegasWinProbability = vegas_wp[[i]]
  )
})
write_json(cases, file.path(reference_dir, "state_cases.json"))

# ---- decision-level reference cases -----------------------------------------

# A fixed set of real games, scored whole by nfl4th's own wrappers. Between
# them they cover both eras of each model (2014-2017 and 2018 on for the
# expected-points and two-point models, before and from 2020 for field goals),
# all four roof types, a playoff game, an end-of-half try and 4th down, a late
# one-score game, a game from the OAK, SD or STL era, and the 4th downs the
# checks below name.
decision_games <- c(
  "2015_05_IND_HOU", # closed
  "2015_06_SD_GB", # outdoors, SD era, extra-point try at the end of the 1st half
  "2015_09_DEN_IND", # open, extra-point try at the end of the 1st half
  "2018_16_MIN_DET", # dome, 2018-2019
  "2023_01_HOU_BAL", # 4th down with 5 seconds left in the 1st half
  "2023_02_GB_ATL", # punt from the opponent's 38
  "2023_03_LAC_MIN", # kneel-out after a conversion with 1:51 left
  "2023_05_PHI_LA", # dome, 2020 on
  "2023_12_BUF_PHI", # outdoors, go-ahead touchdown with 1:52 left, field goal beyond 58 yards
  "2023_18_PIT_BAL", # 4th down with 2:03 left that the runoff brings inside the kneel-out
  "2023_19_GB_DAL" # closed, playoff, extra-point try at the end of the 1st half
)
decision_pbp <- lapply(unique(as.integer(substr(decision_games, 1, 4))), function(season) {
  nflreadr::load_pbp(season) |>
    as.data.frame() |>
    filter(game_id %in% decision_games)
}) |>
  bind_rows() |>
  arrange(game_id, play_id)
if (!setequal(unique(decision_pbp$game_id), decision_games)) stop("a decision game has no pbp")

# The game context is read from pbp, as a caller of the port reads it. nfl4th
# takes the lines and roof from its own schedule file instead, so check they
# agree.
nfl4th_games <- nfl4th:::.games_nfl4th()
schedule <- nflreadr::load_schedules() |> filter(game_id %in% decision_games)
context <- decision_pbp |>
  distinct(game_id, season, season_type, home_team, away_team, spread_line, total_line, roof) |>
  mutate(type = if_else(season_type == "REG", "reg", "post")) |>
  left_join(
    nfl4th_games |> select(home_team, away_team, type, season, nfl4th_spread = spread_line, nfl4th_total = total_line),
    by = c("home_team", "away_team", "type", "season")
  ) |>
  left_join(schedule |> select(game_id, schedule_roof = roof), by = "game_id")
if (nrow(context) != length(decision_games)) stop("a decision game has more than one context")
if (any(context$spread_line != context$nfl4th_spread | context$total_line != context$nfl4th_total | context$roof != context$schedule_roof)) {
  stop("a decision game's pbp lines or roof differ from nfl4th's schedule")
}

two_point <- decision_pbp |>
  filter(!is.na(extra_point_result) | !is.na(two_point_conv_result))
if (!all(c("outdoors", "dome", "closed", "open") %in% two_point$roof)) stop("the tries miss a roof value")
if (!all(c(2017, 2018, 2020) %in% cut(two_point$season, c(0, 2017, 2019, Inf), labels = c(2017, 2018, 2020)))) {
  stop("the tries miss a model era")
}
if (!any(two_point$qtr == 2 & two_point$quarter_seconds_remaining == 0)) stop("no end-of-half try")
if (!any(two_point$season_type == "POST")) stop("no playoff try")
two_point_probs <- nfl4th::add_2pt_probs(two_point)

# Every try in the games is a case, so the tries nfl4th skips (overtime, the
# last 15 seconds) are cases with null outputs.
two_point_cases <- lapply(seq_len(nrow(two_point_probs)), function(i) {
  s <- two_point_probs[i, ]
  computed <- !is.na(s$wp_go1)
  list(
    gameId = s$game_id,
    playId = s$play_id,
    game = list(
      season = s$season,
      seasonType = s$season_type,
      homeTeam = s$home_team,
      awayTeam = s$away_team,
      spreadLine = s$spread_line,
      totalLine = s$total_line,
      roof = s$roof,
      homeOpeningKickoff = s$home_opening_kickoff == 1
    ),
    # pbp leaves down missing on a try; prepare_df scores every play as a 4th
    # down, so the case says 4.
    state = list(
      posteam = s$posteam,
      qtr = s$qtr,
      quarterSecondsRemaining = s$quarter_seconds_remaining,
      down = 4L,
      ydstogo = s$ydstogo,
      yardline100 = s$yardline_100,
      scoreDifferential = s$score_differential,
      posteamTimeoutsRemaining = s$posteam_timeouts_remaining,
      defteamTimeoutsRemaining = s$defteam_timeouts_remaining
    ),
    twoPointProbs = if (computed) {
      list(conv_1pt = s$conv_1pt, conv_2pt = s$conv_2pt, wp_go1 = s$wp_go1, wp_go2 = s$wp_go2)
    } else {
      NULL
    }
  )
})
write_json(two_point_cases, file.path(reference_dir, "two_point_cases.json"))

fourth <- decision_pbp |> filter(down == 4)
if (!any(fourth$goal_to_go == 1)) stop("no goal-to-go 4th down")
if (!any(fourth$field_goal_attempt == 1 & fourth$yardline_100 > 40)) stop("no field goal beyond 58 yards")
if (!any(fourth$punt_attempt == 1 & fourth$yardline_100 < 40)) stop("no punt from inside the opponent's 40")
if (!any(fourth$play_type == "no_play")) stop("no 4th-down no-play")
fourth_probs <- nfl4th::add_4th_probs(fourth)
computed <- fourth_probs |> filter(!is.na(go_wp))
if (!any(computed$qtr == 2 & computed$quarter_seconds_remaining <= 6)) stop("no end-of-half 4th down")
# The kneel-out rules: after a conversion, after a failure, and one that the
# 6-second runoff brings into reach.
if (!any(computed$wp_succeed == 1)) stop("no kneel-out after a conversion")
if (!any(computed$wp_fail == 0)) stop("no kneel-out after a failure")
if (!any(computed$make_fg_wp == 0 & computed$game_seconds_remaining >= 120)) {
  stop("no kneel-out the runoff brings into reach")
}

# Every 4th down in the games is a case, so the ones nfl4th skips are cases
# with null outputs. playType records what the team did, which the outputs
# don't depend on, so the tests can check the set covers it.
num_or_null <- function(x) if (is.na(x)) NULL else x
fourth_down_cases <- lapply(seq_len(nrow(fourth_probs)), function(i) {
  s <- fourth_probs[i, ]
  list(
    gameId = s$game_id,
    playId = s$play_id,
    playType = s$play_type,
    game = list(
      season = s$season,
      seasonType = s$season_type,
      homeTeam = s$home_team,
      awayTeam = s$away_team,
      spreadLine = s$spread_line,
      totalLine = s$total_line,
      roof = s$roof,
      homeOpeningKickoff = s$home_opening_kickoff == 1
    ),
    state = list(
      posteam = s$posteam,
      qtr = s$qtr,
      quarterSecondsRemaining = s$quarter_seconds_remaining,
      down = s$down,
      ydstogo = s$ydstogo,
      yardline100 = s$yardline_100,
      scoreDifferential = s$score_differential,
      posteamTimeoutsRemaining = s$posteam_timeouts_remaining,
      defteamTimeoutsRemaining = s$defteam_timeouts_remaining
    ),
    fourthDownProbs = if (!is.na(s$go_wp)) {
      list(
        go_boost = s$go_boost,
        go_wp = s$go_wp,
        fg_wp = s$fg_wp,
        punt_wp = num_or_null(s$punt_wp),
        first_down_prob = s$first_down_prob,
        wp_succeed = s$wp_succeed,
        wp_fail = s$wp_fail,
        fg_make_prob = s$fg_make_prob,
        make_fg_wp = s$make_fg_wp,
        miss_fg_wp = s$miss_fg_wp
      )
    } else {
      NULL
    }
  )
})
write_json(fourth_down_cases, file.path(reference_dir, "fourth_down_cases.json"))

# ---- provenance -------------------------------------------------------------

# The model_archive release assets aren't versioned, so their hashes are
# recorded: a re-export that changes fd_model or wp_model shows why here.
versions <- list(
  r = as.character(getRversion()),
  packages = as.list(sapply(names(pinned), function(p) as.character(packageVersion(p)))),
  cranSnapshot = Sys.getenv("CRAN_SNAPSHOT"),
  modelArchiveSha256 = list(
    fd_model = cli::hash_raw_sha256(nfl4th:::load_fd_model()),
    wp_model = cli::hash_raw_sha256(nfl4th:::load_wp_model())
  )
)
write_json(versions, file.path(models_dir, "versions.json"))
