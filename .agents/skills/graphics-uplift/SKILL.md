---
name: graphics-uplift
description: >-
  Uplift Wild Wheels 3D visuals in the Bevy WASM PoC (wasm-poc/) using headless
  Blender 5.3 PBR .glb modeling, skeletal rigs with animation clips and shape
  keys, procedural Bevy meshes/VFX, dynamic lighting, and physics-driven
  particles. Use when upgrading or animating racers, vehicles, props,
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
| Living characters and anything that bends: limbs, wings, ears, clothing, gestures, faces | **Blender skeleton + animation clips + shape keys → one skinned `.glb`** (section 3) | `wasm-poc/blender/rigging.py`, `build_yuda.py`, `build_knowitowl.py`, `wasm-poc/src/yuda.rs`, `knowitowl.rs` |
| Vehicles, wheels, turrets, rigid props | **Blender 5.3 headless Python → rigid `.glb` parts** | `wasm-poc/blender/build_taicoon.py`, `wasm-poc/blender/build_houston.py` |
| Explosions, smoke plumes, fire, shockwaves, splinters, sparks, afterburner plumes, dynamic lights | **Procedural Rust/Bevy meshes + physics + dynamic materials** | `wasm-poc/src/explosions.rs`, `wasm-poc/src/scene.rs` |
| Live HUD, menus, telemetry | **HTML/CSS overlay** | `wasm-poc/index.html` |

## 2. Blender 5.3 PBR Character & Vehicle Pipeline

### Fidelity First (Never Rush Placeholders)
1. Read the canonical racer/vehicle definition in `client/characters.js` (and `client/renderer.js` if it has custom animations) before writing any Blender script.
2. Preserve every iconic silhouette cue, color accent, posture, and personality trait—upgrade the craft and realism, never replace the character's identity.
3. **Avoid sterile plastic looks**: add panel seams, bevels, rivets/weld rings, scorch/soot gradients, weathered metallic/roughness contrast, heat-blued exhaust hardware, and believable proportions.

### Rigid Parts for Procedural Animation
Use this for things that turn or slide without bending (wheels, cranks, propellers, turrets). For a character's body use a skeleton instead (section 3).
- Export moving appendages as **separate `.glb` files** authored with their **hinge/root at `(0, 0, 0)`** (e.g. `taicoon_tail.glb`, `houston_arm_l.glb`, `houston_arm_r.glb`).
- Attach them in Bevy as child entities at their socket offset so Bevy drives smooth runtime motion (wheel spin, drift lean, recoil).

### Authoring & Exporting in Blender 5.3
- Write a self-contained generator script at `wasm-poc/blender/build_<name>.py` that clears the scene, builds geometry + Principled BSDF materials, applies smooth shading, and exports with `bpy.ops.export_scene.gltf(..., export_format='GLB', export_yup=True)`.
- Run headlessly (install with `brew install --cask blender` if it is missing):
  ```sh
  /opt/homebrew/bin/blender --background --python wasm-poc/blender/build_<name>.py
  ```
- Export assets to `wasm-poc/assets/models/<name>.glb`.
- Keep triangle counts WASM-friendly (~2k–15k tris per racer) so load times and WebGL2 draw costs stay low.
- `bpy.ops.object.join()` invalidates references to the objects it merges: split a list into groups *before* joining any of them, and `transform_apply` the result so its origin is the hinge.
- Re-exporting rewrites every `.glb` with slightly different bytes. `git checkout` the ones whose geometry you did not change, so unrelated assets do not churn.

## 3. Skeletons, Animation Clips & Shape Keys

Skinning, clip blending and shape keys all work on the WebGL2 build. `Cargo.toml` already enables the `gltf_animation` and `morph` features. Master-Yuda (`build_yuda.py` + `yuda.rs`) is the reference to copy; KnowItOwl shows layered clips and eyelids.

### Authoring in Blender (`wasm-poc/blender/rigging.py`)
- **Bind as you build.** Call `rigging.carry(bone=1.0, ...)` before creating pieces and `rigging.bind(obj)` on every mesh; weights survive `rigging.join`. Give a joint a ball shared 0.5/0.5 by the two bones either side so it bends without a gap, or weight a tube ring by ring.
- **Skeleton.** `rigging.build_armature(name, [(bone, parent, hinge), ...])` with hinges in model space (x across, y up, z forward). Bones lie along Blender's +Y with no roll, so a turn about a bone's x is a turn about the racer's x.
- **Poses are functions of a 0..1 cycle** returning `{bone: turn}`, where a turn is a quaternion (`RX`, `RY`, `RZ`) about the bone's hinge relative to its parent, or `(turn, shift)` / `(turn, shift, scale)`. Use `wave(cycle, whole_turns)` so loops close; one-shot clips reach their last pose at cycle 1.
- **Limbs.** `rigging.reach(shoulder, elbow, hand, target, pole, parent_turn, parent_hinge)` solves a two-bone limb to a target, so write hand and foot positions, not joint angles.
- **Secondary motion is cheap and reads well**: ears, tufts, tails, chains and hems on their own bones, lagging the main move by a phase.
- **Hide by scale.** To make a worn part vanish within a clip (a thrown jacket), key its bone's scale to `0.001`.
- **Shape keys** for faces. Build the feature in its extreme pose (eyelids shut) as its own mesh, then move its rest shape to neutral and add one key per feature (see `open_lids` in `build_knowitowl.py`). Set each key's value to 0 before export.
- **Export** with `rigging.export_rig(path, clips)`: one `.glb` holding meshes, skeleton, shape keys and one animation per clip (each clip is an action on its own NLA track).

### Playing in Bevy
- **Load twice**: `assets.load("models/x.glb")` as `Handle<Gltf>` for `named_animations`, and `GltfAssetLabel::Scene(0)` to spawn.
- **Bind when the model arrives.** A spawned scene appears a frame or more later. Each frame, for unbound rigs, search `Children::iter_descendants` for the entity with `AnimationPlayer`; build one shared `AnimationGraph` from the named clips; insert `AnimationGraphHandle` on the player; `play(node).repeat()` every clip at weight 0.
- **Blend by weights.** Each frame set every clip's weight (`player.animation_mut(node).set_weight`). Bevy normalises per bone over clips with non-zero weight, so keep each layer's weights summing to 1 and ease them for crossfades.
- **Layers need masks.** The exporter samples *every* bone into *every* clip, so a legs-only clip still overwrites the arms. Put bones in mask groups (`graph.add_target_to_mask_group`) and add clips with `add_clip_with_mask` (see `knowitowl.rs`: legs and upper body).
- **Clips not driven by the clock**: `pause()` them and `seek_to` each frame. Use it for one-shots on a rider's own timer (Yuda's strip and dress) and for motion tied to distance (the owl's pedalling follows the crank angle).
- **Shape keys** are `MorphWeights` on the mesh node; set `weights_mut()` from Rust (blink timers, winks).
- **Attaching to a joint.** In the game a joint's axes are a quarter turn about x from model space. Parent attachments through a child with `Quat::from_rotation_x(FRAC_PI_2)`; under it, positions are in model axes relative to the hinge.
- **Hand-offs to the world.** For a piece that leaves the body, pre-spawn one hidden loose copy per racer with its own small rig and clip, and at the release moment place it at the bone's pose and show it. Keep the release frame and pose as named constants in both the Blender script and the Rust.
- **System parameter limit**: a Bevy system takes at most 16 parameters; put binding in its own system ahead of the per-frame one.

### Showing the result
- Write `wasm-poc/blender/preview_<name>.py` (copy `preview_yuda.py`): it imports the builder, poses the rig clip by clip and renders one labelled film. Build into the preview's own folder, set `sys.dont_write_bytecode = True`, and set `rig.animation_data.use_nla = False` or the stacked tracks override hand-set poses.
- Give the user the one-line command as soon as a first version renders, and copy it with `pbcopy`. Rendering takes about a third of a second per frame; pass frame numbers to render stills while tuning.
- Frame it from behind, as the chase camera sees the racer. Then check in the running game too: the film shows clips as authored, not their blending.
- A racer with many sampled clips is larger on disk (the owl: 9 clips on 18 bones, about 1 MB).

## 4. Procedural Bevy VFX & Lighting Craft

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

## 5. Bevy 0.20 WASM Gotchas

- **Loading `.glb` scenes**: `asset_server.load(GltfAssetLabel::Scene(0).from_asset("models/<name>.glb"))` spawned via `WorldAssetRoot`.
- **Child visibility on death/hide**: Setting `Visibility::Visible` on a child overrides a parent's `Visibility::Hidden`! Use `Visibility::Inherited` on attached parts/VFX (and hide/scale down when `!racer.alive`) so afterburners and accessories vanish when a racer explodes.
- **API names in Bevy 0.20**:
  - `PointLight` uses `shadow_maps_enabled` (not `shadows_enabled`).
  - `StandardMaterial` uses `perceptual_roughness` (not `roughness`).
  - `Assets::get_mut(&handle)` returns `Option<AssetMut<'_, T>>` — bind with `if let Some(mut m) = materials.get_mut(&handle)`.
- **Prevent material leaks**: Whenever an entity owns a per-instance dynamic `Handle<StandardMaterial>` (like fading smoke puffs), call `materials.remove(&handle)` right before `commands.entity(ent).despawn()`.

## 6. Build, Serve & Verify Loop

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
