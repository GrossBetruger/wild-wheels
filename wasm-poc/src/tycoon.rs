//! Tai-Coon (driver 15) Bevy WASM visuals: a crate of glossy Südtirol red apples
//! in her pickup bed and physics-driven apples that spill, bounce, and tumble
//! out over the tailgate whenever she boosts.

use crate::{
    BlenderRacer, MobileGraphics, Presentation,
    app::GameSession,
    ported,
    preview::Preview,
    scene,
};
use bevy::asset::RenderAssetUsages;
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::prelude::*;
use std::collections::HashMap;

pub const DRIVER: usize = 15;

const APPLE_RADIUS: f32 = 0.27;
const APPLE_GRAVITY: f32 = 22.0;
const APPLE_LIFE: f32 = 1.65;
const MAX_LIVE_APPLES: usize = 36;

/// Eight deterministic launch profiles matching the browser renderer's feel.
const PROFILES: [(f32, f32, f32, f32, f32, usize); 8] = [
    // (x0, vx, vy0, back_speed, spin, variant)
    (-0.56, -1.1, 3.1, 9.2, 11.5, 0),
    (0.48, 0.95, 3.5, 10.0, 10.2, 1),
    (-0.12, -0.4, 2.7, 8.4, 12.8, 0),
    (0.72, 1.35, 3.3, 10.6, 9.8, 1),
    (-0.74, -1.4, 3.6, 9.6, 11.0, 1),
    (0.22, 0.55, 2.8, 8.8, 12.1, 0),
    (-0.36, -0.75, 3.4, 10.2, 10.6, 0),
    (0.60, 1.15, 2.95, 9.4, 11.9, 1),
];

pub struct TycoonPlugin;

impl Plugin for TycoonPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<TycoonAppleStates>()
            .add_systems(Startup, setup_apple_assets)
            .add_systems(
                Update,
                (attach_bed_apples, spawn_boost_apples, tick_falling_apples)
                    .chain()
                    .after(crate::sync_blender_models)
                    .in_set(Presentation),
            );
    }
}

#[derive(Resource)]
struct TycoonAppleAssets {
    apple_mesh: Handle<Mesh>,
    stem_mesh: Handle<Mesh>,
    leaf_mesh: Handle<Mesh>,
    crate_mesh: Handle<Mesh>,
    crimson_mat: Handle<StandardMaterial>,
    ruby_mat: Handle<StandardMaterial>,
    stem_mat: Handle<StandardMaterial>,
    leaf_mat: Handle<StandardMaterial>,
    wood_mat: Handle<StandardMaterial>,
}

#[derive(Resource, Default)]
struct TycoonAppleStates {
    by_actor: HashMap<usize, ActorAppleState>,
}

struct ActorAppleState {
    boosting: bool,
    timer: f32,
    count: usize,
}

#[derive(Component)]
struct HasAppleBed;

#[derive(Component)]
struct FallingApple {
    vel: Vec3,
    spin: Vec3,
    age: f32,
    life: f32,
}

/// Builds a sculpted, smooth-shaded Südtirol apple mesh (wider shoulders,
/// gently tapered base, top stem dimple & bottom calyx dimple).
fn build_apple_mesh(radius: f32) -> Mesh {
    let segs: usize = 14;
    let rings: usize = 10;
    let mut positions = Vec::with_capacity((rings + 1) * (segs + 1));
    let mut normals = Vec::with_capacity((rings + 1) * (segs + 1));
    let mut uvs = Vec::with_capacity((rings + 1) * (segs + 1));
    let mut indices = Vec::with_capacity(rings * segs * 6);

    for r in 0..=rings {
        let v = r as f32 / rings as f32;
        let phi = v * std::f32::consts::PI; // 0 = top pole, PI = bottom pole
        let sin_p = phi.sin();
        let cos_p = phi.cos();
        // Classic apple profile: fuller upper shoulders, tapered lower cheek, dimpled poles.
        let shoulder = 1.0 + 0.12 * (cos_p + 0.25) * sin_p;
        let pole_dimple = if cos_p > 0.72 {
            let t = (cos_p - 0.72) / 0.28;
            -0.22 * t * t
        } else if cos_p < -0.78 {
            let t = (-cos_p - 0.78) / 0.22;
            0.14 * t * t
        } else {
            0.0
        };
        let y = (cos_p * 0.92 + pole_dimple) * radius;
        let ring_r = sin_p * shoulder * radius;

        for s in 0..=segs {
            let u = s as f32 / segs as f32;
            let theta = u * std::f32::consts::TAU;
            let x = theta.cos() * ring_r;
            let z = theta.sin() * ring_r;
            positions.push([x, y, z]);
            normals.push([0.0, 1.0, 0.0]);
            uvs.push([u, v]);
        }
    }

    let stride = segs + 1;
    for r in 0..rings {
        for s in 0..segs {
            let a = (r * stride + s) as u32;
            let b = a + 1;
            let c = ((r + 1) * stride + s) as u32;
            let d = c + 1;
            indices.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }

    // Accumulate smooth area-weighted vertex normals.
    let mut acc = vec![Vec3::ZERO; positions.len()];
    for tri in indices.chunks_exact(3) {
        let p0 = Vec3::from_array(positions[tri[0] as usize]);
        let p1 = Vec3::from_array(positions[tri[1] as usize]);
        let p2 = Vec3::from_array(positions[tri[2] as usize]);
        let n = (p1 - p0).cross(p2 - p0);
        acc[tri[0] as usize] += n;
        acc[tri[1] as usize] += n;
        acc[tri[2] as usize] += n;
    }
    for (dst, n) in normals.iter_mut().zip(acc) {
        let unit = n.normalize_or_zero();
        *dst = if unit == Vec3::ZERO { [0.0, 1.0, 0.0] } else { unit.to_array() };
    }

    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::MAIN_WORLD | RenderAssetUsages::RENDER_WORLD,
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

fn setup_apple_assets(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    commands.insert_resource(TycoonAppleAssets {
        apple_mesh: meshes.add(build_apple_mesh(APPLE_RADIUS)),
        stem_mesh: meshes.add(Cylinder::new(0.022, 0.13)),
        leaf_mesh: meshes.add(Sphere::new(0.11).mesh().uv(8, 5)),
        crate_mesh: meshes.add(Cuboid::new(1.36, 0.42, 0.46)),
        crimson_mat: materials.add(StandardMaterial {
            base_color: Color::srgb(0.84, 0.09, 0.13),
            perceptual_roughness: 0.22,
            reflectance: 0.68,
            ..default()
        }),
        ruby_mat: materials.add(StandardMaterial {
            base_color: Color::srgb(0.68, 0.06, 0.11),
            perceptual_roughness: 0.26,
            reflectance: 0.62,
            ..default()
        }),
        stem_mat: materials.add(StandardMaterial {
            base_color: Color::srgb(0.32, 0.19, 0.09),
            perceptual_roughness: 0.85,
            ..default()
        }),
        leaf_mat: materials.add(StandardMaterial {
            base_color: Color::srgb(0.24, 0.66, 0.21),
            perceptual_roughness: 0.42,
            ..default()
        }),
        wood_mat: materials.add(StandardMaterial {
            base_color: Color::srgb(0.58, 0.37, 0.20),
            perceptual_roughness: 0.78,
            ..default()
        }),
    });
}

fn spawn_apple_children(parent: &mut ChildSpawnerCommands, assets: &TycoonAppleAssets, variant: usize) {
    let body_mat = if variant % 2 == 0 {
        assets.crimson_mat.clone()
    } else {
        assets.ruby_mat.clone()
    };
    parent.spawn((
        Mesh3d(assets.apple_mesh.clone()),
        MeshMaterial3d(body_mat),
        Transform::IDENTITY,
        Visibility::Inherited,
    ));
    parent.spawn((
        Mesh3d(assets.stem_mesh.clone()),
        MeshMaterial3d(assets.stem_mat.clone()),
        Transform::from_xyz(0.0, APPLE_RADIUS * 0.92, 0.0)
            .with_rotation(Quat::from_rotation_z(-0.14)),
        Visibility::Inherited,
    ));
    parent.spawn((
        Mesh3d(assets.leaf_mesh.clone()),
        MeshMaterial3d(assets.leaf_mat.clone()),
        Transform {
            translation: Vec3::new(APPLE_RADIUS * 0.38, APPLE_RADIUS * 1.06, 0.03),
            rotation: Quat::from_euler(EulerRot::YXZ, 0.25, 0.2, -0.35),
            scale: Vec3::new(1.15, 0.28, 0.68),
        },
        Visibility::Inherited,
    ));
}

/// Attaches a brimming wooden crate of Südtirol red apples into the rear of
/// Tai-Coon's pickup truck bed (uses Visibility::Inherited so it hides on KO).
fn attach_bed_apples(
    mut commands: Commands,
    assets: Res<TycoonAppleAssets>,
    racers: Query<(Entity, &BlenderRacer), Without<HasAppleBed>>,
) {
    const BED_APPLES: [(f32, f32, f32, usize); 5] = [
        (-0.28, 1.94, -2.16, 0),
        (0.14, 1.96, -2.20, 1),
        (0.56, 1.94, -2.16, 0),
        (-0.08, 2.16, -2.18, 1),
        (0.36, 2.15, -2.18, 0),
    ];
    for (ent, racer) in &racers {
        if racer.driver != DRIVER {
            continue;
        }
        commands
            .entity(ent)
            .insert(HasAppleBed)
            .with_children(|truck| {
                truck.spawn((
                    Mesh3d(assets.crate_mesh.clone()),
                    MeshMaterial3d(assets.wood_mat.clone()),
                    Transform::from_xyz(0.18, 1.57, -2.18),
                    Visibility::Inherited,
                ));
                for &(ax, ay, az, variant) in &BED_APPLES {
                    truck
                        .spawn((
                            Transform::from_xyz(ax, ay, az)
                                .with_rotation(Quat::from_rotation_y(ax * 2.1))
                                .with_scale(Vec3::splat(0.84)),
                            Visibility::Inherited,
                        ))
                        .with_children(|apple| spawn_apple_children(apple, &assets, variant));
                }
            });
    }
}

fn spawn_boost_apples(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    preview: Res<Preview>,
    mobile: Res<MobileGraphics>,
    assets: Res<TycoonAppleAssets>,
    mut states: ResMut<TycoonAppleStates>,
    live_apples: Query<(), With<FallingApple>>,
) {
    let Some(client) = session.client.as_ref() else {
        return;
    };
    let dt = time.delta_secs().min(0.05);
    let view = preview.on_stage(client.view());
    let interval = if mobile.mobile { 0.24 } else { 0.14 };
    let mut live_count = live_apples.iter().count();

    for a in view.actors {
        if a.driver != DRIVER || a.inactive || a.afk || a.bomber || a.destroyed > 0.0 {
            continue;
        }
        let state = states.by_actor.entry(a.id).or_insert(ActorAppleState {
            boosting: false,
            timer: 0.0,
            count: 0,
        });
        let boosting = a.boost > 0.0 || a.somersault > 0.0;
        let should_spawn = if boosting {
            if !state.boosting {
                state.timer = interval;
                true
            } else {
                state.timer -= dt;
                if state.timer <= 0.0 {
                    state.timer += interval;
                    true
                } else {
                    false
                }
            }
        } else {
            false
        };
        state.boosting = boosting;

        if !should_spawn || live_count >= MAX_LIVE_APPLES {
            continue;
        }

        let (somersault_h, pitch, _, _) = scene::somersault(a.driver, a.somersault);
        let gy = view.arena_def.ground_height(a.wx, a.wz) as f32;
        let height = gy + if a.somersault > 0.0 { somersault_h } else { 0.0 };
        let tf = ported::placement(
            Vec3::new(a.wx as f32, height, a.wz as f32),
            a.heading as f32,
            pitch,
            0.0,
        );
        let (x0, vx, vy0, back_speed, spin_rate, variant) = PROFILES[state.count % PROFILES.len()];
        state.count = state.count.wrapping_add(1);

        let pos = tf.transform_point(Vec3::new(x0, 2.08, -2.42));
        let back = tf.rotation * Vec3::NEG_Z;
        let right = tf.rotation * Vec3::X;
        let vel = back * back_speed + right * vx + Vec3::Y * vy0;

        commands
            .spawn((
                Transform::from_translation(pos)
                    .with_rotation(Quat::from_rotation_y(a.heading as f32 + x0)),
                Visibility::Visible,
                FallingApple {
                    vel,
                    spin: Vec3::new(-spin_rate, vx * 2.2, vx * 1.6),
                    age: 0.0,
                    life: APPLE_LIFE,
                },
            ))
            .with_children(|apple| spawn_apple_children(apple, &assets, variant));
        live_count += 1;
    }
}

fn tick_falling_apples(
    mut commands: Commands,
    time: Res<Time>,
    mut apples: Query<(Entity, &mut Transform, &mut FallingApple)>,
) {
    let dt = time.delta_secs().min(0.05);
    for (ent, mut tf, mut apple) in &mut apples {
        apple.age += dt;
        if apple.age >= apple.life {
            commands.entity(ent).despawn();
            continue;
        }
        apple.vel.y -= APPLE_GRAVITY * dt;
        tf.translation += apple.vel * dt;
        if tf.translation.y < APPLE_RADIUS {
            tf.translation.y = APPLE_RADIUS;
            if apple.vel.y < -1.2 {
                apple.vel.y = -apple.vel.y * 0.48;
                apple.vel.x *= 0.84;
                apple.vel.z *= 0.84;
                apple.spin *= 0.86;
            } else {
                apple.vel.y = 0.0;
                let drag = (1.0 - 2.4 * dt).max(0.2);
                apple.vel.x *= drag;
                apple.vel.z *= drag;
                apple.spin *= drag;
            }
        }
        tf.rotation = Quat::from_euler(
            EulerRot::XYZ,
            apple.spin.x * dt,
            apple.spin.y * dt,
            apple.spin.z * dt,
        ) * tf.rotation;

        let remaining = apple.life - apple.age;
        if remaining < 0.25 {
            tf.scale = Vec3::splat((remaining / 0.25).clamp(0.02, 1.0));
        }
    }
}
