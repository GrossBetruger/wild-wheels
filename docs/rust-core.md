# Rust/Wasm core migration

Current status: this branch is the multiplayer Arena Battle migration workspace. Main's thin movement activation was reverted after the JS/Wasm bridge used more CPU than the original function; the measurements are in diagnostics/movement-core-comparison.json. Grand Prix is explicitly out of scope and stays JavaScript.

The new coarse API in arena-core.js owns multiplayer arena simulation, AI, weapons, bombs, chaff, scoring, entity lifecycles, packet generation, prediction/reconciliation, immediate action/pickup feedback, and render-facing numeric state in Rust. Inputs and packets cross the boundary; actor objects do not. core-view.js exposes read-only views over Wasm memory for the existing browser renderer/UI. Node rooms now create and advance ArenaCore worlds; NetworkGame receives their packets directly into ArenaClient. Full snapshots are used only for diagnostics and the initial HTTP join response. WebSocket updates do not reconstruct a JavaScript world, including when merging queued sound cues under backpressure.

ArenaCore.room(config) now constructs a complete multiplayer arena inside Rust, including spawns, randomized bot skill tiers, supplies, and bomber inventories. configure(config) applies validated roster, names, animal choices, host transfers, bot counts, and play-request metadata without rebuilding gameplay state. start() enters the regular three-second countdown. A five-number status view lets the server inspect phase and epoch without reading a world snapshot. These APIs are internal to the host adapter; session authorization remains in Node. Configuration changes are validated before mutation, and live driver/role changes are rejected.

The lightweight suite passes 267 tests, including 22 focused Rust simulation, prediction, presentation, and room tests. Existing multiplayer business tests now exercise the Rust server using an explicitly supplied local fixture adapter; production has no mutable JavaScript world. Browser benchmarks read a four-number client status buffer for timing diagnostics. Integration and performance suites run after pushing main, per the development workflow. Passing unit tests is not evidence of a speedup.

WebGL rendering, browser UI/audio, Node HTTP/WebSocket transport and authorization remain JavaScript. Solo arena and Grand Prix also retain the original JavaScript gameplay path. Browser players download the checked-in Wasm asset and need no installations; normal hosts still use Node/npm.

The sections below describe the earlier thin movement prototype, which remains available on this branch for comparison. Its per-actor bridge is not the target architecture.

The earlier thin prototype owns arena kart movement. Its server authority, local prediction/replay, solo arena driving, and AI locomotion call the same checked-in rust-core.wasm module. The coarse engine adds pinned serde and serde_json build dependencies; hosts and players do not need Rust installed to run the game.

## Implemented

- Acceleration, braking/reverse, steering, chassis/travel/camera smoothing, and wall collision response against both arenas' geometry.
- Drift charging, drift-release boosts, turbo timers, dizziness steering, and somersault movement/camera timing.
- Fixed, persistent kart slots in Wasm memory, with a bounded LRU bridge for live actors and temporary prediction previews. Combat actions and authoritative corrections reconcile changed fields into those slots. JavaScript receives movement fields and effect flags for the existing renderer/audio.

Weapons, damage/scoring, pickups, AI decisions/pathfinding, kart-to-kart separation, entity lifecycles, cosmetic particles, packet encoding, and rendering remain in JavaScript. Race-mode circuit physics is also still JavaScript. This is the first production migration step, not a full Rust game port or a demonstrated whole-game speedup.

## Build and run

Normal setup remains npm install and npm start; a prebuilt Wasm binary is committed. To change Rust code, install Rust and its Wasm target once:

```sh
rustup target add wasm32-unknown-unknown
cargo fetch --locked --manifest-path rust-core/Cargo.toml
npm run build:core
```

The build uses Cargo.lock, offline compilation, release optimization/LTO, and temporary build output outside the repository. It replaces rust-core.wasm. Commit the Rust source and rebuilt Wasm binary together. Restart the server and refresh browsers after changing the core.

rust-core.js loads the module in Node and browsers. Arena geometry is uploaded once from combat.js, so the collision shapes come from the existing map definitions. The static server serves Wasm as application/wasm, includes it in build fingerprints, and permits Wasm compilation through the narrow wasm-unsafe-eval CSP directive. General JavaScript unsafe-eval is not enabled.

## Ownership boundary

The core holds 128 resident slots, each containing 16 double-precision movement fields. The JS bridge keeps a weak actor mapping and bounded slot cache. It sends a field back into Wasm only when combat/actions/snapshots changed the JS projection; ordinary movement ticks reuse resident state. Output fields are still projected to JS for the parts of the engine not yet migrated. Temporary prediction previews can evict inactive slots; rehydration preserves each actor's state.

The ABI checks slot indices, arena/block counts, finite state/commands, steering bounds, and tick duration. Geometry/state allocations are fixed, and the movement module never grows its memory. The same .wasm bytes run on the server and browser; there is no JavaScript movement fallback.

## Validation

```sh
npm test
```

rust-core.test.js compares 3,000 command ticks with the frozen pre-migration JavaScript movement model in scripts/reference-movement.mjs, on both maps and with external maneuvers. It also checks independent actor state and cache eviction. The oracle is used only by tests. Existing deterministic prediction, combat, effects, movement-network, and binary-transport tests exercise the production Rust path.

Push after lightweight checks, then run the permanent browser regressions:

```sh
npm run test:regression -- --repeat 1
```

The movement/error thresholds and behavioral criteria remain unchanged. If post-push checks reveal a regression introduced by this migration, revert the migration commit and push the revert, following AGENTS.md.

The next migration boundary is real combat/entity state and packet generation, with rendering-buffer output replacing the remaining object projections. That work needs entity lifecycle and prediction/reconciliation checks; the earlier [persistent-state experiment](owned-state-experiment.md) measures the motivation, not a performance guarantee for this first movement slice.
