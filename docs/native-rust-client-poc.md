# Native Rust client proof of concept

Future experiment: build one complete slice of a native Rust multiplayer client
to measure the work needed for feature parity with the browser client. This is
planned for a later session; implementation has not started.

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
porting speed. Choose the target desktop platform and graphics stack when starting
the experiment. Grand Prix and mobile feature parity are outside this first slice.
