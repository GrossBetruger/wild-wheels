---
name: native-graphics-port
description: Keep the native Rust client's graphics and sounds in step with the browser client. Use when adding or changing racers, arenas, effects, particles, other visuals or sounds in client/, characters/, gameplay/ or audio/, when a visual or sound is wrong or missing in the native client, or when editing scripts/build/graphics-port.mjs, scripts/build/sound-port.mjs, or native-client/src/ported.rs, scene.rs or sound.rs.
---

# Native graphics port

The native client draws no models by hand. `native-client/build.rs` runs the
unmodified browser `Renderer` in Node against a recording WebGL context and
embeds what it draws. Read `docs/native-graphics-port.md` for the clip list,
pack layout and limits before changing the port.

## What ports by itself

A change needs nothing more than a native rebuild when it stays inside
something already recorded:

- The look or animation of an existing racer, vehicle, projectile, pickup,
  arena, effect, cloud, bomb or particle.
- A new racer or arena. The exporter loops over `drivers` and `arenas`, and the
  menus read their names and descriptions from the pack.
- Names, descriptions and colors of racers and arenas.

## What needs a recording

A new kind of visual is invisible natively until it is recorded:

1. Add a recording in `buildGraphicsPack` in `scripts/build/graphics-port.mjs`.
   Build a world containing only the subject, at the origin facing +Z.
   - A looping subject: `record(name, {setup})`.
   - Something that plays by age: `once(name, life, setup, each)`.
   - A state layered on a racer: record with and without it and keep
     `pack.overlay(base, shot)`.
2. Choose the clip in `native-client/src/scene.rs`: add a `Role` if it is a new
   kind of entity, and call `stage.show` with the clip name and a transform.
   A new effect type named `effect:<type>` is picked up without a scene change.
3. If the native client lacks the state that drives it, add the field to
   `ClientView` in `rust-core/src/arena/client/native.rs`.
4. Add the clip name to the checks in `tests/client/graphics-port.test.js` and
   `native-client/src/ported.rs`, and to the table in the documentation.

## What never ports

- GLSL changes. Shader-only effects (feather sway and iridescence, fog, Dark
  Humor, X-ray) need Bevy shaders written by hand.
- HTML and CSS. The native menus and HUD in `native-client/src/gui.rs`,
  `scene.rs` and `feedback.rs` are hand-written Bevy UI.
- Per-frame browser state that depends on a racer's history, such as
  Master-Yuda's drift lean. Port the formula by hand in `scene.rs`.

## Rules that keep the port honest

- Do not edit `client/renderer.js` to suit the exporter. If a recording needs
  renderer state, set it up through the world passed to `draw`.
- Do not hand-model anything in the native client that the browser already draws.
- Recordings must be deterministic: no `Math.random` or wall-clock time.
- Bump `PACK_VERSION` and `VERSION` in `ported.rs` together when the layout changes.
- The pack is a build product in Cargo's `OUT_DIR`; never commit it.

## Sounds

Sounds are ported the same way; read `docs/native-sound-port.md`.

- A change to how an existing cue, voice or engine layer sounds ports by itself.
  So does a new `case` in `RaceAudio.event`.
- A new sound started from `RaceAudio.update`, or a new voice cue, needs a line
  in `buildSoundPack` in `scripts/build/sound-port.mjs` and a trigger in
  `native-client/src/sound.rs`, which mirrors the browser's timing rules by hand.
- If the audio code uses a Web Audio node or automation method the offline
  renderer lacks, add it to `sound-port.mjs`; do not change `audio/audio.js`.
- Recorded audio files are not ported.

## Checking a change

```sh
node --test tests/client/graphics-port.test.js tests/audio/sound-port.test.js
cargo +1.97.1 clippy --locked --manifest-path native-client/Cargo.toml --all-targets -- -D warnings
cargo +1.97.1 test --locked --manifest-path native-client/Cargo.toml
```

Then look at it. Start an isolated dedicated server on a spare port with bots,
run the native client with `--server` and `--screenshot /absolute/path.png`,
bring its window to the front, and read the captured image. The first capture
is taken five seconds after launch and then every ten seconds.
