# Native client versus browser client

Measured 2026-11-14 on an Apple M4 Pro laptop, one client at a time against a
local dedicated server with seven bots in Scrapyard, the client's racer left
idle so that it is attacked and respawns throughout.

**Read these as indicative, not definitive.** The laptop was on battery at 14%,
macOS was running a storage scan at about 80% of a core, and each configuration
was run once for 20 to 25 seconds. Repeat on mains power before relying on any
single figure.

## Results

| | Browser (Chrome) | Native, release | Native, dev profile |
| --- | ---: | ---: | ---: |
| Pixels drawn | 600 × 375 | 2560 × 1600 | 2560 × 1600 |
| Frame rate | 30 (capped by Chrome) | 259 uncapped, 60 paced | 60 paced |
| Game work per frame, mean | 8.10 ms | 0.17 ms uncapped, 0.30 ms paced | 0.29 ms |
| Game work per frame, 95th percentile | 14.2 ms | not recorded | not recorded |
| Whole frame, median / 95th / 99th / max | not measured | 3.2 / 8.3 / 12.1 / 26.2 ms | paced at 16.7 ms |
| Process CPU while paced | not measured | 55% of one core | 62% of one core |
| Memory | 53–91 MiB JavaScript heap | 578 MiB paced, 818 MiB uncapped | 579 MiB |
| Mesh assets after 30 s | n/a | 888–914, about 20 new per second | 879 |
| Binary | n/a | 262 MB | 304 MB |

What each row means:

- **Game work per frame** is the browser's whole `requestAnimationFrame`
  callback (prediction, building every mesh in JavaScript, WebGL calls) and the
  native client's `Update` systems (prediction, choosing clips, HUD, sound).
  The native figure excludes Bevy's own rendering work, so the two are not the
  same scope; the native whole-frame row is the fair upper bound.
- **Chrome capped the page at 30 frames per second**, most likely its energy
  saver on low battery. The game's automatic quality setting read that as a slow
  machine and lowered its resolution to 600 × 375.
- **Uncapped** native runs use `--benchmark` with vertical sync off; **paced**
  runs add `WILD_WHEELS_BENCH_VSYNC=1`. Vertical sync off was honored in two of
  three attempts.

The native client's game logic costs about one twenty-fifth of the browser's
frame callback, and a complete native frame at 18 times the pixel count takes
less time than the browser's JavaScript alone. Native logic by stage, uncapped
release, in milliseconds per frame: network and prediction 0.032, scene 0.032,
clips and particles 0.030, HUD 0.023, sound 0.015, menus and messages 0.040.

## Where the native client can improve

The game logic is not the problem: all of it is under a third of a millisecond.
The costs are in memory, frame-time spikes and what Bevy does with the scene.

1. **Meshes are built and never released.** Clips whose every frame is new
   geometry (flames, explosions, ashes, chaff, fire rings) add about 20 meshes
   per second to a cache that only grows: 888 after 30 seconds, and memory rose
   from about 420 MiB to 818 MiB in the uncapped run. Bound the cache and drop
   meshes of clips no longer on screen. This is the first thing to fix; a long
   match will keep growing.
2. **Frame times spike.** The median frame is 3.2 ms but the 95th percentile is
   8.3 ms and the worst 26 ms. Building a mesh on the main thread averages only
   about 20 microseconds, so the likely cause is uploading new meshes to the
   GPU; this was not profiled directly. Building the meshes of a clip when it
   starts, rather than frame by frame, would move the cost off the playing frames.
3. **Particle quads are rebuilt every rendered frame.** Five to seven sprite
   meshes are re-created and re-uploaded per frame, although clips advance at
   24 frames per second. Rebuild only when the clip frame or the camera's
   orientation changes, or orient the quads in a vertex shader so the meshes
   never change.
4. **The X-ray camera always renders.** The second camera added for Dark Humor
   draws every frame even when nothing is dark. Switch it off unless a
   KnowItOwl's special is active. The saving was not measured.
5. **The packs are embedded uncompressed.** 125 MiB of graphics and sound make
   a 262 MB binary and most of the baseline memory. Sharing vertices between
   triangles, sharing triangles between animation phases, and compressing the
   pack would each cut this substantially; none has been tried.
6. **Players run the dev profile.** `run_client.sh` builds without `--release`.
   Game logic is about 1.7 times slower there, though both hold 60 frames per
   second. Launch the release build and add link-time optimization and symbol
   stripping to the release profile.
7. **Paced play uses about half a core.** With 0.3 ms of game logic per frame,
   the rest is Bevy extracting and preparing roughly 550 entities. One entity
   per model part, trail puff, skid mark and particle adds up; merging a clip
   frame's static parts into one mesh would reduce it. Lower priority than the
   items above.

Per-frame string formatting and map lookups in `scene.rs` and `hud.rs` are
visible in the code but cost hundredths of a millisecond; they are not worth
optimizing before the items above.

## Reproducing

```sh
# native: prints one JSON line after a 5 s warm-up and 25 s of measurement
./native-client/target/release/wild-wheels-native --server http://localhost:5197 --name Bench --auto-start --benchmark 25
WILD_WHEELS_BENCH_VSYNC=1 ./native-client/target/release/wild-wheels-native --server http://localhost:5197 --name Bench --auto-start --benchmark 25
```

Keep the window visible and in front. For the browser, wrap
`window.requestAnimationFrame` in the page console to time each callback and the
gap between callbacks, as `docs/performance.md` does with its profiler.
