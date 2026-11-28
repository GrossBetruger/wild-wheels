//! Uplifted Hedgeguard 3D presentation (armored PBR heater shield + per-character
//! special-ability emblems + luminous turquoise-gold protective aura & pickup):
//! - Replaces the legacy 6-icon ported clip with ONE heirloom Blender PBR
//!   Hedgeguard shield (`models/hedgeguard_shield.glb`) mounted with a bespoke 3D
//!   emblem for every character with a special ability (drivers 5, 7–15) and a
//!   spiky Aegis crest for non-special racers and arena pickups (no cross).
//! - Orbits smoothly in a mathematically seamless `2.4s` loop, phase-shifted by
//!   `PI` from Tehilim so both shields orbit 180° opposite in harmony when active
//!   together.
use crate::{MobileGraphics, Presentation, app::GameSession, scene};
use bevy::prelude::*;
use std::collections::{HashMap, HashSet};
use std::f32::consts::{PI, TAU};

/// Exact seconds per full orbit (matches Tehilim; offset by `PI` so both shields harmonize).
pub const ORBIT_PERIOD: f32 = 2.4;
/// Horizontal orbit radius around the protected racer.
pub const ORBIT_RADIUS: f32 = 3.7;
/// Base height above the racer's ground/jump plane.
pub const ORBIT_HEIGHT: f32 = 2.15;
/// Vertical sinusoidal hover amplitude (2 cycles per orbit, closes at `TAU`).
pub const ORBIT_BOB: f32 = 0.34;
/// Final wind-down fade duration in seconds (matches gameplay `hedgeShield` fade).
pub const WIND_DOWN: f32 = 1.5;
/// Number of analytic trailing sparks following the single shield along its orbit.
pub const TRAIL_SPARKS: usize = 12;
/// Exact seconds per full rotation of a Hedgeguard arena pickup (2x bob period).
pub const PICKUP_SPIN_PERIOD: f32 = 3.6;
pub const PICKUP_BOB_PERIOD: f32 = 1.8;

/// Drivers that have a special ability and therefore a bespoke 3D shield emblem.
pub const SPECIAL_EMBLEM_DRIVERS: [usize; 10] = [5, 7, 8, 9, 10, 11, 12, 13, 14, 15];

pub struct HedgeguardPlugin;

impl Plugin for HedgeguardPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup).add_systems(
            Update,
            sync_hedgeguard.after(scene::sync).in_set(Presentation),
        );
    }
}

#[derive(Resource)]
struct HedgeguardAssets {
    shield: Handle<WorldAsset>,
    default_emblem: Handle<WorldAsset>,
    emblems: HashMap<usize, Handle<WorldAsset>>,
    ring_mesh: Handle<Mesh>,
    ring_mat: Handle<StandardMaterial>,
    spark_mesh: Handle<Mesh>,
    spark_teal_mat: Handle<StandardMaterial>,
    spark_gold_mat: Handle<StandardMaterial>,
}

impl HedgeguardAssets {
    fn emblem_for(&self, driver: usize) -> Handle<WorldAsset> {
        self.emblems
            .get(&driver)
            .cloned()
            .unwrap_or_else(|| self.default_emblem.clone())
    }
}

#[derive(Component)]
struct HedgeguardAuraRig {
    racer_id: usize,
    driver: usize,
    shield: Entity,
    emblem: Entity,
    ring: Entity,
    light: Entity,
    sparks: Vec<Entity>,
}

#[derive(Component)]
struct HedgeguardPickupRig {
    supply_id: u32,
    shield: Entity,
}

#[derive(Component)]
struct HedgeguardPart;

/// Computes the exact local `(position, rotation, uniform_scale)` of the single
/// orbiting Hedgeguard shield at orbital `phase` (radians, period `TAU`) and
/// `strength` (`0.0..=1.0`). Strictly periodic in `phase` mod `TAU`.
pub fn orbit_pose(phase: f32, strength: f32) -> (Vec3, Quat, f32) {
    let s = strength.clamp(0.0, 1.0);
    let pos = Vec3::new(
        phase.sin() * ORBIT_RADIUS,
        ORBIT_HEIGHT + (phase * 2.0).sin() * ORBIT_BOB,
        phase.cos() * ORBIT_RADIUS,
    );
    // Front face (+Z) faces outward from the racer so the character's emblem
    // sweeps clearly across the chase camera.
    let rot = Quat::from_rotation_y(phase)
        * Quat::from_rotation_x(phase.sin() * 0.08)
        * Quat::from_rotation_z((phase * 2.0).cos() * 0.05);
    let scale = s.sqrt();
    (pos, rot, scale)
}

/// Computes the exact local `(position, scale)` of trailing spark `index`
/// (`0..TRAIL_SPARKS`) behind the orbiting shield at `phase` and `strength`.
pub fn trail_spark_pose(phase: f32, index: usize, strength: f32) -> (Vec3, f32) {
    let frac = (index + 1) as f32 / (TRAIL_SPARKS as f32 + 1.0);
    let a = phase - frac * 1.45;
    let radial = ORBIT_RADIUS + (a * 3.0 + index as f32).sin() * 0.14 * frac;
    let y = ORBIT_HEIGHT + (a * 2.0).sin() * ORBIT_BOB + (a * 4.0).cos() * 0.16 * frac;
    let scale = (1.0 - frac * 0.78) * strength.clamp(0.0, 1.0);
    (Vec3::new(a.sin() * radial, y, a.cos() * radial), scale)
}

/// Computes the exact local `(position, rotation)` of a hovering Hedgeguard
/// arena pickup at elapsed time `t`. Strictly periodic over `PICKUP_SPIN_PERIOD`.
pub fn pickup_pose(t: f32) -> (Vec3, Quat) {
    let spin = (t / PICKUP_SPIN_PERIOD).rem_euclid(1.0) * TAU;
    let bob = (t / PICKUP_BOB_PERIOD).rem_euclid(1.0) * TAU;
    let pos = Vec3::new(0.0, 2.05 + bob.sin() * 0.28, 0.0);
    let rot = Quat::from_rotation_y(spin) * Quat::from_rotation_x(0.08);
    (pos, rot)
}

fn setup(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let shield = assets.load(GltfAssetLabel::Scene(0).from_asset("models/hedgeguard_shield.glb"));
    let default_emblem =
        assets.load(GltfAssetLabel::Scene(0).from_asset("models/hedgeguard_emblem_default.glb"));
    let mut emblems = HashMap::new();
    for driver in SPECIAL_EMBLEM_DRIVERS {
        emblems.insert(
            driver,
            assets.load(
                GltfAssetLabel::Scene(0)
                    .from_asset(format!("models/hedgeguard_emblem_{driver}.glb")),
            ),
        );
    }

    let ring_mesh = meshes.add(
        Torus::new(ORBIT_RADIUS - 0.10, ORBIT_RADIUS + 0.10)
            .mesh()
            .major_resolution(48)
            .minor_resolution(8),
    );
    let ring_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.24, 0.92, 0.84, 0.42),
        emissive: LinearRgba::new(0.30, 1.95, 1.75, 1.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    let spark_mesh = meshes.add(Sphere::new(0.18).mesh().ico(1).unwrap());
    let spark_teal_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.32, 0.96, 0.88, 0.9),
        emissive: LinearRgba::new(0.42, 2.6, 2.3, 1.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    let spark_gold_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.88, 0.45, 0.85),
        emissive: LinearRgba::new(2.5, 1.9, 0.58, 1.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    commands.insert_resource(HedgeguardAssets {
        shield,
        default_emblem,
        emblems,
        ring_mesh,
        ring_mat,
        spark_mesh,
        spark_teal_mat,
        spark_gold_mat,
    });
}

fn sync_hedgeguard(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    mobile: Res<MobileGraphics>,
    assets: Res<HedgeguardAssets>,
    mut auras: Query<
        (&mut HedgeguardAuraRig, &mut Transform, &mut Visibility),
        Without<HedgeguardPart>,
    >,
    mut pickups: Query<
        (&HedgeguardPickupRig, &mut Transform, &mut Visibility),
        (Without<HedgeguardAuraRig>, Without<HedgeguardPart>),
    >,
    mut parts: Query<(&mut Transform, &mut Visibility), With<HedgeguardPart>>,
    mut lights: Query<&mut PointLight, With<HedgeguardPart>>,
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
    // Phase-shifted by PI from Tehilim so both shields orbit 180° opposite when active together.
    let base_phase = ((t / ORBIT_PERIOD).rem_euclid(1.0) * TAU + PI).rem_euclid(TAU);
    let spark_budget = mobile.detail(TRAIL_SPARKS, [8, 6, 4, 0]);
    let show_light = !mobile.mobile;

    // 1. Sync single-shield protective aura per guarded racer.
    let mut active_racers = HashSet::new();
    for a in view.actors {
        if a.inactive || a.afk || a.bomber || a.destroyed > 0.0 || a.hedge_shield <= 0.0 {
            continue;
        }
        active_racers.insert(a.id);
        let strength = (a.hedge_shield as f32 / WIND_DOWN).clamp(0.0, 1.0);
        let gy = view.arena_def.ground_height(a.wx, a.wz) as f32;
        let jump_h = scene::somersault(a.driver, a.somersault).0;
        let root_tf = Transform::from_xyz(a.wx as f32, gy + jump_h, a.wz as f32);
        let phase = (base_phase + a.id as f32 * 1.13).rem_euclid(TAU);
        let (shield_pos, shield_rot, shield_scale) = orbit_pose(phase, strength);
        let ring_pulse = 1.0 + 0.025 * (phase * 2.0).sin();

        if let Some((mut rig, mut tf, mut vis)) =
            auras.iter_mut().find(|(r, _, _)| r.racer_id == a.id)
        {
            *tf = root_tf;
            *vis = Visibility::Visible;
            if rig.driver != a.driver {
                rig.driver = a.driver;
                commands
                    .entity(rig.emblem)
                    .insert(WorldAssetRoot(assets.emblem_for(a.driver)));
            }
            if let Ok((mut stf, mut svis)) = parts.get_mut(rig.shield) {
                *svis = Visibility::Inherited;
                stf.translation = shield_pos;
                stf.rotation = shield_rot;
                stf.scale = Vec3::splat(shield_scale);
            }
            if let Ok((mut rtf, mut rvis)) = parts.get_mut(rig.ring) {
                *rvis = Visibility::Inherited;
                rtf.translation = Vec3::new(0.0, 0.25, 0.0);
                rtf.scale =
                    Vec3::new(ring_pulse * shield_scale, shield_scale, ring_pulse * shield_scale);
            }
            if let Ok((mut ltf, mut lvis)) = parts.get_mut(rig.light) {
                ltf.translation = shield_pos;
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
            let emblem = commands
                .spawn((
                    WorldAssetRoot(assets.emblem_for(a.driver)),
                    Transform::IDENTITY,
                    Visibility::Inherited,
                    HedgeguardPart,
                ))
                .id();
            let shield = commands
                .spawn((
                    WorldAssetRoot(assets.shield.clone()),
                    Transform::from_translation(shield_pos)
                        .with_rotation(shield_rot)
                        .with_scale(Vec3::splat(shield_scale)),
                    Visibility::Inherited,
                    HedgeguardPart,
                ))
                .id();
            commands.entity(shield).add_child(emblem);
            let ring = commands
                .spawn((
                    Mesh3d(assets.ring_mesh.clone()),
                    MeshMaterial3d(assets.ring_mat.clone()),
                    Transform::from_xyz(0.0, 0.25, 0.0),
                    Visibility::Inherited,
                    HedgeguardPart,
                ))
                .id();
            let light = commands
                .spawn((
                    PointLight {
                        color: Color::srgb(0.45, 0.96, 0.88),
                        intensity: 180.0 * strength,
                        range: 14.0,
                        shadow_maps_enabled: false,
                        ..default()
                    },
                    Transform::from_translation(shield_pos),
                    if show_light && a.id == view.you {
                        Visibility::Inherited
                    } else {
                        Visibility::Hidden
                    },
                    HedgeguardPart,
                ))
                .id();
            let mut sparks = Vec::with_capacity(TRAIL_SPARKS);
            for idx in 0..TRAIL_SPARKS {
                let (spos, sscale) = trail_spark_pose(phase, idx, strength);
                let mat = if idx % 2 == 0 {
                    assets.spark_teal_mat.clone()
                } else {
                    assets.spark_gold_mat.clone()
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
                        HedgeguardPart,
                    ))
                    .id();
                sparks.push(ent);
            }
            let root = commands
                .spawn((
                    HedgeguardAuraRig {
                        racer_id: a.id,
                        driver: a.driver,
                        shield,
                        emblem,
                        ring,
                        light,
                        sparks: sparks.clone(),
                    },
                    root_tf,
                    Visibility::Visible,
                ))
                .id();
            commands.entity(root).add_children(&[shield, ring, light]);
            commands.entity(root).add_children(&sparks);
        }
    }
    for (rig, _, mut vis) in &mut auras {
        if !active_racers.contains(&rig.racer_id) {
            *vis = Visibility::Hidden;
        }
    }

    // 2. Sync uplifted Hedgeguard arena pickups.
    let mut active_supplies = HashSet::new();
    for supply in view
        .supplies
        .iter()
        .filter(|s| s.kind == "hedgeproof" && s.cooldown <= 0.0)
    {
        active_supplies.insert(supply.id);
        let gy = view.arena_def.ground_height(supply.wx, supply.wz) as f32;
        let root_tf = Transform::from_xyz(supply.wx as f32, gy, supply.wz as f32);
        let (shield_pos, shield_rot) = pickup_pose(t + supply.id as f32 * 0.41);

        if let Some((rig, mut tf, mut vis)) =
            pickups.iter_mut().find(|(r, _, _)| r.supply_id == supply.id)
        {
            *tf = root_tf;
            *vis = Visibility::Visible;
            if let Ok((mut stf, mut svis)) = parts.get_mut(rig.shield) {
                *svis = Visibility::Inherited;
                stf.translation = shield_pos;
                stf.rotation = shield_rot;
            }
        } else {
            let emblem = commands
                .spawn((
                    WorldAssetRoot(assets.default_emblem.clone()),
                    Transform::IDENTITY,
                    Visibility::Inherited,
                    HedgeguardPart,
                ))
                .id();
            let shield = commands
                .spawn((
                    WorldAssetRoot(assets.shield.clone()),
                    Transform::from_translation(shield_pos).with_rotation(shield_rot),
                    Visibility::Inherited,
                    HedgeguardPart,
                ))
                .id();
            commands.entity(shield).add_child(emblem);
            let root = commands
                .spawn((
                    HedgeguardPickupRig {
                        supply_id: supply.id,
                        shield,
                    },
                    root_tf,
                    Visibility::Visible,
                ))
                .id();
            commands.entity(root).add_child(shield);
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
    fn hedgeguard_orbit_is_a_perfect_seamless_loop() {
        let (p0, r0, s0) = orbit_pose(0.0, 1.0);
        let (p1, r1, s1) = orbit_pose(TAU, 1.0);
        assert!((p0 - p1).length() < 1e-5);
        assert!(r0.angle_between(r1) < 1e-5);
        assert!((s0 - s1).abs() < 1e-6);

        for idx in 0..TRAIL_SPARKS {
            let (sp0, ss0) = trail_spark_pose(0.0, idx, 1.0);
            let (sp1, ss1) = trail_spark_pose(TAU, idx, 1.0);
            assert!((sp0 - sp1).length() < 1e-5);
            assert!((ss0 - ss1).abs() < 1e-6);
        }

        let (pp0, pr0) = pickup_pose(0.0);
        let (pp1, pr1) = pickup_pose(PICKUP_SPIN_PERIOD);
        assert!((pp0 - pp1).length() < 1e-5);
        assert!(pr0.angle_between(pr1) < 1e-5);
    }
}
