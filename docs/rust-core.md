# Rust/Wasm multiplayer core

Multiplayer Arena Battle runs inside Rust on the Node host and in each browser. Grand Prix and solo arena retain their original JavaScript gameplay. WebGL rendering, UI/audio, HTTP/WebSocket transport, and session authorization also remain JavaScript.

Rust owns movement, AI, collisions, weapons, bombs, chaff, damage/scoring, pickups, lifecycles, packet encoding/decoding, prediction/reconciliation, local action/pickup/drift feedback, and render-facing numeric state. Node rooms advance ArenaCore with bounded input batches. NetworkGame feeds binary updates directly to ArenaClient. core-view.js exposes read-only views over Wasm memory to the renderer. There is no per-frame JavaScript actor mirror. Initial HTTP join responses and diagnostics can reconstruct snapshots; normal WebSocket updates and queued sound-cue merging stay inside Rust.

ArenaCore.room constructs the arena, randomized bot skill tiers, spawns, supplies, and inventories. configure updates room metadata, names, animal choices, and joining/leaving players without rebuilding the world. start enters the three-second countdown. Node retains the guest request's three-second auto-start/refusal policy. Compact numeric status buffers support phase checks and benchmark instrumentation. Invalid commands/configuration are rejected before mutation.

Hosts run the usual npm install and npm start. Browsers download the checked-in rust-core.wasm asset and need no installation. Rust is required only to rebuild the core:

```sh
rustup target add wasm32-unknown-unknown
cargo fetch --locked --manifest-path rust-core/Cargo.toml
npm run build:core
```

Cargo dependencies are pinned in Cargo.lock. The build uses offline release compilation, optimization/LTO, and temporary output. Commit source and the rebuilt Wasm together. The server serves Wasm with application/wasm and the narrow wasm-unsafe-eval CSP permission; general JavaScript unsafe-eval stays disabled.

The lightweight suite covers multiplayer behavior against the Rust server, with explicit local fixture adapters for arranging scenarios. Production never installs that mutable fixture world. Focused core tests cover simulation parity, scoring, bomber cadence/damage, chaff, prediction, immediate feedback, contested pickups, render memory views, room identity, countdown/reset, host transfer, and invalid commands.

Round transitions have permanent coverage: arena-room.test.js delivers movement after the finish screen, multiplayer.test.js verifies a rematch accepts its new command counter immediately, and arena-lifecycle.test.js runs two Rust clients through three matches with delayed finish packets. arena-client.test.js also checks that fresh drift sparks match the rendered wheels and that heap growth between frames preserves the visible kart and firing feedback.

Rendering reads numeric memory directly. The SDK rebinds detached memory views after each Wasm command, so ordinary property reads do not repeatedly query Wasm memory. Renderer/UI code runs synchronously between those commands; it cannot grow Wasm memory during a draw. Every presentation refresh also updates numeric buffer pointers and UI text versions.

Run npm test before pushing. Push main before the heavy browser/netcode/regression suites, following AGENTS.md. Existing responsiveness and frame criteria remain unchanged. Fix regressions forward, per the user's preference for this recreational game.

The earlier thin movement bridge increased CPU cost and was reverted. Its measurements remain in diagnostics/movement-core-comparison.json; its source is preserved in branch history. Those results do not predict the performance of this full ownership path. Whole-path benchmarks are still required before claiming an improvement.
