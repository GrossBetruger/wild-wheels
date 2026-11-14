# Native Rust client POC results

2026-11-14, macOS Apple Silicon, Bevy 0.20.1/Metal, dedicated Rust server.

## Delivered slice

Launch with `./run_client.sh --server http://localhost:5173 --name "Native Pip"`.
The server must be the dedicated Rust server. Pip the Panda drives in Scrapyard
alongside browser players, with movement, drift, boost, somersaults, weapon cycling,
firing, chaff, death and respawn. The view includes a chase camera, obstacles,
pickups, projectiles, animated wheels, and health/ammunition HUD. Native audio
provides a speed-dependent engine loop and basic combat/pickup cues.

The browser and native adapters use the same Rust prediction, reconciliation,
interpolation and gameplay. Presentation reads borrowed state; the transport
worker owns no simulation. Configuration, per-origin private session storage,
transport, app coordination, scene, and audio remain separate modules. A future
Wasm build needs browser networking/storage/startup adapters; reusable gameplay
and presentation must stay independent of those adapters.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Playable native graphics | Visible Metal window inspected; user played and confirmed graphics/game work. |
| Mixed browser/native combat | In a zero-bot local room, the browser player whacked the native Panda three times; native telemetry recorded each death and full-health respawn. |
| Prediction matches browser/Wasm | 600 frames in each of three snapshot-delay profiles; movement, steering, drift, boost, flips, weapons, projectiles, audio cues and commands agree within 1e-6. Largest observed error: 7.11e-15. |
| Immediate local firing | Core test requires a visible projectile and one fire cue before any following frame or server response. |
| Persistent native identity | Tests restore separate server identities after reopening storage, preserve rotated tokens, reject expired identities, and check private file permissions on Unix. |
| Existing JavaScript behavior | All 635 tests pass. |
| Rust checks | Owned-client tests, native configuration/storage tests, and native Clippy with warnings denied pass. |

The deterministic replay runs in GitHub Actions. Its latency is delayed incoming
snapshots; the separate real Chrome/native test adds delay in both WebSocket
directions. These are complementary tests, not interchangeable measurements.

## Measured core and transport costs

Real Chrome plus the native CLI shared a fresh zero-bot server in each profile.
The native process ran for eight seconds; core update samples exclude the first
second. Each case moved, fired 15 times, received movement/action acknowledgements,
and stayed on one connection. No browser exceptions were recorded.

| WebSocket profile | Native core update p99 | Movement acknowledgement p50 / p99 |
| --- | --- | --- |
| Local | 41.3 microseconds | 35.6 / 53.6 ms |
| 80 ms each direction | 30.5 microseconds | 190.5 / 212.3 ms |
| 80 ± 30 ms each direction | 48.1 microseconds | 204.6 / 260.9 ms |

These are short development-build observations, not throughput guarantees or a
comparison against browser rendering. Acknowledgement time includes input batching,
server snapshots and client polling, so it exceeds the injected network delay.
The test requires one connection and acknowledgement p99 below one second.

The initial jitter proxy used independent timers that reordered equal-deadline
frames, sometimes delivering input before authentication. Instrumentation confirmed
the reordering. A FIFO pump per direction corrected the harness; earlier jitter
results with reconnects are invalid and excluded from this table.

## Effort and remaining work

Implementation began at 08:48 UTC. The first headless movement/firing test passed
after about 16 minutes; the skeleton was committed after 33 minutes and native
graphics verified after 38 minutes. Joint manual testing, the launcher, sound,
pickups, automated parity and transport checks took additional time.

The remaining arena client work is mostly presentation: all character models,
vehicles, gestures, ability effects/audio, environment fidelity, HUD/lobby/results,
chat, accessibility and settings. Prediction and the dedicated protocol are
already reused. Character-specific visual systems and UI need deliberate
adaptation rather than mechanical JavaScript translation.

Estimate after this slice: 15–30 additional hours of focused developer/Codex work
for functional desktop arena parity, or roughly 25–45 hours total for a polished
version with broader performance/platform testing. This is an estimate, not a
deadline; one simple character does not establish the porting rate of the most
complex effects. Grand Prix, native bomber play, mobile, packaging for other
operating systems, and the eventual browser/Wasm port are excluded.

GPU execution, native frame pacing under graphical load, and subjective audio
quality have not been benchmarked. Headless core/transport timings cannot establish
renderer speed or full eight-human-player performance. The POC establishes a
working architecture and playable cross-client slice; it makes no GPU speedup claim.
