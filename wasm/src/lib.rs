#![recursion_limit = "256"]

mod net;

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
static RESET_SESSION: AtomicBool = AtomicBool::new(false);
static HUD_ACTIVE: AtomicBool = AtomicBool::new(false);
static HUD_ACTIONS_OUT: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
static PENDING_AUDIO_EVENTS: Mutex<Vec<String>> = Mutex::new(Vec::new());
static PENDING_VOICES: Mutex<Vec<(usize, String, f64)>> = Mutex::new(Vec::new());
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
pub fn set_hud_active(active: bool) {
    HUD_ACTIVE.store(active, Ordering::Relaxed);
}

#[wasm_bindgen]
pub fn set_direct_net(enabled: bool) {
    let prev = DIRECT_NET_MODE.swap(enabled, Ordering::Relaxed);
    if prev && !enabled {
        RESET_SESSION.store(true, Ordering::Relaxed);
    }
}

#[wasm_bindgen]
pub fn reset_session() {
    RESET_SESSION.store(true, Ordering::Relaxed);
}

#[wasm_bindgen]
pub fn push_audio_event(name: String) {
    if let Ok(mut q) = PENDING_AUDIO_EVENTS.lock() {
        if q.len() < 64 {
            q.push(name);
        }
    }
}

#[wasm_bindgen]
pub fn push_voice(driver: usize, cue: String, volume: f64) {
    if let Ok(mut q) = PENDING_VOICES.lock() {
        if q.len() < 32 {
            q.push((driver, cue, volume));
        }
    }
}

#[wasm_bindgen]
pub fn take_hud_actions() -> String {
    let actions = HUD_ACTIONS_OUT
        .lock()
        .ok()
        .map(|mut q| std::mem::take(&mut *q))
        .unwrap_or_default();
    if actions.is_empty() {
        return String::new();
    }
    serde_json::to_string(&actions).unwrap_or_default()
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
                prevent_default_event_handling: false,
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
            show_leaderboard: false,
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
pub fn connect_socket(url: String, token: String, client_type: String) -> bool {
    net::connect(&url, &token, &client_type)
}

#[wasm_bindgen]
pub fn disconnect_socket() {
    net::disconnect();
}

#[wasm_bindgen]
pub fn take_socket_closed() -> String {
    net::take_closed_json()
}

#[wasm_bindgen]
pub fn socket_rtt_secs() -> f64 {
    net::rtt_secs()
}

#[wasm_bindgen]
pub fn socket_last_packet_ms() -> f64 {
    net::last_packet_ms()
}

#[wasm_bindgen]
pub fn take_latest_packet() -> Vec<u8> {
    net::take_latest_packet()
}

pub(crate) fn enqueue_incoming_packet(bytes: Vec<u8>) {
    if let Ok(mut q) = INCOMING_PACKETS.lock() {
        if q.len() > 8 {
            q.clear();
        }
        q.push(bytes);
    }
}

#[wasm_bindgen]
pub fn accept_net_packet(bytes: Vec<u8>) {
    enqueue_incoming_packet(bytes);
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
    mut last_send: Local<f64>,
    mut last_keys: Local<u32>,
    mut session: ResMut<app::GameSession>,
    mut hud_state: ResMut<hud::HudState>,
    mut hud_events: ResMut<hud::HudEvents>,
) {
    if RESET_SESSION.swap(false, Ordering::Relaxed) {
        session.client = None;
        session.sounds.clear();
        session.voices.clear();
        hud_events.actions.clear();
        if let Ok(mut q) = INCOMING_PACKETS.lock() {
            q.clear();
        }
        if let Ok(mut slot) = OUTBOUND_TEXT.lock() {
            *slot = None;
        }
        if let Ok(mut q) = QUEUED_ACTIONS.lock() {
            q.clear();
        }
    }
    if !DIRECT_NET_MODE.load(Ordering::Relaxed) {
        if let Ok(mut q) = PENDING_AUDIO_EVENTS.lock() {
            session.sounds.append(&mut q);
        }
        if let Ok(mut q) = PENDING_VOICES.lock() {
            session.voices.append(&mut q);
        }
        if let Ok(mut out) = HUD_ACTIONS_OUT.lock() {
            for act in hud_events.actions.drain(..) {
                if let hud::HudAct::Game(action) = act {
                    let (kind, item) = match action {
                        ClientAction::Fire => ("fire", ""),
                        ClientAction::CycleWeapon => ("cycle", ""),
                        ClientAction::Boost => ("turbo", ""),
                        ClientAction::Chaff => ("chaff", ""),
                        ClientAction::Somersault => ("somersault", ""),
                        ClientAction::Special => ("special", ""),
                        ClientAction::SelectHedgehog => ("select", "hedgehog"),
                        ClientAction::SelectMissile => ("select", "missile"),
                    };
                    out.push((kind.into(), item.into()));
                }
            }
        }
        let Some(packet) = PRESENTATION_FRAME.lock().ok().and_then(|mut f| f.take()) else {
            hud_state.active = HUD_ACTIVE.load(Ordering::Relaxed) && session.client.is_some();
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
        hud_state.active = HUD_ACTIVE.load(Ordering::Relaxed) && session.client.is_some();
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
    hud_state.active = HUD_ACTIVE.load(Ordering::Relaxed);
    let mut had_action = false;
    for act in hud_events.actions.drain(..) {
        if let hud::HudAct::Game(action) = act {
            let _ = client.action(action, now);
            had_action = true;
        }
    }
    let blocked = INPUT_BLOCKED.load(Ordering::Relaxed);
    let bits = if blocked { 0 } else { VIRTUAL_KEYS.load(Ordering::Relaxed) };
    if !blocked {
        if bits & 32 != 0 {
            if client.action(ClientAction::Fire, now).unwrap_or(false) {
                had_action = true;
            }
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
                    if client.action(a, now).unwrap_or(false) {
                        had_action = true;
                    }
                }
            }
        }
    }
    let move_keys = bits & 31;
    let input = ClientInput { keys: move_keys, steer: None };
    let _ = client.advance(dt, input, now);
    let changed = had_action || move_keys != *last_keys;
    let min_interval = if changed { 1.0 / 60.0 } else { 1.0 / 30.0 };
    if now - *last_send >= min_interval {
        if net::is_connected() {
            if net::can_send()
                && let Ok(out) = client.outbound(input)
                && let Ok(text) = String::from_utf8(out)
            {
                net::send_if_ready(&text);
                *last_send = now;
                *last_keys = move_keys;
            }
        } else if let Ok(out) = client.outbound(input)
            && let Ok(text) = String::from_utf8(out)
            && let Ok(mut slot) = OUTBOUND_TEXT.lock()
        {
            *slot = Some(text);
            *last_send = now;
            *last_keys = move_keys;
        }
    }
    let mut sounds = client.drain_audio();
    let mut voices = client.drain_voices();
    session.sounds.append(&mut sounds);
    session.voices.append(&mut voices);
    PRESENTATION_READY.store(true, Ordering::Relaxed);
}
