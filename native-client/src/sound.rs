//! Plays the sound pack that `build.rs` ports from the browser audio engine.
//! Nothing here is synthesized: cues, voices and engine layers all come from
//! the JavaScript client. See docs/native-sound-port.md.
use crate::app::GameSession;
use bevy::audio::{AudioSinkPlayback, Volume};
use bevy::prelude::*;
use std::collections::{HashMap, HashSet};

static PACK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/sounds.wwsp"));
const VERSION: u32 = 1;
/// Continuous layers the browser keeps running and fades with the racer's state.
const LAYERS: [&str; 5] = [
    "loop:engine",
    "loop:skid",
    "loop:jet",
    "loop:vulcan",
    "loop:vulcan:firing",
];

pub struct GameAudioPlugin;
impl Plugin for GameAudioPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<Heard>().add_systems(Startup, setup);
    }
}
#[derive(Resource)]
pub struct Sounds(HashMap<String, Handle<AudioSource>>);
#[derive(Component)]
pub struct Layer(usize);
/// The time-stop music, cut short when time resumes.
#[derive(Component)]
pub struct Warp;
/// What has already been announced, so each state change sounds once.
#[derive(Resource, Default)]
pub struct Heard {
    phase: String,
    countdown: i64,
    beat: Option<i64>,
    hearts: HashSet<usize>,
    fashion: HashMap<usize, f64>,
    warp: f64,
    vulcan: f64,
    warning: i64,
    voice_until: f32,
}

fn u32_at(bytes: &[u8], at: usize) -> Option<usize> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize)
}
/// Name and 16-bit mono samples of one sound.
type Sound<'a> = (&'a str, &'a [u8]);
/// Every sound in the pack, with its sample rate.
fn parse(bytes: &[u8]) -> Option<(u32, Vec<Sound<'_>>)> {
    if bytes.get(..4)? != b"WWSP" || u32_at(bytes, 4)? != VERSION as usize {
        return None;
    }
    let rate = u32_at(bytes, 8)? as u32;
    let mut at = 16;
    let mut sounds = Vec::new();
    for _ in 0..u32_at(bytes, 12)? {
        let size = usize::from(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?));
        let name = std::str::from_utf8(bytes.get(at + 2..at + 2 + size)?).ok()?;
        at += 2 + size;
        let length = u32_at(bytes, at)?.checked_mul(2)?;
        sounds.push((name, bytes.get(at + 4..at + 4 + length)?));
        at += 4 + length;
    }
    (at == bytes.len()).then_some((rate, sounds))
}
fn wav(rate: u32, samples: &[u8]) -> Vec<u8> {
    let size = samples.len() as u32;
    let mut bytes = Vec::with_capacity(44 + samples.len());
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + size).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&size.to_le_bytes());
    bytes.extend_from_slice(samples);
    bytes
}
fn setup(mut commands: Commands, mut assets: ResMut<Assets<AudioSource>>) {
    let (rate, pack) = parse(PACK).expect("the ported sound pack is valid");
    let sounds: HashMap<_, _> = pack
        .into_iter()
        .map(|(name, samples)| {
            let source = AudioSource {
                bytes: wav(rate, samples).into(),
            };
            (name.to_owned(), assets.add(source))
        })
        .collect();
    for (index, name) in LAYERS.iter().enumerate() {
        if let Some(source) = sounds.get(*name) {
            commands.spawn((
                AudioPlayer::new(source.clone()),
                PlaybackSettings::LOOP.with_volume(Volume::Linear(0.0)),
                Layer(index),
            ));
        }
    }
    commands.insert_resource(Sounds(sounds));
}

pub fn play(
    mut commands: Commands,
    mut session: ResMut<GameSession>,
    sounds: Res<Sounds>,
    time: Res<Time>,
    mut heard: ResMut<Heard>,
    mut layers: Query<(&mut AudioSink, &Layer)>,
    warps: Query<Entity, With<Warp>>,
) {
    let mut cues: Vec<(String, f32)> = session
        .sounds
        .drain(..)
        .map(|event| (format!("event:{event}"), 1.0))
        .collect();
    let now = time.elapsed_secs();
    // A racer's short calls give way to each other; laps and wins always sound.
    for (driver, cue, volume) in std::mem::take(&mut session.voices) {
        let important = matches!(cue.as_str(), "win" | "lap");
        if !important && heard.voice_until - now > 0.35 {
            continue;
        }
        heard.voice_until = match important {
            true => now + 0.55,
            false => heard.voice_until.max(now) + 0.14,
        };
        cues.push((format!("voice:{driver}:{cue}"), volume as f32));
    }
    let mut levels = [0.0; LAYERS.len()];
    let mut pitch = 1.0;
    let mut stop_warp = false;
    match session.client.as_ref() {
        None => *heard = Heard::default(),
        Some(client) => {
            let view = client.view();
            let p = view.player;
            let active = view.phase == "racing";
            let racers = || view.actors.iter().filter(|a| !a.inactive);
            if view.phase == "countdown" {
                let count = view.countdown.ceil() as i64;
                if count != heard.countdown {
                    cues.push((format!("cue:countdown:{count}"), 1.0));
                    heard.countdown = count;
                }
            } else {
                heard.countdown = 0;
            }
            if active && heard.phase == "countdown" {
                cues.push(("cue:go".into(), 1.0));
            }
            heard.phase = view.phase.into();
            // Fourmidable's xylophone plays an eight-note round while his special lasts.
            let xylophone = active
                && view.special_abilities
                && racers().any(|a| a.driver == 13 && a.special_active > 0.0);
            let beat = xylophone.then(|| (view.elapsed * 8.0).floor() as i64);
            if let Some(beat) = beat.filter(|beat| heard.beat != Some(*beat)) {
                cues.push((format!("cue:xylophone:{}", beat.rem_euclid(8)), 1.0));
            }
            heard.beat = beat;
            let hearts: HashSet<usize> = view
                .effects
                .iter()
                .filter(|fx| fx.kind == "heartbeat")
                .filter_map(|fx| fx.owner)
                .collect();
            for _ in hearts.difference(&heard.hearts) {
                cues.push(("cue:heartbeat".into(), 1.0));
            }
            heard.hearts = hearts;
            let fashion: HashMap<usize, f64> = racers()
                .filter(|a| a.driver == 9 && a.special_active > 0.0 && view.special_abilities)
                .map(|a| (a.id, a.special_active))
                .collect();
            for (id, remaining) in &fashion {
                if heard.fashion.get(id).copied().unwrap_or(0.0) < *remaining {
                    cues.push(("cue:fashion".into(), 1.0));
                }
            }
            heard.fashion = fashion;
            let warp = match active {
                true => view.time_stop,
                false => 0.0,
            };
            if warp > 0.0 && (heard.warp <= 0.0 || warp > heard.warp + 0.3) {
                stop_warp = true;
                cues.push(("cue:timeWarp".into(), 1.0));
            }
            if warp <= 0.0 && heard.warp > 0.0 {
                stop_warp = true;
                if active {
                    cues.push(("cue:timeWarpEnd".into(), 1.0));
                }
            }
            heard.warp = warp;
            let powered =
                active && p.vulcan > 0.0 && p.destroyed <= 0.0 && view.finish_countdown.is_none();
            let warning = p.vulcan.ceil() as i64;
            if powered && warning <= 3 && warning != heard.warning {
                cues.push(("event:vulcanWarning".into(), 1.0));
                heard.warning = warning;
            }
            if p.vulcan > 3.0 || p.vulcan <= 0.0 {
                heard.warning = 0;
            }
            if active && heard.vulcan > 0.0 && p.vulcan <= 0.0 {
                cues.push(("event:vulcanEnd".into(), 1.0));
            }
            heard.vulcan = p.vulcan;
            // The recorded layers already carry the browser's gains; here they only switch.
            let firing = powered && p.item == "hedgehog" && p.fire_cooldown > 0.0;
            let rotor = powered && p.driver != 14;
            levels = [
                active && !p.bomber,
                active && p.was_drifting,
                active && (p.boost > 0.0 || p.somersault > 0.0),
                rotor && !firing,
                rotor && firing,
            ]
            .map(|on| f32::from(u8::from(on)));
            // The engine was recorded idling at 28 Hz; the browser raises it with speed.
            pitch = ((28.0 + p.speed.abs() * 0.045) / 28.0) as f32;
        }
    }
    let blend = (time.delta_secs() * 30.0).min(1.0);
    for (mut sink, layer) in &mut layers {
        let current = match sink.volume() {
            Volume::Linear(level) => level,
            other => other.to_linear(),
        };
        sink.set_volume(Volume::Linear(
            current + (levels[layer.0] - current) * blend,
        ));
        if layer.0 == 0 {
            sink.set_speed(pitch.clamp(0.5, 4.0));
        }
    }
    if stop_warp {
        for entity in &warps {
            commands.entity(entity).despawn();
        }
    }
    for (name, volume) in cues {
        let Some(source) = sounds.0.get(&name) else {
            continue;
        };
        let mut player = commands.spawn((
            AudioPlayer::new(source.clone()),
            PlaybackSettings::DESPAWN.with_volume(Volume::Linear(volume)),
        ));
        if name == "cue:timeWarp" {
            player.insert(Warp);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_pack_ports_every_cue_voice_and_layer() {
        let (rate, sounds) = parse(PACK).expect("valid pack");
        let sounds: HashMap<_, _> = sounds.into_iter().collect();
        for name in ["event:fire", "event:explosion", "event:victory", "cue:go"] {
            assert!(sounds.contains_key(name), "{name}");
        }
        for driver in 0..15 {
            for cue in ["pass", "hurt", "cheer", "lap", "win"] {
                assert!(sounds.contains_key(format!("voice:{driver}:{cue}").as_str()));
            }
        }
        // Layers loop seamlessly: two seconds is a whole number of engine periods.
        for layer in LAYERS {
            assert_eq!(sounds[layer].len(), rate as usize * 2 * 2, "{layer}");
        }
        let audible = |name: &str| {
            sounds[name]
                .chunks_exact(2)
                .any(|s| i16::from_le_bytes([s[0], s[1]]).unsigned_abs() > 300)
        };
        assert!(audible("event:fire") && audible("loop:engine") && audible("voice:14:win"));
    }

    #[test]
    fn sounds_are_wrapped_as_mono_sixteen_bit_wav() {
        let bytes = wav(32000, &[0, 0, 255, 127]);
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(u32_at(&bytes, 24), Some(32000));
        assert_eq!(u32_at(&bytes, 40), Some(4));
        assert_eq!(bytes.len(), 48);
        assert!(parse(b"WWSP").is_none());
    }
}
