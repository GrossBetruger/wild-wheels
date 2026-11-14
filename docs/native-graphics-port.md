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
   the origin and records the vertex buffers, model instances and point sprites
   the renderer uploads. A full port takes about 40 seconds.
3. The result is a binary pack in Cargo's `OUT_DIR`, embedded with
   `include_bytes!`. It is a build product and is not committed.
4. `native-client/src/ported.rs` parses the pack and plays clips as Bevy meshes
   with vertex colors. `scene.rs` only chooses which clip each entity shows.

Run the port by hand with `npm run port:graphics -- /tmp/graphics.wwgp`.

## What is ported

| Clip name | Source |
| --- | --- |
| `driver:<n>:idle` | Each racer for an eight-second loop at 24 frames per second, after a three-second warm-up that settles eased animation |
| `driver:<n>:boost` | The same loop while boosting, recorded with the racer driving so that trails stream behind |
| `driver:<n>:celebrate` | The celebration after a kill, played by its timer |
| `overlay:<n>:<state>` | What `shield`, `hedge`, `tehilim`, `dizzy`, `vulcan` and `special` add to a racer |
| `overlay:xylophone`, `timestop` | Fourmidable's and the time-stop special, shown at other racers or the caster |
| `shot:missile`, `shot:hedgehog`, `shot:vulcan:<n>` | Projectiles, including each racer's rapid-fire variant |
| `trail:missile`, `trail:hedgehog`, `trail:vulcan:<n>`, `skid:<arena>` | One projectile trail puff, scaled along the trail, and a unit-length skid mark fading over six seconds |
| `pickup:<kind>` | Supply pads and their bobbing, spinning items, including the bicycle |
| `wreck`, `health:<1-6>` | The destroyed-racer marker and the health pips above a racer |
| `effect:<type>`, `effect:ash:<n>`, `effect:default` | Explosions, ashes of each racer, atomic blasts, radiation, teleports, fire rings and the other world effects, played by age |
| `bomb:<kind>`, `cloud:chaff`, `cloud:chaff:fairy`, `cloud:stink` | Falling bombs and lingering clouds, played by age |
| `particle:smoke`, `particle:spark:<level>` | One drift particle over its life |
| `locust`, `locust:jump` | Tammy's locusts |
| Arenas | Static scenery, sky color, name, description and Dark Humor X-ray outlines for every entry in `arenas` |
| Racers | Name, description, color and special ability name for the menus and HUD |

Each frame holds solid models, additive glow geometry, and the browser's point
sprites (additive sparks and alpha-blended smoke), which the native client draws
as camera-facing quads with the particle shader's soft disc.

Racers are recorded standing in open ground rather than at the arena's center,
where an obstacle would change anything that looks for free space, such as
KnowItOwl's bat companion.

Three techniques keep the recording automatic:

- **Racer color.** Each racer is drawn twice, once in a marker color. Triangles
  that change follow the racer's color and are recolored per player.
- **Overlays.** A state is drawn with and without it; only the difference is
  kept, so it layers over any racer clip. A state that swaps part of the racer's
  own model keeps only its added geometry and particles.
- **Model placement.** The vertex shader's yaw, pitch, roll and Pearococo's
  feather fold are evaluated in the exporter and stored as one matrix.

To port another state, add a recording in `buildGraphicsPack` and select the new
clip name in `scene.rs`.

## Limits

- Shader-only effects are not ported automatically. Pearococo's feather sway and
  iridescence and distance fog are missing. KnowItOwl's Dark Humor is written by
  hand in `scene.rs`: one still frame of the fog shader covers the world, and the
  caster sees the recorded arena outlines and flat racer silhouettes through it.
  The fog does not drift, bomb flashes do not light it, and nearby objects are
  not brightened.
- Recorded states do not fade in or out, and combine by layering only. A boost
  trail is the one recorded while driving straight.
- Not recorded: Master-Yuda's drift sparks,
  Houston's flying helmet, muzzle flashes, Tammy's arrival scale-up, the dizzy
  camera wobble and the bomber views.
- Master-Yuda's drift lean is the one piece ported by hand, in `scene.rs`.
- Fire rings are recorded at one radius and scaled, which also scales flame width.
- Ashes, celebrations and fire rings are recorded at 12 frames per second to
  bound the pack size: about 120 MiB of geometry, compressed to about 45 MiB.
- Loops whose browser period does not divide their length restart with a small jump.
- Native lighting approximates the browser's `0.62 + 0.38 * n·l` shading; the
  light levels in `scene.rs` were matched against screenshots, not derived exactly.
  Additive colors are added in linear light, so glows differ slightly in strength.

## Pack layout

Little-endian. `WWGP`, `u32` version, then counted sections:

- Palette: `u32` count, then sRGB `u8[3]` entries. Entry 0 means the racer's color.
- Meshes: `u32` count; each is `f32` scale, `u32` triangle count, `u32`
  compressed length and the zlib-compressed triangles. Each triangle is nine
  `i16` coordinates (multiplied by the scale) and a `u16` palette index. Meshes
  are compressed one by one so the client inflates only those it shows.
- Clips: `u32` uncompressed length, `u32` compressed length, then one zlib
  block holding a `u32` count of clips; each is `f32` frames per second, `u32` mode (0 loop,
  1 play once), `u32` frame count, then per frame:
  - a `u16` part count and parts of `u32` mesh, `u32` layer (0 solid, 1 glow)
    and twelve `f32` giving the images of the X, Y and Z axes and the origin;
  - glow sprites, then smoke sprites: each a `u32` count and sprites of seven
    `f32`: x, y, z, size, red, green, blue.
- Names: `u32` count; each is `u16` length, UTF-8 name, `u32` clip.
- Arenas: `u32` count; each is sky `u8[3]`, `u32` scenery mesh, `u32` X-ray
  outline mesh, and `u16`-length UTF-8 name and description.
- Racers: `u32` count; each is name, description, color `u8[3]`, ability name,
  `u8` intelligence, then the ability card's title, line and color `u8[3]`.

## Checks

- `node --test tests/client/graphics-port.test.js` ports one racer and checks the
  pack contents, tinting, glow and sprite layers, overlays and determinism.
- `cargo test --manifest-path native-client/Cargo.toml ported` checks that the
  embedded pack contains every racer and arena and that placement matches the
  browser shader.

## The HUD is not ported

The browser's HUD is HTML and CSS, which this port cannot record. The native HUD
in `native-client/src/hud.rs` rebuilds it by hand for the arena: the same
readouts, labels, enabling rules and notice timing as `client/game.js` and the
classes in `ui/`. Racer names, ability names and ability announcement cards are
read from the pack, so those stay in step automatically; everything else must be
changed in both places.

Positions, sizes, colors, borders and corner radii are the browser's CSS scaled
from its 922-pixel viewport to the 1280-pixel window. Text uses Menlo, the macOS
system monospace font the browser also resolves to, which supplies the HUD's
symbols; on a system without it the built-in font is used and symbols are missing.

Differences from the browser HUD:

- The weapon cards have no emoji icons, and emoji in server text are dropped.
- The leaderboard sits under the arena map; the browser shows it beside the game.
- A MENU button sits beside the browser's AFK button.
- No CSS animation, gradients, blur or letter spacing: announcements appear and
  disappear without motion.
- The page chrome around the game (status line, controls panel, chat,
  photography) and the bomber and mobile controls are not present.
