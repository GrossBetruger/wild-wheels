---
name: graphics-uplift
description: >-
  Uplift Wild Wheels 3D visuals in the Bevy WASM PoC (wasm-poc/) using headless
  Blender 5.3 PBR .glb modeling, procedural Bevy meshes/VFX, dynamic lighting,
  and physics-driven particles. Use when upgrading racers, vehicles, props,
  afterburners, explosions, smoke, fire, arena lighting, or visual polish in
  wasm-poc/.
---

# Wild Wheels 3D Graphics Uplift

Use this workflow to turn flat/legacy visuals into rich, lived-in 3D PBR assets
and reactive Bevy VFX in `wasm-poc/`. Keep all PoC work strictly isolated to
`wasm-poc/` unless the user explicitly asks to modify the main game.

## 1. Choose the Right Technique

| Target | Method | Reference |
| :----- | :----- | :-------- |
| Racers, vehicles, articulated parts (tails, arms, turrets), arena props | **Blender 5.3 headless Python → `.glb` PBR** | `wasm-poc/blender/build_taicoon.py`, `wasm-poc/blender/build_houston.py` |
| Explosions, smoke plumes, fire, shockwaves, splinters, sparks, afterburner plumes, dynamic lights | **Procedural Rust/Bevy meshes + physics + dynamic materials** | `wasm-poc/src/explosions.rs`, `wasm-poc/src/scene.rs` |
| Live HUD, menus, telemetry | **HTML/CSS overlay** | `wasm-poc/index.html` |

## 2. Blender 5.3 PBR Character & Vehicle Pipeline

### Fidelity First (Never Rush Placeholders)
1. Read the canonical racer/vehicle definition in `client/characters.js` (and `client/renderer.js` if it has custom animations) before writing any Blender script.
2. Preserve every iconic silhouette cue, color accent, posture, and personality trait—upgrade the craft and realism, never replace the character's identity.
3. **Avoid sterile plastic looks**: add panel seams, bevels, rivets/weld rings, scorch/soot gradients, weathered metallic/roughness contrast, heat-blued exhaust hardware, and believable proportions.

### Articulated Parts for Procedural Animation
- Export moving appendages as **separate `.glb` files** authored with their **hinge/root at `(0, 0, 0)`** (e.g. `taicoon_tail.glb`, `houston_arm_l.glb`, `houston_arm_r.glb`).
- Attach them in Bevy as child entities at their socket offset so Bevy drives smooth runtime motion (tail wiggle, waving arms, drift lean, recoil) without needing heavy skeletal rigs.

### Authoring & Exporting in Blender 5.3
- Write a self-contained generator script at `wasm-poc/blender/build_<name>.py` that clears the scene, builds geometry + Principled BSDF materials, applies smooth shading, and exports with `bpy.ops.export_scene.gltf(..., export_format='GLB', export_yup=True)`.
- Run headlessly:
  ```sh
  /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_<name>.py
  ```
- Export assets to `wasm-poc/assets/models/<name>.glb`.
- Keep triangle counts WASM-friendly (~2k–15k tris per racer) so load times and WebGL2 draw costs stay low.

## 3. Procedural Bevy VFX & Lighting Craft

### Explosions (`wasm-poc/src/explosions.rs`)
Layer multiple physical systems so blasts feel weighty and alive:
1. **Dynamic Blast `PointLight`**: high-intensity warm orange light with fast flicker and quadratic decay.
2. **Blinding Flash Core**: brief white-hot expanding sphere that snaps out quickly.
3. **Ground Shockwave Ring**: rapidly expanding flat torus/ring skimming the arena floor.
4. **Buoyant Fireball Lobes**: 15–20 spinning, rising, drag-damped glowing lobes.
5. **Turbulent Cauliflower Smoke** — *never use smooth opaque gray spheres*:
   - Build a procedural cloud mesh at startup (`build_cloud_mesh`) by displacing a subdivided icosphere with multi-octave sin/cos turbulence and **recomputing smooth vertex normals** so puffs catch dynamic lights.
   - Spawn a 2-stage plume (~28 puffs): low ground-skirt dust/soot clouds rushing outward + rising buoyant mushroom-column/vortex clouds.
   - Give each puff an `AlphaMode::Blend` `StandardMaterial` whose internal fireball `emissive` (`hot_glow`) cools rapidly into dark brooding soot while the puff **keeps expanding and fades smoothly to `alpha = 0.0`** (never shrink smoke like a rubber ball).
6. **Bouncing 3D Splinters & Shrapnel**: gravity-driven tumbling chunks/hot embers that bounce off `y = 0.14` with restitution, floor friction, and secondary bounce sparks.
7. **Ricocheting Spark Streaks**: thin velocity-aligned emissive streaks that bounce and stretch with speed.

### Afterburners & Exhaust Plumes
- Never attach disconnected gray smoke balls behind a thruster.
- Combine:
  - Layered additive flame cones (outer reddish/orange envelope + hot inner core + Mach shock diamonds).
  - Elongated swept additive/blended exhaust streaks tightly anchored to the engine bells.
  - A dynamic downward/rearward `PointLight` illuminating the arena floor.
- Differentiate **cruise/non-boost** (longer, smokier, warmer/reddish, clearly alive) from **boost/Nightmare Fuel** (intense, roaring, crisp Mach diamonds, stronger flicker).

## 4. Bevy 0.20 WASM Gotchas

- **Loading `.glb` scenes**: `asset_server.load(GltfAssetLabel::Scene(0).from_asset("models/<name>.glb"))` spawned via `WorldAssetRoot`.
- **Child visibility on death/hide**: Setting `Visibility::Visible` on a child overrides a parent's `Visibility::Hidden`! Use `Visibility::Inherited` on attached parts/VFX (and hide/scale down when `!racer.alive`) so afterburners and accessories vanish when a racer explodes.
- **API names in Bevy 0.20**:
  - `PointLight` uses `shadow_maps_enabled` (not `shadows_enabled`).
  - `StandardMaterial` uses `perceptual_roughness` (not `roughness`).
  - `Assets::get_mut(&handle)` returns `Option<AssetMut<'_, T>>` — bind with `if let Some(mut m) = materials.get_mut(&handle)`.
- **Prevent material leaks**: Whenever an entity owns a per-instance dynamic `Handle<StandardMaterial>` (like fading smoke puffs), call `materials.remove(&handle)` right before `commands.entity(ent).despawn()`.

## 5. Build, Serve & Verify Loop

1. **Rebuild WASM + JS bindings**:
   ```sh
   cargo +1.97.1 build --release --target wasm32-unknown-unknown --manifest-path wasm-poc/Cargo.toml && \
   wasm-bindgen --target web --no-typescript --out-dir wasm-poc/pkg wasm-poc/target/wasm32-unknown-unknown/release/wild_wheels_wasm_poc.wasm
   ```
2. **Serve locally with cache disabled & perf logging**:
   ```sh
   python3 wasm-poc/serve.py
   ```
   Open `http://127.0.0.1:8088/` (hard-refresh `Cmd+Shift+R` after rebuilds).
3. **Visually inspect & check perf**:
   - Inspect in-engine (or via headless Chrome screenshot) from gameplay camera angles, during idle, boost, firing, and explosions.
   - Check `wasm-poc/perf-log.jsonl` (gitignored) to confirm frame times stay smooth and there are no console errors or material/entity leaks.
4. **Commit & push** completed changes in `wasm-poc/` (do not commit `wasm-poc/target/` or `wasm-poc/perf-log.jsonl`).
