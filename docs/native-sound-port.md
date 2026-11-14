# Native sound port

The native Rust client synthesizes no sound of its own. Its cues, racer voices
and engine layers are rendered from the browser client's Web Audio code at build
time, so `audio/audio.js` stays the single source of truth. No JavaScript or
Web Audio runs in the native client.

## How it works

1. `native-client/build.rs` runs `scripts/build/port-sounds.mjs` whenever the
   browser sources change, next to the [graphics port](native-graphics-port.md).
2. `scripts/build/sound-port.mjs` runs the unmodified `RaceAudio` against a small
   offline Web Audio implementation: oscillators, gains, biquad filters, noise
   buffers, delays with feedback, and parameter automation. Each cue the game
   schedules is rendered to 16-bit mono PCM at 32 kHz.
3. The result is a pack of about 4 MiB in Cargo's `OUT_DIR`, embedded with
   `include_bytes!`. It is a build product and is not committed.
4. `native-client/src/sound.rs` wraps each sound as WAV for Bevy and decides
   when to play it from the same state the browser uses.

Run the port by hand with `npm run port:sounds -- /tmp/sounds.wwsp`.

## What is ported

| Sound name | Source |
| --- | --- |
| `event:<type>` | Every case of `RaceAudio.event`, found by reading the method, so a new event type needs no exporter change |
| `voice:<n>:<cue>` | Each racer's `pass`, `hurt`, `cheer`, `lap` and `win` calls |
| `cue:countdown:<1-3>`, `cue:go` | The tones the browser HUD plays before a match |
| `cue:xylophone:<0-7>`, `cue:heartbeat`, `cue:fashion`, `cue:timeWarp`, `cue:timeWarpEnd` | Sounds `RaceAudio.update` starts from game state |
| `loop:engine`, `loop:skid`, `loop:jet`, `loop:vulcan`, `loop:vulcan:firing` | The continuous layers, each two seconds long and looped |

Sounds started by game state are isolated by rendering two worlds that differ
only in that state and subtracting one from the other. The engine loop is
recorded idling; the native client raises its playback speed with the racer's
speed, as the browser raises the oscillator frequency.

## Limits

- The Dark Humor laughter uses recorded audio files and is not played natively.
- Reverb and the output limiter are not rendered. Samples are clipped at full scale.
- Sound is mono: the browser's stereo panning of other racers' voices is dropped.
- Band-limited oscillators are approximated by plain waveforms, so bright
  square and sawtooth tones alias slightly.
- Raising the engine's pitch by playback speed also moves its low-pass filter.
- The native client mirrors `RaceAudio.update` and the voice spacing rule by
  hand in `sound.rs`; a change to when a sound plays must be made in both places.

## Pack layout

Little-endian. `WWSP`, `u32` version, `u32` sample rate, `u32` sound count; then
each sound as `u16` name length, UTF-8 name, `u32` sample count and `i16` samples.

## Checks

- `node --test tests/audio/sound-port.test.js` ports the sounds with one racer's
  voices and checks names, levels, durations and loop lengths.
- `cargo test --manifest-path native-client/Cargo.toml sound` checks that the
  embedded pack holds every cue, voice and layer.
