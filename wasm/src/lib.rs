#![recursion_limit = "256"]

use bevy::asset::AssetMetaCheck;
use bevy::prelude::*;
use bevy::window::WindowResolution;
use bevy::winit::{UpdateMode, WinitSettings};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use wasm_bindgen::prelude::*;
use wild_wheels_core::{ClientAction, ClientInput, NativeClient};
use wild_wheels_render::{
    ARENA_CAMERA, MOBILE_IDLE, MobileGraphics, Presentation, WildWheelsRenderPlugin, app, hud,
    mobile_rendering, scene, sound, ui_port,
};

static INVALID_PACKETS: AtomicU32 = AtomicU32::new(0);
static PRESENTATION_FRAME: Mutex<Option<Vec<u8>>> = Mutex::new(None);
static INCOMING_PACKETS: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());
static OUTBOUND_TEXT: Mutex<Option<String>> = Mutex::new(None);
static QUEUED_ACTIONS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
static PRESENTATION_READY: AtomicBool = AtomicBool::new(false);
static DIRECT_NET_MODE: AtomicBool = AtomicBool::new(false);
static VIRTUAL_KEYS: AtomicU32 = AtomicU32::new(0);
static INPUT_BLOCKED: AtomicBool = AtomicBool::new(false);
// Mobile profiles are ordered from highest detail to idle in bevy-presentation.js.
static MOBILE_LEVEL: AtomicU32 = AtomicU32::new(1);
static MOBILE_FRAMES: AtomicU32 = AtomicU32::new(0);

#[wasm_bindgen]
pub fn set_ui_pack(ui_pack: Vec<u8>) {
    if !ui_pack.is_empty() {
        wild_wheels_render::set_ui_pack_bytes(Box::leak(ui_pack.into_boxed_slice()));
    }
}

#[wasm_bindgen]
pub fn start_presentation(pack: Vec<u8>, mobile: bool) {
    start_client(pack, Vec::new(), mobile, false);
}

#[wasm_bindgen]
pub fn start_client(pack: Vec<u8>, sound_pack: Vec<u8>, mobile: bool, direct_net: bool) {
    console_error_panic_hook::set_once();
    wild_wheels_render::set_pack_bytes(Box::leak(pack.into_boxed_slice()));
    let has_audio = !sound_pack.is_empty();
    if has_audio {
        wild_wheels_render::set_sound_pack_bytes(Box::leak(sound_pack.into_boxed_slice()));
    }
    DIRECT_NET_MODE.store(direct_net, Ordering::Relaxed);
    let plugins = DefaultPlugins
        .set(AssetPlugin {
            meta_check: AssetMetaCheck::Never,
            ..default()
        })
        .set(WindowPlugin {
            primary_window: Some(Window {
                title: "Wild Wheels".into(),
                canvas: Some("#bevy-canvas".into()),
                fit_canvas_to_parent: true,
                prevent_default_event_handling: direct_net,
                resolution: WindowResolution::new(1280, 720),
                resize_constraints: match mobile {
                    true => bevy::window::WindowResizeConstraints {
                        min_width: 1.0,
                        min_height: 1.0,
                        ..default()
                    },
                    false => default(),
                },
                ..default()
            }),
            ..default()
        });
    let mut app = App::new();
    app.add_plugins(match has_audio {
        true => plugins,
        false => plugins.disable::<bevy::audio::AudioPlugin>(),
    });
    app.insert_resource(MobileGraphics { mobile, level: 1 })
        .insert_resource(app::GameSession::default())
        .init_resource::<hud::Notices>()
        .insert_resource(hud::HudState {
            active: false,
            show_menu_buttons: false,
            ..default()
        })
        .init_resource::<hud::HudEvents>()
        .add_plugins(WildWheelsRenderPlugin)
        .add_systems(Startup, (ui_port::setup, hud::setup))
        .add_systems(
            Update,
            (
                hud::update,
                hud::sync_prebaked_chrome,
                hud::handle_clicks,
            )
                .chain()
                .after(Presentation),
        );
    if has_audio {
        app.add_plugins(sound::GameAudioPlugin)
            .add_systems(Update, sound::play.after(Presentation));
    }
    if mobile {
        let mode = mobile_update_mode(1);
        app.insert_resource(WinitSettings {
            focused_mode: mode,
            unfocused_mode: mode,
        })
        .add_systems(PreUpdate, apply_mobile_level)
        .add_systems(Last, count_mobile_frame.run_if(mobile_rendering));
    }
    app.add_systems(Update, sync_session.before(Presentation))
        .run();
}

#[wasm_bindgen]
pub fn present_frame(packet: Vec<u8>) {
    if let Ok(mut frame) = PRESENTATION_FRAME.lock() {
        *frame = Some(packet);
    }
}

#[wasm_bindgen]
pub fn accept_net_packet(bytes: Vec<u8>) {
    if let Ok(mut q) = INCOMING_PACKETS.lock() {
        if q.len() > 8 {
            q.clear();
        }
        q.push(bytes);
    }
}

#[wasm_bindgen]
pub fn poll_net_outbound() -> String {
    OUTBOUND_TEXT
        .lock()
        .ok()
        .and_then(|mut g| g.take())
        .unwrap_or_default()
}

#[wasm_bindgen]
pub fn set_muted(muted: bool) {
    sound::set_muted(muted);
}

#[wasm_bindgen]
pub fn set_input_blocked(blocked: bool) {
    INPUT_BLOCKED.store(blocked, Ordering::Relaxed);
}

#[wasm_bindgen]
pub fn set_virtual_keys(bits: u32) {
    VIRTUAL_KEYS.store(bits, Ordering::Relaxed);
}

#[wasm_bindgen]
pub fn trigger_action(kind: String, item: String) {
    if let Ok(mut q) = QUEUED_ACTIONS.lock() {
        q.push((kind, item));
    }
}

#[wasm_bindgen]
pub fn arena_camera() -> Vec<f32> {
    ARENA_CAMERA
        .lock()
        .map(|camera| camera.to_vec())
        .unwrap_or_default()
}

#[wasm_bindgen]
pub fn show_character_preview(
    driver: usize,
    color: String,
    clock: f32,
    yaw: f64,
    celebrate: f64,
    boost: bool,
    tall: bool,
    width: u32,
    height: u32,
) {
    wild_wheels_render::preview::show_character_preview(
        driver, color, clock, yaw, celebrate, boost, tall, width, height,
    );
}

#[wasm_bindgen]
pub fn hide_character_preview() {
    wild_wheels_render::preview::hide_character_preview();
}

#[wasm_bindgen]
pub fn take_character_preview() -> Vec<u8> {
    wild_wheels_render::preview::take_character_preview()
}

#[wasm_bindgen]
pub fn presentation_ready() -> bool {
    PRESENTATION_READY.load(Ordering::Relaxed)
}

#[wasm_bindgen]
pub fn take_invalid_packets() -> u32 {
    INVALID_PACKETS.swap(0, Ordering::Relaxed)
}

#[wasm_bindgen]
pub fn set_mobile_presentation_level(level: u32) {
    MOBILE_LEVEL.store(level.min(MOBILE_IDLE), Ordering::Relaxed);
}

#[wasm_bindgen]
pub fn mobile_presentation_frames() -> u32 {
    MOBILE_FRAMES.load(Ordering::Relaxed)
}

fn count_mobile_frame() {
    if presentation_ready() {
        MOBILE_FRAMES.fetch_add(1, Ordering::Relaxed);
    }
}

fn mobile_update_mode(level: u32) -> UpdateMode {
    let wait = match level {
        MOBILE_IDLE => Duration::from_millis(200),
        3 => Duration::from_millis(50),
        _ => Duration::from_secs_f64(1.0 / 30.0),
    };
    UpdateMode::Reactive {
        wait,
        react_to_device_events: false,
        react_to_user_events: false,
        react_to_window_events: false,
    }
}

fn apply_mobile_level(
    mut commands: Commands,
    mut graphics: ResMut<MobileGraphics>,
    mut settings: ResMut<WinitSettings>,
    mut world: Query<(Entity, &mut Camera), (With<scene::FollowCamera>, Without<scene::XrayCamera>)>,
    mut xray: Query<(Entity, &mut Camera), (With<scene::XrayCamera>, Without<scene::FollowCamera>)>,
) {
    let level = MOBILE_LEVEL.load(Ordering::Relaxed);
    if level == graphics.level {
        return;
    }
    let was_idle = graphics.level == MOBILE_IDLE;
    let idle = level == MOBILE_IDLE;
    graphics.level = level;
    settings.focused_mode = mobile_update_mode(level);
    settings.unfocused_mode = settings.focused_mode;
    if idle == was_idle {
        return;
    }
    for (entity, mut camera) in &mut world {
        camera.is_active = !idle;
        if idle {
            commands.entity(entity).insert(bevy::ui::IsDefaultUiCamera);
        }
    }
    if idle {
        for (entity, mut camera) in &mut xray {
            camera.is_active = false;
            commands.entity(entity).remove::<bevy::ui::IsDefaultUiCamera>();
        }
    }
}

fn sync_session(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    mut session: ResMut<app::GameSession>,
    mut hud_state: ResMut<hud::HudState>,
    mut hud_events: ResMut<hud::HudEvents>,
) {
    if !DIRECT_NET_MODE.load(Ordering::Relaxed) {
        hud_state.active = false;
        hud_events.actions.clear();
        let Some(packet) = PRESENTATION_FRAME.lock().ok().and_then(|mut f| f.take()) else {
            return;
        };
        let result = match session.client.as_mut() {
            Some(client) => client.replace_presentation(&packet),
            None => NativeClient::from_packet(&packet, 0.0).map(|client| {
                session.client = Some(client);
            }),
        };
        if result.is_err() {
            INVALID_PACKETS.fetch_add(1, Ordering::Relaxed);
            return;
        }
        PRESENTATION_READY.store(true, Ordering::Relaxed);
        return;
    }

    let now = time.elapsed_secs_f64();
    let dt = time.delta_secs_f64().clamp(0.0, 0.05);
    let packets = INCOMING_PACKETS
        .lock()
        .map(|mut q| std::mem::take(&mut *q))
        .unwrap_or_default();
    for pkt in packets {
        let res = match session.client.as_mut() {
            Some(client) => client.accept(&pkt, now),
            None => NativeClient::from_packet(&pkt, now).map(|client| {
                session.client = Some(client);
            }),
        };
        if res.is_err() {
            INVALID_PACKETS.fetch_add(1, Ordering::Relaxed);
        }
    }
    let Some(client) = session.client.as_mut() else {
        hud_state.active = false;
        hud_events.actions.clear();
        return;
    };
    hud_state.active = true;
    for act in hud_events.actions.drain(..) {
        if let hud::HudAct::Game(action) = act {
            let _ = client.action(action, now);
        }
    }
    let blocked = INPUT_BLOCKED.load(Ordering::Relaxed);
    let mut bits = if blocked { 0 } else { VIRTUAL_KEYS.load(Ordering::Relaxed) };
    if !blocked {
        if keys.pressed(KeyCode::KeyW) || keys.pressed(KeyCode::ArrowUp) {
            bits |= 1;
        }
        if keys.pressed(KeyCode::KeyS) || keys.pressed(KeyCode::ArrowDown) {
            bits |= 2;
        }
        if keys.pressed(KeyCode::KeyD) || keys.pressed(KeyCode::ArrowRight) {
            bits |= 4;
        }
        if keys.pressed(KeyCode::KeyA) || keys.pressed(KeyCode::ArrowLeft) {
            bits |= 8;
        }
        if keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight) {
            bits |= 16;
        }
        if keys.pressed(KeyCode::Space) {
            let _ = client.action(ClientAction::Fire, now);
        }
        if let Ok(mut q) = QUEUED_ACTIONS.lock() {
            for (kind, item) in q.drain(..) {
                let action = match kind.as_str() {
                    "fire" => Some(ClientAction::Fire),
                    "turbo" | "boost" => Some(ClientAction::Boost),
                    "special" => Some(ClientAction::Special),
                    "somersault" => Some(ClientAction::Somersault),
                    "chaff" => Some(ClientAction::Chaff),
                    "cycle" => Some(ClientAction::CycleWeapon),
                    "select" if item == "hedgehog" => Some(ClientAction::SelectHedgehog),
                    "select" if item == "missile" => Some(ClientAction::SelectMissile),
                    _ => None,
                };
                if let Some(a) = action {
                    let _ = client.action(a, now);
                }
            }
        }
        if keys.just_pressed(KeyCode::KeyX) || keys.just_pressed(KeyCode::KeyE) {
            let _ = client.action(ClientAction::Boost, now);
        }
        if keys.just_pressed(KeyCode::KeyF) {
            let _ = client.action(ClientAction::Special, now);
        }
        if keys.just_pressed(KeyCode::KeyZ) {
            let _ = client.action(ClientAction::Somersault, now);
        }
        if keys.just_pressed(KeyCode::KeyC) {
            let _ = client.action(ClientAction::Chaff, now);
        }
        if keys.just_pressed(KeyCode::Tab) || keys.just_pressed(KeyCode::KeyQ) {
            let _ = client.action(ClientAction::CycleWeapon, now);
        }
    }
    let input = ClientInput { keys: bits & 31, steer: None };
    let _ = client.advance(dt, input, now);
    if let Ok(out) = client.outbound(input)
        && let Ok(text) = String::from_utf8(out)
        && let Ok(mut slot) = OUTBOUND_TEXT.lock()
    {
        *slot = Some(text);
    }
    let mut sounds = client.drain_audio();
    let mut voices = client.drain_voices();
    session.sounds.append(&mut sounds);
    session.voices.append(&mut voices);
    PRESENTATION_READY.store(true, Ordering::Relaxed);
}
