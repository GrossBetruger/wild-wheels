# Dedicated-server chat persistence

The Rust server saves the latest 200 public and private messages when it receives
SIGTERM or Ctrl-C. `update_server.sh` already stops it with SIGTERM before pulling
and starting the next version. Shutdown drains HTTP requests and closes game
WebSockets before saving. Startup restores messages, replies, deletion markers,
and the message cursor; chat rate-limit timers restart empty.

The launcher stores chat in `$WILD_WHEELS_RUN_DIR/chat.json` (by default
`.wild-wheels/chat.json`). `WILD_WHEELS_CHAT_FILE` can override that path. Direct
binary launches default to `.wild-wheels/chat.json`. Keep this file together with
`sessions.json`: private ownership uses persistent identities, never names or
reusable player slots. Replies sent to browsers map identities to current slots;
the browser refreshes retained history when the roster changes.

Writes use an owner-only temporary file, sync it, and atomically replace the
previous snapshot. Loading is limited to 2 MiB and validates identities, message
counts, cursors, and text lengths. Invalid data stops startup without overwriting
the file. The static asset allowlist does not expose chat or session files.
Anyone with filesystem access as the server user can read the saved chat.

This is graceful-shutdown persistence, not a crash journal: SIGKILL, power loss,
or a crash can lose messages since the last successful shutdown. The first update
from a version without this feature cannot preserve its existing in-memory chat.

Validation: Rust chat tests cover saving/reloading, hostile-looking text, changed
slots, private-message isolation, ownership, replies, deletion, file permissions,
and invalid/oversized files. `npm run test:server-commands` exercises an actual
web-triggered update, session restoration in a different order, and retained
public/private messages without exposing private messages to a same-name stranger.
