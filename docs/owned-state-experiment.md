# Persistent Rust/Wasm snapshot ownership

Measured November 11, 2026 on Apple M4 Pro, Node 22.19.0, Rust 1.90.0, and Chrome 157. This follow-up to the [encoding comparison](encoding-comparison.md) keeps snapshot state inside Wasm between updates instead of flattening and transferring the entire JavaScript state every time. Production gameplay is unchanged.

## Results

Mean milliseconds per snapshot in the six-player drifting/Vulcan workload:

| Runtime and path | JavaScript-owned state | Rust/Wasm-owned state | Reduction in time |
| --- | ---: | ---: | ---: |
| Node encoding, including packet ownership copy | 0.0988 | 0.0445 | 55% (2.2× faster) |
| Chrome encoding, including packet ownership copy | 0.0665 | 0.0394 | 41% (1.7× faster) |
| Node update → encode → copy → JS decode | 0.1820 | 0.1299 | 29% |
| Chrome update → encode → copy → JS decode | 0.1253 | 0.0984 | 22% |

Chrome results average three fresh-page runs. The Rust path wins in all three scenarios (driving, drifting, and six-player Vulcan), unlike the previous small Wasm numeric-packing helper. This supports experimenting with Rust-owned state instead of repeatedly crossing the boundary with JavaScript object graphs. It does not establish the benefit of a full Rust game migration.

The Rust path now also serializes metadata with serde_json; the gain cannot be attributed solely to eliminating input copies. JavaScript uses the current production binary encoder, not the older staged binary prototype. Both paths rebuild a fresh packet from changing state on each iteration. No pre-encoded snapshot replay or packet patching is used.

## State and command ownership

- Choose the largest recorded snapshot from each of the existing three 60-snapshot corpora. Initialize one persistent JS state and one persistent Rust state per scenario. The scene populations stay fixed during the probe.
- Rust owns typed numeric vectors for skids, particles and projectile trails, plus an owned metadata tree. JavaScript owns the equivalent ordinary game objects. Initial full-state upload/parse is measured separately from steady-state encoding. Wasm compilation and instantiation are excluded.
- Each update sends four scalar doubles across the Wasm boundary: dt, dx, dz, and heading change (32 bytes if packed). Both sides update actor positions/headings, elapsed time, particle positions/ages, skid times, and trail positions. Particle ages wrap at their lifetime to maintain the fixed population. These synthetic commands are not real keyboard input or a complete simulation step.
- Rust assembles a complete production-format binary packet, including JSON metadata, directly from resident state. Both sides return independently owned packet bytes so later state updates cannot invalidate an asynchronous WebSocket write. The required Wasm-to-JS packet copy is inside the timing.
- The pipeline timing includes the existing JavaScript binary decoder, which rebuilds objects for the current renderer. No game-state object graph is reconstructed before Rust encodes. Future rendering ownership changes could alter this cost but were not measured.

Raw results: [Node](../diagnostics/owned-state-node.json), [Chrome](../diagnostics/owned-state-browser.json).

## Correctness and limits

Each case warms for 120 command updates and measures 600 more, alternating which implementation runs first. Every update is checked outside the timing region for identical decoded gameplay fields and cosmetics, including floating-point round-off. Across Node and three Chrome runs, 8,640 paired updates pass semantic equivalence. All 241 existing lightweight tests pass. Browser and transport error lists are empty.

The Rust serializer orders metadata differently, so packets need not be byte-identical even though decoded states match. Final raw packet lengths match in these cases; level-1 DEFLATE packets are slightly larger for Rust (busy scene: 18,099 versus 17,988 bytes). This experiment demonstrates CPU savings, not a bandwidth improvement.

Initialization is more expensive for Rust than a JS clone and is listed in the raw results. The game has not been ported: collision detection, AI, spawning, variable effect populations, prediction/reconciliation, multiplayer authority, and GPU rendering are outside this synthetic probe. Do not treat these CPU reductions as measured FPS or internet-latency improvements. The before/after workloads differ from the earlier whole-game profile, so their absolute timings are not directly comparable.

The isolated Chrome benchmark page uses COOP/COEP to enable finer timing and explicitly permits Wasm compilation. These headers apply only inside the local test harness. The game's profile, settings and CSP are unchanged.

## Reproduce

Generate the deterministic corpus using the [earlier comparison](encoding-comparison.md#reproduce), then run:

```sh
cargo build --locked --release --target wasm32-unknown-unknown --manifest-path scripts/owned-state-lab/Cargo.toml --target-dir /private/tmp/wild-wheels-owned-state-target
node scripts/profiling/compare-owned-state.mjs /private/tmp/wild-wheels-owned-state-target/wasm32-unknown-unknown/release/wild_wheels_owned_state_lab.wasm /private/tmp/wild-wheels-encoding-comparison.json.corpus.json /private/tmp/wild-wheels-owned-state-node.json
npm run test:browser-netcode -- --owned-state --repeat 3 --wasm /private/tmp/wild-wheels-owned-state-target/wasm32-unknown-unknown/release/wild_wheels_owned_state_lab.wasm --corpus /private/tmp/wild-wheels-encoding-comparison.json.corpus.json --output /private/tmp/wild-wheels-owned-state-browser.json
```

Follow the repository workflow: lightweight checks before pushing; Chrome measurements after pushing. The Rust dependency is pinned in Cargo.toml and Cargo.lock and used only by this experiment.

The next decision is whether to prototype one real simulation slice with Rust-owned state and renderer-friendly output. That would test whether these encoding savings survive actual collision, entity lifecycle, and prediction workloads before committing to a larger migration.
