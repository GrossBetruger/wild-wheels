# Project structure and file guide

Start with `client/game.js` to follow the browser game, `server.js` for the Node server, and `gameplay/combat.js` for JavaScript arena rules. The Rust arena simulation lives in `rust-core/src/arena/`. Run commands from the project root.

## Root files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure, menus, game canvas, and browser entry script. |
| `style.css` | Page layout, menus, controls, and visual styling. |
| `server.js` | Node entry point: serves public files, attaches multiplayer, and exposes build information. |
| `public-assets.json` | Explicit list of files the servers may serve to browsers. Update it when moving or adding public assets. |
| `package.json` | JavaScript dependencies and named commands such as `npm test`. |
| `package-lock.json` | Exact installed JavaScript dependency versions. |
| `rust-core.wasm` | Compiled Rust simulation loaded by JavaScript; rebuild with `npm run build:core`. |
| `README.md` | Instructions for running and playing the game. |
| `AGENTS.md` | Repository development instructions for coding agents. |
| `install_ubuntu.sh` | Installs the dependencies needed for Ubuntu hosting. |
| `run_server.sh` | Builds and starts the native server in the background. |
| `kill_server.sh` | Stops the native server started by the launcher. |
| `update_server.sh` | Updates the hosted checkout and restarts the native server. |

## Gameplay

| File in `gameplay/` | Purpose |
| --- | --- |
| `engine.js` | Driver definitions and stats, race state, driving, and item rules. |
| `combat.js` | JavaScript arena state, damage, weapons, pickups, bots, and match progression. |
| `track.js` | Track geometry shared by driving, camera positioning, and the minimap. |
| `special-abilities.js` | Ability descriptions, activation, cooldowns, and shared ability behavior. |
| `bicycle-pickup.js` | Shared bicycle pickup animation and landing calculations. |
| `arena-core.js` | Loads WebAssembly and exposes Rust arena and client simulation operations to JavaScript. |
| `core-view.js` | Reads live simulation data from WebAssembly memory for JavaScript consumers. |

## Browser client

| File in `client/` | Purpose |
| --- | --- |
| `game.js` | Connects menus, input, rendering, audio, networking, and the game loop. |
| `renderer.js` | WebGL rendering, cameras, vehicles, characters, and effects. |
| `characters.js` | Shared procedural character, vehicle, and projectile models. Some character models still live here. |
| `character-preview.js` | Character selection preview display. |
| `preview-pose.js` | Animation poses and gestures for previews. |
| `prediction.js` | Immediate local movement and reconciliation with authoritative updates. |
| `playback.js` | Interpolates network snapshots for smooth remote presentation. |

## Character folders

Each `*.test.js` file checks the feature named in its filename. Character folders contain dedicated models and behavior; shared rendering and ability coordination also remain in `client/` and `gameplay/`.

| Folder | Files and purpose |
| --- | --- |
| `characters/master-yuda/` | `master-yuda.js`: motorcycle, rider, stunts, and related visuals. `yuda-drift.js`: Yuda drift presentation. `fire-ring.js`: fire ring gameplay. `fire-ring-visual.js`: fire ring rendering. Tests: `master-yuda.test.js`, `yuda-drift.test.js`, `yuda-stunts.test.js`, `yuda-exhaust.test.js`, `yuda-jacket.test.js`, `fire-ring.test.js`. |
| `characters/r-yeah/` | `r-yeah.js`: lion, helicopter, and archangel models. `r-yeah-logo.js`: model logo data. `r-yeah.test.js`: character coverage. `tehilim.test.js`: protective book pickup and missile behavior. |
| `characters/pearococo/` | `pearococo.js`: peacock and rococo vehicle models. `pearococo.test.js`: character coverage. `fashion-statement.test.js`: special ability damage and activation. |
| `characters/catheterpillar/` | `catheterpillar.js`: character, ambulance, and related visuals. `catheterpillar.test.js`: character and healing coverage. |
| `characters/fourmidable/` | `fourmidable.js`: ant, calculator vehicle, and related visuals. `fourmidable.test.js`: character and special ability coverage. |
| `characters/knowitowl/` | `knowitowl.js`: owl, bicycle, and related models. `dark-humor.js`: Dark Humor state, fog shader, and visibility rules. `dark-bomb-light.js`: bomb illumination calculations during darkness. `bat-companion.js`: companion aiming and model. Tests: `knowitowl.test.js`, `dark-bomb-light.test.js`, `bat-companion.test.js`. |
| `characters/tammy/` | `cricket-teleport.js`: safe teleport behavior. `cricket-teleport.test.js`: teleport coverage. |
| `characters/houston/` | `houston-gravity.test.js`: gravity ability coverage. |
| `characters/avita-jas/` | `avita.test.js`: Avita-Jas and relativity coverage. |

## Interface

| File in `ui/` | Purpose |
| --- | --- |
| `chat.js` | Room chat UI, separate conversation views and drafts, message bubbles, polling, and input isolation. |
| `match-layout.js` | Moves chat to the sidebar and the live map into the game during a match; restores the lobby layout afterward. |
| `mobile.js` | Touch device detection, bomber camera calculations, aiming, and panning helpers. |
| `feedback.js` | Immediate local visual feedback for actions before server confirmation. |
| `drift-feedback.js` | Local drift charge and related presentation. |
| `combat-notices.js` | Kill celebrations, chaff notices, and fire ring notices. |
| `nameplates.js` | Computes visible racer nameplates and screen positions. |
| `results.js` | Match results, finish ordering, placement labels, and tie notices. |

## Audio and recordings

| File | Purpose |
| --- | --- |
| `audio/audio.js` | Main sound engine and game sound effects. |
| `audio/action-audio.js` | Plays local action sounds immediately and avoids duplicate confirmation sounds. |
| `audio/recorded-laughter.js` | Loads and plays the Dark Humor recordings. |
| `assets/audio/dark-humor-crowd.ogg` | Recorded crowd laughter. |
| `assets/audio/dark-humor-solo.flac` | Recorded solo laughter. |

## Networking and servers

| File | Purpose |
| --- | --- |
| `networking/network.js` | Browser connection, rooms, lobby actions, and network updates. |
| `networking/wire.js` | Snapshot serialization and reconstruction helpers. |
| `networking/binary-wire.js` | Binary snapshot encoding and decoding. |
| `server/chat.js` | Bounded room chat history, validation, rate limits, and private message filtering. |
| `server/multiplayer.js` | Node multiplayer rooms, sessions, requests, sockets, and simulation scheduling. |
| `server/photo-album.js` | Node server storage and retrieval of match photos. |
| `server/ngrok.js` | Finds the public tunnel URL for the local game server. |
| `server/tunnel-control.js` | Local control endpoint for starting and stopping the tunnel process. |

## Photos

| File in `photos/` | Purpose |
| --- | --- |
| `photography.js` | Canvas snapshots, JPEG encoding, photo controls, uploads, and slideshow UI. |
| `photo-protocol.js` | Shared photo limits, validation, and slideshow timing. |

## Tests

The files in `tests/` are automated checks, not game entry points. `npm test` discovers these tests and the tests inside character folders.

| Folder | Test files and coverage |
| --- | --- |
| `tests/arena/` | `arena-core`: Rust simulation bridge. `arena-client`: Rust client prediction. `arena-room`: room behavior. `arena-lifecycle`: repeated match transitions. `dedicated-core`, `dedicated-room`: native arena and room integration. |
| `tests/combat/` | `combat`: general combat. `combat-hazards`: bombs, dizziness, and wall crashes. `ending-combat`: combat during match ending. `bomber`: bomber rules. `stinkbomb`: gas effects and scoring. `radiation`: lingering radioactive damage. `hedgeguard`: protective pickup. `spawn-vulnerability`: unprotected spawns. `incoming`: missile warnings. `special-abilities`: shared abilities. `bot-visibility`: bot visibility rules. |
| `tests/gameplay/` | `engine`: core race rules. `movement`: driving. `somersault`: flips. `fuel`: boost duration. `intelligence`: capacity rules. `recovery`: replenishment. `bicycle-pickup`: dropped bicycles and upgrades. |
| `tests/networking/` | `wire`, `binary-wire`: snapshot formats. `netcode`: synchronization and delayed network updates. |
| `tests/multiplayer/` | `chat`: authenticated public and private messages, session isolation, limits, and history. `multiplayer`: HTTP and socket integration. `auto-start`: countdown behavior. `play-request`: requests to start. `host-tie`: host and tie behavior. |
| `tests/client/` | `prediction`: local movement reconciliation. `playback`: snapshot presentation. `preview-pose`: preview gestures. `benchmark`: validation of projectile motion measurements. |
| `tests/ui/` | `chat`: separation of Everyone and individual private conversations.  `feedback`, `drift-feedback`, `chaff-feedback`, `kill-feedback`: action presentation. `nameplates`: racer labels. `mobile`: touch and bomber controls. `results`: results ordering and labels. |
| `tests/server/` | `ngrok`: tunnel URL selection. `tunnel-control`: local tunnel control restrictions and lifecycle. |
| `tests/audio/` | `action-audio`: immediate sounds and duplicate prevention. |
| `tests/photos/` | `photography`: photo encoding, validation, storage, and slideshow behavior. |

Names in this table omit the common `.test.js` ending. To run one group, use a shell glob, for example `node --test tests/arena/*.test.js`.

## Scripts

Scripts are development tools. Run their commands from the project root. The existing npm command names remain the same after the folder reorganization.

| Folder | Files and purpose |
| --- | --- |
| `scripts/build/` | `build-rust-core.mjs`: compiles Rust into the root `rust-core.wasm` artifact. `port-graphics.mjs`, `graphics-port.mjs`: port the browser renderer's graphics into the native client build. `port-sounds.mjs`, `sound-port.mjs`: port the browser's synthesized sounds the same way. |
| `scripts/checks/` | `check-chat-browser.mjs`: public and private chat in three browsers, typing isolation, and mobile layout. `check-netcode.mjs`: network simulation checks. `check-browser-netcode.mjs`: browser runner with latency profiles and selectable scenarios. `check-regressions.mjs`: runs automated and browser scenario checks together. `check-photo-browser.mjs`: photo workflow in browsers. `check-dedicated-server.mjs`: native server integration. `check-dedicated-browser.mjs`: browser clients against the native server. `check-server-commands.mjs`: launcher, stop, and update integration. `check-ubuntu-install.sh`: install and startup verification in a disposable Ubuntu environment. |
| `scripts/scenarios/` | `check-controls-scenario.mjs`: player controls. `check-characters-scenario.mjs`: character selection and behavior. `check-preview-scenario.mjs`: previews. `check-tehilim-scenario.mjs`: protective books. `check-pearococo-scenario.mjs`: Pearococo. `check-drift-scenario.mjs`: drifting. `check-specials-scenario.mjs`: abilities. `check-feedback-scenario.mjs`: action feedback and motion measurements. `check-yuda-scenario.mjs`: Master-Yuda. `check-r-yeah-scenario.mjs`: R-yeah. `check-room-scenario.mjs`: rooms and rejoining. `check-mobile-scenario.mjs`: mobile controls. These modules are used by the browser runners. |
| `scripts/profiling/` | `profile-network.mjs`: network measurements. `profile-performance.mjs`: simulation and encoding measurements. `benchmark-dedicated.mjs`: native server benchmark. `compare-encoding.mjs`: snapshot encoding comparisons. `compare-owned-state.mjs`: state ownership experiment measurements. |
| `scripts/reports/` | `report-drift.mjs`, `report-feedback.mjs`, `report-netcode.mjs`: turn recorded diagnostics into HTML reports. `summarize-core-profile.mjs`: combines profiling and regression measurements into a summary. |
| `scripts/helpers/` | `arena-fixture.mjs`: mutable test adapter for a Rust arena. `reference-combat.mjs`: reference JavaScript combat implementation for comparisons. |
| `scripts/server/` | `server-process.sh`: shared process tracking and locking for the root server launch and stop commands. |
| `scripts/encoding-lab/` | `codecs.mjs`: experimental codecs. `browser.mjs`: browser measurements. `kernel.rs`: Rust encoding experiment. |
| `scripts/owned-state-lab/` | `experiment.mjs`: state ownership experiment. `browser.mjs`: browser measurements. `src/lib.rs`: Rust experiment implementation. `Cargo.toml`, `Cargo.lock`: experiment dependencies and build configuration. |

Use `npm run test:netcode` for the network checks, `npm run build:core` to rebuild Wasm, and `npm run profile:network` for network profiling. Browser and native checks have their own requirements; see the existing testing and hosting documentation.

## Rust simulation

| File in `rust-core/` | Purpose |
| --- | --- |
| `Cargo.toml`, `Cargo.lock` | Rust package configuration and pinned dependencies. |
| `src/lib.rs` | Shared simulation kernel and exported entry points, including the WebAssembly interface. |
| `src/arena/mod.rs` | Arena module assembly and core game operations. |
| `src/arena/types.rs` | Arena entities, commands, and state types. |
| `src/arena/control.rs` | Arena configuration and control operations. |
| `src/arena/movement.rs` | Actor movement and driving. |
| `src/arena/tick.rs` | Advances the simulation frame. |
| `src/arena/weapons.rs` | Weapons, projectiles, damage, and related combat behavior. |
| `src/arena/specials.rs` | Special ability behavior. |
| `src/arena/fire_ring.rs` | Master-Yuda fire ring simulation. |
| `src/arena/bat.rs` | Bat companion simulation. |
| `src/arena/bicycles.rs` | Bicycle drops and pickups. |
| `src/arena/client.rs` | Rust client prediction and reconciliation. |
| `src/arena/client/feedback.rs` | Immediate client action feedback. |
| `src/arena/presentation.rs` | Simulation data prepared for rendering. |
| `src/arena/packet.rs` | Network packet generation and handling. |
| `src/arena/native.rs` | Owned native arena interface used outside WebAssembly. |

## Native dedicated server

| File in `dedicated-server/` | Purpose |
| --- | --- |
| `Cargo.toml`, `Cargo.lock` | Server package configuration and pinned dependencies. |
| `build.rs` | Embeds the public files listed in `public-assets.json` during compilation. |
| `src/main.rs` | Native server startup, HTTP and socket handling, and routing. |
| `src/chat.rs` | Native chat history, validation, send limits, and private session filtering. |
| `src/room.rs` | Native multiplayer room and session behavior. |
| `src/photos.rs` | Native photo storage and endpoints. |
| `src/benchmark.rs` | Native performance benchmark implementation. |

## Documentation and generated data

| Location | Purpose |
| --- | --- |
| `docs/audio-credits.md` | Recording provenance and credits. |
| `docs/bicycle-pickup.md` | Bicycle pickup behavior and verification. |
| `docs/dedicated-server.md` | Native server setup and operation. |
| `docs/dedicated-server-results.json` | Recorded native server results. |
| `docs/encoding-comparison.md` | Snapshot encoding experiment results. |
| `docs/owned-state-experiment.md` | State ownership experiment design and results. |
| `docs/performance.md` | Performance measurements and methodology. |
| `docs/photography.md` | Photography behavior and protocol. |
| `docs/ring-of-fire.md` | Fire ring behavior and verification. |
| `docs/rust-core.md` | Rust simulation architecture and integration. |
| `docs/testing.md` | Feature expectations and verification commands. |
| `docs/project-structure.md` | This file and folder guide. |
| `diagnostics/` | Saved benchmark traces, JSON measurements, compressed traces, and generated HTML reports. |
| `node_modules/` | Installed npm packages; generated by npm. |
| Rust `target/` directories | Compiled Rust build output, when present. |

Git metadata and local editor or runtime settings are separate from game source. Avoid editing generated output as a substitute for editing its source.
