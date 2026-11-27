#![recursion_limit = "256"]

use bevy::asset::AssetMetaCheck;
use bevy::prelude::*;
use bevy::window::WindowResolution;
use bevy::winit::{UpdateMode, WinitSettings};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use wasm_bindgen::prelude::*;
use wild_wheels_core::{Action, ClientAction, ClientInput, Frame, Input, NativeArena, NativeClient};
use wild_wheels_render::{
    ARENA_CAMERA, MOBILE_IDLE, MobileGraphics, Presentation, WildWheelsRenderPlugin, app,
    has_blender_model, mobile_rendering, ported, scene, sound,
};

#[derive(Resource)]
struct LocalMatch {
    arena: NativeArena,
    elapsed: f64,
    next_action: u32,
    last_x_tap: f64,
}

#[derive(Resource, Clone)]
struct LaunchConfig {
    driver: usize,
    arena: usize,
    bots: usize,
    player_name: String,
    target_score: u32,
    match_minutes: u32,
    special_abilities: bool,
}

static HUD_JSON: Mutex<String> = Mutex::new(String::new());
static METADATA_JSON: Mutex<String> = Mutex::new(String::new());
static PENDING_RESTART: Mutex<Option<LaunchConfig>> = Mutex::new(None);
static QUEUED_ACTIONS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
static INCOMING_PACKETS: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());
static OUTBOUND_TEXT: Mutex<Option<String>> = Mutex::new(None);
static INVALID_PACKETS: AtomicU32 = AtomicU32::new(0);
static PRESENTATION_FRAME: Mutex<Option<Vec<u8>>> = Mutex::new(None);
static PRESENTATION_READY: AtomicBool = AtomicBool::new(false);
// Mobile profiles are ordered from highest detail to idle in bevy-presentation.js.
static MOBILE_LEVEL: AtomicU32 = AtomicU32::new(1);
static MOBILE_FRAMES: AtomicU32 = AtomicU32::new(0);
static PAUSED: AtomicBool = AtomicBool::new(false);
static INPUT_BLOCKED: AtomicBool = AtomicBool::new(false);
static ONLINE_MODE: AtomicBool = AtomicBool::new(false);
static ONLINE_RESET: AtomicBool = AtomicBool::new(false);
static VIRTUAL_KEYS: AtomicU32 = AtomicU32::new(0);

#[wasm_bindgen]
pub fn hud_state() -> String {
    HUD_JSON.lock().map(|g| g.clone()).unwrap_or_default()
}

#[wasm_bindgen]
pub fn get_metadata() -> String {
    METADATA_JSON.lock().map(|g| g.clone()).unwrap_or_default()
}

#[wasm_bindgen]
pub fn set_paused(paused: bool) {
    PAUSED.store(paused, Ordering::Relaxed);
}

#[wasm_bindgen]
pub fn set_input_blocked(blocked: bool) {
    INPUT_BLOCKED.store(blocked, Ordering::Relaxed);
}

#[wasm_bindgen]
pub fn set_network_mode(online: bool) {
    ONLINE_MODE.store(online, Ordering::Relaxed);
    ONLINE_RESET.store(true, Ordering::Relaxed);
    PAUSED.store(false, Ordering::Relaxed);
    if let Ok(mut q) = INCOMING_PACKETS.lock() {
        q.clear();
    }
    if let Ok(mut o) = OUTBOUND_TEXT.lock() {
        *o = None;
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
pub fn take_invalid_packets() -> u32 {
    INVALID_PACKETS.swap(0, Ordering::Relaxed)
}

#[wasm_bindgen]
pub fn set_muted(muted: bool) {
    sound::set_muted(muted);
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
pub fn restart_local_match(
    driver: usize,
    arena: usize,
    bots: usize,
    player_name: String,
    target_score: u32,
    match_minutes: u32,
    special_abilities: bool,
) {
    let arena_count = wild_wheels_core::arena_defs().len().max(1);
    let cfg = LaunchConfig {
        driver: driver.min(15),
        arena: arena.min(arena_count - 1),
        bots: bots.min(7),
        player_name: if player_name.trim().is_empty() {
            "WASM Pilot".into()
        } else {
            player_name.trim().chars().take(18).collect()
        },
        target_score: target_score.clamp(5, 50),
        match_minutes: match_minutes.clamp(1, 15),
        special_abilities,
    };
    PAUSED.store(false, Ordering::Relaxed);
    if let Ok(mut pending) = PENDING_RESTART.lock() {
        *pending = Some(cfg);
    }
}

#[wasm_bindgen]
pub fn start_game(
    pack: Vec<u8>,
    sound_pack: Vec<u8>,
    driver: usize,
    arena: usize,
    bots: usize,
    player_name: String,
    target_score: u32,
    match_minutes: u32,
    special_abilities: bool,
) {
    let arena_count = wild_wheels_core::arena_defs().len().max(1);
    let cfg = LaunchConfig {
        driver: driver.min(15),
        arena: arena.min(arena_count - 1),
        bots: bots.min(7),
        player_name: if player_name.trim().is_empty() {
            "WASM Pilot".into()
        } else {
            player_name.trim().chars().take(18).collect()
        },
        target_score: target_score.clamp(5, 50),
        match_minutes: match_minutes.clamp(1, 15),
        special_abilities,
    };
    PAUSED.store(false, Ordering::Relaxed);
    wild_wheels_render::set_sound_pack_bytes(Box::leak(sound_pack.into_boxed_slice()));

    presentation_app(pack, "#bevy-canvas", true, false)
        .insert_resource(cfg)
        .add_plugins(sound::GameAudioPlugin)
        .add_systems(Startup, (start_local_match, publish_metadata))
        .add_systems(Update, (tick_local_match.before(Presentation), sound::play.after(Presentation)))
        .run();
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

#[wasm_bindgen]
pub fn start_presentation(pack: Vec<u8>, mobile: bool) {
    let mut app = presentation_app(pack, "#bevy-canvas", false, mobile);
    if mobile {
        app.insert_resource(WinitSettings {
            focused_mode: mobile_update_mode(1),
            unfocused_mode: mobile_update_mode(1),
        })
        .configure_sets(Update, Presentation.run_if(mobile_rendering))
        .add_systems(PreUpdate, apply_mobile_level)
        .add_systems(Last, count_mobile_frame.run_if(mobile_rendering));
    }
    app.add_systems(Update, apply_presentation_frame.before(Presentation)).run();
}

#[wasm_bindgen]
pub fn present_frame(packet: Vec<u8>) {
    if let Ok(mut frame) = PRESENTATION_FRAME.lock() {
        *frame = Some(packet);
    }
}

#[wasm_bindgen]
pub fn arena_camera() -> Vec<f32> {
    ARENA_CAMERA.lock().map(|camera| camera.to_vec()).unwrap_or_default()
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
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

fn apply_presentation_frame(mut session: ResMut<app::GameSession>) {
    let Some(packet) = PRESENTATION_FRAME.lock().ok().and_then(|mut frame| frame.take()) else {
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
}

fn presentation_app(pack: Vec<u8>, canvas: &str, interactive: bool, mobile: bool) -> App {
    console_error_panic_hook::set_once();
    wild_wheels_render::set_pack_bytes(Box::leak(pack.into_boxed_slice()));
    let plugins = DefaultPlugins
        .set(AssetPlugin { meta_check: AssetMetaCheck::Never, ..default() })
        .set(WindowPlugin {
            primary_window: Some(Window {
                title: "Wild Wheels — Bevy WASM".into(),
                canvas: Some(canvas.into()),
                fit_canvas_to_parent: true,
                prevent_default_event_handling: interactive,
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
    let mut bevy_app = App::new();
    bevy_app.add_plugins(match interactive {
        true => plugins,
        false => plugins.disable::<bevy::audio::AudioPlugin>(),
    });
    bevy_app
        .insert_resource(MobileGraphics { mobile, level: 1 })
        .insert_resource(app::GameSession::default())
        .add_plugins(WildWheelsRenderPlugin);
    bevy_app
}

fn publish_metadata(graphics: Res<ported::Graphics>) {
    let drivers: Vec<_> = graphics
        .racers()
        .iter()
        .enumerate()
        .map(|(idx, r)| {
            let [cr, cg, cb] = r.color;
            let hex = format!("#{cr:02x}{cg:02x}{cb:02x}");
            json!({
                "id": idx,
                "name": r.name,
                "description": r.description,
                "ability": r.ability,
                "intelligence": r.intelligence,
                "color": hex,
                "blender": has_blender_model(idx),
            })
        })
        .collect();
    let arenas: Vec<_> = graphics
        .arenas()
        .iter()
        .enumerate()
        .map(|(idx, a)| {
            json!({
                "id": idx,
                "name": a.name,
                "description": a.description,
            })
        })
        .collect();
    if let Ok(mut guard) = METADATA_JSON.lock() {
        *guard = json!({ "drivers": drivers, "arenas": arenas }).to_string();
    }
}

fn build_local_arena(cfg: &LaunchConfig, seed: u64) -> NativeArena {
    let bots = if cfg.arena == 2 {
        cfg.bots.min(3)
    } else {
        cfg.bots.min(7)
    };
    let config = json!({
        "code": "00",
        "maxPlayers": 8,
        "arena": cfg.arena,
        "bots": bots,
        "dedicated": true,
        "host": null,
        "epoch": seed,
        "seed": seed,
        "players": [{"id": 0, "name": cfg.player_name, "driver": cfg.driver, "role": "driver"}],
        "specialAbilities": cfg.special_abilities,
        "targetScore": cfg.target_score,
        "matchMinutes": cfg.match_minutes
    });
    let mut arena = NativeArena::new(config).expect("valid local arena");
    arena.start();
    arena
}

fn start_local_match(
    mut commands: Commands,
    cfg: Res<LaunchConfig>,
    mut session: ResMut<app::GameSession>,
) {
    let arena = build_local_arena(&cfg, 42);
    let pkt = arena.packet(0);
    session.client = NativeClient::from_packet(&pkt, 0.0).ok();
    commands.insert_resource(LocalMatch {
        arena,
        elapsed: 0.0,
        next_action: 1,
        last_x_tap: -10.0,
    });
}

fn publish_hud(client: &NativeClient) {
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
                a.driver,
                a.name.as_deref().unwrap_or("Bot"),
                a.color.as_str(),
            )
        })
        .collect();
    standings.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let rows: Vec<_> = standings
        .into_iter()
        .map(|(kills, deaths, id, driver, name, color)| {
            json!({
                "id": id,
                "driver": driver,
                "name": name,
                "color": color,
                "kills": kills,
                "deaths": deaths,
                "me": id == view.you
            })
        })
        .collect();
    let kill_feed: Vec<_> = view
        .kill_feed
        .iter()
        .rev()
        .take(5)
        .map(|k| {
            json!({
                "id": k.id,
                "attacker": k.attacker_name,
                "victim": k.victim_name,
                "victimColor": k.victim_color,
                "kind": k.kind,
                "text": k.text,
                "time": k.time,
            })
        })
        .collect();
    let radar_actors: Vec<_> = view
        .actors
        .iter()
        .filter(|a| !a.inactive)
        .map(|a| {
            json!({
                "wx": a.wx,
                "wz": a.wz,
                "heading": a.heading,
                "color": a.color,
                "me": a.id == view.you,
                "dead": a.destroyed > 0.0,
            })
        })
        .collect();
    let radar_supplies: Vec<_> = view
        .supplies
        .iter()
        .filter(|s| s.cooldown <= 0.0)
        .map(|s| json!({ "wx": s.wx, "wz": s.wz, "kind": s.kind }))
        .collect();
    let radar_missiles: Vec<_> = view
        .projectiles
        .iter()
        .filter(|s| s.kind == "missile")
        .map(|s| json!({ "wx": s.wx, "wz": s.wz }))
        .collect();
    let radar_ghosts: Vec<_> = view
        .effects
        .iter()
        .filter(|e| e.kind == "eulerGhost")
        .map(|e| json!({ "wx": e.wx, "wz": e.wz }))
        .collect();
    let bridge_count = view.arena_def.bridges.len();
    let bridges_crossed = p.euler_bridges.count_ones();
    let winner_name = view
        .winner
        .and_then(|wid| view.actors.get(wid))
        .map(|a| a.name.as_deref().unwrap_or("Bot").to_string());
    let snap = json!({
        "multiplayer": view.multiplayer,
        "match": view.epoch,
        "phase": view.phase,
        "elapsed": view.elapsed,
        "duration": view.duration,
        "countdown": view.countdown,
        "finishCountdown": view.finish_countdown,
        "targetScore": view.target_score,
        "winner": winner_name,
        "you": view.you,
        "driver": p.driver,
        "health": p.health,
        "destroyed": p.destroyed,
        "speed": p.speed,
        "ammo": p.ammo,
        "missiles": p.missiles,
        "turbos": p.turbos,
        "chaff": p.chaff,
        "bombAmmo": p.bomb_ammo,
        "stinkAmmo": p.stink_ammo,
        "item": p.item,
        "shield": p.shield,
        "hedgeShield": p.hedge_shield,
        "tehilim": p.tehilim,
        "vulcan": p.vulcan,
        "boost": p.boost,
        "drift": p.drift,
        "wasDrifting": p.was_drifting,
        "specialCooldown": p.special_cooldown,
        "specialActive": p.special_active,
        "nightmareActive": p.nightmare_active,
        "nightmareCooldown": p.nightmare_cooldown,
        "somersaultCooldown": p.somersault_cooldown,
        "bridgeCount": bridge_count,
        "bridgesCrossed": bridges_crossed,
        "notice": p.notice,
        "noticeTime": p.notice_time,
        "standings": rows,
        "killFeed": kill_feed,
        "radar": {
            "size": view.arena_def.size,
            "shape": view.arena_def.shape,
            "blocks": view.blocks,
            "water": view.arena_def.water,
            "bridges": view.arena_def.bridges,
            "eulerBridges": p.euler_bridges,
            "actors": radar_actors,
            "supplies": radar_supplies,
            "missiles": radar_missiles,
            "ghosts": radar_ghosts,
        }
    })
    .to_string();
    if let Ok(mut guard) = HUD_JSON.lock() {
        *guard = snap;
    }
}

fn tick_local_match(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    mut local: ResMut<LocalMatch>,
    mut session: ResMut<app::GameSession>,
) {
    let dt = f64::from(time.delta_secs()).clamp(1.0 / 240.0, 0.05);

    // Online multiplayer mode: feed server packets to NativeClient and emit predicted outbound JSON
    if ONLINE_MODE.load(Ordering::Relaxed) {
        if ONLINE_RESET.swap(false, Ordering::Relaxed) {
            session.client = None;
            session.sounds.clear();
            session.voices.clear();
            local.elapsed = 0.0;
        }
        local.elapsed += dt;
        let packets: Vec<Vec<u8>> = INCOMING_PACKETS
            .lock()
            .map(|mut q| q.drain(..).collect())
            .unwrap_or_default();
        for pkt in packets {
            let result = match session.client.as_mut() {
                Some(client) => client.accept(&pkt, local.elapsed),
                None => NativeClient::from_packet(&pkt, local.elapsed).map(|client| {
                    session.client = Some(client);
                }),
            };
            if result.is_err() {
                INVALID_PACKETS.fetch_add(1, Ordering::Relaxed);
            }
        }
        let Some(client) = session.client.as_mut() else {
            return;
        };
        let blocked = PAUSED.load(Ordering::Relaxed) || INPUT_BLOCKED.load(Ordering::Relaxed);
        let mut bits = if blocked {
            0
        } else {
            VIRTUAL_KEYS.load(Ordering::Relaxed)
        };
        if !blocked {
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
        }
        let move_input = ClientInput {
            keys: bits & 31,
            steer: None,
        };
        let _ = client.advance(dt, move_input, local.elapsed);
        if !blocked {
            if (bits & 32) != 0 {
                let _ = client.action(ClientAction::Fire, local.elapsed);
            }
            if keys.just_pressed(KeyCode::KeyX) || keys.just_pressed(KeyCode::KeyE) {
                let _ = client.action(ClientAction::Boost, local.elapsed);
            }
            if keys.just_pressed(KeyCode::KeyF) {
                let _ = client.action(ClientAction::Special, local.elapsed);
            }
            if keys.just_pressed(KeyCode::KeyZ) {
                let _ = client.action(ClientAction::Somersault, local.elapsed);
            }
            if keys.just_pressed(KeyCode::KeyC) {
                let _ = client.action(ClientAction::Chaff, local.elapsed);
            }
            if keys.just_pressed(KeyCode::Tab) || keys.just_pressed(KeyCode::KeyQ) {
                let _ = client.action(ClientAction::CycleWeapon, local.elapsed);
            }
            if keys.just_pressed(KeyCode::Digit1) {
                let _ = client.action(ClientAction::SelectHedgehog, local.elapsed);
            }
            if keys.just_pressed(KeyCode::Digit2) {
                let _ = client.action(ClientAction::SelectMissile, local.elapsed);
            }
            if let Ok(mut q) = QUEUED_ACTIONS.lock() {
                for (kind, item) in q.drain(..) {
                    let act = match (kind.as_str(), item.as_str()) {
                        ("fire", _) => Some(ClientAction::Fire),
                        ("turbo", _) => Some(ClientAction::Boost),
                        ("special", _) => Some(ClientAction::Special),
                        ("somersault", _) => Some(ClientAction::Somersault),
                        ("chaff", _) => Some(ClientAction::Chaff),
                        ("cycle", _) => Some(ClientAction::CycleWeapon),
                        ("select", "hedgehog") => Some(ClientAction::SelectHedgehog),
                        ("select", "missile") => Some(ClientAction::SelectMissile),
                        _ => None,
                    };
                    if let Some(a) = act {
                        let _ = client.action(a, local.elapsed);
                    }
                }
            }
        }
        // Encoding advances the send cursors. Keep the packet until JavaScript takes it.
        if let Ok(mut out) = OUTBOUND_TEXT.lock()
            && out.is_none()
            && let Ok(bytes) = client.outbound(move_input)
            && let Ok(text) = String::from_utf8(bytes)
        {
            *out = Some(text);
        }
        let mut drained_sounds = client.drain_audio();
        let mut drained_voices = client.drain_voices();
        publish_hud(client);
        session.sounds.append(&mut drained_sounds);
        session.voices.append(&mut drained_voices);
        return;
    }

    // Handle instant match restart / driver or arena change without reloading WASM
    if let Ok(mut pending) = PENDING_RESTART.lock()
        && let Some(new_cfg) = pending.take()
    {
        let seed = ((time.elapsed_secs_f64() * 1000.0) as u64).wrapping_add(1337);
        local.arena = build_local_arena(&new_cfg, seed);
        local.elapsed = 0.0;
        local.next_action = 1;
        local.last_x_tap = -10.0;
        let pkt = local.arena.packet(0);
        session.client = NativeClient::from_packet(&pkt, 0.0).ok();
        session.sounds.clear();
        session.voices.clear();
    }

    if PAUSED.load(Ordering::Relaxed) {
        return;
    }

    local.elapsed += dt;

    let blocked = INPUT_BLOCKED.load(Ordering::Relaxed);
    let mut bits = if blocked { 0 } else { VIRTUAL_KEYS.load(Ordering::Relaxed) };
    if !blocked {
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
    }

    let mut actions = Vec::new();
    let mut push = |kind: &str, item: &str, bomb_kind: Option<String>, id: &mut u32| {
        actions.push(Action {
            id: Some(*id),
            kind: kind.into(),
            after_move: -1,
            wx: 0.0,
            wz: 0.0,
            item: item.into(),
            bomb_kind,
        });
        *id += 1;
    };
    if !blocked {
        if let Ok(mut q) = QUEUED_ACTIONS.lock() {
            for (kind, item) in q.drain(..) {
                if kind == "turbo" {
                    if local.elapsed - local.last_x_tap <= 0.38 {
                        push("nightmare", "", None, &mut local.next_action);
                        local.last_x_tap = -10.0;
                    } else {
                        push("turbo", "", None, &mut local.next_action);
                        local.last_x_tap = local.elapsed;
                    }
                } else {
                    push(&kind, &item, None, &mut local.next_action);
                }
            }
        }
        if keys.just_pressed(KeyCode::KeyX) || keys.just_pressed(KeyCode::KeyE) {
            if local.elapsed - local.last_x_tap <= 0.38 {
                push("nightmare", "", None, &mut local.next_action);
                local.last_x_tap = -10.0;
            } else {
                push("turbo", "", None, &mut local.next_action);
                local.last_x_tap = local.elapsed;
            }
        }
        if keys.just_pressed(KeyCode::KeyF) {
            push("special", "", None, &mut local.next_action);
        }
        if keys.just_pressed(KeyCode::KeyZ) {
            push("somersault", "", None, &mut local.next_action);
        }
        if keys.just_pressed(KeyCode::KeyC) {
            push("chaff", "", None, &mut local.next_action);
        }
        if keys.just_pressed(KeyCode::Tab) || keys.just_pressed(KeyCode::KeyQ) {
            push("cycle", "", None, &mut local.next_action);
        }
        if keys.just_pressed(KeyCode::Digit1) {
            push("select", "hedgehog", None, &mut local.next_action);
        }
        if keys.just_pressed(KeyCode::Digit2) {
            push("select", "missile", None, &mut local.next_action);
        }
        if keys.just_pressed(KeyCode::Digit3) || keys.just_pressed(KeyCode::KeyB) {
            push("bomb", "", Some("bomb".into()), &mut local.next_action);
        }
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
        publish_hud(client);
    } else {
        session.client = NativeClient::from_packet(&pkt, local.elapsed).ok();
    }
    session.sounds.append(&mut drained_sounds);
    session.voices.append(&mut drained_voices);
}
