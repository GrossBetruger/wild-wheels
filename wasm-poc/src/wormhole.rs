//! Avita-Jas's portable Wormhole (double-tap X, 8s duration, 20-unit pull radius)
//! + generic dynamic spaghettification for ALL racers in Bevy WASM:
//! - Portable singularity hovering 14 units in front of Avita & moving with her:
//!   pitch-black event horizon core, swirling WGSL accretion vortex disc,
//!   gravitational lensing Einstein ring, inward-spiraling accretion streaks,
//!   and a pulsing violet-cyan arena PointLight.
//! - Generic spaghettification pass (`PostUpdate`, before `TransformSystems::Propagate`):
//!   any rival racer within 20 units of an active wormhole has its actual 3D
//!   model dynamically stretched 4.5x along the tidal pull vector, thinned into
//!   a spaghetti strand, and spiraled into the event horizon, with glowing
//!   tidal plasma tendrils arcing from the victim into the singularity!
use crate::{MobileGraphics, Presentation, app::GameSession, relativity::SpacetimeGridMaterial, scene};
use bevy::{
    asset::{AssetPath, embedded_asset, embedded_path},
    mesh::MeshVertexBufferLayoutRef,
    pbr::{MaterialPipeline, MaterialPipelineKey},
    prelude::*,
    reflect::TypePath,
    render::render_resource::{
        AsBindGroup, RenderPipelineDescriptor, SpecializedMeshPipelineError,
    },
    shader::ShaderRef,
    transform::TransformSystems,
};
use std::collections::HashMap;
use std::f32::consts::FRAC_PI_2;

pub const DRIVER: usize = 8;
pub const WORMHOLE_OFFSET: f32 = 14.0;
pub const WORMHOLE_RADIUS: f32 = 20.0;
pub const WORMHOLE_HEIGHT: f32 = 2.6;
const WORMHOLE_DURATION: f32 = 8.0;

pub struct WormholePlugin;

impl Plugin for WormholePlugin {
    fn build(&self, app: &mut App) {
        embedded_asset!(app, "wormhole_vortex.wgsl");
        app.add_plugins(MaterialPlugin::<WormholeVortexMaterial>::default())
            .init_resource::<ActiveWormholes>()
            .add_systems(Startup, setup)
            .add_systems(
                Update,
                (sync_wormholes, tick_streaks)
                    .chain()
                    .after(scene::sync)
                    .in_set(Presentation),
            )
            .add_systems(
                PostUpdate,
                spaghettify_racers.before(TransformSystems::Propagate),
            );
    }
}

fn embedded_vortex() -> ShaderRef {
    ShaderRef::Path(AssetPath::from_path_buf(embedded_path!("wormhole_vortex.wgsl")).with_source("embedded"))
}

#[derive(Asset, TypePath, AsBindGroup, Debug, Clone, Default)]
pub struct WormholeVortexMaterial {
    #[uniform(0)]
    pub params: Vec4,
}

impl Material for WormholeVortexMaterial {
    fn vertex_shader() -> ShaderRef {
        embedded_vortex()
    }
    fn fragment_shader() -> ShaderRef {
        embedded_vortex()
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Add
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
    fn specialize(
        _pipeline: &MaterialPipeline,
        descriptor: &mut RenderPipelineDescriptor,
        layout: &MeshVertexBufferLayoutRef,
        _key: MaterialPipelineKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        descriptor.vertex.buffers = vec![layout.0.get_layout(&[
            Mesh::ATTRIBUTE_POSITION.at_shader_location(0),
            Mesh::ATTRIBUTE_UV_0.at_shader_location(1),
        ])?];
        descriptor.primitive.cull_mode = None;
        if let Some(ds) = descriptor.depth_stencil.as_mut() {
            ds.depth_write_enabled = Some(false);
        }
        Ok(())
    }
}

/// Marker so `spaghettify_racers` never deforms the wormhole itself or its VFX.
#[derive(Component)]
struct WormholePart;

#[derive(Resource, Default)]
struct ActiveWormholes {
    /// Active wormholes this frame: (owner_id, world_pos, strength)
    holes: Vec<(usize, Vec3, f32)>,
    /// Victim actors currently inside a wormhole's 20-unit pull radius:
    /// (actor_wx, actor_wz, wormhole_pos, weight_0_to_1)
    victims: Vec<(f32, f32, Vec3, f32)>,
}

#[derive(Resource)]
struct WormholeAssets {
    core_mesh: Handle<Mesh>,
    core_mat: Handle<StandardMaterial>,
    vortex_mesh: Handle<Mesh>,
    halo_mesh: Handle<Mesh>,
    halo_mat: Handle<StandardMaterial>,
    streak_mesh: Handle<Mesh>,
    streak_cyan_mat: Handle<StandardMaterial>,
    streak_violet_mat: Handle<StandardMaterial>,
    grid_mesh: Handle<Mesh>,
    rigs: HashMap<usize, WormholeRig>,
    streak_timer: f32,
}

struct WormholeRig {
    root: Entity,
    vortex: Entity,
    vortex_mat: Handle<WormholeVortexMaterial>,
    halo: Entity,
    grid: Entity,
    grid_mat: Handle<SpacetimeGridMaterial>,
    light: Entity,
}

#[derive(Component)]
struct AccretionStreak {
    target: Vec3,
    angle: f32,
    radius: f32,
    height: f32,
    age: f32,
    life: f32,
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut std_mats: ResMut<Assets<StandardMaterial>>,
) {
    let core_mesh = meshes.add(Sphere::new(2.25).mesh().uv(24, 16));
    let core_mat = std_mats.add(StandardMaterial {
        base_color: Color::srgb(0.01, 0.004, 0.03),
        emissive: LinearRgba::rgb(0.01, 0.005, 0.04),
        unlit: true,
        ..default()
    });
    let vortex_mesh = meshes.add(Plane3d::default().mesh().size(24.0, 24.0));
    let halo_mesh = meshes.add(Torus::new(0.24, 3.0));
    let halo_mat = std_mats.add(StandardMaterial {
        base_color: Color::srgba(0.45, 0.85, 1.0, 0.82),
        emissive: LinearRgba::rgb(2.2, 5.2, 7.5),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    let streak_mesh = meshes.add(Sphere::new(0.26).mesh().uv(6, 4));
    let streak_cyan_mat = std_mats.add(StandardMaterial {
        base_color: Color::srgba(0.32, 0.94, 1.0, 0.85),
        emissive: LinearRgba::rgb(1.8, 5.2, 7.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    let streak_violet_mat = std_mats.add(StandardMaterial {
        base_color: Color::srgba(0.76, 0.30, 1.0, 0.85),
        emissive: LinearRgba::rgb(4.6, 1.4, 7.2),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    // Compact Einstein funnel grid right underneath the wormhole
    let grid_mesh = meshes.add(Plane3d::default().mesh().size(44.0, 44.0).subdivisions(28));

    commands.insert_resource(WormholeAssets {
        core_mesh,
        core_mat,
        vortex_mesh,
        halo_mesh,
        halo_mat,
        streak_mesh,
        streak_cyan_mat,
        streak_violet_mat,
        grid_mesh,
        rigs: HashMap::new(),
        streak_timer: 0.0,
    });
}

#[allow(clippy::too_many_arguments)]
fn sync_wormholes(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    preview: Res<crate::preview::Preview>,
    mobile: Res<MobileGraphics>,
    mut assets: ResMut<WormholeAssets>,
    mut active: ResMut<ActiveWormholes>,
    mut vortex_mats: ResMut<Assets<WormholeVortexMaterial>>,
    mut grid_mats: ResMut<Assets<SpacetimeGridMaterial>>,
    mut transforms: Query<(&mut Transform, &mut Visibility), With<WormholePart>>,
    mut lights: Query<&mut PointLight>,
) {
    active.holes.clear();
    active.victims.clear();

    let Some(client) = session.client.as_ref() else {
        return;
    };
    let view = preview.on_stage(client.view());
    let t = time.elapsed_secs();
    let dt = time.delta_secs().min(0.05);

    let mut seen = Vec::new();
    for a in view.actors {
        if !view.special_abilities
            || a.driver != DRIVER
            || a.nightmare_active <= 0.0
            || a.destroyed > 0.0
            || a.inactive
            || a.afk
            || a.bomber
        {
            continue;
        }
        let rem = a.nightmare_active as f32;
        let age = (WORMHOLE_DURATION - rem).max(0.0);
        // Snappy open in 0.25s, smooth collapse in final 0.45s
        let open = (age / 0.25).clamp(0.0, 1.0);
        let close = (rem / 0.45).clamp(0.0, 1.0);
        let strength = open * close;

        let heading = a.heading as f32;
        let pos = Vec3::new(
            a.wx as f32 + heading.sin() * WORMHOLE_OFFSET,
            WORMHOLE_HEIGHT,
            a.wz as f32 + heading.cos() * WORMHOLE_OFFSET,
        );
        active.holes.push((a.id, pos, strength));
        seen.push(a.id);

        if !assets.rigs.contains_key(&a.id) {
            let vortex_mat = vortex_mats.add(WormholeVortexMaterial::default());
            let grid_mat = grid_mats.add(SpacetimeGridMaterial::default());
            let mut vortex = Entity::PLACEHOLDER;
            let mut halo = Entity::PLACEHOLDER;
            let mut grid = Entity::PLACEHOLDER;
            let mut light = Entity::PLACEHOLDER;
            let root = commands
                .spawn((
                    Mesh3d(assets.core_mesh.clone()),
                    MeshMaterial3d(assets.core_mat.clone()),
                    Transform::from_translation(pos),
                    Visibility::Visible,
                    WormholePart,
                ))
                .with_children(|parent| {
                    vortex = parent
                        .spawn((
                            Mesh3d(assets.vortex_mesh.clone()),
                            MeshMaterial3d(vortex_mat.clone()),
                            Transform::from_xyz(0.0, 0.0, 0.0),
                            Visibility::Inherited,
                            WormholePart,
                        ))
                        .id();
                    halo = parent
                        .spawn((
                            Mesh3d(assets.halo_mesh.clone()),
                            MeshMaterial3d(assets.halo_mat.clone()),
                            Transform::from_xyz(0.0, 0.0, 0.0)
                                .with_rotation(Quat::from_rotation_x(FRAC_PI_2)),
                            Visibility::Inherited,
                            WormholePart,
                        ))
                        .id();
                    grid = parent
                        .spawn((
                            Mesh3d(assets.grid_mesh.clone()),
                            MeshMaterial3d(grid_mat.clone()),
                            Transform::from_xyz(0.0, -WORMHOLE_HEIGHT + 0.24, 0.0),
                            Visibility::Inherited,
                            WormholePart,
                        ))
                        .id();
                    light = parent
                        .spawn((
                            PointLight {
                                color: Color::srgb(0.48, 0.36, 1.0),
                                intensity: 2_600_000.0,
                                range: 52.0,
                                shadow_maps_enabled: false,
                                ..default()
                            },
                            Transform::from_xyz(0.0, 2.2, 0.0),
                        ))
                        .id();
                })
                .id();
            assets.rigs.insert(
                a.id,
                WormholeRig {
                    root,
                    vortex,
                    vortex_mat,
                    halo,
                    grid,
                    grid_mat,
                    light,
                },
            );
        }

        if let Some(rig) = assets.rigs.get(&a.id) {
            let pulse = 1.0 + 0.07 * (t * 9.0).sin();
            if let Ok((mut tf, mut vis)) = transforms.get_mut(rig.root) {
                tf.translation = pos;
                tf.scale = Vec3::splat(strength.max(0.01) * pulse);
                *vis = Visibility::Visible;
            }
            if let Ok((mut vtf, _)) = transforms.get_mut(rig.vortex) {
                // Tilt vortex slightly toward the horizon & spin dramatically
                vtf.rotation = Quat::from_rotation_x(0.28 * (t * 2.1).sin())
                    * Quat::from_rotation_z(0.24 * (t * 1.7).cos());
            }
            if let Ok((mut htf, _)) = transforms.get_mut(rig.halo) {
                htf.rotation = Quat::from_rotation_y(t * 2.6)
                    * Quat::from_rotation_x(FRAC_PI_2 + 0.35 * (t * 3.1).sin());
            }
            if let Ok((mut gtf, _)) = transforms.get_mut(rig.grid) {
                gtf.translation = Vec3::new(0.0, -WORMHOLE_HEIGHT + 0.24, 0.0);
            }
            if let Some(mut vmat) = vortex_mats.get_mut(&rig.vortex_mat) {
                vmat.params = Vec4::new(strength, age, rem, 0.0);
            }
            if let Some(mut gmat) = grid_mats.get_mut(&rig.grid_mat) {
                gmat.params = Vec4::new(strength * 0.9, age, rem, (age * 28.0) % 24.0);
            }
            if let Ok(mut light) = lights.get_mut(rig.light) {
                light.intensity = strength * 2_600_000.0 * pulse;
            }
        }
    }

    // Hide inactive wormhole rigs
    for (&id, rig) in &assets.rigs {
        if !seen.contains(&id) {
            if let Ok((_, mut vis)) = transforms.get_mut(rig.root) {
                *vis = Visibility::Hidden;
            }
            if let Ok(mut light) = lights.get_mut(rig.light) {
                light.intensity = 0.0;
            }
        }
    }

    // Collect every rival within 20 units of an active wormhole for generic spaghettification!
    let ActiveWormholes { holes, victims } = &mut *active;
    for &(owner_id, hole_pos, strength) in holes.iter() {
        for v in view.actors {
            if v.id == owner_id || v.destroyed > 0.0 || v.inactive || v.afk || v.bomber {
                continue;
            }
            let dx = hole_pos.x - v.wx as f32;
            let dz = hole_pos.z - v.wz as f32;
            let dist = dx.hypot(dz);
            if dist < WORMHOLE_RADIUS {
                let u = (1.0 - dist / WORMHOLE_RADIUS).clamp(0.0, 1.0);
                let weight = u * u * strength;
                victims.push((v.wx as f32, v.wz as f32, hole_pos, weight));
            }
        }
    }

    // Spawn inward-spiraling accretion streaks + victim spaghettification plasma tendrils
    if !active.holes.is_empty() {
        assets.streak_timer += dt;
        let interval = if mobile.mobile { 0.09 } else { 0.032 };
        if assets.streak_timer >= interval {
            assets.streak_timer = 0.0;
            for &(_, hole_pos, _) in &active.holes {
                let count = if mobile.mobile { 1 } else { 2 };
                for k in 0..count {
                    let ang = t * 7.3 + k as f32 * 3.14 + hole_pos.x * 0.13;
                    let radius = 14.0 + ((t * 17.0 + k as f32).sin() * 0.5 + 0.5) * 6.0;
                    let height = 0.4 + ((t * 13.0 + k as f32).cos() * 0.5 + 0.5) * 4.5;
                    let start = Vec3::new(
                        hole_pos.x + ang.cos() * radius,
                        height,
                        hole_pos.z + ang.sin() * radius,
                    );
                    commands.spawn((
                        Mesh3d(assets.streak_mesh.clone()),
                        MeshMaterial3d(if k == 0 {
                            assets.streak_cyan_mat.clone()
                        } else {
                            assets.streak_violet_mat.clone()
                        }),
                        Transform::from_translation(start).with_scale(Vec3::new(0.18, 0.18, 1.2)),
                        WormholePart,
                        AccretionStreak {
                            target: hole_pos,
                            angle: ang,
                            radius,
                            height,
                            age: 0.0,
                            life: 0.45,
                        },
                    ));
                }
            }
            // Extra glowing tidal tendrils ripping off any spaghettifying victim straight into the core!
            for &(vx, vz, hole_pos, weight) in &active.victims {
                if weight < 0.05 {
                    continue;
                }
                let start = Vec3::new(vx, 1.6, vz);
                let to_hole = hole_pos - start;
                let ang = to_hole.z.atan2(to_hole.x) + std::f32::consts::PI;
                commands.spawn((
                    Mesh3d(assets.streak_mesh.clone()),
                    MeshMaterial3d(assets.streak_cyan_mat.clone()),
                    Transform::from_translation(start)
                        .looking_to(to_hole.normalize_or_zero(), Vec3::Y)
                        .with_scale(Vec3::new(0.16, 0.16, 1.8 + weight * 2.4)),
                    WormholePart,
                    AccretionStreak {
                        target: hole_pos,
                        angle: ang,
                        radius: to_hole.xz().length(),
                        height: 1.6,
                        age: 0.0,
                        life: 0.28,
                    },
                ));
            }
        }
    }
}

/// Generic dynamic spaghettification pass for ALL characters (rigged GLBs,
/// static Blender karts, and ported browser meshes). Runs in `PostUpdate` right
/// before `TransformSystems::Propagate` so every victim within 20 units of a
/// wormhole stretches into a spinning tidal noodle toward the event horizon!
fn spaghettify_racers(
    time: Res<Time>,
    active: Res<ActiveWormholes>,
    mut roots: Query<
        &mut Transform,
        (
            With<Children>,
            Without<ChildOf>,
            Without<WormholePart>,
            Without<Camera>,
            Without<PointLight>,
        ),
    >,
) {
    if active.victims.is_empty() {
        return;
    }
    let t = time.elapsed_secs();
    for mut tf in &mut roots {
        // Match any racer root entity positioned at a victim's world (wx, wz)
        let Some(&(_, _, hole_pos, w)) = active.victims.iter().find(|&&(vx, vz, _, _)| {
            (tf.translation.x - vx).abs() < 0.75 && (tf.translation.z - vz).abs() < 0.75
        }) else {
            continue;
        };
        if w <= 0.01 {
            continue;
        }
        let to_hole = hole_pos - tf.translation;
        let dist = to_hole.length();
        if dist < 0.1 {
            continue;
        }
        let pull_dir = to_hole / dist;

        // 1. Lift slightly off the ground toward the swirling event horizon
        tf.translation += to_hole * (0.18 * w);
        tf.translation.y = tf.translation.y.lerp(hole_pos.y, 0.55 * w);

        // 2. Swing the character's forward (+Z) axis into the tidal pull vector
        //    and spiral-spin around it as they get yanked into the singularity!
        let look_rot = Transform::from_translation(tf.translation)
            .looking_to(pull_dir, Vec3::Y)
            .rotation;
        // `looking_to` aligns -Z with pull_dir; flip by PI so +Z faces the hole
        let face_hole = look_rot * Quat::from_rotation_y(std::f32::consts::PI);
        let swirl = Quat::from_rotation_z(w * w * 10.0 + t * 9.5 * w);
        tf.rotation = tf.rotation.slerp(face_hole * swirl, (w * 1.35).clamp(0.0, 1.0));

        // 3. True tidal spaghettification: elongate dramatically along the pull axis
        //    (+Z in the rotated frame) and squash thin perpendicularly!
        let stretch = 1.0 + 3.8 * w.powf(1.2);
        let thin = (1.0 - 0.76 * w).max(0.20);
        tf.scale = Vec3::new(tf.scale.x * thin, tf.scale.y * thin, tf.scale.z * stretch);
    }
}

fn tick_streaks(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(Entity, &mut AccretionStreak, &mut Transform)>,
) {
    let dt = time.delta_secs().min(0.05);
    for (ent, mut s, mut tf) in &mut q {
        s.age += dt;
        if s.age >= s.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = (s.age / s.life).clamp(0.0, 1.0);
        let r = s.radius * (1.0 - u).powf(1.4);
        let ang = s.angle + u * 5.2;
        let y = s.height + (s.target.y - s.height) * u;
        let next = Vec3::new(s.target.x + ang.cos() * r, y, s.target.z + ang.sin() * r);
        let move_dir = (next - tf.translation).normalize_or_zero();
        tf.translation = next;
        if move_dir.length_squared() > 0.01 {
            tf.look_to(move_dir, Vec3::Y);
        }
        let stretch = 0.8 + u * 2.8;
        let thin = (1.0 - u * 0.75).max(0.08);
        tf.scale = Vec3::new(0.18 * thin, 0.18 * thin, stretch);
    }
}
