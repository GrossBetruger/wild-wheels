# Performance measurements

## Rust-owned multiplayer core

The paired comparison uses JavaScript main 7b8ef3d and Rust main 3cf3fc8 on the same Apple M4 Pro, Chrome/ANGLE Metal, Balanced graphics at 668 × 418. Four profiles run in JS/Rust/Rust/JS order, with two samples per scene and implementation. [Complete paired measurements and browser acceptance results](../diagnostics/rust-core-comparison.json). The [first ownership-path comparison](../diagnostics/rust-core-before-view-optimization.json) is retained separately.

| Scene | Server CPU, JS → Rust (ms/second) | Server speedup | Total browser CPU, JS → Rust (ms/second) | GPU, JS → Rust (ms/frame) |
| --- | ---: | ---: | ---: | ---: |
| Driving | 2.61 → 0.81 | 3.23× | 53.40 → 71.15 | 0.193 → 0.191 |
| Drifting | 3.72 → 1.17 | 3.19× | 85.91 → 108.67 | 0.212 → 0.200 |
| Six players with Vulcan | 23.99 → 8.96 | 2.68× | 130.91 → 163.94 | 0.283 → 0.323 |

Server simulation plus packet generation is consistently faster. Browser CPU is still 25–33% higher in this comparison; a whole-game speedup is not established. Frame interval p95 stays 16.7–16.8 ms, about 60 FPS. GPU time does not show a consistent improvement. The GPU scene evolves during each run, and local timing/scene differences limit the interpretation of small changes. The server's absolute CPU saving is modest at this room size; these ratios do not imply lower internet RTT or a higher FPS cap.

CPU totals normalize to 60 simulation/render updates and 30 snapshots per second. Browser total adds asynchronous binary receipt, parsing, and reconciliation to frame callback work. The client-core column in the JSON isolates prediction/presentation plus receipt. Rust packet timing uses the actual owned-state packet path, rather than reconstructing a diagnostic JS world and re-encoding it. GPU elapsed is measured with disjoint timer queries; it overlaps CPU execution and must not be added to CPU time.

The permanent suite covers finished matches receiving late commands, fresh rematch input counters, three consecutive matches with delayed snapshots, immediate shots/pickups, fresh drift effects, and Wasm heap growth. Browser acceptance covers five groups across host, local guest, 160 ms guest, and 160 ms guest with jitter. Mobile coverage uses Chrome emulation. Full evidence and individual profile summaries are retained in the paired JSON.

Reproduce each profile with the commands below, alternating the JavaScript checkout and current main. Run after pushing, following AGENTS.md:

```sh
npm run test:browser-netcode -- --profile --source /path/to/javascript-checkout --output /private/tmp/js-profile.json
npm run test:browser-netcode -- --profile --output /private/tmp/rust-profile.json
```

## Earlier profiler result

Follow-up: [JSON versus JavaScript binary versus Rust/Wasm encoding](encoding-comparison.md), including Node and Chrome measurements and compressed packet sizes.

Recorded November 11, 2026 with Chrome/ANGLE on an Apple M4 Pro, hardware rendering, Balanced graphics at 668 × 418 pixels. [Raw results](../diagnostics/performance-profile.json).

Run the same profiler:

```sh
npm run test:browser-netcode -- --profile --output /private/tmp/wild-wheels-performance.json
```

The profiler runs driving, drifting, and a six-player drifting/Vulcan scenario. Server measurements warm up for 300 ticks and collect 1,800 ticks and 900 broadcasts per scenario. Browser measurements warm up for three seconds and collect six seconds of frames. Players have shields to keep the workload active instead of ending in repeated deaths. Server simulation uses held inputs; this is not a movement-command backlog benchmark.

## Six-player stress result

| Component | Mean | 95th percentile | Scope |
| --- | ---: | ---: | --- |
| Simulation | 0.028 ms | 0.055 ms | One room tick, 60 Hz |
| Snapshot construction | 0.171 ms | 0.217 ms | All six recipients, 30 Hz |
| Snapshot encoding | 2.835 ms | 3.613 ms | All six recipients, 30 Hz |
| Browser network rendering/prediction | 0.189 ms | 0.400 ms | One browser frame |
| Renderer CPU work | 1.675 ms | 1.900 ms | One browser frame |
| Whole game frame callback CPU work | 2.154 ms | 2.500 ms | Includes renderer and prediction |
| GPU elapsed time | 0.290 ms | 0.391 ms | Commands inside renderer.draw |

Rendered frame intervals remained about 16.67 ms. Snapshot encoding is the first server optimization candidate; physics is a much smaller cost in this workload. Reduce repeated cosmetic state and repeated packing across recipients before considering a Rust/Wasm physics port. Buffer reuse in the renderer is a separate candidate for improving browser CPU efficiency.

## Measurement boundaries

- Simulation excludes snapshot broadcasting. Snapshot construction and JSON/cosmetic encoding are timed separately; compression, transport, and internet latency are excluded.
- Renderer CPU time includes geometry preparation and WebGL command submission. GPU timers use EXT_disjoint_timer_query, retrieve results asynchronously, discard invalid disjoint samples, and report unsupported hardware explicitly. No gl.finish stall is used. GPU elapsed time is the elapsed span of renderer commands, not a hardware utilization counter or presentation/compositor latency. CPU and GPU times overlap and should not be added together.
- Browser frame callback timing excludes work outside that callback, such as asynchronous message parsing. GPU timer overhead is included in the instrumented whole-frame callback.
- These numbers come from one completed CPU/GPU pass on this machine, with 364 GPU samples per scenario and no disjoint events. Two earlier CPU-only passes produced similar encoding costs; a third stopped on a Chrome Page.enable timeout. No gameplay regression was observed, and the completed GPU pass had no browser or transport errors.
- This workload does not cover multiple rooms, mobile GPUs, high-resolution displays, or internet routing. Repeat on a slower player machine before generalizing the browser results.

Profiler instrumentation is enabled only by --profile in the local browser harness; production gameplay is unchanged.
