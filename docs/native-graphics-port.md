# Native graphics port

The native Rust client draws no models by hand. Its racers, arenas, projectiles
and pickups are ported from the browser client's procedural JavaScript at build
time, so the browser renderer stays the single source of truth. No JavaScript or
WebGL runs in the native client.

## How it works

1. `native-client/build.rs` runs `scripts/build/port-graphics.mjs` whenever a file
   under `client/`, `characters/`, `gameplay/`, `ui/` or `scripts/build/` changes.
   Building the native client therefore requires Node.js.
2. `scripts/build/graphics-port.mjs` runs the unmodified `Renderer` against a
   recording WebGL context. It draws synthetic battles containing one subject at
   the origin and records the vertex buffers and model instances the renderer
   uploads.
3. The result is a binary pack in Cargo's `OUT_DIR`, embedded with
   `include_bytes!`. It is a build product and is not committed.
4. `native-client/src/ported.rs` parses the pack and plays clips as Bevy meshes
   with vertex colors. `scene.rs` only chooses which clip each entity shows.

Run the port by hand with `npm run port:graphics -- /tmp/graphics.wwgp`.

## What is ported

| Clip name | Source |
| --- | --- |
| `driver:<n>:idle`, `driver:<n>:boost` | Each racer for an eight-second loop at 24 frames per second, after a three-second warm-up that settles eased animation |
| `shot:missile`, `shot:hedgehog`, `shot:vulcan:<n>` | Projectiles, including each racer's rapid-fire variant |
| `pickup:<kind>` | Supply pads and their bobbing, spinning items |
| `wreck`, `health:<1-6>` | The destroyed-racer marker and the health pips above a racer |
| Arenas | Static scenery and sky color for every entry in `arenas` |

Additive geometry, such as boost flames, is kept as a separate glow layer.
Triangles that take the racer's color are detected by drawing each racer twice,
once in a marker color, and are recolored per player in the native client.

To port another state, add a `record(...)` call in `buildGraphicsPack` and select
the new clip name in `scene.rs`. State that only adds geometry can be isolated
with `added(...)`, as the health pips are.

## Limits

- Point-sprite particles (smoke, sparkles, halos) and shader-only effects
  (Pearococo's feather motion and iridescence, fog, Dark Humor, X-ray) are not ported.
- Clips are recorded with the racer stationary, so trails that depend on
  movement, such as Fourmidable's receipts, do not stream behind the racer.
- Ability, shield, celebration, rapid-fire mount and teleport visuals are not
  yet recorded. Effects such as explosions remain native code in `feedback.rs`.
- Loops whose browser period does not divide eight seconds restart with a small jump.
- Native lighting approximates the browser's `0.62 + 0.38 * n·l` shading; the
  light levels in `scene.rs` were matched against screenshots, not derived exactly.

## Pack layout

Little-endian. `WWGP`, `u32` version, then counted sections:

- Palette: `u32` count, then sRGB `u8[3]` entries. Entry 0 means the racer's color.
- Meshes: `u32` count; each is `f32` scale, `u32` triangle count, then per
  triangle nine `i16` coordinates (multiplied by the scale) and a `u16` palette index.
- Clips: `u32` count; each is `f32` frames per second, `u32` frame count, then
  per frame a `u16` part count and parts of `u32` mesh, `u32` layer (0 solid,
  1 glow) and `f32` x, y, z, yaw, pitch, roll.
- Names: `u32` count; each is `u16` length, UTF-8 name, `u32` clip.
- Arenas: `u32` count; each is sky `u8[3]` and `u32` mesh.

## Checks

- `node --test tests/client/graphics-port.test.js` ports one racer and checks the
  pack contents, tinting, glow layer and determinism.
- `cargo test --manifest-path native-client/Cargo.toml ported` checks that the
  embedded pack contains every racer and arena and that placement matches the
  browser shader.
