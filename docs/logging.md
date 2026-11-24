# Problem log

The dedicated server keeps one log of what went wrong, and of what happened in
each match, for itself and for every client. Browsers and native clients report
their own problems to it, so one place answers "what was happening when that
player's game froze, slowed or showed something wrong".

## Where it is and how long it lasts

Files are in `.wild-wheels/logs/`, with the server's other saved state:
`run_server.sh` puts them in the `logs` folder of `WILD_WHEELS_RUN_DIR`, and
`WILD_WHEELS_LOG_DIR` names the folder outright. Each UTC day has two files of
one JSON object per line:

| File | Holds |
| --- | --- |
| `2026-11-18.server.jsonl` | What the server saw: connections, refusals, match events, its own timing. |
| `2026-11-18.clients.jsonl` | What players' browsers and native clients reported. |
| `read-key` | The key for reading the log over HTTP. Not a log. |

A day's files are kept for 30 days after that day and deleted on the next, just
after midnight UTC or when the server next starts if it was not running then.
Files the log did not write are left alone.

The folder cannot outgrow a small disk. Each day the server's file stops at
3 MiB and the clients' file at 1 MiB, so 31 days hold at most about 124 MiB;
`WILD_WHEELS_LOG_DAILY_BYTES` sets the two together (three parts server, one
part clients). When a file reaches its limit it says so once
(`log-limit-reached`), and the next day's file says how many lines were left out
(`log-limit-summary`). The two limits are separate so players' reports cannot
crowd out the server's own lines.

Three more limits keep one noisy problem from using the day's space:

- A line longer than 2 KiB keeps only the start of its details (`truncated`).
- More than 30 lines of one event in a minute are counted, not written
  (`log-repeats`).
- If lines arrive faster than the disk takes them, the excess is counted
  (`log-queue-full`).

## What it costs the game

- **Server.** Noting a line never waits: it is queued in memory and a separate
  thread writes about once a second. Reading the log reads files on a blocking
  thread, not the game's. Game events are found by comparing a few flags per
  racer each tick.
- **Network.** Clients send reports over ordinary HTTP, never over the game
  socket, at most one request every 15 seconds and only when something waits. A
  request carries at most 32 reports and 7 KB. The server accepts 6 report
  requests per 10 seconds from one address and 8 KiB per request.
- **Clients.** A problem that repeats is counted, not queued again. At most 40
  reports wait and a visit or run sends at most 400. Frame times are kept for a
  minute and reported only if the minute was slow.

## Reading it

`GET /logz` needs the reading key as a bearer token (`GET /logz/all` is public). The key is made the first
time the server starts and saved in `read-key` with the log, readable only by
the server's own user; `LOG_READ_KEY` (32 characters or more) sets it instead.

```sh
KEY=$(cat .wild-wheels/logs/read-key)
curl -H "Authorization: Bearer $KEY" 'http://localhost:5173/logz'
curl -H "Authorization: Bearer $KEY" 'http://localhost:5173/logz?day=today&level=error'
```

Without `day` the reply lists the days on disk and their sizes. With `day`
(`today` or `YYYY-MM-DD`) it returns that day's matching lines, oldest first:

| Query | Keeps lines |
| --- | --- |
| `source` | from `server`, `browser`, `bevy-wasm`, `native` or `log` |
| `level` | at `error`, `warn` or `info` |
| `event` | with exactly this event name |
| `contains` | containing this text anywhere |
| `limit` | the newest this many (default 200, at most 2000) |

A misspelled query name is an error, not an empty answer. The endpoint allows
30 requests a minute from one address.

### Collecting everything

`GET /logz/all` is public and returns every kept day in one download: one JSON object per
line, both files of each day merged in the order things happened, oldest day
first.

```sh
curl -o wild-wheels-log.jsonl 'http://localhost:5173/logz/all'
curl 'http://localhost:5173/logz/all?days=2&level=error' | jq .
```

`days` keeps only the latest that many days (1–31); `source`, `level`, `event`
and `contains` filter as above. There is no `day` or `limit`. The server reads
and sends one day at a time, so the whole log, about 124 MiB at most, is never
held in memory and the game's thread never reads a file. It is sent
uncompressed. The endpoint allows 4 requests a minute from one address.

## What is in a line

Every line has `t` (UTC, when the server wrote it), `source`, `level` and
`event`. A client's line also has `who` (the player's seat, name and racer),
`build`, `agoMs` (how long it waited before being sent), `happened` (`t` less
that wait), `count` when the same problem repeated, and `data`.

Sessions, the reading key, invitation secrets, network addresses and chat are
never logged. Player names and whatever text a client's error carries are.

### From the server

| Event | Means |
| --- | --- |
| `server-start`, `server-stop`, `panic` | The server's own life. |
| `request` | A room request that changed who plays or how: join, return, leave, away, racer, name, color, start, arena, bots. |
| `request-refused` | A room request the server refused, with its status and message. |
| `socket-open`, `socket-refused` | A game connection signed in, or could not. |
| `socket-closed` | A game connection ended, with `reason`. When the server refused an input, `detail` holds the input's sequence numbers and what the server held, at level `error`. |
| `player-away`, `player-expired` | A player was not heard from for 15 seconds, or for 15 minutes. |
| `match-phase` | The match moved between ready, countdown, racing and finished, with its players. |
| `game-ability` | An ability, Nightmare Fuel, Ring of Fire or rapid fire: `state` is `start`, `end`, or `used` for one with no duration. |
| `game-kill` | Who defeated whom, and with what. |
| `server-minute` | Once a minute while anyone is in the room: tick cost (median, 99th percentile, longest), late ticks, the longest gap between ticks, the most projectiles, effects and particles in flight, and each player's inputs and longest queue of waiting moves. |
| `tick-slow` | One tick took longer than a frame. |

### From clients

| Event | Means |
| --- | --- |
| `js-error`, `js-rejection` | An uncaught error in the browser, with where and its stack. |
| `graphics-lost` | The browser lost its WebGL context. |
| `socket-closed`, `socket-message-invalid`, `reconnect-failed` | The browser's connection ended, received something it could not use, or could not return. |
| `connection-lost`, `connected`, `connection-ended` | The native client's connection, with the reason it dropped. |
| `packet-invalid`, `prediction-failed` | The native client could not use a snapshot or advance its prediction. |
| `crashed-last-run` | The native client crashed last time; reported on the next start. |
| `racer-not-drawn` | A racer who is in the match left nothing on screen: a position or angle that is not a number, or a model that drew nothing. Includes the racer's state. |
| `model-not-finite` | The browser was asked to draw a model at a position that is not a number. |
| `owl-visibility` | Press F8 (Fn+F8 on some Macs) in the affected multiplayer browser when a human opponent's owl disappears. Records the match clock, fog, owl state, owned projectile count and whether its body was submitted in the latest frame. For a submitted body, compare expected and allocated WebGL buffer bytes. A matching size establishes allocation only. Captures are limited to one per browser per 30 seconds and sent with the normal client-log batch. |
| `slow-minute` | A minute with a 95th-percentile frame over 40 ms, ten frames over 50 ms, or a second without news from the server. |
| `match-frames` | One line per finished match: frames, long frames, the longest frame and wait. |
| `reports-dropped` | The client had more to report than it is allowed to send. |

3D Bevy Beta reports as `bevy-wasm` when playing online on the dedicated server.
It reports the same `slow-minute` and `match-frames` metrics, including server
snapshot gaps and ping. `bevy-startup` records WASM and graphics load times and
time to the first Bevy frame. `bevy-mobile-performance` records the active mobile
quality, Bevy FPS, target FPS and canvas size. `bevy-mobile-quality` records a
quality change and the FPS that triggered it. `bevy-startup-failed`,
`bevy-frame-invalid`, and `bevy-frame-failed` identify renderer failures. Use
`source=bevy-wasm` to find these reports.
Server socket events include the connection's reported `client` label. Older
clients that omit it appear as `unknown`.

```sh
curl 'http://localhost:5173/logz/all?days=1&source=bevy-wasm'
```

## Setting a client's slowdown beside the match

Game lines and clients' slow frames carry the same clock: `match` (which match)
and `matchSeconds` (seconds into it). A `slow-minute` has `match`,
`fromMatchSeconds`, `toMatchSeconds` and `slowest`, its eight longest frames as
`[matchSeconds, milliseconds]`.

To ask whether Dark Humor slows a player down:

```sh
curl -H "Authorization: Bearer $KEY" 'http://localhost:5173/logz?day=today&event=slow-minute&limit=2000'
curl -H "Authorization: Bearer $KEY" 'http://localhost:5173/logz?day=today&event=game-ability&contains=Dark%20Humor&limit=2000'
```

A slow frame at `[41.3, 180]` in match 12 was drawn while Dark Humor was on if
match 12 has a Dark Humor `start` at or before 41.3 and its `end` after. The
client shows the match about a tenth of a second late, so allow that much.
`server-minute` for the same match says whether the server was slow too and how
much was in flight.

## Checks

- `cargo test --manifest-path dedicated-server/Cargo.toml logs` covers the
  30-day rule, the daily limits, repeats, line length, the reading key,
  queries and collecting everything in order. `abilities_and_match_phases_are_noted_with_the_match_clock` covers
  game lines.
- `tests/client/log.test.js` and `cargo test --lib reports` (native client)
  cover counting repeats, the limits on what a client sends, and which minutes
  count as slow.
- `npm run test:logging` runs a real server and checks the whole path: who may
  write, who may read, that a refused input is explained, that no session or key
  reaches the log, and that the native client reports. It needs the release
  server; the native client is included when its release build exists.
