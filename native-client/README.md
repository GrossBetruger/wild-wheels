# Wild Wheels native client skeleton

macOS Apple Silicon developer POC. Arena racers against the dedicated Rust
server only; no Grand Prix, bomber client, or mobile controls.

From the repository root:

```sh
cargo +1.97.1 run --manifest-path native-client/Cargo.toml -- --server http://localhost:5173 --name "Native Pip"
```

For a non-graphical network smoke test against an isolated dedicated server:

```sh
cargo +1.97.1 run --manifest-path native-client/Cargo.toml -- --server http://localhost:5189 --name "Native Pip" --headless --auto-start --seconds 10
```

The smoke test requires movement, firing, and server acknowledgements. It prints
a JSON result and fails if those outcomes are missing. `--auto-start` uses the
normal room start API; use it only on a test server. Native session cookies are
stored privately per origin in application data; `WILD_WHEELS_NATIVE_DATA_DIR`
overrides the directory for isolated tests.

Arrows/WASD drive; Shift drifts; Space fires; Tab/Command switches weapons;
X boosts; C deploys chaff; Z flips; Enter starts; Escape toggles AFK.
`--screenshot /absolute/path.png` captures the window periodically for inspection.
`--sparring --seconds 180` runs a developer input controller instead of a window;
it uses normal movement/fire commands and stops after two additional kills.

## Current checkpoint

The owned Rust client, transport, session restoration, movement, and combat work.
An automated 10-second dedicated-server test observed 69 units of movement,
13 requested shots, movement acknowledgement 414, and action acknowledgement 12.
In a zero-bot manual test, a browser player whacked the native Panda three times;
native telemetry confirmed all three deaths and full-health respawns.

The Bevy scene and procedural sound code compile, and Metal initializes, but
window captures are currently black. This is a networking/combat skeleton, not
a verified graphical playable build. Fix and validate rendering next. The engine
loop, richer visuals, broader parity checks, and browser/Wasm adapter remain future work.

## Boundaries

`rust-core` owns simulation and client prediction. The native package separates
configuration, private sessions, transport, application coordination, scene, and
sound. Scene/audio consume core state; transport never invokes the simulation.
The existing kernel guard is shared across owned native arena/client operations.
Keep future browser/Wasm networking and storage adapters outside presentation.
