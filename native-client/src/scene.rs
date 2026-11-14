//! Presentation-only entities. All gameplay state comes from the core client.
use crate::app::GameSession;
use bevy::ecs::system::SystemParam;
use bevy::{prelude::*, text::FontSize};
use std::collections::{HashMap, HashSet};

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
fn capture(mut commands: Commands, capture: Res<Capture>, time: Res<Time>, mut last: Local<f32>) {
    if time.elapsed_secs() < 5.0 {
        return;
    }
    if time.elapsed_secs() - *last < 10.0 {
        return;
    }
    if let Some(path) = capture.0.as_ref() {
        *last = time.elapsed_secs();
        commands
            .spawn(bevy::render::view::screenshot::Screenshot::primary_window())
            .observe(bevy::render::view::screenshot::save_to_disk(path.clone()));
    }
}
#[derive(Resource, Default)]
pub struct SceneCache {
    actors: HashMap<usize, (Entity, usize)>,
    shots: HashMap<u32, Entity>,
    built: bool,
}
#[derive(Resource)]
pub struct Geometry {
    cube: Handle<Mesh>,
    ball: Handle<Mesh>,
    wheel: Handle<Mesh>,
    white: Handle<StandardMaterial>,
    black: Handle<StandardMaterial>,
    purple: Handle<StandardMaterial>,
    gold: Handle<StandardMaterial>,
}
#[derive(Component)]
pub struct FollowCamera;
#[derive(Component)]
pub struct Hud;

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let cube = meshes.add(Cuboid::default());
    let ball = meshes.add(Sphere::new(1.0).mesh().uv(16, 12));
    let wheel = meshes.add(Cylinder::new(1.0, 1.0));
    let white = materials.add(Color::srgb(0.96, 0.95, 0.90));
    let black = materials.add(Color::srgb(0.07, 0.07, 0.10));
    let purple = materials.add(Color::srgb(0.52, 0.34, 0.81));
    let gold = materials.add(Color::srgb(0.95, 0.78, 0.25));
    commands.insert_resource(Geometry {
        cube,
        ball,
        wheel,
        white,
        black,
        purple,
        gold,
    });
    commands.insert_resource(GlobalAmbientLight {
        brightness: 350.0,
        ..default()
    });
    commands.spawn((
        DirectionalLight {
            illuminance: 18000.0,
            ..default()
        },
        Transform::from_xyz(-40.0, 80.0, 30.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(0.0, 65.0, -75.0).looking_at(Vec3::ZERO, Vec3::Y),
        FollowCamera,
    ));
    commands.spawn((
        Text::new("WILD WHEELS · NATIVE RUST\nConnecting to dedicated arena…"),
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
fn part(
    commands: &mut Commands,
    parent: Entity,
    mesh: &Handle<Mesh>,
    material: &Handle<StandardMaterial>,
    position: Vec3,
    scale: Vec3,
    rotation: Quat,
) {
    commands.spawn((
        Mesh3d(mesh.clone()),
        MeshMaterial3d(material.clone()),
        Transform {
            translation: position,
            scale,
            rotation,
        },
        ChildOf(parent),
    ));
}
fn kart(
    commands: &mut Commands,
    g: &Geometry,
    driver: usize,
    color: Handle<StandardMaterial>,
) -> Entity {
    let root = commands
        .spawn((Transform::default(), Visibility::default()))
        .id();
    part(
        commands,
        root,
        &g.cube,
        &color,
        Vec3::new(0.0, 0.8, 0.0),
        Vec3::new(2.6, 0.65, 3.6),
        Quat::IDENTITY,
    );
    part(
        commands,
        root,
        &g.cube,
        &g.black,
        Vec3::new(0.0, 1.2, -0.7),
        Vec3::new(1.5, 0.5, 1.1),
        Quat::IDENTITY,
    );
    for x in [-1.4, 1.4] {
        for z in [-1.1, 1.1] {
            part(
                commands,
                root,
                &g.wheel,
                &g.black,
                Vec3::new(x, 0.58, z),
                Vec3::new(0.6, 0.4, 0.6),
                Quat::from_rotation_z(std::f32::consts::FRAC_PI_2),
            );
        }
    }
    match driver {
        0 => {
            part(
                commands,
                root,
                &g.ball,
                &g.white,
                Vec3::new(0.0, 1.9, -0.2),
                Vec3::new(0.8, 1.0, 0.65),
                Quat::IDENTITY,
            );
            part(
                commands,
                root,
                &g.ball,
                &g.white,
                Vec3::new(0.0, 3.0, 0.0),
                Vec3::splat(0.92),
                Quat::IDENTITY,
            );
            for side in [-1.0, 1.0] {
                part(
                    commands,
                    root,
                    &g.ball,
                    &g.black,
                    Vec3::new(side * 0.67, 3.65, -0.05),
                    Vec3::splat(0.36),
                    Quat::IDENTITY,
                );
                part(
                    commands,
                    root,
                    &g.ball,
                    &g.black,
                    Vec3::new(side * 0.36, 3.10, 0.76),
                    Vec3::new(0.29, 0.35, 0.13),
                    Quat::from_rotation_z(side * 0.25),
                );
                part(
                    commands,
                    root,
                    &g.ball,
                    &g.white,
                    Vec3::new(side * 0.34, 3.15, 0.89),
                    Vec3::splat(0.10),
                    Quat::IDENTITY,
                );
                part(
                    commands,
                    root,
                    &g.ball,
                    &g.black,
                    Vec3::new(side * 0.75, 1.9, 0.35),
                    Vec3::new(0.25, 0.45, 0.3),
                    Quat::from_rotation_z(side * 0.5),
                );
            }
            part(
                commands,
                root,
                &g.ball,
                &g.black,
                Vec3::new(0.0, 2.86, 0.91),
                Vec3::new(0.20, 0.13, 0.13),
                Quat::IDENTITY,
            );
        }
        _ => part(
            commands,
            root,
            &g.ball,
            &color,
            Vec3::new(0.0, 2.5, 0.0),
            Vec3::new(0.8, 1.1, 0.8),
            Quat::IDENTITY,
        ),
    }
    root
}
#[derive(SystemParam)]
pub struct SceneAssets<'w> {
    geometry: Res<'w, Geometry>,
    materials: ResMut<'w, Assets<StandardMaterial>>,
}

pub fn sync(
    mut commands: Commands,
    session: Res<GameSession>,
    assets: SceneAssets,
    mut cache: ResMut<SceneCache>,
    mut transforms: Query<&mut Transform, Without<FollowCamera>>,
    mut cameras: Query<&mut Transform, With<FollowCamera>>,
    mut hud: Query<&mut Text, With<Hud>>,
) {
    let SceneAssets {
        geometry: g,
        mut materials,
    } = assets;
    let Some(client) = session.client.as_ref() else {
        for mut text in &mut hud {
            text.0 = format!("WILD WHEELS · NATIVE RUST\n{}", session.status);
        }
        return;
    };
    let view = client.view();
    if view.arena != 0 {
        return;
    }
    if !cache.built {
        let ground = materials.add(Color::srgb(0.46, 0.51, 0.38));
        let wall = materials.add(Color::srgb(0.84, 0.44, 0.29));
        commands.spawn((
            Mesh3d(g.cube.clone()),
            MeshMaterial3d(ground),
            Transform::from_xyz(0.0, -0.3, 0.0).with_scale(Vec3::new(192.0, 0.5, 192.0)),
        ));
        for [x, z, w, d] in view.blocks {
            commands.spawn((
                Mesh3d(g.cube.clone()),
                MeshMaterial3d(wall.clone()),
                Transform::from_xyz(*x as f32, 3.0, *z as f32)
                    .with_scale(Vec3::new(*w as f32, 6.0, *d as f32)),
            ));
        }
        for (x, z, w, d) in [
            (0.0, 97.0, 196.0, 2.0),
            (0.0, -97.0, 196.0, 2.0),
            (97.0, 0.0, 2.0, 192.0),
            (-97.0, 0.0, 2.0, 192.0),
        ] {
            commands.spawn((
                Mesh3d(g.cube.clone()),
                MeshMaterial3d(wall.clone()),
                Transform::from_xyz(x, 2.0, z).with_scale(Vec3::new(w, 4.0, d)),
            ));
        }
        cache.built = true;
    }
    let live: HashSet<_> = view
        .actors
        .iter()
        .filter(|a| !a.inactive && !a.bomber)
        .map(|a| a.id)
        .collect();
    cache.actors.retain(|id, (entity, _)| {
        if live.contains(id) {
            return true;
        }
        commands.entity(*entity).despawn();
        false
    });
    for a in view.actors.iter().filter(|a| live.contains(&a.id)) {
        let entity = match cache.actors.get(&a.id) {
            Some((entity, driver)) if *driver == a.driver => *entity,
            _ => {
                if let Some((old, _)) = cache.actors.remove(&a.id) {
                    commands.entity(old).despawn();
                }
                let color = match a.driver {
                    0 => g.purple.clone(),
                    _ => materials.add(Color::srgb_u8(
                        ((a.id * 73 + 60) % 200 + 40) as u8,
                        ((a.id * 41 + 100) % 200 + 40) as u8,
                        ((a.id * 29 + 120) % 200 + 40) as u8,
                    )),
                };
                let entity = kart(&mut commands, &g, a.driver, color);
                cache.actors.insert(a.id, (entity, a.driver));
                entity
            }
        };
        let progress = (1.0 - a.somersault / 0.55).clamp(0.0, 1.0) as f32;
        let jump = match a.somersault > 0.0 {
            true => (progress * std::f32::consts::PI).sin() * 5.0,
            false => 0.0,
        };
        let transform = Transform::from_xyz(a.wx as f32, jump, a.wz as f32).with_rotation(
            Quat::from_rotation_y(a.heading as f32) * Quat::from_rotation_z(-(a.yaw as f32) * 0.4),
        );
        commands.entity(entity).insert((
            transform,
            match a.destroyed > 0.0 {
                true => Visibility::Hidden,
                false => Visibility::Inherited,
            },
        ));
    }
    let live_shots: HashSet<_> = view.projectiles.iter().map(|p| p.id).collect();
    cache.shots.retain(|id, entity| {
        if live_shots.contains(id) {
            return true;
        }
        commands.entity(*entity).despawn();
        false
    });
    for p in view.projectiles {
        let entity = *cache.shots.entry(p.id).or_insert_with(|| {
            commands
                .spawn((
                    Mesh3d(g.ball.clone()),
                    MeshMaterial3d(g.gold.clone()),
                    Transform::default(),
                ))
                .id()
        });
        if let Ok(mut transform) = transforms.get_mut(entity) {
            *transform = Transform::from_xyz(p.wx as f32, p.height as f32, p.wz as f32)
                .with_scale(match p.kind.as_str() {
                    "missile" => Vec3::new(0.28, 0.28, 1.2),
                    _ => Vec3::splat(0.45),
                })
                .with_rotation(Quat::from_rotation_y(p.heading as f32));
        }
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
            "WILD WHEELS · NATIVE RUST POC\n{} · {} · {:.0} KILLS\nHEALTH {:.0}   HEDGES {}   MISSILES {}   BOOST {}\n{} · {}\nWASD / arrows · Shift drift · Space fire · Tab weapon\nX boost · C chaff · Z flip · Enter start",
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
                _ if p.destroyed > 0.0 => "RESPAWNING…".into(),
                _ => String::new(),
            }
        );
    }
}
