//! Small procedural PCM cues using Bevy audio; no browser audio runtime.
use crate::app::GameSession;
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
}
pub fn play(mut commands: Commands, mut session: ResMut<GameSession>, sounds: Res<Sounds>) {
    for event in session.sounds.drain(..) {
        if let Some(source) = sounds.0.get(event.as_str()) {
            commands.spawn((AudioPlayer::new(source.clone()), PlaybackSettings::DESPAWN));
        }
    }
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
