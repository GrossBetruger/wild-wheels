# All-time leaderboard

The dedicated server keeps one leaderboard across matches and restarts. For
each player it holds three numbers and nothing else: matches won, matches
played and an Elo rating.

## What counts

- A match counts when it finishes, once. A match that is reset or abandoned
  before finishing counts for nobody.
- Everyone who is in the room and not away when it finishes gets one game,
  drivers and bombers alike. Bots and players who are away get nothing.
- Whoever the match ranks first gets one win. If that is a bot, nobody wins.
- Players are told apart by name, whatever its capitals: `Oren` and `oren` are
  one player, shown as last written. Two people using the same name share a
  line, and a player who changes name starts a new one.

## Rating

Everyone starts at 1000. When a match finishes, the people driving in it are
rated against each other; bots, bombers and players who are away are not rated
and do not affect anyone's rating.

- Each pair of drivers is compared by score: more kills wins, then fewer
  deaths, and equal on both is a draw. Seat order never decides it, so two
  level players can draw even though the match names one of them the winner.
- Against each opponent a player gains or loses the difference between that
  result and what the two ratings predicted. A rating 400 above another's is
  expected to win ten times in eleven, so beating a much weaker player earns
  little and losing to one costs a lot.
- The total is scaled so one match moves a rating by at most 16 however many
  played: between two level players the winner takes 16 points from the loser.
  What some gain the others lose.
- A driver alone in a match, or alone among bots, keeps their rating.

Ratings are kept to one decimal place and shown as whole numbers.

## The file

The board is saved to `.wild-wheels/leaderboard.json`, with the server's other
saved state: `run_server.sh` puts it in `WILD_WHEELS_RUN_DIR`, and
`WILD_WHEELS_LEADERBOARD_FILE` names the file outright.

```json
{"players":[{"name":"Oren","wins":3,"games":7,"rating":1031.5},{"name":"Sarah","wins":1,"games":7,"rating":968.5}]}
```

A file saved before ratings existed is still read: its counts are kept and
everyone in it starts at 1000.

It is written when a match finishes, away from the game's thread, and again
when the server stops. It holds at most 1000 names; a new name beyond that
replaces the one that has played least. A file the server cannot read as a
board stops the server from starting, so a damaged file is never overwritten;
fix or remove it.

## Seeing it

`GET /api/leaderboard` returns the board, highest rating first, then most wins,
fewest games, and by name. It needs no session: it holds only names and the
three numbers.

The browser shows it under the match's own kills and deaths, as
`ALL-TIME · RATING · WINS / GAMES`: the top eight, and your own line if you are
further down. The native client shows the top five under its leaderboard. Both fetch it
on arriving and when a match finishes, never during play.

## Checks

- `cargo test --manifest-path dedicated-server/Cargo.toml leaderboard` covers
  counting, names, ratings between two and four players, upsets, draws, a lone
  driver, the file's contents, a file from before ratings, a damaged file and
  the limit on names.
  `a_finished_match_counts_one_game_for_each_person_playing_and_a_win_for_the_winner`
  plays whole matches in a room, with and without a bot, and checks the two
  people are rated against each other by their scores.
- `tests/ui/all-time.test.js` covers which lines the browser shows and that only
  a well-formed board is shown.
- `npm run test:leaderboard` runs a real server through one whole match, about
  3.5 minutes: a saved board is read at start, the finished match is counted
  once, the file is written as it finishes, and a restart keeps it.
