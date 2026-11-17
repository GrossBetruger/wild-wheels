# All-time leaderboard

The dedicated server keeps one leaderboard across matches and restarts. For
each player it holds two numbers and nothing else: matches won and matches
played.

## What counts

- A match counts when it finishes, once. A match that is reset or abandoned
  before finishing counts for nobody.
- Everyone who is in the room and not away when it finishes gets one game,
  drivers and bombers alike. Bots and players who are away get nothing.
- Whoever the match ranks first gets one win. If that is a bot, nobody wins.
- Players are told apart by name, whatever its capitals: `Oren` and `oren` are
  one player, shown as last written. Two people using the same name share a
  line, and a player who changes name starts a new one.

## The file

The board is saved to `.wild-wheels/leaderboard.json`, with the server's other
saved state: `run_server.sh` puts it in `WILD_WHEELS_RUN_DIR`, and
`WILD_WHEELS_LEADERBOARD_FILE` names the file outright.

```json
{"players":[{"name":"Oren","wins":3,"games":7},{"name":"Sarah","wins":1,"games":7}]}
```

It is written when a match finishes, away from the game's thread, and again
when the server stops. It holds at most 1000 names; a new name beyond that
replaces the one that has played least. A file the server cannot read as a
board stops the server from starting, so a damaged file is never overwritten;
fix or remove it.

## Seeing it

`GET /api/leaderboard` returns the board, most wins first, then fewest games,
then by name. It needs no session: it holds only names and the two counts.

The browser shows it under the match's own kills and deaths, as
`ALL-TIME · WINS / GAMES`: the top eight, and your own line if you are further
down. The native client shows the top five under its leaderboard. Both fetch it
on arriving and when a match finishes, never during play.

## Checks

- `cargo test --manifest-path dedicated-server/Cargo.toml leaderboard` covers
  counting, names, the file's contents, a damaged file and the limit on names.
  `a_finished_match_counts_one_game_for_each_person_playing_and_a_win_for_the_winner`
  plays whole matches in a room, with and without a bot.
- `tests/ui/all-time.test.js` covers which lines the browser shows and that only
  a well-formed board is shown.
- `npm run test:leaderboard` runs a real server through one whole match, about
  3.5 minutes: a saved board is read at start, the finished match is counted
  once, the file is written as it finishes, and a restart keeps it.
