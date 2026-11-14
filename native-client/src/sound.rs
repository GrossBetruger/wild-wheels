//! Small procedural PCM cues using Bevy audio; no browser audio runtime.
use crate::app::GameSession;
use bevy::audio::{AudioSinkPlayback, Volume};
use bevy::prelude::*;
use std::collections::HashMap;
pub struct GameAudioPlugin;
impl Plugin for GameAudioPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup);
    }
}
#[derive(Resource)]
pub struct Sounds(HashMap<&'static str, Handle<AudioSource>>);
#[derive(Component)]
pub struct Engine;
fn setup(mut commands: Commands, mut assets: ResMut<Assets<AudioSource>>) {
    let mut sounds = HashMap::new();
    for (name, hz, duration) in [
        ("fire", 190.0, 0.08),
        ("vulcanFire", 250.0, 0.04),
        ("missile", 85.0, 0.3),
        ("explosion", 45.0, 0.45),
        ("hit", 90.0, 0.12),
        ("pickup", 700.0, 0.18),
        ("boost", 150.0, 0.3),
    ] {
        sounds.insert(
            name,
            assets.add(AudioSource {
                bytes: wav(hz, duration).into(),
            }),
        );
    }
    commands.insert_resource(Sounds(sounds));
    let engine = assets.add(AudioSource {
        bytes: engine_wav().into(),
    });
    commands.spawn((
        AudioPlayer::new(engine),
        PlaybackSettings::LOOP.with_volume(Volume::Linear(0.0)),
        Engine,
    ));
}
pub fn play(
    mut commands: Commands,
    mut session: ResMut<GameSession>,
    sounds: Res<Sounds>,
    mut engines: Query<&mut AudioSink, With<Engine>>,
) {
    let (speed, running) = session.client.as_ref().map_or((0.0, false), |client| {
        let view = client.view();
        (
            view.player.speed.abs() as f32,
            view.phase == "racing" && view.player.destroyed <= 0.0 && !view.player.afk,
        )
    });
    for mut engine in &mut engines {
        engine.set_speed((0.8 + speed / 45.0).clamp(0.8, 3.0));
        engine.set_volume(Volume::Linear(match running {
            true => 0.04 + (speed / 1000.0).min(0.09),
            false => 0.0,
        }));
    }
    for event in session.sounds.drain(..) {
        if let Some(source) = sounds.0.get(event.as_str()) {
            commands.spawn((AudioPlayer::new(source.clone()), PlaybackSettings::DESPAWN));
        }
    }
}
fn engine_wav() -> Vec<u8> {
    let mut bytes = wav(44.0, 1.0);
    for (i, sample) in bytes[44..].chunks_exact_mut(2).enumerate() {
        let phase = i as f32 / 22050.0 * 44.0 * std::f32::consts::TAU;
        let value = (phase.sin() + 0.35 * (phase * 2.0).sin()) * 5000.0;
        sample.copy_from_slice(&(value as i16).to_le_bytes());
    }
    bytes
}
fn wav(hz: f32, duration: f32) -> Vec<u8> {
    let rate = 22050u32;
    let count = (duration * rate as f32) as u32;
    let size = count * 2;
    let mut bytes = Vec::with_capacity(44 + size as usize);
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
    for i in 0..count {
        let t = i as f32 / rate as f32;
        let amplitude = (1.0 - t / duration).powi(2);
        let wave = (t * hz * std::f32::consts::TAU * (1.0 - t * 0.6)).sin();
        bytes.extend_from_slice(&((wave * amplitude * 4500.0) as i16).to_le_bytes());
    }
    bytes
}
