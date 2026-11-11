# Development checks

For CPU/GPU profiling and recorded results, see [Performance measurements](performance.md).

Run lightweight checks before pushing:

```sh
npm test
```

Push completed changes to main before heavy browser checks. Fix regressions forward, per the user's preference. See [the development workflow](../AGENTS.md).

## Browser regressions

```sh
npm run test:regression
```

This runs automated tests and seven browser groups: movement, projectile/pickup feedback, drift visuals, lobby/item controls, mobile bombing, character selection/rendering, and room persistence. Each covers host, guest, 160 ms latency, and jitter profiles, repeated three times (84 scenarios). Results and traces go to the directory printed by the runner. For a shorter check:

```sh
npm run test:regression -- --repeat 1
```

Chrome must be installed. Set CHROME_PATH if it is outside the default macOS location. The harness runs the real WebSocket server and WebGL renderer locally. Mobile checks emulate touch in Chrome; they do not establish physical iOS or Android support.

Local checks enforce frame time ≤20 ms at the 95th percentile, with guests within 2 ms of the host. Movement checks require position error ≤0.15 units at the 95th percentile (0.5 maximum), camera error ≤1° at the 95th percentile (3° maximum), and no unexplained frozen or backward frames. Action feedback must appear within one rendered frame without duplicate projectiles or pickup cues.

GitHub Actions runs all seven groups with --functional --repeat 1 on pushes and pull requests, retaining traces for 30 days. Functional checks enforce behavior and record frame times without enforcing hardware-dependent FPS thresholds.

Room checks require refresh to restore the same player, room, host role and scores after going offline. AFK must retain the seat and prevent combat; returning must restore responsive controls. The host can replace the server's only room, invalidating old sessions and invitations. Names survive refresh in a cookie; the separate session cookie is HttpOnly. Lightweight tests also reject replacement by guests and verify fresh input sequencing after resumption. Rooms persist for the lifetime of the Node process, without disk storage.

Guest lobby checks require room setup, map, restart, invitation and duplicate character controls to be hidden while name, character, play request, AFK and fullscreen controls remain usable. Names have no save button: edits reach the server when play is requested or begins. The mobile group verifies this for bomber names too.

The character group verifies seven menu choices, selects the elephant, cricket, and Elon/Roadster through the live lobby, checks that remote players receive the same character, renders all three in WebGL, and schedules their synthesized calls. It checks their cuteness bars and authoritative self-healing in the local HUD and remote snapshots. Roadster turbo and somersault checks require white vapor and a remotely visible somersault. Screenshots are saved alongside the results for visual review. Run it alone with:

```sh
npm run test:browser-netcode -- --characters --output /private/tmp/wild-wheels-characters.json
```

The Roadster's procedural body and effects draw on [Tesla's Roadster reference](https://www.tesla.com/roadster): a low sports-car body, full-width rear light, rear cold-gas thrusters, and perimeter jets for upward/rotational movement. Its body and chaff stay white in every player slot. Its four rear nozzles emit white condensation during boost, with additional underbody jets during somersaults. These are visual effects; multiplayer driving and weapon balance stay shared across characters.

Arena recovery restores one heart every `14 - 2 × cuteness` seconds after the last damaging hit, up to the normal three hearts. Pip, Ellie and Tamar have 5 cuteness (4 seconds); Felix and Benny have 4 (6 seconds); Rocco has 3 (8 seconds); Elon has 1 (12 seconds). Bonus hearts remain available through pickups and Vulcan rewards. Heart recovery pauses for menus, countdowns, AFK, wrecks and the ending; respawning clears recovery progress. Bombers do not regenerate health. Hedgehog ammo replenishes every `2.25 - 0.25 × cuteness` seconds (1 second at 5 cuteness, 2 seconds at 1), capped at six; damage does not restart ammo recovery. Missiles and turbos keep their existing pickup rules. `recovery.test.js` exercises these rules in both simulation engines, including resumption and peer snapshots. The Rust simulation parity test uses the current solo Arena implementation; the historical benchmark reference remains frozen.

## Targeted checks

```sh
npm run test:netcode
npm run test:browser-netcode -- --repeat 3
npm run test:browser-netcode -- --feedback --repeat 3
npm run test:browser-netcode -- --drift --repeat 3
npm run test:browser-netcode -- --controls
npm run test:browser-netcode -- --mobile
npm run test:browser-netcode -- --room
npm run profile:network
```

Recorded comparisons and traces are under [diagnostics](../diagnostics/): [movement](../diagnostics/netcode-report.html), [action feedback](../diagnostics/feedback-report.html), and [drift](../diagnostics/drift-report.html).
