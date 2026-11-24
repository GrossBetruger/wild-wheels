mod arena_mesh;
mod bench;
mod plumage;
mod ported;
mod scene;
mod sound;
mod sprite;
mod xray;

use bevy::prelude::*;
use bevy::window::WindowResolution;
use serde_json::json;
use std::sync::{Mutex, OnceLock};
use wasm_bindgen::prelude::*;
use wild_wheels_core::{Action, Frame, Input, NativeArena, NativeClient};

pub mod reports {
    pub fn limited(_key: &str, _seconds: f64, _level: &str, _event: &str, _data: impl FnOnce() -> serde_json::Value) {}
}

pub mod app {
    use bevy::prelude::*;
    use wild_wheels_core::NativeClient;

    #[derive(Resource, Default)]
    pub struct GameSession {
        pub client: Option<NativeClient>,
        pub sounds: Vec<String>,
        pub voices: Vec<(usize, String, f64)>,
    }
    impl GameSession {
        pub fn joined(&self) -> bool {
            self.client.is_some()
        }
    }
}

#[derive(Resource)]
struct LocalMatch {
    arena: NativeArena,
    elapsed: f64,
    next_action: u32,
}

#[derive(Resource, Clone, Copy)]
struct LaunchConfig {
    driver: usize,
    arena: usize,
    bots: usize,
}

static PACK_BYTES: OnceLock<&'static [u8]> = OnceLock::new();
static SOUND_BYTES: OnceLock<&'static [u8]> = OnceLock::new();
static HUD_JSON: Mutex<String> = Mutex::new(String::new());

#[wasm_bindgen]
pub fn hud_state() -> String {
    HUD_JSON.lock().map(|g| g.clone()).unwrap_or_default()
}

pub(crate) fn pack_bytes() -> &'static [u8] {
    PACK_BYTES.get().copied().unwrap_or(&[])
}

pub(crate) fn sound_pack_bytes() -> &'static [u8] {
    SOUND_BYTES.get().copied().unwrap_or(&[])
}

#[wasm_bindgen]
pub fn start_game(pack: Vec<u8>, sound_pack: Vec<u8>, driver: usize, arena: usize, bots: usize) {
    console_error_panic_hook::set_once();
    let leaked: &'static [u8] = Box::leak(pack.into_boxed_slice());
    let _ = PACK_BYTES.set(leaked);
    let leaked_sound: &'static [u8] = Box::leak(sound_pack.into_boxed_slice());
    let _ = SOUND_BYTES.set(leaked_sound);

    let cfg = LaunchConfig {
        driver: driver.min(15),
        arena: arena.min(2),
        bots: bots.min(7),
    };

    let mut bevy_app = App::new();
    bevy_app
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Wild Wheels — Bevy WASM PoC".into(),
                canvas: Some("#bevy-canvas".into()),
                fit_canvas_to_parent: true,
                prevent_default_event_handling: true,
                resolution: WindowResolution::new(1280, 720),
                ..default()
            }),
            ..default()
        }))
        .insert_resource(cfg)
        .insert_resource(app::GameSession::default())
        .insert_resource(scene::Capture(None))
        .add_plugins((
            ported::PortedGraphicsPlugin,
            scene::ArenaPresentationPlugin,
            sound::GameAudioPlugin,
        ))
        .add_systems(Startup, start_local_match)
        .add_systems(
            Update,
            (tick_local_match, scene::sync, ported::animate, sound::play).chain(),
        );

    bevy_app.run();
}

fn start_local_match(
    mut commands: Commands,
    cfg: Res<LaunchConfig>,
    mut session: ResMut<app::GameSession>,
) {
    let bots = if cfg.arena == 2 { cfg.bots.min(3) } else { cfg.bots.min(7) };
    let config = json!({
        "code": "00",
        "maxPlayers": 8,
        "arena": cfg.arena,
        "bots": bots,
        "dedicated": true,
        "host": null,
        "epoch": 1,
        "seed": 42,
        "players": [{"id": 0, "name": "WASM Pilot", "driver": cfg.driver, "role": "driver"}],
        "specialAbilities": true,
        "targetScore": 15,
        "matchMinutes": 5
    });
    let mut arena = NativeArena::new(config).expect("valid local arena");
    arena.start();
    let pkt = arena.packet(0);
    session.client = NativeClient::from_packet(&pkt, 0.0).ok();
    commands.insert_resource(LocalMatch {
        arena,
        elapsed: 0.0,
        next_action: 1,
    });
}

fn tick_local_match(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    mut local: ResMut<LocalMatch>,
    mut session: ResMut<app::GameSession>,
) {
    let dt = f64::from(time.delta_secs()).clamp(1.0 / 240.0, 0.05);
    local.elapsed += dt;

    let mut bits = 0u32;
    if keys.pressed(KeyCode::KeyW) || keys.pressed(KeyCode::ArrowUp) {
        bits |= 1;
    }
    if keys.pressed(KeyCode::KeyS) || keys.pressed(KeyCode::ArrowDown) {
        bits |= 2;
    }
    if keys.pressed(KeyCode::KeyA) || keys.pressed(KeyCode::ArrowLeft) {
        bits |= 8;
    }
    if keys.pressed(KeyCode::KeyD) || keys.pressed(KeyCode::ArrowRight) {
        bits |= 4;
    }
    if keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight) {
        bits |= 16;
    }
    if keys.pressed(KeyCode::Space) {
        bits |= 32;
    }

    let mut actions = Vec::new();
    let mut push = |kind: &str, item: &str, id: &mut u32| {
        actions.push(Action {
            id: Some(*id),
            kind: kind.into(),
            after_move: -1,
            wx: 0.0,
            wz: 0.0,
            item: item.into(),
            bomb_kind: None,
        });
        *id += 1;
    };
    if keys.just_pressed(KeyCode::KeyX) || keys.just_pressed(KeyCode::KeyE) {
        push("turbo", "", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::KeyF) {
        push("special", "", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::KeyZ) {
        push("somersault", "", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::KeyC) {
        push("chaff", "", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::Tab) || keys.just_pressed(KeyCode::KeyQ) {
        push("cycle", "", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::Digit1) {
        push("select", "hedgehog", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::Digit2) {
        push("select", "missile", &mut local.next_action);
    }

    let frame = Frame {
        dt,
        inputs: vec![Input {
            actor: 0,
            keys: bits,
            steer: None,
            sequence: None,
            moves: None,
            actions,
            action_clock: false,
        }],
    };
    let _ = local.arena.step(frame);
    let (events, voices) = local.arena.cues(0);
    let pkt = local.arena.packet_with_cues(0, events, voices);
    local.arena.drain();
    let (mut drained_sounds, mut drained_voices) = (Vec::new(), Vec::new());
    if let Some(client) = session.client.as_mut() {
        let _ = client.accept(&pkt, local.elapsed);
        drained_sounds = client.drain_audio();
        drained_voices = client.drain_voices();
        let view = client.view();
        let p = view.player;
        let mut standings: Vec<_> = view
            .actors
            .iter()
            .filter(|a| !a.inactive)
            .map(|a| {
                (
                    a.kills,
                    a.deaths,
                    a.id,
                    a.name.as_deref().unwrap_or("Bot"),
                    a.color.as_str(),
                )
            })
            .collect();
        standings.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        let rows: Vec<_> = standings
            .into_iter()
            .map(|(kills, deaths, id, name, color)| {
                json!({ "name": name, "color": color, "kills": kills, "deaths": deaths, "me": id == view.you })
            })
            .collect();
        let snap = json!({
            "phase": view.phase,
            "elapsed": view.elapsed,
            "duration": view.duration,
            "countdown": view.countdown,
            "health": p.health,
            "destroyed": p.destroyed,
            "speed": p.speed,
            "ammo": p.ammo,
            "missiles": p.missiles,
            "turbos": p.turbos,
            "chaff": p.chaff,
            "item": p.item,
            "specialCooldown": p.special_cooldown,
            "notice": p.notice,
            "noticeTime": p.notice_time,
            "standings": rows,
        })
        .to_string();
        if let Ok(mut guard) = HUD_JSON.lock() {
            *guard = snap;
        }
    } else {
        session.client = NativeClient::from_packet(&pkt, local.elapsed).ok();
    }
    session.sounds.append(&mut drained_sounds);
    session.voices.append(&mut drained_voices);
}
