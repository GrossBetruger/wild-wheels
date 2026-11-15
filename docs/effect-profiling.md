# Profiling visual effects

Run `npm run profile:effects` to compare the browser renderer with and without each
effect. Reports are written to `.wild-wheels/reports/effect-costs.json`, `.md`, and
`.html`. This command starts an isolated headless Chrome with a temporary profile
and a static server bound to localhost. It does not start a multiplayer match or
modify game state outside the profiling process.

The standalone HTML dashboard opens automatically after a successful run. It shows
separate CPU/GPU rankings and a searchable table with category filters and sortable
columns. Use `--no-open` for unattended runs. Run
`npm run profile:effects -- --report-only` to rebuild and open the dashboard from
the saved JSON without repeating the measurements. `--out` selects the same report
basename in this mode. The dashboard works offline without external assets.

Use `npm run profile:effects -- --samples 60 --out /private/tmp/effect-costs` for
longer sampling or a different destination. `--limit 3` runs only the first three
scenarios for a harness smoke check. Set `CHROME_PATH` to use a different local
Chrome executable. Interrupted runs retain partial JSON; the Markdown and HTML
are produced only after all selected scenes complete.

Use `--filter 'Dark Humor / victim fog' --resume` to remeasure matching scenes in
an existing report. Resume requires the same GPU, viewport and sample count.
The fog-victim baseline includes the caster racer, and the gravity-tether baseline
includes its six pickups, so those supporting objects are present in both phases.

The catalog is in `scripts/profiling/effect-scenes.mjs`. It covers each racer's
boost, rapid-fire attachment, shields, hedgeguard, books, dizziness, celebration,
somersault, ashes and rapid-fire projectile; special abilities, Nightmare Fuel's
ending, world effects, fire-ring sizes/colors, projectile multiplicities, bombs,
clouds, particles, skids, locusts, pickups and gravity-well tethers. Add a catalog
entry when a new visual family or materially different variant is introduced.

Each scenario has a same-driver baseline followed by the effect. Both use 12
warm-up frames and 30 measured frames by default. The renderer receives synthetic
state; gameplay simulation is excluded. World-effect ages span representative
portions of their lifetimes. Full lifetime maxima, concurrent effects, every
ability transition and activation spikes are not exhaustively profiled.

CPU measurements cover renderer work and WebGL submission with instrumentation.
GPU measurements use asynchronous `EXT_disjoint_timer_query` queries; unavailable
or invalid samples are recorded explicitly, with sample counts and disjoint events.
No `gl.finish` is used. CPU and GPU overlap, so their times must not be added.
Triangle, point-sprite, draw-call and uploaded-byte counts cover submitted WebGL
work, including offscreen geometry; they do not measure shaded pixels or overdraw.

Read the deltas alongside the raw baseline and effect measurements. Browser timer
precision, garbage collection, fixed baseline-first order and other machine activity
can affect small differences. Negative deltas are preserved rather than clamped.
The viewport and camera can also change with the effect. A large triangle count
is an optimization clue, not a measurement of GPU saturation. Repeat expensive
scenes on slower hardware before selecting thresholds for cheaper effects.

The [initial report](effect-costs.md) and [raw data](../diagnostics/effect-costs.json)
are retained for comparison. Native rendering plays ported clips using a different
submission pipeline; these browser timings are not native benchmarks.
