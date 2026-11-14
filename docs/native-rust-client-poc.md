# Native Rust client proof of concept

Build one complete slice of a native Rust multiplayer client
to measure the work needed for feature parity with the browser client.
Initial skeleton implementation started on 2026-11-14. Target macOS Apple Silicon,
Bevy presentation, Pip the Panda, and Scrapyard, against the dedicated Rust server
only. Launch from the CLI and retain native session identity across app restarts.

The longer-term goal is to reuse the mature Rust client in the browser through
WebAssembly, including its Bevy presentation code. Keep native networking,
filesystem/session storage, and CLI startup outside reusable presentation and
gameplay modules. A future browser build will supply WebSocket/fetch, browser
storage, and page integration adapters; browser support is not part of this POC.

The slice should include one character, one arena, multiplayer movement,
shooting, and sound. The native client should play alongside a browser client on
the existing dedicated Rust server, using the same protocol and gameplay rules.
Reuse the Rust simulation, prediction, reconciliation, and interpolation through
an owned native client API; port enough rendering, input, and audio to make the
slice playable and comparable.

Record development effort with Codex, rendering and audio integration work,
visual fidelity, frame times, and responsiveness under latency and jitter.
Check that movement and shooting behave consistently between native and browser
players, and identify which remaining features can be ported mechanically versus
which need redesign.

Deliver a playable demo, a list of remaining presentation and platform work,
and a revised estimate for full multiplayer feature parity based on the measured
porting speed. Grand Prix and mobile feature parity are outside this first slice.

Other racers may use placeholder models. Gameplay for every character still comes
from the shared core and dedicated server; unported ability visuals and audio may
be omitted entirely, with no fallback overlays required. Native bomber play,
bomber controls/cameras, and photography are excluded. Server-side bombers can
still damage or affect the native racer.

See [POC results](native-client-poc-results.md) for verification, measurements,
and the remaining work.
