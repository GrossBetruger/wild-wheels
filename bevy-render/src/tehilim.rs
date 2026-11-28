//! Uplifted Tehilim vs Tilim 3D presentation (Sefer Tehilim PBR `.glb` + luminous
//! sapphire-gold protective aura & arena pickup):
//! - Replaces the legacy 6-book ported clip with ONE heirloom Blender PBR Sefer
//!   Tehilim (`models/tehilim_book.glb`, with embossed gold Hebrew Bible lettering
//!   `תהילים` on both covers) orbiting smoothly in a mathematically seamless loop.
//! - Analytic comet trail of golden-sapphire sparks + pulsing protective halo ring
//!   locked to the exact same `ORBIT_PERIOD` so there is zero loop seam.
//! - Same PBR book hovers & rotates smoothly over Tehilim arena pickups.
use crate::{MobileGraphics, Presentation, app::GameSession, scene};
use bevy::prelude::*;
use std::collections::HashSet;
use std::f32::consts::TAU;

/// Exact seconds per full orbit of the single protective Sefer Tehilim.
pub const ORBIT_PERIOD: f32 = 2.4;
/// Horizontal orbit radius around the protected racer.
pub const ORBIT_RADIUS: f32 = 3.7;
/// Base height above the racer's ground/jump plane.
pub const ORBIT_HEIGHT: f32 = 2.15;
/// Vertical sinusoidal hover amplitude (2 cycles per orbit, closes at `TAU`).
pub const ORBIT_BOB: f32 = 0.34;
/// Final wind-down fade duration in seconds (matches gameplay `tehilim` fade).
pub const WIND_DOWN: f32 = 1.5;
/// Number of analytic trailing sparks following the single book along its orbit.
pub const TRAIL_SPARKS: usize = 12;
/// Exact seconds per full rotation of a Tehilim arena pickup (2x bob period).
pub const PICKUP_SPIN_PERIOD: f32 = 3.6;
pub const PICKUP_BOB_PERIOD: f32 = 1.8;

pub struct TehilimPlugin;

impl Plugin for TehilimPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup).add_systems(
            Update,
            sync_tehilim.after(scene::sync).in_set(Presentation),
        );
    }
}

#[derive(Resource)]
struct TehilimAssets {
    book: Handle<WorldAsset>,
    ring_mesh: Handle<Mesh>,
    ring_mat: Handle<StandardMaterial>,
    spark_mesh: Handle<Mesh>,
    spark_gold_mat: Handle<StandardMaterial>,
    spark_blue_mat: Handle<StandardMaterial>,
    pad_mesh: Handle<Mesh>,
    pad_mat: Handle<StandardMaterial>,
    pad_ring_mesh: Handle<Mesh>,
    pad_ring_mat: Handle<StandardMaterial>,
}

#[derive(Component)]
struct TehilimAuraRig {
    racer_id: usize,
    book: Entity,
    ring: Entity,
    light: Entity,
    sparks: Vec<Entity>,
}

#[derive(Component)]
struct TehilimPickupRig {
    supply_id: u32,
    book: Entity,
    ring: Entity,
}

#[derive(Component)]
struct TehilimPart;

/// Computes the exact local `(position, rotation, uniform_scale)` of the single
/// orbiting Sefer Tehilim at orbital `phase` (radians, period `TAU`) and
/// `strength` (`0.0..=1.0`). Strictly periodic in `phase` mod `TAU`.
pub fn orbit_pose(phase: f32, strength: f32) -> (Vec3, Quat, f32) {
    let s = strength.clamp(0.0, 1.0);
    let pos = Vec3::new(
        phase.sin() * ORBIT_RADIUS,
        ORBIT_HEIGHT + (phase * 2.0).sin() * ORBIT_BOB,
        phase.cos() * ORBIT_RADIUS,
    );
    // Front cover (+Z in tehilim_book.glb) faces outward from the racer so the
    // embossed gold "תהילים" cover catches the chase camera as it sweeps past.
    let rot = Quat::from_rotation_y(phase)
        * Quat::from_rotation_x(phase.sin() * 0.09)
        * Quat::from_rotation_z((phase * 2.0).cos() * 0.06);
    let scale = s.sqrt();
    (pos, rot, scale)
}

/// Computes the exact local `(position, scale)` of trailing spark `index`
/// (`0..TRAIL_SPARKS`) behind the orbiting book at `phase` and `strength`.
pub fn trail_spark_pose(phase: f32, index: usize, strength: f32) -> (Vec3, f32) {
    let frac = (index + 1) as f32 / (TRAIL_SPARKS as f32 + 1.0);
    let a = phase - frac * 1.45;
    let radial = ORBIT_RADIUS + (a * 3.0 + index as f32).sin() * 0.14 * frac;
    let y = ORBIT_HEIGHT + (a * 2.0).sin() * ORBIT_BOB + (a * 4.0).cos() * 0.16 * frac;
    let scale = (1.0 - frac * 0.78) * strength.clamp(0.0, 1.0);
    (Vec3::new(a.sin() * radial, y, a.cos() * radial), scale)
}

/// Computes the exact local `(position, rotation)` of a hovering Tehilim arena
/// pickup at elapsed time `t`. Strictly periodic over `PICKUP_SPIN_PERIOD`.
pub fn pickup_pose(t: f32) -> (Vec3, Quat) {
    let spin = (t / PICKUP_SPIN_PERIOD).rem_euclid(1.0) * TAU;
    let bob = (t / PICKUP_BOB_PERIOD).rem_euclid(1.0) * TAU;
    let pos = Vec3::new(0.0, 2.05 + bob.sin() * 0.28, 0.0);
    let rot = Quat::from_rotation_y(spin) * Quat::from_rotation_x(0.10);
    (pos, rot)
}

fn setup(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let book = assets.load(GltfAssetLabel::Scene(0).from_asset("models/tehilim_book.glb"));
    let ring_mesh = meshes.add(
        Torus::new(ORBIT_RADIUS - 0.10, ORBIT_RADIUS + 0.10)
            .mesh()
            .major_resolution(48)
            .minor_resolution(8),
    );
    let ring_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.28, 0.56, 1.0, 0.42),
        emissive: LinearRgba::new(0.45, 0.85, 2.2, 1.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    let spark_mesh = meshes.add(Sphere::new(0.18).mesh().ico(1).unwrap());
    let spark_gold_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.88, 0.45, 0.9),
        emissive: LinearRgba::new(2.8, 2.1, 0.65, 1.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    let spark_blue_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.35, 0.68, 1.0, 0.85),
        emissive: LinearRgba::new(0.65, 1.35, 3.0, 1.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    let pad_mesh = meshes.add(Cylinder::new(2.6, 0.05));
    let pad_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.22, 0.42, 0.82, 0.48),
        emissive: LinearRgba::new(0.18, 0.35, 0.95, 1.0),
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        ..default()
    });
    let pad_ring_mesh = meshes.add(
        Torus::new(2.60, 2.78)
            .mesh()
            .major_resolution(36)
            .minor_resolution(6),
    );
    let pad_ring_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.95, 0.80, 0.38, 0.72),
        emissive: LinearRgba::new(1.5, 1.15, 0.38, 1.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });

    commands.insert_resource(TehilimAssets {
        book,
        ring_mesh,
        ring_mat,
        spark_mesh,
        spark_gold_mat,
        spark_blue_mat,
        pad_mesh,
        pad_mat,
        pad_ring_mesh,
        pad_ring_mat,
    });
}

fn sync_tehilim(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    mobile: Res<MobileGraphics>,
    assets: Res<TehilimAssets>,
    mut auras: Query<(&TehilimAuraRig, &mut Transform, &mut Visibility), Without<TehilimPart>>,
    mut pickups: Query<
        (&TehilimPickupRig, &mut Transform, &mut Visibility),
        (Without<TehilimAuraRig>, Without<TehilimPart>),
    >,
    mut parts: Query<(&mut Transform, &mut Visibility), With<TehilimPart>>,
    mut lights: Query<&mut PointLight, With<TehilimPart>>,
) {
    let Some(client) = session.client.as_ref() else {
        for (_, _, mut vis) in &mut auras {
            *vis = Visibility::Hidden;
        }
        for (_, _, mut vis) in &mut pickups {
            *vis = Visibility::Hidden;
        }
        return;
    };

    let view = client.view();
    let t = time.elapsed_secs();
    let base_phase = (t / ORBIT_PERIOD).rem_euclid(1.0) * TAU;
    let spark_budget = mobile.detail(TRAIL_SPARKS, [8, 6, 4, 0]);
    let show_light = !mobile.mobile;

    // 1. Sync single-book protective aura per shielded racer.
    let mut active_racers = HashSet::new();
    for a in view.actors {
        if a.inactive || a.afk || a.bomber || a.destroyed > 0.0 || a.tehilim <= 0.0 {
            continue;
        }
        active_racers.insert(a.id);
        let strength = (a.tehilim as f32 / WIND_DOWN).clamp(0.0, 1.0);
        let gy = view.arena_def.ground_height(a.wx, a.wz) as f32;
        let jump_h = scene::somersault(a.driver, a.somersault).0;
        let root_tf = Transform::from_xyz(a.wx as f32, gy + jump_h, a.wz as f32);
        // Deterministic per-racer phase offset so two shielded racers don't sync identically.
        let phase = (base_phase + a.id as f32 * 1.13).rem_euclid(TAU);
        let (book_pos, book_rot, book_scale) = orbit_pose(phase, strength);
        let ring_pulse = 1.0 + 0.025 * (phase * 2.0).sin();

        if let Some((rig, mut tf, mut vis)) =
            auras.iter_mut().find(|(r, _, _)| r.racer_id == a.id)
        {
            *tf = root_tf;
            *vis = Visibility::Visible;
            if let Ok((mut btf, mut bvis)) = parts.get_mut(rig.book) {
                *bvis = Visibility::Inherited;
                btf.translation = book_pos;
                btf.rotation = book_rot;
                btf.scale = Vec3::splat(book_scale);
            }
            if let Ok((mut rtf, mut rvis)) = parts.get_mut(rig.ring) {
                *rvis = Visibility::Inherited;
                rtf.translation = Vec3::new(0.0, 0.35, 0.0);
                rtf.scale = Vec3::new(ring_pulse * book_scale, book_scale, ring_pulse * book_scale);
            }
            if let Ok((mut ltf, mut lvis)) = parts.get_mut(rig.light) {
                ltf.translation = book_pos;
                *lvis = if show_light && a.id == view.you {
                    Visibility::Inherited
                } else {
                    Visibility::Hidden
                };
            }
            if let Ok(mut pl) = lights.get_mut(rig.light) {
                pl.intensity = 180.0 * strength;
            }
            for (idx, &spark_ent) in rig.sparks.iter().enumerate() {
                if let Ok((mut stf, mut svis)) = parts.get_mut(spark_ent) {
                    if idx < spark_budget {
                        let (spos, sscale) = trail_spark_pose(phase, idx, strength);
                        *svis = Visibility::Inherited;
                        stf.translation = spos;
                        stf.scale = Vec3::splat(sscale);
                    } else {
                        *svis = Visibility::Hidden;
                    }
                }
            }
        } else {
            let book = commands
                .spawn((
                    WorldAssetRoot(assets.book.clone()),
                    Transform::from_translation(book_pos)
                        .with_rotation(book_rot)
                        .with_scale(Vec3::splat(book_scale)),
                    Visibility::Inherited,
                    TehilimPart,
                ))
                .id();
            let ring = commands
                .spawn((
                    Mesh3d(assets.ring_mesh.clone()),
                    MeshMaterial3d(assets.ring_mat.clone()),
                    Transform::from_xyz(0.0, 0.35, 0.0),
                    Visibility::Inherited,
                    TehilimPart,
                ))
                .id();
            let light = commands
                .spawn((
                    PointLight {
                        color: Color::srgb(0.65, 0.80, 1.0),
                        intensity: 180.0 * strength,
                        range: 14.0,
                        shadow_maps_enabled: false,
                        ..default()
                    },
                    Transform::from_translation(book_pos),
                    if show_light && a.id == view.you {
                        Visibility::Inherited
                    } else {
                        Visibility::Hidden
                    },
                    TehilimPart,
                ))
                .id();
            let mut sparks = Vec::with_capacity(TRAIL_SPARKS);
            for idx in 0..TRAIL_SPARKS {
                let (spos, sscale) = trail_spark_pose(phase, idx, strength);
                let mat = if idx % 2 == 0 {
                    assets.spark_gold_mat.clone()
                } else {
                    assets.spark_blue_mat.clone()
                };
                let ent = commands
                    .spawn((
                        Mesh3d(assets.spark_mesh.clone()),
                        MeshMaterial3d(mat),
                        Transform::from_translation(spos).with_scale(Vec3::splat(sscale)),
                        if idx < spark_budget {
                            Visibility::Inherited
                        } else {
                            Visibility::Hidden
                        },
                        TehilimPart,
                    ))
                    .id();
                sparks.push(ent);
            }
            let root = commands
                .spawn((
                    TehilimAuraRig {
                        racer_id: a.id,
                        book,
                        ring,
                        light,
                        sparks: sparks.clone(),
                    },
                    root_tf,
                    Visibility::Visible,
                ))
                .id();
            commands.entity(root).add_children(&[book, ring, light]);
            commands.entity(root).add_children(&sparks);
        }
    }
    for (rig, _, mut vis) in &mut auras {
        if !active_racers.contains(&rig.racer_id) {
            *vis = Visibility::Hidden;
        }
    }

    // 2. Sync uplifted Tehilim arena pickups.
    let mut active_supplies = HashSet::new();
    for supply in view
        .supplies
        .iter()
        .filter(|s| s.kind == "tehilim" && s.cooldown <= 0.0)
    {
        active_supplies.insert(supply.id);
        let gy = view.arena_def.ground_height(supply.wx, supply.wz) as f32;
        let root_tf = Transform::from_xyz(supply.wx as f32, gy, supply.wz as f32);
        let (book_pos, book_rot) = pickup_pose(t + supply.id as f32 * 0.41);
        let pulse = 1.0 + 0.04 * ((t / PICKUP_BOB_PERIOD).rem_euclid(1.0) * TAU).sin();

        if let Some((rig, mut tf, mut vis)) =
            pickups.iter_mut().find(|(r, _, _)| r.supply_id == supply.id)
        {
            *tf = root_tf;
            *vis = Visibility::Visible;
            if let Ok((mut btf, mut bvis)) = parts.get_mut(rig.book) {
                *bvis = Visibility::Inherited;
                btf.translation = book_pos;
                btf.rotation = book_rot;
            }
            if let Ok((mut rtf, mut rvis)) = parts.get_mut(rig.ring) {
                *rvis = Visibility::Inherited;
                rtf.scale = Vec3::new(pulse, 1.0, pulse);
            }
        } else {
            let book = commands
                .spawn((
                    WorldAssetRoot(assets.book.clone()),
                    Transform::from_translation(book_pos).with_rotation(book_rot),
                    Visibility::Inherited,
                    TehilimPart,
                ))
                .id();
            let pad = commands
                .spawn((
                    Mesh3d(assets.pad_mesh.clone()),
                    MeshMaterial3d(assets.pad_mat.clone()),
                    Transform::from_xyz(0.0, 0.08, 0.0),
                    Visibility::Inherited,
                    TehilimPart,
                ))
                .id();
            let ring = commands
                .spawn((
                    Mesh3d(assets.pad_ring_mesh.clone()),
                    MeshMaterial3d(assets.pad_ring_mat.clone()),
                    Transform::from_xyz(0.0, 0.14, 0.0),
                    Visibility::Inherited,
                    TehilimPart,
                ))
                .id();
            let root = commands
                .spawn((
                    TehilimPickupRig {
                        supply_id: supply.id,
                        book,
                        ring,
                    },
                    root_tf,
                    Visibility::Visible,
                ))
                .id();
            commands.entity(root).add_children(&[book, pad, ring]);
        }
    }
    for (rig, _, mut vis) in &mut pickups {
        if !active_supplies.contains(&rig.supply_id) {
            *vis = Visibility::Hidden;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tehilim_orbit_is_a_perfect_seamless_loop() {
        let (p0, r0, s0) = orbit_pose(0.0, 1.0);
        let (p1, r1, s1) = orbit_pose(TAU, 1.0);
        assert!((p0 - p1).length() < 1e-5, "orbit position must close seamlessly: {p0:?} vs {p1:?}");
        assert!(r0.angle_between(r1) < 1e-5, "orbit rotation must close seamlessly");
        assert!((s0 - s1).abs() < 1e-6);

        for idx in 0..TRAIL_SPARKS {
            let (sp0, ss0) = trail_spark_pose(0.0, idx, 1.0);
            let (sp1, ss1) = trail_spark_pose(TAU, idx, 1.0);
            assert!((sp0 - sp1).length() < 1e-5, "spark {idx} must close seamlessly");
            assert!((ss0 - ss1).abs() < 1e-6);
        }

        let (pp0, pr0) = pickup_pose(0.0);
        let (pp1, pr1) = pickup_pose(PICKUP_SPIN_PERIOD);
        assert!((pp0 - pp1).length() < 1e-5, "pickup hover must close seamlessly");
        assert!(pr0.angle_between(pr1) < 1e-5, "pickup spin must close seamlessly");
    }

    #[test]
    fn tehilim_wind_down_shrinks_smoothly_to_zero() {
        let (_, _, full) = orbit_pose(1.0, 1.0);
        let (_, _, half) = orbit_pose(1.0, 0.5);
        let (_, _, done) = orbit_pose(1.0, 0.0);
        assert!((full - 1.0).abs() < 1e-6);
        assert!(half > 0.0 && half < full);
        assert_eq!(done, 0.0);
    }
}
