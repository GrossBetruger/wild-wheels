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
