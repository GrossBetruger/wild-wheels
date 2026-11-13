# Development checks

R-yeah is driver 11: a lion with a black kippah, hanging outside a small JetRanger from its landing skid. He waves with one paw normally and grips with both paws during boost. The full layered mane waves in the wind three times faster during boost; the main rotor tilts forward. Both sides carry the blue IAI mark. Character checks cover front/side/chase-camera visibility, main/tail rotor animation locally and remotely, rotor-wash boost and somersaults. Room, weapon, recovery, capacity and Fuel tests include him. Reflected Tehilim missiles now travel at 100 units/s, turn at 10 radians/s, lead moving shooters and get six seconds to pursue; normal missiles retain their existing handling.

Tehilim vs Tilim spawns once after 30 seconds, refills 45 seconds after pickup and lasts 25 seconds, matching Hedgeguard's rarity. Six orbiting books repel an incoming locked missile after it passes halfway between its shooter and target. The missile loses its lock and curves away under an outward force; ownership remains with the shooter. Unlocked missiles and other weapons still deal damage. R-yeah’s active Providence ability exclusively returns missiles to their shooter. `tehilim.test.js` covers timing, damage, midpoint, repulsion trajectory, unchanged ownership, exclusive Providence reflection, immediate pickup and remote aura. `npm run test:browser-netcode -- --tehilim` checks the books, repulsion, survival and expiry in all four connection profiles.

Drivers have no spawn immunity at match start, when joining an active room, or after respawning. `tests/combat/spawn-vulnerability.test.js` verifies immediate projectile damage in both engines and unprotected native room spawns. Hedgeguard remains a separate collectible power-up.

Chaff diverts owner-targeted missiles within 40 units of its cloud, with a clear path. Boundary tests cover both simulation engines. Radiation kills use the Chernowhacked celebration with a combined radiation/hammer-and-sickle emblem and warning colors.

A-bombs leave a radioactive zone covering the full 28-unit blast footprint for 8 seconds. Contact deals 1 damage immediately and every second afterward; leaving and re-entering starts a new immediate dose. Respawn shields and Hedgeguard protect against radiation. Radiation kills credit the bomb's owner and produce ash. `tests/combat/radiation.test.js` covers dose timing, boundaries, shields, expiry, re-entry, credit and remote presentation in both engines; the mobile group checks fallout replication and visuals.

Combat hazards: A-bombs deal 5 damage within 22 units and 3 damage in the outer ring through 28 units. Dizziness lasts 8 seconds, with stronger steering disturbance and camera sway during boost. Wall collisions explode only while boosting and actively drifting; each bomber with active gas credit earns a full point for those fatal crashes. Boost alone, drift alone, and a boost earned by releasing drift remain survivable. Ordinary stink-assisted kills remain half a point. `tests/combat/combat-hazards.test.js` covers radius boundaries, the four boost/drift combinations, multiple bomber credit and stronger boosted swerving in both simulation engines. Movement prediction stops at fatal impacts while the server confirms death and scoring; nonfatal impacts retain control.

A-bomb deaths turn the character and vehicle's last rendered shape into rubble. Chunks collapse smoothly over 1.3 seconds, then smolder for 3 seconds. Combat tests check rubble lifetime through respawn, kill credit, and remote typed presentation; mobile captures cover the initial shape, collapse, heap and smolder. Other fatal damage keeps its normal explosion.

Fuel controls each turbo's duration: `2 + 0.8 × (Fuel − 1)` seconds. Houston alone has 5 Fuel (5.2 seconds); every other character has at most 3. `tests/gameplay/fuel.test.js` checks all character durations in Grand Prix, solo Arena and Rust multiplayer, plus immediate/queued client prediction and server agreement. The character browser group checks Fuel bars and duration tooltips.

The character browser group checks the selection preview for all twelve characters, orbiting camera, pause/resume, four gesture stages, and unchanged live-game inventory. Preview rendering must stop once a match starts.

Master-Yuda coverage includes his sunglasses salute, motorcycle silhouette, local and remote boost/flip exhaust, winged biker protection and laser Vulcan shots. Lasers retain normal Vulcan damage, cadence, ammunition and kill credit in both engines. His flip retains the 180-degree reversal, full rotation and landing; recovery, capacity and fuel tests cover Cuteness 3, Intelligence 5 and Fuel 3.

`npm run test:browser-netcode -- --yuda-drift` checks his floor-level lean, dense scraping trail, smooth recovery and fading sparks under the same 20 ms feedback/frame criteria as ordinary drifting. Cosmetic unit tests cover both lean directions, remote riders, continuous trail coverage, teleports, repeated frames and scene resets. Spark history is bounded and generated from rendered positions without additional network traffic.

Master-Yuda's jacket flies off on boost or Vulcan activation, remains off while either effect is active, then returns through a 0.85-second dressing animation. The character browser group checks flight, bare boost/Vulcan, remote clothing and restoration; unit tests cover overlapping effects, interrupted dressing, independent riders and preview resets.

Boost also raises Yuda into a one-handed wheelie with his rear axle planted. His whack celebration reclines him with feet on the handlebars and hands behind his head. Both ease in/out and yield to drifting, flips and dressing as appropriate. Character browser checks cover both poses locally and remotely; unit checks cover wheel contact, transitions and animation priority.

Yuda's somersault is a low corkscrew: a rolling twist, nose pitch and continuous 180-degree heading change, peaking at 2.8 units of lift and landing wheels-down. The normal 0.55-second maneuver and immediate aim reversal are retained. Unit tests cover launch, twist, low apex and upright landing; browser checks require the corkscrew locally and remotely, with attached exhaust and weapons.

Yuda's boost/flip exhaust leaves dense, overlapping gray smoke clouds in world space for three seconds, obscuring players following him. Unit tests cover lifetime after emission stops, path coverage, remote owners, teleports and resets. The character browser group verifies large smoke puffs and lingering smoke after boost ends alongside the wheelie and celebration checks.

Pearococo coverage includes local and remote royal waves, fairy-dust boost/flip/chaff and protection, and pink ballet-pump Vulcan shots. The preview checks framebuffer changes in her rippling fan and folded silhouette with the camera held still, and reproducible pixels when its animation clock is restored. Boosting must smoothly fold only that player's tail, with both local and remote tails reopening afterward. Combat tests preserve normal damage, inventory and kill credit; recovery and capacity tables include her Cuteness 5 and Intelligence 4.

Avita-Jas is included in the character browser group: character selection, local/remote Cessna rendering, animated propeller, boost/loop vapor trails, and local/remote electron Vulcan shots. `avita.test.js` verifies ordinary Vulcan damage and ammunition rules in solo and Rust combat; room, recovery, inventory, and Hedgeguard tests include the worm pilot.

Houston's Starship is covered in the selection preview and arena screenshots, with local turbo exhaust, somersault maneuvering jets, and remote engine effects. Her existing local/remote Vulcan helmet launch, bare head, and helmet restoration checks also run with the spacecraft.

Hedgeguard coverage in `tests/combat/hedgeguard.test.js` exercises both solo and Rust combat: rare spawn timing, 25-second protection, ordinary/Vulcan/cricket/dollar shot immunity, A-bomb damage immunity, stink-bomb dizziness immunity, missile damage, expiration, death/respawn, and immediate pickup feedback with remote replication. The character browser group checks local and remote orbiting shield/cricket/money auras, the countdown, and expiry under all four network profiles.

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

Arena recovery restores one heart every `14 - 2 × cuteness` seconds after the last damaging hit, up to the normal three hearts. Pip, Ellie, Tammy and Houston have 5 cuteness (4 seconds); Felix and Benny have 4 (6 seconds); Rocco has 3 (8 seconds); Elon has 1 (12 seconds). Bonus hearts remain available through pickups and Vulcan rewards. Heart recovery pauses for menus, countdowns, AFK, wrecks and the ending; respawning clears recovery progress. Bombers do not regenerate health. Hedgehog ammo replenishes every `2.25 - 0.25 × cuteness` seconds (1 second at 5 cuteness, 2 seconds at 1), up to the Intelligence carrying limit; damage does not restart ammo recovery. `tests/gameplay/recovery.test.js` exercises these rules in both simulation engines, including resumption and peer snapshots. The Rust simulation parity test uses the current solo Arena implementation; the historical benchmark reference remains frozen.

Intelligence limits hedgehogs to `10 + 2 × (intelligence - 1)` and missiles, turbos, A-bombs and stinkbombs to `intelligence + 1` of each. Pickups, regeneration and client speculation obey those limits; choosing a less intelligent character clamps stored inventory. Everyone starts and respawns with ten hedgehogs. Regular hedgehog cooldown is 0.225 seconds; Vulcan stays at 0.075 seconds and missiles at 0.9 seconds. `tests/gameplay/intelligence.test.js` covers all eight characters, capped bomber refills, native client pickup prediction and four held-fire shots in 0.9 seconds.

Elon's Vulcan renders spinning dollar bundles for local predicted and remote shots. The character group verifies both paths and the Dollar Vulcan label. Projectile damage, trajectories and fire rate use the shared Vulcan rules.

The actual room host wins a tie for the highest points, including when they have more deaths; ties that do not involve the host still use deaths and player ID. The ending announcement and final leaderboard explicitly say `TIE ON POINTS · HOST WINS`, preserving the actual point and death totals. `tests/multiplayer/host-tie.test.js` checks both host slots, per-player victory/finish events, packets and client rendering; the controls group checks the final on-screen notice and tied rows.

## Targeted checks

Houston's “reine de la paresse” activates an eight-second tractor field with twenty-second recharge. Ready power-ups within 80 units move toward the closest active Houston at 55 units/second; ties use actor ID. Collected power-ups respawn at their original location, and uncollected ones return home on expiry or disable. `houston-gravity.test.js` covers JS/Rust parity, exact range, unavailable pickups, collection, expiry, and simultaneous fields. Chrome checks the moving pickup and its replicated inventory reward.

Fashion-Statement uses F and a twenty-second recharge. It damages every other active racer for two hearts, or one heart at cuteness five, preserves the caster's health, credits kills, and places a pink/gold finger-snap burst above every other active racer, including distant racers. `fashion-statement.test.js` checks both engines, disabled abilities, range, and repeat activation. Browser special-ability checks also verify the overhead effects and time-warp music starts and resolves. A regression in `tests/combat/special-abilities.test.js` ensures time dilation never changes bots into human-controlled actors and they resume driving after it expires.

Special abilities default on and are controlled by the room host. `tests/combat/special-abilities.test.js` checks JS/Rust parity: Catheterpillar activates up to six healing beats at t=0, 1, 2, 3, 4, 5 seconds, each restoring one heart, ending immediately at six hearts; each beat has a replicated heart effect and heartbeat audio; Yuda's three-second boost smoke causes eight seconds of dizziness without affecting its owner; R-yeah activates an eight-second Providence that returns locked missiles without books; Avita-Jas slows opponents and their projectiles to 2.5% speed for 2.5 seconds and has a 20-second cooldown. Disabling abilities releases time immediately and retains ordinary power-ups. R-yeah and Catheterpillar start ready but inactive, require F, and recharge for twenty seconds. Slowed movement commands must be acknowledged without a backlog jump, including client prediction. Tammy teleports to a safe random destination on a somersault; multiplayer landing positions come from the server.

After pushing, run `npm run test:browser-netcode -- --specials` for real Chrome checks of the ability button, movement during and after the freeze, cooldown, holy aura, healing, smoke, and replicated room toggle across host/guest and delayed networks.

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
