//! R-Yeah (#11) as an articulated Blender PBR Bell 206 JetRanger helicopter + hanging lion:
//! - Bell 206 JetRanger with spinning main rotor (tilts forward on boost + translucent blur disc)
//!   and fast-spinning tail rotor
//! - Always-mounted 6-barrel rotary Vulcan cannon under the Bell 206 belly (muzzle at local
//!   `(1.3, 4.56, 3.05)`), spinning up with fiery muzzle flash & dynamic light whenever firing!
//! - Heroic hanging lion pilot gripping the left skid, with a lush 44-lock flowing golden-amber
//!   mane billowing dynamically in rotor downwash, speed, boost, and turns!
//! - Ground rotor-wash dust & golden sparkle rings when boosting or somersaulting.
use crate::{MobileGraphics, Presentation, app::GameSession, ported, scene};
use bevy::gltf::GltfAssetLabel;
use bevy::prelude::*;
use std::collections::HashSet;
use std::f32::consts::{PI, TAU};

pub const DRIVER: usize = 11;

/// Exact local-space position of the Bell 206 Vulcan cannon muzzle crown.
/// Used by `scene.rs` to align R-Yeah's hedgehogs so they stream straight out of the barrel!
pub const VULCAN_MUZZLE_LOCAL: Vec3 = Vec3::new(1.3, 4.56, 3.05);

/// Main rotor mast top & tail rotor hub offsets in R-Yeah's local space.
const MAIN_ROTOR_OFFSET: Vec3 = Vec3::new(1.3, 4.5 + 6.15 * 0.6, -0.4 - 0.2 * 0.6);
const TAIL_ROTOR_OFFSET: Vec3 = Vec3::new(1.3 + 0.26 * 0.6, 4.5 + 3.8 * 0.6, -0.4 - 6.1 * 0.6);
const VULCAN_SOCKET: Vec3 = Vec3::new(1.3, 4.56, 1.50);

/// Local-space center of the hanging lion's head (matching `hanging_pt(0, 4.02, 0.30)`).
fn hanging_lion_local(x: f32, y: f32, z: f32) -> Vec3 {
    let (c, s) = (0.27_f32.cos(), 0.27_f32.sin());
    let (cp, sp) = (0.18_f32.cos(), 0.18_f32.sin());
    let x = x + 0.85;
    let y = y - 5.15;
    let xx = x * c - y * s;
    let yy = x * s + y * c;
    Vec3::new(0.05 + xx, 4.48 + yy * cp - z * sp, 0.05 + yy * sp + z * cp)
}

/// Hover bob height matching `lionChopper` in `client/renderer.js`.
pub fn hover_height(time_secs: f32) -> f32 {
    0.18 + (time_secs * 3.0).sin() * 0.08
}

pub struct RYeahPlugin;

impl Plugin for RYeahPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, load).add_systems(
            Update,
            (fly_ryeah, tick_rotor_wash)
                .chain()
                .after(scene::sync)
                .in_set(Presentation),
        );
    }
}

#[derive(Resource)]
struct RYeahAssets {
    chopper: Handle<WorldAsset>,
    main_rotor: Handle<WorldAsset>,
    tail_rotor: Handle<WorldAsset>,
    vulcan_barrels: Handle<WorldAsset>,
    lion: Handle<WorldAsset>,
    mane_lock_mesh: Handle<Mesh>,
    mane_mats: [Handle<StandardMaterial>; 4],
    rotor_blur_mesh: Handle<Mesh>,
    rotor_blur_mat: Handle<StandardMaterial>,
    muzzle_flash_mesh: Handle<Mesh>,
    muzzle_outer_mat: Handle<StandardMaterial>,
    muzzle_core_mat: Handle<StandardMaterial>,
    wash_mesh: Handle<Mesh>,
    wash_dust_mat: Handle<StandardMaterial>,
    wash_gold_mat: Handle<StandardMaterial>,
}

struct ManeLockSlot {
    entity: Entity,
    base_pos: Vec3,
    ring: u8,
    angle: f32,
    phase: f32,
    base_scale: f32,
}

#[derive(Component)]
struct RYeahRig {
    id: usize,
    main_rotor: Entity,
    rotor_blur: Entity,
    tail_rotor: Entity,
    vulcan_barrels: Entity,
    muzzle_outer: Entity,
    muzzle_core: Entity,
    muzzle_light: Option<Entity>,
    mane_locks: Vec<ManeLockSlot>,
    rotor_angle: f32,
    rotor_tilt: f32,
    vulcan_angle: f32,
    vulcan_rpm: f32,
    prev_heading: f32,
    turn_swing: f32,
    wash_timer: f32,
}

#[derive(Component)]
struct RotorWashPuff {
    vel: Vec3,
    age: f32,
    life: f32,
    start_scale: f32,
    end_scale: f32,
}

/// Procedural slender, silky lion-mane fur tuft rooted at `(0,0,0)` extending along `-Z`.
/// Fine taper (0.78 units long, ~0.12 half-width) so 64 overlapping tufts read as a
/// cohesive, regal lion's mane rather than thick spikes!
fn build_mane_lock_mesh() -> Mesh {
    let steps: [(f32, f32, f32, f32); 6] = [
        (0.00, 0.00, 0.115, 0.095),
        (-0.14, 0.025, 0.128, 0.102),
        (-0.30, 0.015, 0.105, 0.082),
        (-0.48, -0.018, 0.072, 0.056),
        (-0.64, -0.022, 0.036, 0.028),
        (-0.76, -0.008, 0.010, 0.009),
    ];
    let segs = 6usize;
    let mut positions: Vec<[f32; 3]> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();

    for &(gz, gy, rx, ry) in &steps {
        for k in 0..segs {
            let a = (k as f32) * TAU / (segs as f32);
            positions.push([a.cos() * rx, gy + a.sin() * ry, gz]);
        }
    }
    let tip_idx = positions.len() as u32;
    positions.push([0.0, 0.0, -0.82]);

    for r in 0..(steps.len() - 1) {
        let base0 = (r * segs) as u32;
        let base1 = ((r + 1) * segs) as u32;
        for k in 0..segs {
            let kn = ((k + 1) % segs) as u32;
            let k = k as u32;
            indices.extend_from_slice(&[base0 + k, base1 + k, base1 + kn]);
            indices.extend_from_slice(&[base0 + k, base1 + kn, base0 + kn]);
        }
    }
    let last_base = ((steps.len() - 1) * segs) as u32;
    for k in 0..segs {
        let kn = ((k + 1) % segs) as u32;
        let k = k as u32;
        indices.extend_from_slice(&[last_base + k, tip_idx, last_base + kn]);
    }

    let mut mesh = Mesh::new(
        bevy::mesh::PrimitiveTopology::TriangleList,
        bevy::asset::RenderAssetUsages::RENDER_WORLD,
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_indices(bevy::mesh::Indices::U32(indices));
    mesh.compute_smooth_normals();
    mesh
}

fn load(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let part = |name: &str| {
        assets.load(GltfAssetLabel::Scene(0).from_asset(format!("models/ryeah_{name}.glb")))
    };

    // 4 rich warm golden-chestnut-honey PBR mane tiers with subtle sunlit sheen!
    let mane_mats = [
        materials.add(StandardMaterial {
            base_color: Color::srgb(0.55, 0.27, 0.12),
            perceptual_roughness: 0.56,
            metallic: 0.04,
            ..default()
        }),
        materials.add(StandardMaterial {
            base_color: Color::srgb(0.70, 0.37, 0.15),
            perceptual_roughness: 0.52,
            metallic: 0.05,
            ..default()
        }),
        materials.add(StandardMaterial {
            base_color: Color::srgb(0.84, 0.50, 0.19),
            emissive: LinearRgba::rgb(0.06, 0.025, 0.005),
            perceptual_roughness: 0.46,
            metallic: 0.08,
            ..default()
        }),
        materials.add(StandardMaterial {
            base_color: Color::srgb(0.95, 0.68, 0.27),
            emissive: LinearRgba::rgb(0.14, 0.075, 0.015),
            perceptual_roughness: 0.40,
            metallic: 0.12,
            ..default()
        }),
    ];

    commands.insert_resource(RYeahAssets {
        chopper: part("chopper"),
        main_rotor: part("main_rotor"),
        tail_rotor: part("tail_rotor"),
        vulcan_barrels: part("vulcan_barrels"),
        lion: part("lion"),
        mane_lock_mesh: meshes.add(build_mane_lock_mesh()),
        mane_mats,
        rotor_blur_mesh: meshes.add(Cylinder::new(4.7 * 0.6, 0.03)),
        rotor_blur_mat: materials.add(StandardMaterial {
            base_color: Color::srgba(0.18, 0.28, 0.42, 0.18),
            emissive: LinearRgba::rgb(0.22, 0.18, 0.08),
            unlit: true,
            alpha_mode: AlphaMode::Blend,
            cull_mode: None,
            ..default()
        }),
        muzzle_flash_mesh: meshes.add(Cone::new(0.42, 1.35)),
        muzzle_outer_mat: materials.add(StandardMaterial {
            base_color: Color::srgba(1.0, 0.58, 0.10, 0.92),
            emissive: LinearRgba::rgb(10.0, 4.5, 0.6),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            cull_mode: None,
            ..default()
        }),
        muzzle_core_mat: materials.add(StandardMaterial {
            base_color: Color::srgba(1.0, 0.96, 0.72, 0.98),
            emissive: LinearRgba::rgb(16.0, 13.0, 5.5),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            cull_mode: None,
            ..default()
        }),
        wash_mesh: meshes.add(Sphere::new(0.55).mesh().uv(8, 6)),
        wash_dust_mat: materials.add(StandardMaterial {
            base_color: Color::srgba(0.78, 0.76, 0.66, 0.26),
            emissive: LinearRgba::rgb(0.24, 0.19, 0.11),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            cull_mode: None,
            ..default()
        }),
        wash_gold_mat: materials.add(StandardMaterial {
            base_color: Color::srgba(1.0, 0.80, 0.34, 0.65),
            emissive: LinearRgba::rgb(3.2, 2.1, 0.45),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            cull_mode: None,
            ..default()
        }),
    });
}

fn fly_ryeah(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    mobile: Res<MobileGraphics>,
    assets: Option<Res<RYeahAssets>>,
    mut rigs: Query<(Entity, &mut RYeahRig, &mut Transform, &mut Visibility)>,
    mut parts: Query<(&mut Transform, &mut Visibility), (Without<RYeahRig>, Without<PointLight>)>,
    mut lights: Query<&mut PointLight>,
) {
    let Some(assets) = assets else { return };
    let Some(client) = session.client.as_ref() else {
        return;
    };
    let view = client.view();
    let t = time.elapsed_secs();
    let dt = time.delta_secs().min(0.05);
    let mut alive = HashSet::new();

    for a in view.actors {
        if a.driver != DRIVER || a.inactive || a.afk || a.bomber || a.destroyed > 0.0 {
            continue;
        }
        alive.insert(a.id);

        let (som_h, som_pitch, som_roll, som_yaw) = scene::somersault(a.driver, a.somersault);
        let hover = hover_height(t);
        let boost = a.boost > 0.0;
        let speed_norm = (a.speed.abs() as f32 / 520.0).clamp(0.0, 1.35);
        // Subtle nose-down helicopter forward cyclic pitch when accelerating/boosting
        let cyclic_pitch = if a.somersault <= 0.0 {
            if boost { 0.14 } else { 0.05 * speed_norm }
        } else {
            0.0
        };
        let tf = ported::placement(
            Vec3::new(a.wx as f32, som_h + hover, a.wz as f32),
            a.heading as f32 + som_yaw,
            som_pitch + cyclic_pitch,
            som_roll,
        );

        // Detect active hedgehog firing (either Vulcan rapid-fire or freshly spawned hedgehog)
        let recently_fired = view.projectiles.iter().any(|p| {
            p.owner == a.id && p.kind == "hedgehog" && p.age < 0.095
        });
        let vulcan_active = a.vulcan > 0.0;

        if let Some((_, mut rig, mut root_tf, mut root_vis)) =
            rigs.iter_mut().find(|(_, r, _, _)| r.id == a.id)
        {
            *root_tf = tf;
            *root_vis = Visibility::Visible;

            // Track turning rate for mane centrifugal whip!
            let dh = (a.heading as f32 - rig.prev_heading)
                .sin()
                .atan2((a.heading as f32 - rig.prev_heading).cos());
            rig.prev_heading = a.heading as f32;
            let turn_target = if dt > 0.001 {
                ((dh / dt) * 0.22).clamp(-0.65, 0.65)
            } else {
                0.0
            };
            rig.turn_swing += (turn_target - rig.turn_swing) * (1.0 - (-dt * 8.0).exp());

            // 1. Main & tail rotors (forward cyclic tilt on boost)
            let target_tilt = if boost { 0.26 } else { 0.04 * speed_norm };
            rig.rotor_tilt += (target_tilt - rig.rotor_tilt) * (1.0 - (-dt * 10.0).exp());
            rig.rotor_angle = (rig.rotor_angle + dt * if boost { 52.0 } else { 30.0 }) % TAU;

            if let Ok((mut rtf, _)) = parts.get_mut(rig.main_rotor) {
                rtf.rotation = Quat::from_rotation_x(rig.rotor_tilt)
                    * Quat::from_rotation_y(rig.rotor_angle);
            }
            if let Ok((mut btf, _)) = parts.get_mut(rig.rotor_blur) {
                btf.rotation = Quat::from_rotation_x(rig.rotor_tilt);
            }
            if let Ok((mut ttf, _)) = parts.get_mut(rig.tail_rotor) {
                ttf.rotation = Quat::from_rotation_x(rig.rotor_angle * 3.0);
            }

            // 2. Always-mounted Bell 206 6-barrel Vulcan spin & muzzle flash
            let target_rpm = if vulcan_active || recently_fired {
                44.0
            } else {
                2.2
            };
            rig.vulcan_rpm += (target_rpm - rig.vulcan_rpm) * (1.0 - (-dt * 12.0).exp());
            rig.vulcan_angle = (rig.vulcan_angle + dt * rig.vulcan_rpm) % TAU;
            if let Ok((mut vtf, _)) = parts.get_mut(rig.vulcan_barrels) {
                vtf.rotation = Quat::from_rotation_z(rig.vulcan_angle);
            }

            let flash_on = recently_fired;
            let flash_flicker = 0.82 + (t * 95.0).sin() * 0.26;
            for (ent, scale_mul) in [(rig.muzzle_outer, 1.0_f32), (rig.muzzle_core, 0.62)] {
                if let Ok((mut ftf, mut fvis)) = parts.get_mut(ent) {
                    if flash_on {
                        *fvis = Visibility::Inherited;
                        ftf.rotation = Quat::from_rotation_x(PI * 0.5)
                            * Quat::from_rotation_y(t * 47.0);
                        ftf.scale = Vec3::new(
                            scale_mul * flash_flicker,
                            scale_mul * (0.9 + flash_flicker * 0.4),
                            scale_mul * flash_flicker,
                        );
                    } else {
                        *fvis = Visibility::Hidden;
                    }
                }
            }
            if let Some(light_ent) = rig.muzzle_light
                && let Ok(mut light) = lights.get_mut(light_ent)
            {
                light.intensity = if flash_on {
                    320_000.0 * flash_flicker
                } else {
                    0.0
                };
            }

            // 3. COHESIVE REGAL LION'S MANE!
            // Spatially coherent traveling wind wave (adjacent tufts ripple together cleanly
            // instead of thrashing randomly), sweeping back gently with speed/boost & turns.
            let wind_freq = if boost { 13.5 } else { 6.5 + speed_norm * 3.5 };
            let wave_amp = if boost { 0.16 } else { 0.075 + speed_norm * 0.04 };
            let length_stretch = if boost {
                1.30
            } else {
                0.95 + speed_norm * 0.16
            };
            let downwash_pitch = if boost { 0.06 } else { -0.04 };
            for slot in &rig.mane_locks {
                if let Ok((mut mtf, _)) = parts.get_mut(slot.entity) {
                    let ring_f = slot.ring as f32;
                    let w1 = (t * wind_freq - slot.phase).sin();
                    let w2 = (t * (wind_freq * 1.45) - slot.phase * 1.3 + ring_f * 0.6).cos();
                    // Clean radial lion-mane crown flare (wider around face ruff, sleeker at back)
                    let flare = (0.14 + ring_f * 0.11) * if boost { 0.72 } else { 1.0 };

                    let yaw_out = -slot.angle.sin() * flare + w1 * wave_amp + rig.turn_swing * 0.65;
                    let pitch_out =
                        slot.angle.cos() * flare + downwash_pitch + w2 * (wave_amp * 0.65);

                    mtf.translation = slot.base_pos;
                    mtf.rotation = Quat::from_euler(EulerRot::YXZ, yaw_out, pitch_out, slot.angle);
                    let pulse = 1.0 + w2 * 0.045;
                    mtf.scale = Vec3::new(
                        slot.base_scale,
                        slot.base_scale,
                        slot.base_scale * length_stretch * pulse,
                    );
                }
            }

            // 4. Rotor-wash ground dust & golden sparkles during boost or somersault (desktop)
            if !mobile.mobile && (boost || a.somersault > 0.0) {
                rig.wash_timer += dt;
                if rig.wash_timer >= 0.04 {
                    rig.wash_timer = 0.0;
                    let count = if boost { 3 } else { 2 };
                    for k in 0..count {
                        let ang = t * 5.5 + (k as f32) * 2.094 + (a.id as f32);
                        let dir = Vec3::new(ang.cos(), 0.0, ang.sin());
                        let pos = Vec3::new(a.wx as f32, 0.25, a.wz as f32) + dir * 1.1;
                        let is_gold = k == 0;
                        commands.spawn((
                            Mesh3d(assets.wash_mesh.clone()),
                            MeshMaterial3d(if is_gold {
                                assets.wash_gold_mat.clone()
                            } else {
                                assets.wash_dust_mat.clone()
                            }),
                            Transform::from_translation(pos).with_scale(Vec3::splat(if is_gold {
                                0.24
                            } else {
                                0.55
                            })),
                            RotorWashPuff {
                                vel: dir * (11.0 + (k as f32) * 2.5) + Vec3::Y * (1.2 + (k as f32) * 0.4),
                                age: 0.0,
                                life: if is_gold { 0.34 } else { 0.48 },
                                start_scale: if is_gold { 0.24 } else { 0.55 },
                                end_scale: if is_gold { 0.04 } else { 1.85 },
                            },
                        ));
                    }
                }
            }
        } else {
            // Spawn full articulated R-Yeah rig!
            let mut main_rotor = Entity::PLACEHOLDER;
            let mut rotor_blur = Entity::PLACEHOLDER;
            let mut tail_rotor = Entity::PLACEHOLDER;
            let mut vulcan_barrels = Entity::PLACEHOLDER;
            let mut muzzle_outer = Entity::PLACEHOLDER;
            let mut muzzle_core = Entity::PLACEHOLDER;
            let mut muzzle_light = None;
            let mut mane_locks = Vec::new();

            let head_center = hanging_lion_local(0.0, 4.02, 0.30);

            // Desktop: 64 fine overlapping fur tufts across 4 concentric spherical dome rings
            // forming a clean, lush, unmistakable lion's mane crown!
            // Mobile: 22 tufts across 2 rings for crisp mobile perf.
            let ring_specs: &[(u8, usize, f32, f32, f32)] = if mobile.mobile {
                &[
                    (0, 9, 0.42, -0.30, 1.02),
                    (1, 13, 0.88, 0.14, 1.05),
                ]
            } else {
                &[
                    (0, 10, 0.28, -0.44, 0.92),
                    (1, 14, 0.56, -0.32, 0.98),
                    (2, 18, 0.78, -0.10, 1.04),
                    (3, 22, 0.94, 0.16, 1.00),
                ]
            };

            let root = commands
                .spawn((WorldAssetRoot(assets.chopper.clone()), tf))
                .with_children(|parent| {
                    parent.spawn((WorldAssetRoot(assets.lion.clone()), Transform::IDENTITY));

                    main_rotor = parent
                        .spawn((
                            WorldAssetRoot(assets.main_rotor.clone()),
                            Transform::from_translation(MAIN_ROTOR_OFFSET),
                        ))
                        .id();
                    rotor_blur = parent
                        .spawn((
                            Mesh3d(assets.rotor_blur_mesh.clone()),
                            MeshMaterial3d(assets.rotor_blur_mat.clone()),
                            Transform::from_translation(MAIN_ROTOR_OFFSET + Vec3::Y * 0.02),
                        ))
                        .id();
                    tail_rotor = parent
                        .spawn((
                            WorldAssetRoot(assets.tail_rotor.clone()),
                            Transform::from_translation(TAIL_ROTOR_OFFSET),
                        ))
                        .id();
                    vulcan_barrels = parent
                        .spawn((
                            WorldAssetRoot(assets.vulcan_barrels.clone()),
                            Transform::from_translation(VULCAN_SOCKET),
                        ))
                        .id();
                    muzzle_outer = parent
                        .spawn((
                            Mesh3d(assets.muzzle_flash_mesh.clone()),
                            MeshMaterial3d(assets.muzzle_outer_mat.clone()),
                            Transform::from_translation(VULCAN_MUZZLE_LOCAL + Vec3::Z * 0.55),
                            Visibility::Hidden,
                        ))
                        .id();
                    muzzle_core = parent
                        .spawn((
                            Mesh3d(assets.muzzle_flash_mesh.clone()),
                            MeshMaterial3d(assets.muzzle_core_mat.clone()),
                            Transform::from_translation(VULCAN_MUZZLE_LOCAL + Vec3::Z * 0.36),
                            Visibility::Hidden,
                        ))
                        .id();
                    if !mobile.mobile {
                        muzzle_light = Some(
                            parent
                                .spawn((
                                    PointLight {
                                        color: Color::srgb(1.0, 0.72, 0.25),
                                        intensity: 0.0,
                                        range: 20.0,
                                        shadow_maps_enabled: false,
                                        ..default()
                                    },
                                    Transform::from_translation(VULCAN_MUZZLE_LOCAL + Vec3::Z * 0.6),
                                ))
                                .id(),
                        );
                    }

                    // Spawn concentric spherical rings of fine golden-amber lion mane tufts!
                    let mut idx = 0usize;
                    for &(ring, count, rad, z_off, base_scale) in ring_specs {
                        for i in 0..count {
                            let angle = (i as f32) * TAU / (count as f32) + (ring as f32) * 0.28;
                            let base_pos = head_center
                                + Vec3::new(angle.sin() * rad, angle.cos() * rad, z_off);
                            // Darker chestnut inner rings transitioning to sunlit golden-amber outer crown
                            let mat_idx = ((ring as usize) + (i % 2)).min(3);
                            let mat = assets.mane_mats[mat_idx].clone();
                            let ent = parent
                                .spawn((
                                    Mesh3d(assets.mane_lock_mesh.clone()),
                                    MeshMaterial3d(mat),
                                    Transform::from_translation(base_pos),
                                ))
                                .id();
                            // Spatially coherent phase so wind ripples smoothly across the mane!
                            let phase = (ring as f32) * 0.75 + angle.sin() * 1.35 + angle.cos() * 0.55;
                            mane_locks.push(ManeLockSlot {
                                entity: ent,
                                base_pos,
                                ring,
                                angle,
                                phase,
                                base_scale,
                            });
                            idx += 1;
                        }
                    }
                    let _ = idx;
                })
                .id();

            commands.entity(root).insert(RYeahRig {
                id: a.id,
                main_rotor,
                rotor_blur,
                tail_rotor,
                vulcan_barrels,
                muzzle_outer,
                muzzle_core,
                muzzle_light,
                mane_locks,
                rotor_angle: 0.0,
                rotor_tilt: 0.0,
                vulcan_angle: 0.0,
                vulcan_rpm: 2.2,
                prev_heading: a.heading as f32,
                turn_swing: 0.0,
                wash_timer: 0.0,
            });
        }
    }

    for (entity, rig, _, mut vis) in &mut rigs {
        if !alive.contains(&rig.id) {
            *vis = Visibility::Hidden;
            if let Some(light_ent) = rig.muzzle_light
                && let Ok(mut light) = lights.get_mut(light_ent)
            {
                light.intensity = 0.0;
            }
            if !view.actors.iter().any(|a| a.id == rig.id && a.driver == DRIVER) {
                commands.entity(entity).despawn();
            }
        }
    }
}

fn tick_rotor_wash(
    mut commands: Commands,
    time: Res<Time>,
    mut puffs: Query<(Entity, &mut RotorWashPuff, &mut Transform)>,
) {
    let dt = time.delta_secs().min(0.05);
    for (ent, mut puff, mut tf) in &mut puffs {
        puff.age += dt;
        if puff.age >= puff.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = puff.age / puff.life;
        tf.translation += puff.vel * dt;
        puff.vel *= (1.0 - dt * 2.5).max(0.0);
        let s = puff.start_scale + (puff.end_scale - puff.start_scale) * u;
        tf.scale = Vec3::splat(s.max(0.01));
    }
}
