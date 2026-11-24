# Ideas that require strong AI

1. **Create low-performance-cost versions of the most graphics-demanding effects.**
   Preserve each effect's identity and gameplay readability while reducing geometry,
   particles, transparency overdraw, shader work, and allocations. Use measured
   effect costs to prioritize the work, and keep browser and native visuals in sync
   through the existing graphics port. Compare the original and cheaper versions
   visually and on slower hardware before choosing quality thresholds.
   Use the [visual effect cost report](effect-costs.md) as the initial prioritization
   baseline; its browser timings need separate validation on native and slower GPUs.

2. **Commentator.** A sports commentator powered by a small language model (SLM),
   prompted to comment on arena events in real time and potentially fine-tuned
   later. Deliver the commentary in a natural-sounding human voice.

3. ~~**Automatic HTML-to-texture port for browser UI overlays in native Rust.**~~ **(Done)**
   Implemented in `scripts/build/ui-port.mjs`, `scripts/build/port-ui.mjs`, and
   `native-client/src/ui_port.rs`: headless Chrome renders the browser's themed
   HTML/CSS announcement and reward cards (`ui/ability-announcements.js`,
   `ui/reward-notice.js`, `style.css`) into transparent 2× RGBA textures (`ui.wwup`)
   at build time, and `native-client/src/hud.rs` displays them with entrance/exit
   motion, dynamic subtitles, and radial burst sparks.

4. **Consolidate the browser client's "brain" onto `rust-core.wasm` (while keeping
   rendering, audio, and DOM UI in JS).**
   Do *not* compile the full Bevy `native-client` to WASM (that would bloat a ~1 MB
   instant-load web game into a 60+ MB download with baked `.wwgp`/`.wwsp`/`.wwup`
   packs and degrade web/mobile/RTL chat UX). Instead, expose the already-shared,
   Bevy-free Rust client modules through `rust-core.wasm` and retire duplicated JS
   implementations:
   - **Prediction, reconciliation & packet decoding:** Expose `NativeClient`
     (`rust-core/src/arena/client/native.rs`) over WASM and replace the parallel JS
     implementations in `client/prediction.js`, `client/playback.js`, and
     `gameplay/core-view.js` so browser and native share bit-for-bit identical
     netcode, prediction, smoothing, and inline server-defined arena handling.
   - **Retire duplicate JS combat/gameplay simulation:** Route remaining JS
     single-player and prediction callers (`gameplay/combat.js`,
     `gameplay/special-abilities.js`, etc.) through `rust-core.wasm` so gameplay
     fixes and new mechanics (e.g., spawn clearance, Easter eggs, abilities) never
     drift between Rust and JS.
   - **Shared HUD/feedback state machine:** Drive browser DOM notices, phase
     banners, and ability card triggers from `rust-core/src/arena/client/feedback.rs`
     via WASM while keeping actual rendering in HTML/CSS.
   - **Keep in browser JS/WebGL/DOM:** Procedural WebGL renderer (`client/renderer.js`
     as the canonical art source), WebAudio, HTML/CSS HUD/menus/chat/mobile controls,
     and WebSocket/WebRTC transport glue — preserving the ~1 MB web payload.
