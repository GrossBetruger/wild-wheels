//! Presentation-only entities. All gameplay state comes from the core client.
use crate::app::GameSession;
use crate::ported::{Graphics, Ported, Tint, placement, tint};
use bevy::ecs::system::SystemParam;
use bevy::{core_pipeline::tonemapping::Tonemapping, prelude::*, text::FontSize};
use std::collections::{HashMap, HashSet};
use std::f32::consts::{PI, TAU};
use wild_wheels_core::ClientView;

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
/// What a ported clip stands for; with a number it names one entity on screen.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Role {
    Racer,
    Health,
    Overlay(usize),
    Xylophone,
    Shot,
    Supply,
    Effect,
    Bomb,
    Chaff,
    Stink,
    Particle,
    Locust,
    TimeStop,
}
/// Racer states the browser layers over the racer's own model.
const OVERLAYS: [&str; 6] = ["shield", "hedge", "tehilim", "dizzy", "vulcan", "special"];
/// Matches `FIRE_RING_RADIUS` in scripts/build/graphics-port.mjs.
const FIRE_RING_RADIUS: f32 = 20.0;

#[derive(Resource, Default)]
pub struct SceneCache {
    shown: HashMap<(Role, u64), Entity>,
    live: HashSet<(Role, u64)>,
    arena: Option<(usize, Entity)>,
    /// Master-Yuda's eased drift lean and the side he last leaned to, per racer.
    leans: HashMap<usize, (f32, f32)>,
}
#[derive(Component)]
pub struct FollowCamera;
#[derive(Component)]
pub struct Hud;

fn setup(mut commands: Commands) {
    // The browser shades as color * (0.62 + 0.38 * n·l) in display space with no
    // tone mapping. These light levels were matched to it against screenshots.
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
        Projection::Perspective(PerspectiveProjection {
            fov: 1.07,
            near: 0.3,
            far: 1600.0,
            ..default()
        }),
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
    time: Res<'w, Time>,
}
/// Shows ported clips, reusing one entity per role and key from frame to frame.
struct Stage<'a, 'w, 's, 'q, 'qw, 'qs, 'p> {
    commands: &'a mut Commands<'w, 's>,
    cache: &'a mut SceneCache,
    players: &'q mut Query<'qw, 'qs, &'p mut Ported>,
    graphics: &'a Graphics,
}
struct Play {
    clip: Option<usize>,
    tint: Tint,
    time: Option<f32>,
}
impl Stage<'_, '_, '_, '_, '_, '_, '_> {
    fn clip(&self, name: &str) -> Play {
        Play {
            clip: self.graphics.clip(name),
            tint: [255; 3],
            time: None,
        }
    }
    /// A clip that plays once, `age` seconds in.
    fn aged(&self, name: &str, age: f64) -> Play {
        Play {
            time: Some(age as f32),
            ..self.clip(name)
        }
    }
    fn show(&mut self, role: Role, key: usize, play: Play, transform: Transform) {
        if play.clip.is_none() {
            return;
        }
        let key = (role, key as u64);
        self.cache.live.insert(key);
        match self.cache.shown.get(&key) {
            Some(entity) => {
                // A clip spawned this frame is not queryable until the next one.
                if let Ok(mut player) = self.players.get_mut(*entity) {
                    (player.clip, player.tint, player.time) = (play.clip, play.tint, play.time);
                    self.commands.entity(*entity).insert(transform);
                }
            }
            None => {
                let player = Ported::new(play.clip, play.tint, play.time);
                let entity = self
                    .commands
                    .spawn((transform, Visibility::default(), player))
                    .id();
                self.cache.shown.insert(key, entity);
            }
        }
    }
    fn retire(&mut self) {
        let SceneCache { shown, live, .. } = &mut *self.cache;
        shown.retain(|key, entity| {
            if live.contains(key) {
                return true;
            }
            self.commands.entity(*entity).despawn();
            false
        });
        live.clear();
    }
}
fn at(wx: f64, height: f64, wz: f64, heading: f64) -> Transform {
    Transform::from_xyz(wx as f32, height as f32, wz as f32)
        .with_rotation(Quat::from_rotation_y(heading as f32))
}

fn racers(stage: &mut Stage, view: &ClientView, dt: f32) {
    let auditing = |id: usize| {
        view.actors
            .iter()
            .any(|a| a.id != id && a.driver == 13 && a.special_active > 0.0)
    };
    for a in view
        .actors
        .iter()
        .filter(|a| !a.inactive && !a.bomber && !a.afk)
    {
        let wrecked = a.destroyed > 0.0;
        let state = match (a.boost > 0.0, a.celebrate > 0.0) {
            (true, _) => "boost",
            (false, true) => "celebrate",
            _ => "idle",
        };
        let mut play = match wrecked {
            true => stage.clip("wreck"),
            false => stage.clip(&format!("driver:{}:{state}", a.driver)),
        };
        play.tint = tint(&a.color).unwrap_or([255; 3]);
        if state == "celebrate" && !wrecked {
            play.time = Some((1.6 - a.celebrate) as f32);
        }
        let (height, pitch, mut roll, yaw) = match wrecked {
            true => (0.0, 0.0, 0.0, 0.0),
            false => somersault(a.driver, a.somersault),
        };
        if a.driver == 10 {
            // Master-Yuda leans his motorcycle into drifts, eased as in the browser.
            let (lean, side) = stage.cache.leans.entry(a.id).or_insert((0.0, 1.0));
            let active = view.phase == "racing" && a.was_drifting && a.somersault <= 0.0;
            let slip = (a.heading - a.motion_heading)
                .sin()
                .atan2((a.heading - a.motion_heading).cos());
            if active && slip.abs() > 0.015 {
                *side = -slip.signum() as f32;
            }
            let (target, rate) = match active {
                true => (*side * 1.12, 18.0),
                false => (0.0, 12.0),
            };
            *lean += (target - *lean) * (1.0 - (-dt * rate).exp());
            if a.somersault > 0.0 || wrecked {
                *lean = 0.0;
            }
            roll += *lean;
        }
        let ground = Vec3::new(a.wx as f32, 0.0, a.wz as f32);
        let body = placement(
            ground + Vec3::Y * height,
            a.heading as f32 + yaw,
            pitch,
            roll,
        );
        stage.show(Role::Racer, a.id, play, body);
        if wrecked {
            continue;
        }
        // Health pips face along the viewer's heading, as in the browser.
        let pips = stage.clip(&format!("health:{}", (a.health.max(0.0) as usize).min(6)));
        stage.show(
            Role::Health,
            a.id,
            pips,
            at(a.wx, 0.0, a.wz, view.player.heading),
        );
        let active = [
            a.shield,
            a.hedge_shield,
            a.tehilim,
            a.dizzy,
            a.vulcan,
            a.special_active,
        ];
        for (index, name) in OVERLAYS.iter().enumerate() {
            if active[index] > 0.0 {
                let overlay = stage.clip(&format!("overlay:{}:{name}", a.driver));
                let key = a.id * OVERLAYS.len() + index;
                stage.show(
                    Role::Overlay(index),
                    key,
                    overlay,
                    at(a.wx, height as f64, a.wz, a.heading),
                );
            }
        }
        if auditing(a.id) {
            let facing = match a.id == view.you {
                true => a.camera_heading,
                false => a.heading,
            };
            let xylophone = stage.clip("overlay:xylophone");
            stage.show(
                Role::Xylophone,
                a.id,
                xylophone,
                at(a.wx, 0.0, a.wz, facing),
            );
        }
    }
}

fn effects(stage: &mut Stage, view: &ClientView) {
    for (index, fx) in view.effects.iter().enumerate() {
        let mut transform = at(fx.wx, 0.0, fx.wz, 0.0);
        let play = match fx.kind.as_str() {
            // The browser draws Master-Yuda's exhaust from his own position instead.
            "yudaSmoke" => continue,
            "ash" => {
                let body = view
                    .actors
                    .iter()
                    .find(|a| a.destroyed > 0.0 && (a.wx - fx.wx).hypot(a.wz - fx.wz) < 0.5);
                stage.aged(
                    &format!("effect:ash:{}", body.map_or(0, |a| a.driver)),
                    fx.age,
                )
            }
            "fireRing" | "fireRingOut" => {
                let radius = fx.radius.unwrap_or(10.0) as f32 / FIRE_RING_RADIUS;
                transform.scale = Vec3::new(radius, 1.0, radius);
                match (fx.kind.as_str(), fx.color.as_deref()) {
                    ("fireRingOut", _) => stage.aged("effect:fireRingOut", fx.age),
                    (_, Some("#4abaff")) => stage.clip("effect:fireRing:blue"),
                    _ => stage.clip("effect:fireRing:orange"),
                }
            }
            kind => {
                if matches!(kind, "heartbeat" | "taxAudit") {
                    // These face the viewer; a heartbeat also follows its racer.
                    let owner = fx.owner.and_then(|id| view.actors.get(id));
                    let (wx, wz) = match (kind, owner) {
                        ("heartbeat", Some(a)) => (a.wx, a.wz),
                        _ => (fx.wx, fx.wz),
                    };
                    transform = at(wx, 0.0, wz, view.player.camera_heading);
                }
                if let Some(heading) = fx.heading.filter(|_| kind == "teleportOut") {
                    transform = at(fx.wx, 0.0, fx.wz, heading);
                }
                let name = format!("effect:{kind}");
                match stage.graphics.clip(&name) {
                    Some(_) => stage.aged(&name, fx.age),
                    None => stage.aged("effect:default", fx.age),
                }
            }
        };
        stage.show(Role::Effect, index, play, transform);
    }
    for (index, bomb) in view.bombs.iter().enumerate() {
        let name = match bomb.kind.as_str() {
            "stink" => "bomb:stink",
            _ => "bomb:bomb",
        };
        let play = stage.aged(name, bomb.age);
        stage.show(Role::Bomb, index, play, at(bomb.wx, 0.0, bomb.wz, 0.0));
    }
    for (index, cloud) in view.chaff_clouds.iter().enumerate() {
        let fairy = view.actors.get(cloud.owner).is_some_and(|a| a.driver == 9);
        let play = match fairy {
            true => stage.aged("cloud:chaff:fairy", cloud.age),
            false => stage.aged("cloud:chaff", cloud.age),
        };
        stage.show(Role::Chaff, index, play, at(cloud.wx, 0.0, cloud.wz, 0.0));
    }
    for (index, cloud) in view.stink_clouds.iter().enumerate() {
        let play = stage.aged("cloud:stink", cloud.age);
        stage.show(Role::Stink, index, play, at(cloud.wx, 0.0, cloud.wz, 0.0));
    }
    for (index, particle) in view.drift_particles.iter().enumerate() {
        // Master-Yuda's motorcycle throws its own sparks in the browser.
        if view
            .actors
            .get(particle.owner)
            .is_some_and(|a| a.driver == 10)
        {
            continue;
        }
        let mut play = match particle.kind.as_str() {
            "smoke" => stage.clip("particle:smoke"),
            _ => stage.clip(&format!("particle:spark:{}", particle.level.min(2))),
        };
        // Recorded over a one-second life, so age/life is the time into the clip.
        play.time = Some((particle.age / particle.life.max(0.01)) as f32);
        stage.show(
            Role::Particle,
            index,
            play,
            at(particle.wx, particle.height, particle.wz, 0.0),
        );
    }
    for (index, bug) in view.locusts.iter().enumerate() {
        let play = match bug.jump > 0.0 {
            true => stage.aged("locust:jump", 0.7 - bug.jump),
            false => stage.clip("locust"),
        };
        let buried = -1.2 * (1.0 - (bug.age / 0.6).min(1.0));
        stage.show(
            Role::Locust,
            index,
            play,
            at(bug.wx, buried, bug.wz, bug.heading),
        );
    }
    if view.time_stop > 0.0 {
        let caster = view
            .time_owner
            .and_then(|id| view.actors.get(id))
            .unwrap_or(view.player);
        let play = stage.aged("timestop", 2.5 - view.time_stop);
        stage.show(Role::TimeStop, 0, play, at(caster.wx, 0.0, caster.wz, 0.0));
    }
}

pub fn sync(
    mut commands: Commands,
    session: Res<GameSession>,
    assets: SceneAssets,
    mut cache: ResMut<SceneCache>,
    mut players: Query<&mut Ported>,
    mut cameras: Query<(&mut Transform, &mut Projection), With<FollowCamera>>,
    mut hud: Query<&mut Text, With<Hud>>,
) {
    let SceneAssets {
        mut graphics,
        mut meshes,
        mut sky,
        time,
    } = assets;
    let Some(client) = session.client.as_ref() else {
        for mut text in &mut hud {
            text.0 = format!("WILD WHEELS | NATIVE RUST\n{}", session.status);
        }
        return;
    };
    let view = client.view();
    if cache.arena.is_none_or(|(arena, _)| arena != view.arena) {
        if let Some((_, old)) = cache.arena.take() {
            commands.entity(old).despawn();
        }
        if let Some(arena) = graphics.arena(view.arena) {
            let (mesh, color) = (arena.mesh, arena.sky);
            sky.0 = color;
            let scenery = commands
                .spawn((
                    Mesh3d(graphics.mesh(mesh, [0; 3], false, &mut meshes)),
                    MeshMaterial3d(graphics.solid()),
                    Transform::default(),
                ))
                .id();
            cache.arena = Some((view.arena, scenery));
        }
    }
    let mut stage = Stage {
        commands: &mut commands,
        cache: &mut cache,
        players: &mut players,
        graphics: &graphics,
    };
    racers(&mut stage, &view, time.delta_secs().min(0.05));
    for p in view.projectiles {
        let owner = view.actors.get(p.owner).map_or(0, |a| a.driver);
        let play = match (p.kind.as_str(), p.vulcan) {
            ("missile", _) => stage.clip("shot:missile"),
            (_, true) => stage.clip(&format!("shot:vulcan:{owner}")),
            _ => stage.clip("shot:hedgehog"),
        };
        stage.show(
            Role::Shot,
            p.id as usize,
            play,
            at(p.wx, p.height, p.wz, p.heading),
        );
    }
    for supply in view.supplies.iter().filter(|s| s.cooldown <= 0.0) {
        let play = stage.clip(&format!("pickup:{}", supply.kind));
        stage.show(
            Role::Supply,
            supply.id as usize,
            play,
            at(supply.wx, 0.0, supply.wz, 0.0),
        );
    }
    effects(&mut stage, &view);
    stage.retire();
    // The browser's chase camera, including its wider view while boosting or drifting.
    let p = view.player;
    let facing = Vec3::new(
        p.camera_heading.sin() as f32,
        0.0,
        p.camera_heading.cos() as f32,
    );
    let center = Vec3::new(p.wx as f32, 0.0, p.wz as f32);
    let height = match p.destroyed > 0.0 {
        true => 15.0,
        false => 10.0,
    };
    for (mut camera, mut projection) in &mut cameras {
        *camera = Transform::from_translation(center - facing * 17.0 + Vec3::Y * height)
            .looking_at(center + facing * 18.0 + Vec3::Y * 1.5, Vec3::Y);
        if let Projection::Perspective(perspective) = &mut *projection {
            perspective.fov = match (p.boost > 0.0, p.was_drifting) {
                (true, _) => 1.2,
                (false, true) => 1.13,
                _ => 1.07,
            };
        }
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
