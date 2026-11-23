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

3. **Automatic HTML-to-texture port for browser UI overlays in native Rust.**
   Port the browser's HTML/CSS overlays and themed announcements (starting with special
   ability announcements and reward notices in `ui/ability-announcements.js`,
   `ui/reward-notice.js`, and `style.css`) into the native Rust Bevy client by
   rendering the real HTML/CSS to transparent textures at build time, so browser CSS
   stays the single source of truth and native announcements match the browser
   visually instead of using plain flat text boxes.
