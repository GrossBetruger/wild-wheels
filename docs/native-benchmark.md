# Native client versus browser client

Measured 2026-11-14 on an Apple M4 Pro laptop, one client at a time against a
local dedicated server with seven bots in Scrapyard, the client's racer left
idle so that it is attacked and respawns throughout.

**Read the first results as indicative, not definitive.** The laptop was on battery at 14%,
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

## After optimization

The items this benchmark suggested were implemented and measured against the
previous release build on the same machine, now charging, alternating old and
new binaries against a fresh local server with six bots. Each figure is one run
of 25 seconds unless stated; the display ran at 120 Hz.

| | Before | After |
| --- | ---: | ---: |
| Uncapped frames per second | 244 | 453 |
| Uncapped median / 95th / 99th frame | 3.3 / 9.3 / 15.5 ms | 1.8 / 4.0 / 8.7 ms |
| Paced CPU, two runs | 113%, 108% | 70%, 71% |
| Paced 95th / 99th frame, two runs | 9.2 / 9.5, 8.9 / 10.1 ms | 10.6 / 11.4, 10.1 / 11.1 ms |
| Sprite meshes rebuilt per frame | 2.5 to 6.8 | 0.4 to 1.8 |
| 105 s match: meshes held / memory / CPU | 881 / 724 MiB / 111% | 491 / 636 MiB / 80% |
| Graphics pack / binary | 125 MB / 262 MB | 44 MB / 134 MB |

What changed:

1. **Meshes are built on Bevy's async compute pool**, never in the frame. Each
   clip also builds the meshes of its next four frames ahead; a part keeps its
   previous mesh until its new one is ready.
2. **The mesh cache is bounded.** Meshes unused for 12 seconds are released.
3. **Particle quads are rebuilt only when the clip frame changes or the view
   turns** by more than about half a degree.
4. **The X-ray camera renders only while Dark Humor darkens its caster's view**;
   the HUD moves onto it then and back afterwards.
5. **The pack is compressed**: each mesh separately, inflated only when it is
   built, and the clip table as one block inflated at startup.
6. **Release builds use thin link-time optimization and strip symbols**, and
   `run_client.sh` launches the release build.
7. **Bevy's task pools are capped at four threads in total.** Paced CPU rose
   steadily with more: 70% at 4, 75% at 6, 89% at 8 and 95% at 14 threads.
   `WILD_WHEELS_THREADS` overrides the cap for measurements.

Not done: merging model parts into fewer entities. The benchmark counts about
60 mesh entities among roughly 550; most entities are HUD nodes, so merging
parts would save little. The HUD now skips rewriting unchanged button borders.

**Open regression:** at 120 Hz the new build misses more frames at the tail
(95th percentile about 10.4 ms against 9.0 ms over 105 seconds), although its
worst frames are no worse. It is not the thread cap: 14 threads gave the same
tail. Limiting new meshes to three uploads per frame did not help either. Not
yet tested: the release profile change, the HUD drawing on the world camera,
and the four-frame lookahead. At 60 Hz both builds hold every frame.

## Reproducing

```sh
# native: prints one JSON line after a 5 s warm-up and 25 s of measurement
./native-client/target/release/wild-wheels-native --server http://localhost:5197 --name Bench --auto-start --benchmark 25
WILD_WHEELS_BENCH_VSYNC=1 ./native-client/target/release/wild-wheels-native --server http://localhost:5197 --name Bench --auto-start --benchmark 25
```

Keep the window visible and in front. For the browser, wrap
`window.requestAnimationFrame` in the page console to time each callback and the
gap between callbacks, as `docs/performance.md` does with its profiler.
