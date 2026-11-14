# Persistent dedicated-server health statistics

`GET /statsz` returns three independent views of the retained history:

- `total`: grand total across every recorded commit and date.
- `byCommit`: one aggregate per full Git commit embedded in the running binary.
- `byDate`: one aggregate per UTC calendar date (`YYYY-MM-DD`), spanning commits.

`currentCommit` and `build` identify the running executable. A build made without
Git metadata uses a `build:<content hash>` key instead of a commit key. Changing
the checkout while a server is running never reassigns its ticks to another commit.

Each aggregate contains ticks, scheduling overruns, mean and maximum tick
execution time in microseconds, historical p99 upper bound, peak room membership,
member-seconds, simulation-seconds, and first/last sample times (Unix seconds).
Members include retained disconnected/AFK slots, matching `/healthz`'s player
count; these are not unique visitors or game participation measurements. Bots do
not count toward room membership, though their simulation work contributes to
tick timings. Simulation seconds count completed 60 Hz ticks, not wall time.

`tickP99UpperUs` is the upper bound of the power-of-two timing bucket containing
the 99th percentile of all ticks in that group. For example, 15 µs lies in the
16 µs bucket. Buckets merge by sample count across restarts; p99 values are never
averaged. `/healthz` remains the current process's health snapshot, including
its existing p99 computed from recent raw timings, and now includes `revision`.

Snapshots save every 30 seconds and at graceful shutdown, including updates.
Writes run off the simulation thread, use owner-only files and atomic replacement,
and finish before the final shutdown snapshot. SIGKILL or power failure can lose
the interval since the latest completed checkpoint. Errors are logged, periodic
writes retry, and corrupt files stop startup rather than erase historical totals.
No player names, session tokens, or chat content are included.

Storage defaults to `.wild-wheels/stats.json`; the launcher uses
`$WILD_WHEELS_RUN_DIR/stats.json`, with `WILD_WHEELS_STATS_FILE` as an explicit
override. Preserve that directory when replacing or updating a server. Data is
retained without automatic expiry. Loading is bounded to 64 MiB and 100,000
commit/date groups; reaching the file limit requires archiving or migration, not
silent deletion. The JSON file is not served as a static asset. `/statsz` is a
public read-only summary like `/healthz`, limited to 30 requests/minute per IP.

Collection starts with the version that introduces this feature; old process
snapshots cannot reconstruct historical tick distributions or calendar dates.

Validation covers independent commit/date grouping, grand totals, UTC midnight,
leap years, save/reload accumulation, invalid-file preservation, and a real
web-triggered update with cumulative totals surviving the process replacement.
