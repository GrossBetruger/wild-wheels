//! Presentation-only entities. All gameplay state comes from the core client.
use crate::app::GameSession;
use crate::plumage::Wind;
use crate::ported::{Graphics, Look, Ported, Tint, placement, tint};
use crate::xray::FogMaterial;
use bevy::ecs::system::SystemParam;
use bevy::{
    camera::{ClearColorConfig, visibility::RenderLayers},
    core_pipeline::tonemapping::{DebandDither, Tonemapping},
    prelude::*,
    ui::{IsDefaultUiCamera, UiTargetCamera},
};
use std::collections::{HashMap, HashSet};
use std::f32::consts::{PI, TAU};
use wild_wheels_core::ClientView;

pub struct ArenaPresentationPlugin;
impl Plugin for ArenaPresentationPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<SceneCache>()
            .add_systems(Last, audit_xray)
            .add_systems(Startup, setup)
            .add_systems(Update, capture);
    }
}
#[derive(Resource)]
pub struct Capture(pub Option<String>);
fn capture(_capture: Res<Capture>) {}
/// What a ported clip stands for; with a number it names one entity on screen.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Role {
    Racer,
    Health,
    Overlay(usize),
    Nightmare,
    CricketPuppet,
    Xylophone,
    /// A racer's silhouette seen through Dark Humor.
    Ghost,
    /// Projectiles, their trails, bombs and effects seen through Dark Humor.
    /// KnowItOwl's bat seen through Dark Humor.
    GhostBat,
    GhostShot,
    GhostTrail,
    GhostBomb,
    GhostEffect,
    Shot,
    Trail,
    Skid,
    Supply,
    Effect,
    /// A skull circling one of Master-Yuda's fire rings.
    Rider,
    Bomb,
    Chaff,
    Stink,
    Particle,
    Locust,
    TimeStop,
}
/// Racer states the browser layers over the racer's own model.
const OVERLAYS: [&str; 6] = ["shield", "hedge", "tehilim", "dizzy", "vulcan", "special"];
/// Matches `TRANSITION` in scripts/build/graphics-port.mjs: how long recorded
/// transitions between states last.
const TRANSITION: f32 = 1.0;
/// Matches `ENDINGS` in scripts/build/graphics-port.mjs: the seconds over which
/// each timed state fades out in the browser, by its index in `OVERLAYS`.
const ENDINGS: [Option<f64>; 6] = [Some(1.0), Some(1.5), Some(1.5), None, None, Some(1.0)];
/// Racers whose special ability ramps in from its starting duration.
const SPECIAL_STARTS: [(usize, f64); 1] = [(11, 12.0)];
/// Matches `FIRE_RING_RADIUS` in scripts/build/graphics-port.mjs.
pub const FIRE_RING_RADIUS: f32 = 20.0;
/// Matches `FIRE_RING_RIDERS` in characters/master-yuda/fire-ring-visual.js.
pub const FIRE_RING_RIDERS: usize = 6;
/// Where skull rider `index` of a fire ring stands relative to the ring's centre,
/// and how far ahead its clip plays. The ring's clip is stretched to its radius,
/// which a skull must not follow, so each rider is one recorded clip placed here by
/// the browser's `fireRingRiderAngle` and `fireRingRiderSize`. `spin` is 1 for an
/// orange ring and -1 for a blue one. Riders on the off beat bob and laugh half a
/// cycle apart, which two thirds of a second into the clip also does.
pub fn fire_ring_rider(index: usize, radius: f32, spin: f32, elapsed: f32) -> (Transform, f32) {
    let angle = (index as f32 + spin * elapsed / 2.0) * TAU / FIRE_RING_RIDERS as f32;
    let place = Transform::from_xyz(radius * angle.sin(), 0.0, radius * angle.cos())
        .with_rotation(Quat::from_rotation_y(angle))
        .with_scale(Vec3::splat((0.5 + radius / 40.0).min(1.0)));
    (place, (index % 2) as f32 * 2.0 / 3.0)
}

#[derive(Resource, Default)]
pub struct SceneCache {
    shown: HashMap<(Role, u64), Entity>,
    live: HashSet<(Role, u64)>,
    /// The arena shown, its definition, its scenery and its X-ray outlines.
    arena: Option<(usize, wild_wheels_core::ArenaDef, Entity, Entity)>,
    /// Master-Yuda's eased drift lean and the side he last leaned to, per racer.
    leans: HashMap<usize, (f32, f32)>,
    /// Per racer and state (0 boost, 1 rapid fire): whether it is on, and since when.
    changes: HashMap<(usize, u8), (bool, f32)>,
    /// Each racer's tail, swinging behind their turns.
    tails: HashMap<usize, Tail>,
    /// Smoothly frame Houston's full exhaust weapon, matching the browser camera.
    nightmare_zoom: f32,
}
/// Developer check, on with WILD_WHEELS_XRAY_AUDIT: reports every frame in which
/// a racer's X-ray silhouette exists but none of it is drawn, and why.
fn audit_xray(
    cache: Res<SceneCache>,
    time: Res<Time>,
    ghosts: Query<(&Ported, Option<&Children>)>,
    parts: Query<(&Visibility, &ViewVisibility)>,
    xray: Query<&Camera, With<XrayCamera>>,
    mut frames: Local<(u32, u32)>,
) {
    // Silhouettes are kept ready between casts; they only count while X-ray is on.
    if std::env::var_os("WILD_WHEELS_XRAY_AUDIT").is_none() || !xray.iter().any(|c| c.is_active) {
        return;
    }
    let mut any = false;
    // How many of an entity's parts are shown, and how many of those are drawn.
    let drawn = |entity: Entity| {
        let (mut shown, mut seen) = (0, 0);
        if let Ok((_, children)) = ghosts.get(entity) {
            for child in children.into_iter().flatten() {
                if let Ok((visibility, view)) = parts.get(*child) {
                    shown += u32::from(*visibility != Visibility::Hidden);
                    seen += u32::from(*visibility != Visibility::Hidden && view.get());
                }
            }
        }
        (shown, seen)
    };
    for ((role, id), entity) in &cache.shown {
        if *role != Role::Ghost {
            continue;
        }
        any = true;
        let Some(body) = cache.shown.get(&(Role::Racer, *id)) else {
            continue;
        };
        // A racer drawn in the world, from the same viewpoint, must be drawn in X-ray.
        let ((_, world), (shown, seen)) = (drawn(*body), drawn(*entity));
        if world > 0 && seen == 0 {
            frames.1 += 1;
            let clip = ghosts
                .get(*entity)
                .map(|(player, _)| player.clip)
                .ok()
                .flatten();
            eprintln!(
                "xray-audit t={:.2} racer={id} clip={clip:?} world-parts-drawn={world} ghost-parts-shown={shown} drawn={seen}",
                time.elapsed_secs()
            );
        }
    }
    if any {
        frames.0 += 1;
        if frames.0.is_multiple_of(240) {
            eprintln!(
                "xray-audit frames={} empty-silhouettes={}",
                frames.0, frames.1
            );
        }
    }
}
/// A damped spring that trails a racer's turning, and how hard speed presses on it.
/// The browser's plumage only sways on its own; this response is native.
#[derive(Default)]
struct Tail {
    heading: f64,
    place: (f64, f64),
    swing: f32,
    velocity: f32,
    press: f32,
}
/// Swing, as a share of its limit, per radian a second of turning: a full swing
/// while drifting, about half in an ordinary turn.
const SWING_PER_TURN: f32 = 0.28;
/// The speed at which a tail is pressed fully back: the arena's top speed unboosted.
const FULL_PRESS_SPEED: f64 = 520.0;
impl Tail {
    fn follow(&mut self, heading: f64, place: (f64, f64), speed: f64, dt: f32) -> Wind {
        let turned = (heading - self.heading)
            .sin()
            .atan2((heading - self.heading).cos()) as f32;
        // A respawn or teleport is not a turn.
        let moved = (place.0 - self.place.0).hypot(place.1 - self.place.1);
        (self.heading, self.place) = (heading, place);
        if moved > 18.0 || dt <= 0.0 {
            (self.swing, self.velocity) = (0.0, 0.0);
            return Wind {
                swing: 0.0,
                press: self.press,
            };
        }
        // Turning left carries the base of the tail right, so the tips trail left.
        let target = ((turned / dt).clamp(-6.0, 6.0) * SWING_PER_TURN).clamp(-1.0, 1.0);
        self.velocity += ((target - self.swing) * 90.0 - self.velocity * 9.0) * dt;
        self.swing = (self.swing + self.velocity * dt).clamp(-1.0, 1.0);
        let press = (speed.abs() / FULL_PRESS_SPEED).min(1.0) as f32;
        self.press += (press - self.press) * (1.0 - (-dt * 4.0).exp());
        Wind {
            swing: self.swing,
            press: self.press,
        }
    }
}
impl SceneCache {
    /// Seconds since a racer's state last changed. A state first seen is treated
    /// as long settled, so joining a match plays no transitions.
    fn since(&mut self, racer: usize, state: u8, on: bool, now: f32) -> f32 {
        let entry = self
            .changes
            .entry((racer, state))
            .or_insert((on, f32::NEG_INFINITY));
        if entry.0 != on {
            *entry = (on, now);
        }
        now - entry.1
    }
}
#[derive(Component)]
pub struct FollowCamera;
/// Draws what KnowItOwl sees through the dark, over the fog and under the menus.
#[derive(Component)]
pub struct XrayCamera;
#[derive(Component)]
pub struct DarkFog;

fn setup(mut commands: Commands, mut fogs: ResMut<Assets<FogMaterial>>, mobile: Res<crate::MobileGraphics>) {
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
    let lens = Projection::Perspective(PerspectiveProjection {
        fov: 1.07,
        near: 0.3,
        far: 1600.0,
        ..default()
    });
    let mut world = commands.spawn((
            Camera3d::default(),
            lens.clone(),
            Tonemapping::None,
            DebandDither::Disabled,
            Transform::from_xyz(0.0, 65.0, -75.0).looking_at(Vec3::ZERO, Vec3::Y),
            IsDefaultUiCamera,
            FollowCamera,
        ));
    if mobile.mobile { world.insert(Msaa::Off); }
    let world = world.id();
    // Dark Humor: fog covers the world, then X-ray silhouettes are drawn over the
    // fog with no walls in the way, and the menus and HUD come last. This camera
    // renders only while its caster's arena is dark; the HUD moves onto it then.
    let mut xray = commands.spawn((
        Camera3d::default(),
        Camera {
            order: 1,
            clear_color: ClearColorConfig::None,
            is_active: false,
            ..default()
        },
        lens,
        Tonemapping::None,
        DebandDither::Disabled,
        RenderLayers::layer(1),
        XrayCamera,
    ));
    if mobile.mobile { xray.insert(Msaa::Off); }
    commands.spawn((
        Node {
            position_type: PositionType::Absolute,
            width: percent(100),
            height: percent(100),
            ..default()
        },
        MaterialNode(fogs.add(FogMaterial::default())),
        UiTargetCamera(world),
        DarkFog,
    ));
}
/// The browser's somersault pose; Master-Yuda's motorcycle barrel-rolls instead of flipping.
pub fn somersault(driver: usize, remaining: f64) -> (f32, f32, f32, f32) {
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
#[derive(SystemParam)]
pub struct Darkness<'w, 's> {
    fog: Query<'w, 's, &'static MaterialNode<FogMaterial>, With<DarkFog>>,
    fogs: ResMut<'w, Assets<FogMaterial>>,
    xray: Query<'w, 's, Lens, (With<XrayCamera>, Without<FollowCamera>)>,
    world: Query<'w, 's, Entity, With<FollowCamera>>,
}
type Lens = (
    Entity,
    &'static mut Camera,
    &'static mut Transform,
    &'static mut Projection,
);
impl Darkness<'_, '_> {
    /// Sets how dark the fog is. The material is touched only when that changes.
    fn darken(&mut self, strength: f32) {
        for fog in &self.fog {
            if self
                .fogs
                .get(&fog.0)
                .is_some_and(|m| m.strength.x != strength)
                && let Some(mut material) = self.fogs.get_mut(&fog.0)
            {
                material.strength.x = strength;
            }
        }
    }
    /// Turns the X-ray camera on or off, with the HUD drawn by whichever camera is last.
    fn see_through(&mut self, commands: &mut Commands, seeing: bool) {
        for (xray, mut camera, ..) in &mut self.xray {
            if camera.is_active == seeing {
                continue;
            }
            camera.is_active = seeing;
            for world in &self.world {
                let (on, off) = match seeing {
                    true => (xray, world),
                    false => (world, xray),
                };
                commands.entity(on).insert(IsDefaultUiCamera);
                commands.entity(off).remove::<IsDefaultUiCamera>();
            }
        }
    }
}
/// How dark KnowItOwl's special makes the arena, and whether the viewer cast it.
pub fn dark_humor(view: &ClientView) -> (f32, bool) {
    if !view.special_abilities || view.phase != "racing" {
        return (0.0, false);
    }
    let owls = || {
        view.actors.iter().filter(|a| {
            a.driver == 14
                && a.special_active > 0.0
                && a.destroyed <= 0.0
                && !a.inactive
                && !a.afk
                && !a.bomber
        })
    };
    let strength = owls()
        .map(|a| {
            ((7.0 - a.special_active) / 0.4)
                .min(a.special_active / 0.6)
                .min(1.0)
        })
        .fold(0.0, f64::max);
    (strength as f32, owls().any(|a| a.id == view.you))
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
    ghost: bool,
    wind: Wind,
}
impl Stage<'_, '_, '_, '_, '_, '_, '_> {
    fn clip(&self, name: &str) -> Play {
        Play {
            clip: self.graphics.clip(name),
            tint: [255; 3],
            time: None,
            ghost: false,
            wind: Wind::default(),
        }
    }
    /// A clip that plays once, `age` seconds in.
    fn aged(&self, name: &str, age: f64) -> Play {
        Play {
            time: Some(age as f32),
            ..self.clip(name)
        }
    }
    /// A recorded transition `age` seconds in, or the steady clip if this racer has none.
    fn transition(&self, name: &str, steady: &str, age: f32) -> Play {
        match self.graphics.clip(name) {
            Some(_) => self.aged(name, f64::from(age)),
            None => self.clip(steady),
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
                    player.wind = play.wind;
                    self.commands.entity(*entity).insert(transform);
                }
            }
            None => {
                let mut player = Ported::new(play.clip, play.tint, play.time);
                (player.ghost, player.wind) = (play.ghost, play.wind);
                crate::bench::SPAWNED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
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
            crate::bench::DESPAWNED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            false
        });
        live.clear();
    }
}
fn at(wx: f64, height: f64, wz: f64, heading: f64) -> Transform {
    Transform::from_xyz(wx as f32, height as f32, wz as f32)
        .with_rotation(Quat::from_rotation_y(heading as f32))
}

/// The recorded bat hovers this far to its owl's right.
const BAT_SIDE: f32 = 4.0;
/// Each KnowItOwl's bat: where it hovers and the way it faces.
type Bats = HashMap<usize, [f64; 3]>;

fn racers(stage: &mut Stage, view: &ClientView, bats: &Bats, dt: f32, now: f32, xray: bool) {
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
        let boosting = a.boost > 0.0;
        let changed = stage.cache.since(a.id, 0, boosting, now);
        let shifting = changed < TRANSITION;
        let racer = |state: &str| format!("driver:{}:{state}", a.driver);
        // Recorded transitions carry the browser's easing between idle and boost.
        let mut play = match (wrecked, boosting, a.celebrate > 0.0) {
            (true, ..) => stage.clip("wreck"),
            (false, ..) if a.nightmare_active > 0.0 => stage.clip(&racer("idle")),
            (false, true, _) if shifting => {
                stage.transition(&racer("boost:in"), &racer("boost"), changed)
            }
            (false, true, _) => stage.clip(&racer("boost")),
            (false, false, true) => stage.aged(&racer("celebrate"), 1.6 - a.celebrate),
            (false, false, false) if shifting => {
                stage.transition(&racer("boost:out"), &racer("idle"), changed)
            }
            (false, false, false) => stage.clip(&racer("idle")),
        };
        if play.clip.is_none() && !wrecked {
            play = stage.clip(&racer("idle"));
        }
        // For the problem log: a racer who is in the match yet cannot be drawn.
        let placed = a.wx.is_finite() && a.wz.is_finite() && a.heading.is_finite();
        if play.clip.is_none() || !placed {
            crate::reports::limited(
                &format!("racer:{}", a.id),
                30.0,
                "error",
                "racer-not-drawn",
                || {
                    serde_json::json!({"reason":match placed {true => "no ported animation for this racer", false => "a position or angle is not a number"},
                    "viewer":view.you,"racer":a.id,"driver":a.driver,"color":a.color,"wx":a.wx.to_string(),"wz":a.wz.to_string(),"heading":a.heading.to_string(),"boost":a.boost,"wrecked":wrecked})
                },
            );
        }
        play.tint = tint(&a.color).unwrap_or([255; 3]);
        play.wind = stage
            .cache
            .tails
            .entry(a.id)
            .or_insert_with(|| Tail {
                heading: a.heading,
                place: (a.wx, a.wz),
                ..default()
            })
            .follow(a.heading, (a.wx, a.wz), a.speed, dt);
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
        if xray && !wrecked {
            let ghost = Play {
                ghost: true,
                tint: crate::xray::RACER,
                ..play
            };
            stage.show(Role::Ghost, a.id, ghost, body);
        }
        if !crate::has_blender_model(a.driver) || wrecked {
            stage.show(Role::Racer, a.id, play, body);
        }
        if wrecked {
            continue;
        }
        if view.special_abilities && a.driver == 7 && a.nightmare_active > 0.0 {
            let nightmare = match a.nightmare_active <= 1.0 {
                true => stage.aged("overlay:7:nightmare:end", 1.0 - a.nightmare_active),
                false => stage.clip("overlay:7:nightmare"),
            };
            stage.show(Role::Nightmare, a.id, nightmare, body);
        }
        // Health pips face along the viewer's heading, as in the browser.
        if view.special_abilities && a.reverse_controls > 0.0 {
            let puppet = match a.reverse_controls < 0.4 {
                true => stage.aged("overlay:reversePsychology:end", 0.4 - a.reverse_controls),
                false => stage.clip("overlay:reversePsychology"),
            };
            let height = match a.driver {
                11 => 3.0,
                _ => 0.0,
            };
            stage.show(
                Role::CricketPuppet,
                a.id,
                puppet,
                at(a.wx, height, a.wz, a.heading),
            );
        }
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
        let firing = a.vulcan > 0.0;
        let fired = stage.cache.since(a.id, 1, firing, now);
        for (index, name) in OVERLAYS.iter().enumerate() {
            let value = active[index];
            let clip = |part: &str| format!("overlay:{}:{name}{part}", a.driver);
            let start = SPECIAL_STARTS
                .iter()
                .find(|(driver, _)| *name == "special" && *driver == a.driver)
                .map(|(_, initial)| initial - value);
            let overlay = match ENDINGS[index] {
                // Rapid fire's start and end are transitions; it has no fade.
                _ if *name == "vulcan" && fired < TRANSITION => match firing {
                    true => stage.transition(&clip(":in"), &clip(""), fired),
                    false => stage.aged(&clip(":out"), f64::from(fired)),
                },
                _ if value <= 0.0 => continue,
                _ if start.is_some_and(|age| age < f64::from(TRANSITION)) => {
                    stage.transition(&clip(":start"), &clip(""), start.unwrap_or(0.0) as f32)
                }
                // Timed states fade out as their remaining time runs down.
                Some(length) if value < length => {
                    stage.transition(&clip(":end"), &clip(""), (length - value) as f32)
                }
                _ => stage.clip(&clip("")),
            };
            {
                let key = a.id * OVERLAYS.len() + index;
                let mut place = at(a.wx, height as f64, a.wz, a.heading);
                // KnowItOwl's rapid fire is his bat, recorded hovering at his right
                // and facing ahead. It hovers where its shots come from and turns
                // to its target, as the browser aims it.
                if let Some([x, z, aim]) = bats.get(&a.id).filter(|_| *name == "vulcan") {
                    let lift = match a.boost > 0.0 {
                        true => 2.4,
                        false => 0.0,
                    };
                    place = at(*x, f64::from(height) + lift, *z, *aim)
                        * Transform::from_xyz(-BAT_SIDE, 0.0, 0.0);
                    if xray {
                        let ghost = Play {
                            ghost: true,
                            tint: crate::xray::RACER,
                            ..overlay
                        };
                        stage.show(Role::GhostBat, a.id, ghost, place);
                    }
                    // The articulated Blender PBR BatYouDidn'tKnow is rendered by knowitowl.rs.
                    continue;
                }
                stage.show(Role::Overlay(index), key, overlay, place);
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

fn effects(stage: &mut Stage, view: &ClientView, xray: bool, elapsed: f32, drift_limit: usize) {
    // In X-ray, the viewer's own bombs and everyone else's are told apart by color.
    let side = |owner: usize| match owner == view.you {
        true => crate::xray::OWN,
        false => crate::xray::RIVAL,
    };
    for (index, fx) in view.effects.iter().enumerate() {
        let mut transform = at(fx.wx, 0.0, fx.wz, 0.0);
        let play = match fx.kind.as_str() {
            // The browser draws Master-Yuda's exhaust from his own position instead.
            "yudaSmoke" | "explosion" => continue,
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
                let radius = fx.radius.unwrap_or(10.0) as f32;
                let stretch = radius / FIRE_RING_RADIUS;
                transform.scale = Vec3::new(stretch, 1.0, stretch);
                let (color, spin) = match fx.color.as_deref() {
                    Some("#4abaff") => ("blue", -1.0),
                    _ => ("orange", 1.0),
                };
                let out = fx.kind == "fireRingOut";
                for rider in 0..FIRE_RING_RIDERS {
                    let (mut place, ahead) = fire_ring_rider(rider, radius, spin, elapsed);
                    place.translation += Vec3::new(fx.wx as f32, 0.0, fx.wz as f32);
                    let play = match out {
                        true => stage.aged(&format!("effect:fireRingOut:rider:{color}"), fx.age),
                        false => Play {
                            time: Some(elapsed + ahead),
                            ..stage.clip(&format!("effect:fireRing:rider:{color}"))
                        },
                    };
                    stage.show(Role::Rider, index * FIRE_RING_RIDERS + rider, play, place);
                }
                match out {
                    true => stage.aged(&format!("effect:fireRingOut:{color}"), fx.age),
                    false => stage.clip(&format!("effect:fireRing:{color}")),
                }
            }
            kind => {
                if matches!(kind, "heartbeat" | "taxAudit" | "karmaRaccoon") {
                    // These face the viewer; a heartbeat also follows its racer.
                    let owner = fx.owner.and_then(|id| view.actors.get(id));
                    let (wx, wz) = match (kind, owner) {
                        ("heartbeat", Some(a)) => (a.wx, a.wz),
                        _ => (fx.wx, fx.wz),
                    };
                    transform = at(wx, 0.0, wz, view.player.camera_heading);
                }
                if let Some(heading) = fx
                    .heading
                    .filter(|_| matches!(kind, "teleportOut" | "eulerGhost"))
                {
                    transform = at(fx.wx, 0.0, fx.wz, heading);
                }
                let name = format!("effect:{kind}");
                match stage.graphics.clip(&name) {
                    Some(_) if kind == "eulerGhost" => stage.clip(&name),
                    Some(_) => stage.aged(&name, fx.age),
                    None => stage.aged("effect:default", fx.age),
                }
            }
        };
        if xray {
            let ghost = Play {
                ghost: true,
                tint: crate::xray::BLAST,
                ..play
            };
            stage.show(Role::GhostEffect, index, ghost, transform);
        }
        stage.show(Role::Effect, index, play, transform);
    }
    for (index, bomb) in view.bombs.iter().enumerate() {
        let name = match bomb.kind.as_str() {
            "stink" => "bomb:stink",
            _ => "bomb:bomb",
        };
        let play = stage.aged(name, bomb.age);
        if xray {
            let ghost = Play {
                ghost: true,
                tint: side(bomb.owner),
                ..play
            };
            stage.show(
                Role::GhostBomb,
                index,
                ghost,
                at(bomb.wx, 0.0, bomb.wz, 0.0),
            );
        }
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
    let recent_drift = view.drift_particles.len().saturating_sub(drift_limit);
    for (index, particle) in view.drift_particles.iter().enumerate().skip(recent_drift) {
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
    shake: Option<Res<crate::explosions::CameraShake>>,
    mut players: Query<&mut Ported>,
    mut cameras: Query<(&mut Transform, &mut Projection), With<FollowCamera>>,
    mut darkness: Darkness,
    mobile: Res<crate::MobileGraphics>,
) {
    let SceneAssets {
        mut graphics,
        mut meshes,
        mut sky,
        time,
    } = assets;
    let Some(client) = session.client.as_ref() else {
        cache.nightmare_zoom = 0.0;
        // Outside a room the world is empty; the menus say what is happening.
        for (_, entity) in cache.shown.drain() {
            commands.entity(entity).despawn();
        }
        if let Some((_, _, scenery, outlines)) = cache.arena.take() {
            commands.entity(scenery).despawn();
            commands.entity(outlines).despawn();
        }
        darkness.darken(0.0);
        darkness.see_through(&mut commands, false);
        return;
    };
    let view = client.view();
    if cache
        .arena
        .as_ref()
        .is_none_or(|(arena, def, ..)| *arena != view.arena || def != view.arena_def)
    {
        cache.nightmare_zoom = 0.0;
        if let Some((_, _, old, outlines)) = cache.arena.take() {
            commands.entity(old).despawn();
            commands.entity(outlines).despawn();
        }
        let (scenery_mesh, xray_mesh, color) =
            if wild_wheels_core::is_default_arena(view.arena, view.arena_def)
                && let Some(arena) = graphics.arena(view.arena)
            {
                let (mesh, xray, color) = (arena.mesh, arena.xray, arena.sky);
                (
                    graphics.mesh(mesh, [0; 3], Look::Solid, &mut meshes),
                    graphics.mesh(xray, [0; 3], Look::Flat, &mut meshes),
                    color,
                )
            } else {
                crate::arena_mesh::build(view.arena_def, &mut meshes)
            };
        sky.0 = color;
        let scenery = commands
            .spawn((
                Mesh3d(scenery_mesh),
                MeshMaterial3d(graphics.surface(Look::Solid)),
                Transform::default(),
            ))
            .id();
        let outlines = commands
            .spawn((
                Mesh3d(xray_mesh),
                MeshMaterial3d(graphics.surface(Look::Flat)),
                Transform::default(),
                RenderLayers::layer(1),
                Visibility::Hidden,
            ))
            .id();
        cache.arena = Some((view.arena, view.arena_def.clone(), scenery, outlines));
    }
    let (dark, xray) = dark_humor(&view);
    darkness.darken(dark);
    darkness.see_through(&mut commands, xray && dark > 0.0);
    if let Some((.., outlines)) = cache.arena {
        commands.entity(outlines).insert(match xray && dark > 0.0 {
            true => Visibility::Inherited,
            false => Visibility::Hidden,
        });
    }
    let mut stage = Stage {
        commands: &mut commands,
        cache: &mut cache,
        players: &mut players,
        graphics: &graphics,
    };
    let seeing = xray && dark > 0.0;
    // A KnowItOwl keeps the silhouettes ready between casts, unseen, so they are
    // there the moment the dark falls instead of a few frames later.
    let owl = view.special_abilities && view.player.driver == 14;
    let bats: Bats = view
        .actors
        .iter()
        .filter(|a| a.driver == 14 && !a.inactive)
        .filter_map(|a| Some((a.id, client.bat_aim(a.id)?)))
        .collect();
    racers(
        &mut stage,
        &view,
        &bats,
        time.delta_secs().min(0.05),
        time.elapsed_secs(),
        seeing || owl,
    );
    crate::bench::PROJECTILES.store(
        view.projectiles.len() as u64,
        std::sync::atomic::Ordering::Relaxed,
    );
    crate::bench::EFFECTS.store(
        view.effects.len() as u64,
        std::sync::atomic::Ordering::Relaxed,
    );
    for p in view.projectiles {
        let owner = view.actors.get(p.owner).map_or(0, |a| a.driver);
        let play = match (p.kind.as_str(), p.vulcan) {
            ("missile", _) => stage.clip("shot:missile"),
            (_, true) => stage.clip(&format!("shot:vulcan:{owner}")),
            _ => stage.clip("shot:hedgehog"),
        };
        if seeing {
            // The browser marks the viewer's own shots green and the rest pink.
            let ghost = Play {
                ghost: true,
                tint: match p.owner == view.you {
                    true => crate::xray::OWN,
                    false => crate::xray::RIVAL,
                },
                ..play
            };
            stage.show(
                Role::GhostShot,
                p.id as usize,
                ghost,
                at(p.wx, p.height, p.wz, p.heading),
            );
        }
        stage.show(
            Role::Shot,
            p.id as usize,
            play,
            at(p.wx, p.height, p.wz, p.heading),
        );
    }
    let trail_stride = mobile.detail(3, [4, 5, 7, 9]);
    for p in view.projectiles {
        // Leave puffs along the trail, using fewer samples on phones.
        let owner = view.actors.get(p.owner).map_or(0, |a| a.driver);
        let name = match (p.vulcan, p.kind.as_str()) {
            (true, _) => format!("trail:vulcan:{owner}"),
            (false, "missile") => "trail:missile".into(),
            _ => "trail:hedgehog".into(),
        };
        for (index, sample) in p.trail.iter().enumerate().step_by(trail_stride).take(16) {
            let size = match p.vulcan {
                true => 1.0,
                false => (0.12 + (1.0 - index as f32 / p.trail.len() as f32) * 0.5) / 0.62,
            };
            let play = stage.clip(&name);
            let key = p.id as usize * 16 + index / trail_stride;
            let puff = at(sample.wx, sample.height, sample.wz, 0.0).with_scale(Vec3::splat(size));
            if seeing {
                let ghost = Play {
                    ghost: true,
                    ..play
                };
                stage.show(Role::GhostTrail, key, ghost, puff);
            }
            stage.show(Role::Trail, key, play, puff);
        }
    }
    let skid_limit = mobile.detail(usize::MAX, [32, 24, 12, 6]);
    let recent_skids = view.skids.len().saturating_sub(skid_limit);
    for (index, skid) in view.skids.iter().enumerate().skip(recent_skids) {
        let (dx, dz) = (skid.bx - skid.ax, skid.bz - skid.az);
        let length = dx.hypot(dz);
        if length < 0.01 {
            continue;
        }
        let skid_arena = view.arena.min(graphics.arenas().len().saturating_sub(1));
        let play = stage.aged(&format!("skid:{skid_arena}"), view.elapsed - skid.time);
        let mark = at(
            (skid.ax + skid.bx) / 2.0,
            0.0,
            (skid.az + skid.bz) / 2.0,
            dx.atan2(dz),
        )
        .with_scale(Vec3::new(1.0, 1.0, length as f32));
        stage.show(Role::Skid, index, play, mark);
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
    let drift_limit = mobile.detail(usize::MAX, [24, 16, 8, 4]);
    effects(&mut stage, &view, seeing, time.elapsed_secs(), drift_limit);
    stage.retire();
    // The browser's chase camera, including its wider view while boosting or drifting.
    let p = view.player;
    let nightmare = match (
        p.driver,
        p.nightmare_active > 0.0,
        p.boost > 0.0,
        p.destroyed > 0.0,
    ) {
        (7, true, true, false) => 1.0,
        _ => 0.0,
    };
    cache.nightmare_zoom +=
        (nightmare - cache.nightmare_zoom) * (1.0 - (-time.delta_secs().min(0.1) * 5.0).exp());
    if nightmare > 0.0 && p.nightmare_active <= 1.0 {
        cache.nightmare_zoom = cache
            .nightmare_zoom
            .min((p.nightmare_active as f32).powi(2));
    }
    let zoom = cache.nightmare_zoom;
    let distance = 17.0 + 25.0 * zoom;
    let ahead = 18.0 - 32.0 * zoom;
    let facing = Vec3::new(
        p.camera_heading.sin() as f32,
        0.0,
        p.camera_heading.cos() as f32,
    );
    let center = Vec3::new(p.wx as f32, 0.0, p.wz as f32);
    let height = 16.0 * zoom
        + match p.destroyed > 0.0 {
            true => 15.0,
            false => 10.0,
        };
    let shake_offset = if let Some(ref s) = shake
        && s.trauma > 0.001
    {
        let amp = s.trauma * s.trauma * 1.15;
        let t = s.time;
        Vec3::new(
            (t * 47.0).sin() * amp,
            (t * 53.0 + 1.3).cos() * amp * 0.75,
            (t * 41.0 + 2.7).sin() * amp,
        )
    } else {
        Vec3::ZERO
    };
    for (mut camera, mut projection) in &mut cameras {
        *camera = Transform::from_translation(
            center - facing * distance + Vec3::Y * height + shake_offset,
        )
        .looking_at(
            center + facing * ahead + Vec3::Y * 1.5 + shake_offset * 0.45,
            Vec3::Y,
        );
        if let Projection::Perspective(perspective) = &mut *projection {
            perspective.fov = match (p.boost > 0.0, p.was_drifting) {
                (true, _) => 1.2,
                (false, true) => 1.13,
                _ => 1.07,
            };
        }
        for (_, _, mut xray, mut lens) in &mut darkness.xray {
            *xray = *camera;
            *lens = projection.clone();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tail_trails_a_turn_overshoots_and_settles() {
        let mut tail = Tail::default();
        let dt = 1.0 / 120.0;
        let mut heading = 0.0;
        let mut peak = 0.0f32;
        // Half a second turning left at two radians a second, then straight on.
        for step in 0..240 {
            if step < 60 {
                heading += 2.0 * f64::from(dt);
            }
            let wind = tail.follow(heading, (0.0, 0.0), 0.0, dt);
            peak = peak.max(wind.swing);
            if step == 59 {
                // Trailing left of where a steady turn would hold it, about 0.56.
                assert!((0.3..0.9).contains(&wind.swing), "{}", wind.swing);
            }
            if step == 80 {
                // Springing back through centre after the turn ends.
                assert!(wind.swing < 0.3, "{}", wind.swing);
            }
        }
        assert!(peak > 0.56, "the spring overshoots: {peak}");
        assert!(tail.swing.abs() < 0.02 && tail.velocity.abs() < 0.2);
    }

    #[test]
    fn speed_presses_a_tail_back_and_a_respawn_is_not_a_turn() {
        let mut tail = Tail::default();
        let dt = 1.0 / 60.0;
        for _ in 0..120 {
            tail.follow(0.0, (0.0, 0.0), 520.0, dt);
        }
        assert!(tail.press > 0.95);
        // Jumping across the arena while facing the other way does not swing it.
        let wind = tail.follow(3.0, (60.0, -40.0), 0.0, dt);
        assert_eq!(wind.swing, 0.0);
        assert_eq!(tail.velocity, 0.0);
    }

    #[test]
    fn sync_and_hud_update_have_no_query_conflicts() {
        let mut world = World::new();
        let mut sync_sys = IntoSystem::into_system(sync);
        sync_sys.initialize(&mut world);
        let mut hud_sys = IntoSystem::into_system(crate::hud::update);
        hud_sys.initialize(&mut world);
    }
}
