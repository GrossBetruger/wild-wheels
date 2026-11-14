//! Presentation-only entities. All gameplay state comes from the core client.
use crate::app::GameSession;
use crate::ported::{Graphics, Ported, Tint, placement, tint};
use bevy::ecs::system::SystemParam;
use bevy::{core_pipeline::tonemapping::Tonemapping, prelude::*, text::FontSize};
use std::collections::{HashMap, HashSet};
use std::f32::consts::{PI, TAU};

pub struct ArenaPresentationPlugin;
impl Plugin for ArenaPresentationPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<SceneCache>()
            .add_systems(Startup, setup)
            .add_systems(Update, capture);
    }
}
#[derive(Resource)]
pub struct Capture(pub Option<String>);
fn capture(
    mut commands: Commands,
    capture: Res<Capture>,
    time: Res<Time>,
    mut last: Local<f32>,
    windows: Query<&Window>,
) {
    let Some(path) = capture.0.as_ref() else {
        return;
    };
    // On macOS, a fully covered window can yield a valid but entirely black PNG.
    // Wait for focus instead of overwriting a useful capture with that frame.
    if !windows
        .iter()
        .any(|window| window.focused && window.visible)
    {
        return;
    }
    if time.elapsed_secs() < 5.0 {
        return;
    }
    if time.elapsed_secs() - *last < 10.0 {
        return;
    }
    *last = time.elapsed_secs();
    commands
        .spawn(bevy::render::view::screenshot::Screenshot::primary_window())
        .observe(bevy::render::view::screenshot::save_to_disk(path.clone()));
}
#[derive(Resource, Default)]
pub struct SceneCache {
    actors: HashMap<usize, Entity>,
    health: HashMap<usize, Entity>,
    shots: HashMap<u32, Entity>,
    supplies: HashMap<u32, Entity>,
    arena: Option<(usize, Entity)>,
}
#[derive(Component)]
pub struct FollowCamera;
#[derive(Component)]
pub struct Hud;

fn setup(mut commands: Commands) {
    // The browser shades as color * (0.62 + 0.38 * n·l) in display space with no
    // tone mapping. These linear-light levels reproduce that at Bevy's default exposure.
    commands.insert_resource(GlobalAmbientLight {
        brightness: 783.0,
        ..default()
    });
    commands.spawn((
        DirectionalLight {
            illuminance: 1920.0,
            ..default()
        },
        Transform::from_xyz(-50.0, 100.0, 30.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    commands.spawn((
        Camera3d::default(),
        Tonemapping::None,
        Transform::from_xyz(0.0, 65.0, -75.0).looking_at(Vec3::ZERO, Vec3::Y),
        FollowCamera,
    ));
    commands.spawn((
        Text::new("WILD WHEELS | NATIVE RUST\nConnecting to dedicated arena..."),
        TextFont {
            font_size: FontSize::Px(22.0),
            ..default()
        },
        TextColor(Color::WHITE),
        TextShadow::default(),
        Node {
            position_type: PositionType::Absolute,
            top: px(18),
            left: px(20),
            ..default()
        },
        Hud,
    ));
}
/// Keeps one ported clip per live key, spawning and despawning its entity as needed.
fn show<K: Copy + Eq + std::hash::Hash>(
    commands: &mut Commands,
    shown: &mut HashMap<K, Entity>,
    players: &mut Query<&mut Ported>,
    key: K,
    clip: Option<usize>,
    tint: Tint,
    transform: Transform,
) {
    match shown.get(&key) {
        Some(entity) => {
            // A clip spawned this frame is not queryable until the next one.
            if let Ok(mut player) = players.get_mut(*entity) {
                if player.clip != clip || player.tint != tint {
                    (player.clip, player.tint) = (clip, tint);
                }
                commands.entity(*entity).insert(transform);
            }
        }
        None => {
            let entity = commands
                .spawn((transform, Visibility::default(), Ported::new(clip, tint)))
                .id();
            shown.insert(key, entity);
        }
    }
}
fn retire<K: Eq + std::hash::Hash>(
    commands: &mut Commands,
    shown: &mut HashMap<K, Entity>,
    live: &HashSet<K>,
) {
    shown.retain(|key, entity| {
        if live.contains(key) {
            return true;
        }
        commands.entity(*entity).despawn();
        false
    });
}
/// The browser's somersault pose; Master-Yuda's motorcycle barrel-rolls instead of flipping.
fn somersault(driver: usize, remaining: f64) -> (f32, f32, f32, f32) {
    if remaining <= 0.0 {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let progress = (1.0 - remaining / 0.55).clamp(0.0, 1.0) as f32;
    let arc = (progress * PI).sin();
    if driver == 10 {
        let turn = progress * progress * (3.0 - 2.0 * progress);
        return (
            arc * 2.8,
            -(progress * TAU).sin() * 0.45,
            turn * TAU,
            -(1.0 - turn) * PI,
        );
    }
    (arc * 5.0, -progress * TAU, 0.0, 0.0)
}
#[derive(SystemParam)]
pub struct SceneAssets<'w> {
    graphics: ResMut<'w, Graphics>,
    meshes: ResMut<'w, Assets<Mesh>>,
    sky: ResMut<'w, ClearColor>,
}

pub fn sync(
    mut commands: Commands,
    session: Res<GameSession>,
    assets: SceneAssets,
    mut cache: ResMut<SceneCache>,
    mut players: Query<&mut Ported>,
    mut cameras: Query<&mut Transform, With<FollowCamera>>,
    mut hud: Query<&mut Text, With<Hud>>,
) {
    let SceneAssets {
        mut graphics,
        mut meshes,
        mut sky,
    } = assets;
    let Some(client) = session.client.as_ref() else {
        for mut text in &mut hud {
            text.0 = format!("WILD WHEELS | NATIVE RUST\n{}", session.status);
        }
        return;
    };
    let view = client.view();
    let cache = &mut *cache;
    if cache.arena.is_none_or(|(arena, _)| arena != view.arena) {
        if let Some((_, old)) = cache.arena.take() {
            commands.entity(old).despawn();
        }
        if let Some(arena) = graphics.arena(view.arena) {
            let (mesh, color) = (arena.mesh, arena.sky);
            sky.0 = color;
            let scenery = commands
                .spawn((
                    Mesh3d(graphics.mesh(mesh, [0; 3], &mut meshes)),
                    MeshMaterial3d(graphics.solid()),
                    Transform::default(),
                ))
                .id();
            cache.arena = Some((view.arena, scenery));
        }
    }
    let racers = || view.actors.iter().filter(|a| !a.inactive && !a.bomber);
    let live: HashSet<_> = racers().map(|a| a.id).collect();
    retire(&mut commands, &mut cache.actors, &live);
    retire(&mut commands, &mut cache.health, &live);
    for a in racers() {
        let wrecked = a.destroyed > 0.0;
        let clip = match (wrecked, a.boost > 0.0) {
            (true, _) => graphics.clip("wreck"),
            (false, true) => graphics.clip(&format!("driver:{}:boost", a.driver)),
            (false, false) => graphics.clip(&format!("driver:{}:idle", a.driver)),
        };
        let (height, pitch, roll, yaw) = match wrecked {
            true => (0.0, 0.0, 0.0, 0.0),
            false => somersault(a.driver, a.somersault),
        };
        let position = Vec3::new(a.wx as f32, 0.0, a.wz as f32);
        show(
            &mut commands,
            &mut cache.actors,
            &mut players,
            a.id,
            clip,
            tint(&a.color).unwrap_or([255; 3]),
            placement(
                position + Vec3::Y * height,
                a.heading as f32 + yaw,
                pitch,
                roll,
            ),
        );
        // Health pips face along the viewer's heading, as in the browser.
        let pips = match wrecked {
            true => None,
            false => graphics.clip(&format!("health:{}", (a.health.max(0.0) as usize).min(6))),
        };
        show(
            &mut commands,
            &mut cache.health,
            &mut players,
            a.id,
            pips,
            [255; 3],
            Transform::from_translation(position)
                .with_rotation(Quat::from_rotation_y(view.player.heading as f32)),
        );
    }
    let live_shots: HashSet<_> = view.projectiles.iter().map(|p| p.id).collect();
    retire(&mut commands, &mut cache.shots, &live_shots);
    for p in view.projectiles {
        let owner = view.actors.get(p.owner).map_or(0, |a| a.driver);
        let clip = match (p.kind.as_str(), p.vulcan) {
            ("missile", _) => graphics.clip("shot:missile"),
            (_, true) => graphics.clip(&format!("shot:vulcan:{owner}")),
            _ => graphics.clip("shot:hedgehog"),
        };
        show(
            &mut commands,
            &mut cache.shots,
            &mut players,
            p.id,
            clip,
            [255; 3],
            Transform::from_xyz(p.wx as f32, p.height as f32, p.wz as f32)
                .with_rotation(Quat::from_rotation_y(p.heading as f32)),
        );
    }
    let p = view.player;
    let facing = Vec3::new(
        p.camera_heading.sin() as f32,
        0.0,
        p.camera_heading.cos() as f32,
    );
    let center = Vec3::new(p.wx as f32, 0.0, p.wz as f32);
    for mut camera in &mut cameras {
        *camera = Transform::from_translation(center - facing * 20.0 + Vec3::Y * 10.0)
            .looking_at(center + facing * 6.0 + Vec3::Y * 1.6, Vec3::Y);
    }
    for mut text in &mut hud {
        text.0 = format!(
            "WILD WHEELS | NATIVE RUST POC\n{} | {} | {:.0} KILLS\nHEALTH {:.0}   HEDGES {}   MISSILES {}   BOOST {}\n{} | {}\nWASD / arrows | Shift drift | Space fire | Tab weapon\nX boost | C chaff | Z flip | Enter start",
            session.status,
            view.phase,
            p.kills,
            p.health,
            p.ammo,
            p.missiles,
            p.turbos,
            p.item,
            match view.phase {
                "countdown" => format!("{:.0}", view.countdown.ceil()),
                _ if p.destroyed > 0.0 => "RESPAWNING...".into(),
                _ => String::new(),
            }
        );
    }
}

pub fn sync_pickups(
    mut commands: Commands,
    session: Res<GameSession>,
    graphics: Res<Graphics>,
    mut cache: ResMut<SceneCache>,
    mut players: Query<&mut Ported>,
) {
    let Some(client) = session.client.as_ref() else {
        return;
    };
    let view = client.view();
    let visible: HashSet<_> = view
        .supplies
        .iter()
        .filter(|s| s.cooldown <= 0.0)
        .map(|s| s.id)
        .collect();
    retire(&mut commands, &mut cache.supplies, &visible);
    for supply in view.supplies.iter().filter(|s| visible.contains(&s.id)) {
        show(
            &mut commands,
            &mut cache.supplies,
            &mut players,
            supply.id,
            graphics.clip(&format!("pickup:{}", supply.kind)),
            [255; 3],
            Transform::from_xyz(supply.wx as f32, 0.0, supply.wz as f32),
        );
    }
}
