# Development checks

A-bombs leave a radioactive zone covering the full 28-unit blast footprint for 8 seconds. Contact deals 1 damage immediately and every second afterward; leaving and re-entering starts a new immediate dose. Respawn shields and Hedgeguard protect against radiation. Radiation kills credit the bomb's owner and produce ash. `radiation.test.js` covers dose timing, boundaries, shields, expiry, re-entry, credit and remote presentation in both engines; the mobile group checks fallout replication and visuals.

Combat hazards: A-bombs deal 5 damage within 22 units and 3 damage in the outer ring through 28 units. Dizziness lasts 8 seconds, with stronger steering disturbance and camera sway during boost. Boosted wall collisions explode; each bomber with active gas credit earns a full point for those crashes. Ordinary stink-assisted kills remain half a point. `combat-hazards.test.js` covers radius boundaries, normal versus boosted impacts, multiple bomber credit and stronger boosted swerving in both simulation engines. Movement prediction stops at fatal impacts while the server confirms death and scoring.

A-bomb deaths turn the character and vehicle's last rendered shape into rubble. Chunks collapse smoothly over 1.3 seconds, then smolder for 3 seconds. Combat tests check rubble lifetime through respawn, kill credit, and remote typed presentation; mobile captures cover the initial shape, collapse, heap and smolder. Other fatal damage keeps its normal explosion.

Fuel controls each turbo's duration: `2 + 0.8 × (Fuel − 1)` seconds. Houston alone has 5 Fuel (5.2 seconds); every other character has at most 3. `fuel.test.js` checks all character durations in Grand Prix, solo Arena and Rust multiplayer, plus immediate/queued client prediction and server agreement. The character browser group checks Fuel bars and duration tooltips.

The character browser group checks the selection preview for all ten characters, orbiting camera, pause/resume, four gesture stages, and unchanged live-game inventory. Preview rendering must stop once a match starts.

Pearococo coverage includes local and remote royal waves, fairy-dust boost/flip/chaff and protection, and pink ballet-pump Vulcan shots. The preview checks framebuffer changes in her rippling fan and folded silhouette with the camera held still, and reproducible pixels when its animation clock is restored. Boosting must smoothly fold only that player's tail, with both local and remote tails reopening afterward. Combat tests preserve normal damage, inventory and kill credit; recovery and capacity tables include her Cuteness 5 and Intelligence 4.

Avita-Jas is included in the character browser group: character selection, local/remote Cessna rendering, animated propeller, boost/loop vapor trails, and local/remote electron Vulcan shots. `avita.test.js` verifies ordinary Vulcan damage and ammunition rules in solo and Rust combat; room, recovery, inventory, and Hedgeguard tests include the worm pilot.

Houston's Starship is covered in the selection preview and arena screenshots, with local turbo exhaust, somersault maneuvering jets, and remote engine effects. Her existing local/remote Vulcan helmet launch, bare head, and helmet restoration checks also run with the spacecraft.

Hedgeguard coverage in `hedgeguard.test.js` exercises both solo and Rust combat: rare spawn timing, 25-second protection, ordinary/Vulcan/cricket/dollar shot immunity, A-bomb damage immunity, stink-bomb dizziness immunity, missile damage, expiration, death/respawn, and immediate pickup feedback with remote replication. The character browser group checks local and remote orbiting shield/cricket/money auras, the countdown, and expiry under all four network profiles.

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

The character group verifies ten menu choices, selects the elephant, cricket, astronaut sloth Houston, and Elon/Roadster through the live lobby, checks that remote players receive the same character, renders all four in WebGL, and schedules their synthesized calls. It checks Cuteness and Intelligence bars and authoritative recovery in the local HUD and remote snapshots. Houston's helmet must spin upward during Vulcan activation, stay off afterward, and return when Vulcan ends; the same animation is checked on a remote Houston. Roadster turbo and somersault checks require white vapor and a remotely visible somersault. Screenshots are saved alongside the results for visual review. Run it alone with:

```sh
npm run test:browser-netcode -- --characters --output /private/tmp/wild-wheels-characters.json
```

The Roadster's procedural body and effects draw on [Tesla's Roadster reference](https://www.tesla.com/roadster): a low sports-car body, full-width rear light, rear cold-gas thrusters, and perimeter jets for upward/rotational movement. Its body and chaff stay white in every player slot. Its four rear nozzles emit white condensation during boost, with additional underbody jets during somersaults. These are visual effects; multiplayer driving and weapon balance stay shared across characters.

Arena recovery restores one heart every `14 - 2 × cuteness` seconds after the last damaging hit, up to the normal three hearts. Pip, Ellie, Tamar and Houston have 5 cuteness (4 seconds); Felix and Benny have 4 (6 seconds); Rocco has 3 (8 seconds); Elon has 1 (12 seconds). Bonus hearts remain available through pickups and Vulcan rewards. Heart recovery pauses for menus, countdowns, AFK, wrecks and the ending; respawning clears recovery progress. Bombers do not regenerate health. Hedgehog ammo replenishes every `2.25 - 0.25 × cuteness` seconds (1 second at 5 cuteness, 2 seconds at 1), up to the Intelligence carrying limit; damage does not restart ammo recovery. `recovery.test.js` exercises these rules in both simulation engines, including resumption and peer snapshots. The Rust simulation parity test uses the current solo Arena implementation; the historical benchmark reference remains frozen.

Intelligence limits hedgehogs to `10 + 2 × (intelligence - 1)` and missiles, turbos, A-bombs and stinkbombs to `intelligence + 1` of each. Pickups, regeneration and client speculation obey those limits; choosing a less intelligent character clamps stored inventory. Everyone starts and respawns with ten hedgehogs. Regular hedgehog cooldown is 0.225 seconds; Vulcan stays at 0.075 seconds and missiles at 0.9 seconds. `intelligence.test.js` covers all eight characters, capped bomber refills, native client pickup prediction and four held-fire shots in 0.9 seconds.

Elon's Vulcan renders spinning dollar bundles for local predicted and remote shots. The character group verifies both paths and the Dollar Vulcan label. Projectile damage, trajectories and fire rate use the shared Vulcan rules.

The actual room host wins a tie for the highest points, including when they have more deaths; ties that do not involve the host still use deaths and player ID. The ending announcement and final leaderboard explicitly say `TIE ON POINTS · HOST WINS`, preserving the actual point and death totals. `host-tie.test.js` checks both host slots, per-player victory/finish events, packets and client rendering; the controls group checks the final on-screen notice and tied rows.

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
