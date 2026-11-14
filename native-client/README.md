# Wild Wheels native client POC

macOS Apple Silicon developer POC. Arena racers against the dedicated Rust
server only; no Grand Prix, bomber client, or mobile controls.

From the repository root:

```sh
./run_client.sh --server http://localhost:5173 --name "Native Pip"
```

For a non-graphical network smoke test against an isolated dedicated server:

```sh
./run_client.sh --server http://localhost:5189 --name "Native Pip" --headless --auto-start --seconds 10
```

The smoke test requires movement, firing, and server acknowledgements. It prints
a JSON result and fails if those outcomes are missing. `--auto-start` uses the
normal room start API; use it only on a test server. Native session cookies are
stored privately per origin in application data; `WILD_WHEELS_NATIVE_DATA_DIR`
overrides the directory for isolated tests.

Arrows/WASD drive; Shift drifts; Space fires; Tab/Command switches weapons;
X boosts; C deploys chaff; Z flips; Enter starts; Escape toggles AFK.
`--screenshot /absolute/path.png` captures the focused, visible window periodically
for inspection. Bring the native window to the foreground before inspecting a
capture: macOS can return black frames for fully occluded windows.
`--sparring --seconds 180` runs a developer input controller instead of a window;
it uses normal movement/fire commands and stops after two additional kills.

## Current checkpoint

The owned Rust client, transport, session restoration, movement, and combat work.
An automated 10-second dedicated-server test observed 69 units of movement,
13 requested shots, movement acknowledgement 414, and action acknowledgement 12.
In a zero-bot manual test, a browser player whacked the native Panda three times;
native telemetry confirmed all three deaths and full-health respawns.

The native Metal window renders Scrapyard, Pip's kart/panda model, animated wheels,
pickups, projectiles, and a chase camera/HUD. Procedural engine audio changes pitch
with speed; firing, missiles, hits, explosions, pickups and boost have sound cues.
Other racers use placeholder models. This is the playable slice, not full browser
visual or audio parity. See [results and remaining work](../docs/native-client-poc-results.md).

## Repeatable checks

Use the native toolchain pinned in this directory:

```sh
cargo +1.97.1 test --locked --manifest-path native-client/Cargo.toml
cargo +1.97.1 clippy --locked --manifest-path native-client/Cargo.toml --all-targets -- -D warnings
cargo build --locked --manifest-path rust-core/Cargo.toml --example replay_native_client
npm run test:native-parity
```

The replay compares 600 frames per profile against the browser/Wasm adapter for
local, 160 ms round trip, and jittered snapshots, including predicted shots and
audio cues. It runs in CI. It does not launch a graphical browser or measure GPU time.

For a real Chrome/native transport check, build both binaries first, then run:

```sh
cargo build --release --locked --manifest-path dedicated-server/Cargo.toml
cargo +1.97.1 build --locked --manifest-path native-client/Cargo.toml
npm run test:native-multiplayer
```

The mixed-client test starts fresh isolated zero-bot dedicated servers and headless
Chrome contexts for three latency profiles. It leaves an existing game server alone.
`CHROME_PATH` selects Chrome; `--server-binary`, `--client-binary` and `--output`
can override paths. Reports default to the OS temporary directory.

## Boundaries

`rust-core` owns simulation and client prediction. The native package separates
configuration, private sessions, transport, application coordination, scene, and
sound. Scene/audio consume core state; transport never invokes the simulation.
The existing kernel guard is shared across owned native arena/client operations.
Keep future browser/Wasm networking and storage adapters outside presentation.
