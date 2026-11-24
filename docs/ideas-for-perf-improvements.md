# Ideas for Performance Improvements

Prioritized from real production telemetry (299 matches / 40,214 log lines across browser, native, and dedicated server) combined with the local [visual effect cost report](effect-costs.md).

## Key Telemetry Findings

- **Dedicated server is not a bottleneck:** `tickP99Us ≈ 47 µs` (`0.047 ms`), `0` tick overruns across 5,280 logged server-minutes.
- **Native client is already fast in normal play:** `8.3 ms` median (`120 FPS`); `7.9%` of matches (11/140) had a slow minute, half of which were network gaps rather than slow frames. Real native frame spikes (`110–187 ms` max) clustered during heavy overlapping ability bursts (`Reverse Psychology` + `Fashion-Statement` + `Special Relativity` + `rapid fire`).
- **Browser client is the primary bottleneck:** `29.6%` of browser matches (47/159) had slow minutes (`p95` `46–151 ms`, worst frames up to `494 ms`, occasionally stalling the main thread long enough to trigger server disconnects: *"the client did not take a message within 2 seconds"*).
  - **70% of browser slow-minutes (58/83)** occurred in **Bomber (top-down overview) mode**, where the entire arena's geometry and effects render simultaneously.
  - **71.7% of `>50 ms` browser spikes** occurred with **`rapid fire` (Vulcan)** active, followed by **`Reverse Psychology` (37.6%)**, **`Karmic Raccooning` (21.5%)**, **`Special Relativity` (20.9%)**, **`Ring of Fire` (14.6%)**, and **`Dark Humor` (9.4%)**.

---

## Ranked Improvement Ideas

1. **Cache & instance dynamic meshes in `client/renderer.js` (Highest overall impact — helps both browser & native)**
   - Browser frame cost is dominated by **JS CPU vertex generation and `gl.bufferData` uploads** (`400–660 KiB/frame` per heavy effect), not GPU shaders:
     - **Celebrations** (`+3.1–4.1 ms CPU`, `~475 KiB/frame`) bypass the cached racer model and rebuild the kart from scratch every frame.
     - **Fire Ring** (`+3.9 ms CPU`, `5,760` triangles, `619 KiB/frame`), **Locust swarms** (`+3.7 ms CPU`, `556 KiB/frame`), **Ashes** (`+3.4 ms CPU`, `480 KiB/frame`), and **20 projectiles + trails** (`+2.4–3.4 ms CPU`, `490 KiB/frame`) all rebuild geometry into `m.data` every frame.
   - Moving these onto cached GPU buffers (`this.model(...)` / instanced transforms) eliminates the biggest CPU + upload bottleneck in the browser — and because `scripts/build/graphics-port.mjs` records `this.model(...)` instances as reusable static parts, it **automatically shrinks `graphics.wwgp` and reduces runtime decompression/upload churn in `native-client/src/ported.rs` too**.

2. **Bomber-view LOD in `client/renderer.js` (Fastest high-ROI win — targets 70% of browser slow-minutes)**
   - When `overview` (Bomber camera) is active, skip or simplify sub-pixel geometry that is invisible from altitude: skid marks, per-step projectile trail spheres, dense drift sparks/smoke, and fine character/hat details.
   - Prevents main-thread stalls that currently drop Bomber players to `<10 FPS` and cause WebSocket read timeouts.

3. **Optimize `rapid fire` (Vulcan) projectiles & trails**
   - Present in `71.7%` of browser `>50 ms` spikes.
   - Replace per-frame sphere/trail triangle generation for Vulcan shots and normal projectile trails with cached meshes or lightweight point sprites, and cap trail segments under heavy multi-player fire.

4. **Low-performance-cost versions of heavy GPU/CPU effects (see `ideas_that_require_strong_ai.md` #1)**
   - Target **Dark Humor** (`+1.47 ms` GPU — the largest GPU cost via full-screen fog + X-ray pass, plus `35,139` triangles), **Fire Ring** (`432` particles), **Locust swarms**, and **Nightmare Fuel** (whose half-length ending currently keeps full geometry/particle counts).
   - Provide quality thresholds / cheaper visual variants synced through the graphics port.

5. **Hierarchical / transform-driven `graphics.wwgp` for native client (see `ideas_that_require_strong_ai.md` #9)**
   - Replace per-frame baked dynamic meshes in `graphics.wwgp` (`~47 MB`) with static rigid-part meshes animated by Bevy `Transform`s.
   - Eliminates mid-battle worker-thread zlib decompression, `Assets<Mesh>` GPU uploads, and 12-second cache eviction/rebuild cycles during overlapping ability bursts in `native-client/src/ported.rs`, while also shrinking binary size and build times.
