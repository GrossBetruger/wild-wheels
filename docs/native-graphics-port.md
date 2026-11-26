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
| `driver:8:wormhole` | Avita’s fast propeller and swept blade tips while the Wormhole is open |
| `driver:<n>:boost` | The same loop while boosting, recorded with the racer driving so that trails stream behind |
| `driver:<n>:celebrate` | The celebration after a kill, played by its timer |
| `driver:<n>:boost:in`, `driver:<n>:boost:out` | One second after a boost starts or ends, through the renderer's own easing: Pearococo's tail folds, KnowItOwl takes off and drops the bicycle, rotors tilt |
| `overlay:<n>:vulcan:in`, `overlay:<n>:vulcan:out` | Rapid fire starting and ending, such as the bat flying in and away |
| `overlay:<n>:<state>:end` | Shield, hedgeguard and tehilim fading over their last 1 to 1.5 seconds, played by the time remaining |
| `overlay:11:special:start`, `overlay:11:special:end` | R-yeah's archangels descending and rising |
| `overlay:7:nightmare`, `overlay:7:nightmare:end` | Houston's full ultraviolet plume and its one-second shortening wind-down, recorded from the browser at 60 fps |
| `overlay:<n>:<state>` | What `shield`, `hedge`, `tehilim`, `dizzy`, `vulcan` and `special` add to a racer |
| `overlay:xylophone`, `timestop` | Fourmidable's and the time-stop special, shown at other racers or the caster |
| `overlay:reversePsychology`, `overlay:reversePsychology:end` | A cricket marionette above affected racers, with tugging strings, a wooden control cross and a fade at the end of reversed controls |
| `shot:missile`, `shot:hedgehog`, `shot:vulcan:<n>` | Projectiles, including each racer's rapid-fire variant |
| `trail:missile`, `trail:hedgehog`, `trail:vulcan:<n>`, `skid:<arena>` | One projectile trail puff, scaled along the trail, and a unit-length skid mark fading over six seconds |
| `pickup:<kind>` | Supply pads and their bobbing, spinning items, including the bicycle |
| `wreck`, `health:<1-6>` | The destroyed-racer marker and the health pips above a racer |
| `effect:<type>`, `effect:ash:<n>`, `effect:karmaRaccoon`, `effect:default` | Explosions, ashes of each racer, atomic blasts, radiation, teleports, fire rings, Karmic Raccooning’s spinning yin-yang lotus mandala, Reverse Psychology’s 100-unit green haze shockwave and the other world effects, played by age |
| `bomb:<kind>`, `cloud:chaff`, `cloud:chaff:fairy`, `cloud:stink` | Falling bombs and lingering clouds, played by age |
| `particle:smoke`, `particle:spark:<level>` | One drift particle over its life |
| `locust`, `locust:jump` | Tammy's locusts |
| Arenas | Static scenery, sky color, name, description and Dark Humor X-ray outlines for every entry in `arenas` |
| Racers | Name, description, color and special ability name for the menus and HUD |

Each frame holds solid models, additive glow geometry, and the browser's point
sprites (additive sparks and alpha-blended smoke), which the native client draws
as quads turned to face the camera in `native-client/src/sprite.wesl`, with the
particle shader's soft disc. Each recorded frame's particles are one mesh shared
by everything showing that frame.

Racers are recorded standing in open ground rather than at the arena's center,
where an obstacle would change anything that looks for free space, such as
KnowItOwl's bat companion.

## Smoother than the browser

Clips are recorded at 24 frames a second, but the native client plays them at
the display's rate. Between two recorded frames, a part whose mesh is the same
in both is blended: position and scale linearly, rotation along the shortest
arc. Particles are blended the same way when both frames hold the same number
of them. Anything that moves more than two units between frames is treated as a
different object and is not blended. Spinning pickups, hovering vehicles,
orbiting icons, flames and smoke therefore move at 60 or 120 frames a second,
where the browser redraws them only as often as its own frame rate allows.

Three techniques keep the recording automatic:

- **Racer color.** Each racer is drawn twice, once in a marker color. Triangles
  that change follow the racer's color and are recolored per player.
- **Overlays.** A state is drawn with and without it; only the difference is
  kept, so it layers over any racer clip. A state that swaps part of the racer's
  own model keeps only its added geometry and particles.
- **Model placement.** The vertex shader's yaw, pitch, roll and Pearococo's
  feather fold are evaluated in the exporter and stored as one matrix.
- **Plumage.** Parts the browser draws with its plumage shader are stored in a
  plumage layer. The native client draws them with `native-client/src/plumage.wesl`,
  a hand port of that shader's sway, bent normals and angle-dependent iridescence,
  shaded per pixel. It adds native-only detail the browser lacks: tip flutter,
  the tail swinging behind turns and pressed back by speed (a spring in
  `scene.rs`, passed through each feather's mesh tag), barbs that each sit at
  their own point on the iridescent palette, glints, rings around the eyes and a
  gold gleam. A change to the browser's plumage shader must be repeated there.

To port another state, add a recording in `buildGraphicsPack` and select the new
clip name in `scene.rs`.

## Limits

- Shader-only effects are not ported automatically. Pearococo's plumage shader is
  ported by hand (see Plumage above); distance fog is missing. KnowItOwl's Dark Humor is ported
  by hand, in `native-client/src/xray.rs`: `fog.wesl` is the browser's drifting fog
  shader, and `xray.wesl` its rim-lit X-ray shading. Through the fog the caster
  sees the recorded arena outlines, racers in cyan, their own shots and bombs in
  green and everyone else's in pink, with trails, and effects such as explosions.
  The browser draws shots as darts and bombs as spheres there; natively they are
  the ported models in those colors. The browser also warms the fog around
  falling bombs and brightens nearby objects; neither is ported.
- Transitions are recorded from a settled state, so a state that changes again
  within a second restarts its transition. States combine by layering only. A
  boost trail is the one recorded while driving straight.
- Interpolation cannot add poses the browser does not draw: models that switch
  between a few fixed poses, such as wing flaps, still switch.
- Not recorded: Master-Yuda's drift sparks,
  Houston's flying helmet, muzzle flashes, Tammy's arrival scale-up, the dizzy
  camera wobble and the bomber views.
- Master-Yuda's drift lean is the one piece ported by hand, in `scene.rs`.
- Fire rings are recorded at one radius and scaled, which also scales flame width; the browser keeps its
  flames from widening past a mid-sized ring. The skulls circling a ring are not stretched: one rider is
  recorded as `effect:fireRing:rider:<color>` and `effect:fireRingOut:rider:<color>`, and `fire_ring_rider`
  in `scene.rs` places six of them with the browser's formula.
- Ashes and celebrations are recorded at 12 frames per second to
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
  - a `u16` part count and parts of `u32` mesh, `u32` layer (0 solid, 1 glow,
    2 plumage)
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

## Keeping signature motion through a rig migration

KnowItOwl and Catheterpillar exposed two different failure modes. In commit
`763019c`, KnowItOwl's playback setup waited for optional eyelids. The fix let
the skeleton start without the morph and repaired animation targets bound to
the wrong player. Catheterpillar already had that binding repair. Her first
Blender export reduced the classic wingbeat from 3 Hz to 2 Hz in cruise, from
4 Hz to 3 Hz in boost, and to 1 Hz during healing. A still image and a test
that found two different bone rotations both passed with the wrong cadence.

When replacing a moving racer with a skinned model:

1. Record the signature motion in the original renderer. Write down its hinge,
   stroke, beats per second and which actions can interrupt it. Check the
   rear race camera as well as the character preview.
2. Test both sides of the **exported** rig. Check that the moving joints carry
   vertices and measure full strokes per second from the glTF sample times.
   Count strokes in cruise, boost and special independently.
3. Start skeletal playback as soon as its required player and targets exist.
   Bind targets to the player in that racer's own scene instance. An optional
   morph or accessory can finish loading separately.
4. Test the **rendered race** over multiple frames with the racer stationary.
   Measure movement of the named body part. Body bob, camera motion or exhaust
   alone must never satisfy the check. For bugs specific to remote racers or
   the picker, repeat the check on that render path.

For Catheterpillar, these commands check the exported asset and the visible wing
span in the local Bevy race. The browser check needs built web assets and Chrome.
It also runs in the multiplayer regression workflow.

```sh
node --test wasm-poc/blender/specialist-animation.test.mjs
bash scripts/build/build-experimental.sh wasm-poc
npm run test:browser-netcode -- --wingbeats
```
