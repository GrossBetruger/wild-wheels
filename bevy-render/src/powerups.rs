//! Uplifted 3D PBR arena powerups (`missile`, `hedgehog`, `boost`, `health`):
//! - Renders each pickup with its dedicated Blender 5.3 PBR `.glb` hovering and
//!   rotating smoothly on a mathematically seamless `3.2s` loop (2x `1.6s` bob).
//! - Adds a color-coded luminous ground beacon pad, pulsing additive outer halo
//!   ring, and 4 analytic rising energy motes so pickups read unmistakably from
//!   across the arena.
use crate::{MobileGraphics, Presentation, app::GameSession, scene};
use bevy::prelude::*;
use std::collections::HashSet;
use std::f32::consts::TAU;

/// Exact seconds per full rotation of an arena powerup (exact 2x `BOB_PERIOD`).
pub const SPIN_PERIOD: f32 = 3.2;
/// Exact seconds per vertical hover cycle.
pub const BOB_PERIOD: f32 = 1.6;
/// Number of analytic rising energy motes orbiting each powerup.
pub const MOTE_COUNT: usize = 4;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum PowerupKind {
    Missile,
    Hedgehog,
    Boost,
    Health,
}

impl PowerupKind {
    pub fn from_str(kind: &str) -> Option<Self> {
        match kind {
            "missile" => Some(Self::Missile),
            "hedgehog" => Some(Self::Hedgehog),
            "boost" => Some(Self::Boost),
            "health" => Some(Self::Health),
            _ => None,
        }
    }

    fn hover_height(self) -> f32 {
        match self {
            Self::Missile => 2.15,
            Self::Hedgehog => 1.75,
            Self::Boost => 1.95,
            Self::Health => 1.95,
        }
    }
}

pub struct PowerupsPlugin;

impl Plugin for PowerupsPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup).add_systems(
            Update,
            sync_powerups.after(scene::sync).in_set(Presentation),
        );
    }
}

struct KindVisuals {
    model: Handle<WorldAsset>,
    pad_mat: Handle<StandardMaterial>,
    ring_mat: Handle<StandardMaterial>,
    mote_mat: Handle<StandardMaterial>,
}

#[derive(Resource)]
struct PowerupAssets {
    missile: KindVisuals,
    hedgehog: KindVisuals,
    boost: KindVisuals,
    health: KindVisuals,
    pad_mesh: Handle<Mesh>,
    ring_mesh: Handle<Mesh>,
    mote_mesh: Handle<Mesh>,
}

impl PowerupAssets {
    fn visuals(&self, kind: PowerupKind) -> &KindVisuals {
        match kind {
            PowerupKind::Missile => &self.missile,
            PowerupKind::Hedgehog => &self.hedgehog,
            PowerupKind::Boost => &self.boost,
            PowerupKind::Health => &self.health,
        }
    }
}

#[derive(Component)]
struct PowerupRig {
    supply_id: u32,
    kind: PowerupKind,
    model: Entity,
    pad: Entity,
    ring: Entity,
    motes: Vec<Entity>,
}

#[derive(Component)]
struct PowerupPart;

/// Exact local `(position, rotation)` of a hovering powerup at time `t`.
/// Strictly periodic over `SPIN_PERIOD`.
pub fn pickup_pose(kind: PowerupKind, t: f32) -> (Vec3, Quat) {
    let spin = (t / SPIN_PERIOD).rem_euclid(1.0) * TAU;
    let bob = (t / BOB_PERIOD).rem_euclid(1.0) * TAU;
    let pos = Vec3::new(0.0, kind.hover_height() + bob.sin() * 0.28, 0.0);
    let rot = Quat::from_rotation_y(spin);
    (pos, rot)
}

/// Exact local `(position, uniform_scale)` of rising energy mote `index` at time `t`.
/// Strictly periodic over `SPIN_PERIOD`.
pub fn mote_pose(index: usize, t: f32) -> (Vec3, f32) {
    let frac = ((t / BOB_PERIOD) + index as f32 / MOTE_COUNT as f32).rem_euclid(1.0);
    let angle = (t / SPIN_PERIOD).rem_euclid(1.0) * TAU + index as f32 * (TAU / MOTE_COUNT as f32);
    let radius = 1.65 - frac * 0.45;
    let y = 0.25 + frac * 2.65;
    let scale = (frac * std::f32::consts::PI).sin() * 0.85;
    (Vec3::new(angle.sin() * radius, y, angle.cos() * radius), scale)
}

fn make_kind(
    assets: &AssetServer,
    materials: &mut Assets<StandardMaterial>,
    path: &'static str,
    pad_rgb: [f32; 3],
    emissive_rgb: [f32; 3],
) -> KindVisuals {
    KindVisuals {
        model: assets.load(GltfAssetLabel::Scene(0).from_asset(path)),
        pad_mat: materials.add(StandardMaterial {
            base_color: Color::srgba(pad_rgb[0], pad_rgb[1], pad_rgb[2], 0.48),
            emissive: LinearRgba::new(
                emissive_rgb[0] * 0.45,
                emissive_rgb[1] * 0.45,
                emissive_rgb[2] * 0.45,
                1.0,
            ),
            unlit: true,
            alpha_mode: AlphaMode::Blend,
            ..default()
        }),
        ring_mat: materials.add(StandardMaterial {
            base_color: Color::srgba(emissive_rgb[0], emissive_rgb[1], emissive_rgb[2], 0.72),
            emissive: LinearRgba::new(
                emissive_rgb[0] * 1.5,
                emissive_rgb[1] * 1.5,
                emissive_rgb[2] * 1.5,
                1.0,
            ),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            ..default()
        }),
        mote_mat: materials.add(StandardMaterial {
            base_color: Color::srgba(emissive_rgb[0], emissive_rgb[1], emissive_rgb[2], 0.9),
            emissive: LinearRgba::new(
                emissive_rgb[0] * 2.2,
                emissive_rgb[1] * 2.2,
                emissive_rgb[2] * 2.2,
                1.0,
            ),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            ..default()
        }),
    }
}

fn setup(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let missile = make_kind(
        &assets,
        &mut materials,
        "models/pickup_missile.glb",
        [0.82, 0.28, 0.24],
        [1.0, 0.36, 0.28],
    );
    let hedgehog = make_kind(
        &assets,
        &mut materials,
        "models/pickup_hedgehog.glb",
        [0.76, 0.60, 0.36],
        [0.98, 0.78, 0.42],
    );
    let boost = make_kind(
        &assets,
        &mut materials,
        "models/pickup_boost.glb",
        [0.88, 0.72, 0.22],
        [1.0, 0.84, 0.28],
    );
    let health = make_kind(
        &assets,
        &mut materials,
        "models/pickup_health.glb",
        [0.32, 0.78, 0.52],
        [0.32, 0.98, 0.62],
    );
    let pad_mesh = meshes.add(Cylinder::new(2.55, 0.05));
    let ring_mesh = meshes.add(
        Torus::new(2.55, 2.73)
            .mesh()
            .major_resolution(36)
            .minor_resolution(6),
    );
    let mote_mesh = meshes.add(Sphere::new(0.14).mesh().ico(1).unwrap());

    commands.insert_resource(PowerupAssets {
        missile,
        hedgehog,
        boost,
        health,
        pad_mesh,
        ring_mesh,
        mote_mesh,
    });
}

fn sync_powerups(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    mobile: Res<MobileGraphics>,
    assets: Res<PowerupAssets>,
    mut rigs: Query<(&mut PowerupRig, &mut Transform, &mut Visibility), Without<PowerupPart>>,
    mut parts: Query<(&mut Transform, &mut Visibility), With<PowerupPart>>,
) {
    let Some(client) = session.client.as_ref() else {
        for (_, _, mut vis) in &mut rigs {
            *vis = Visibility::Hidden;
        }
        return;
    };

    let view = client.view();
    let t = time.elapsed_secs();
    let mote_budget = mobile.detail(MOTE_COUNT, [2, 2, 0, 0]);
    let mut active = HashSet::new();

    for supply in view.supplies.iter().filter(|s| s.cooldown <= 0.0) {
        let Some(kind) = PowerupKind::from_str(&supply.kind) else {
            continue;
        };
        active.insert(supply.id);
        let gy = view.arena_def.ground_height(supply.wx, supply.wz) as f32;
        let root_tf = Transform::from_xyz(supply.wx as f32, gy, supply.wz as f32);
        let local_t = t + supply.id as f32 * 0.37;
        let (pos, rot) = pickup_pose(kind, local_t);
        let pulse = 1.0 + 0.045 * ((local_t / BOB_PERIOD).rem_euclid(1.0) * TAU).sin();
        let vis_set = assets.visuals(kind);

        if let Some((mut rig, mut tf, mut vis)) =
            rigs.iter_mut().find(|(r, _, _)| r.supply_id == supply.id)
        {
            *tf = root_tf;
            *vis = Visibility::Visible;
            if rig.kind != kind {
                rig.kind = kind;
                commands
                    .entity(rig.model)
                    .insert(WorldAssetRoot(vis_set.model.clone()));
                commands
                    .entity(rig.pad)
                    .insert(MeshMaterial3d(vis_set.pad_mat.clone()));
                commands
                    .entity(rig.ring)
                    .insert(MeshMaterial3d(vis_set.ring_mat.clone()));
                for &mote in &rig.motes {
                    commands
                        .entity(mote)
                        .insert(MeshMaterial3d(vis_set.mote_mat.clone()));
                }
            }
            if let Ok((mut mtf, mut mvis)) = parts.get_mut(rig.model) {
                *mvis = Visibility::Inherited;
                mtf.translation = pos;
                mtf.rotation = rot;
            }
            if let Ok((mut rtf, mut rvis)) = parts.get_mut(rig.ring) {
                *rvis = Visibility::Inherited;
                rtf.scale = Vec3::new(pulse, 1.0, pulse);
            }
            for (idx, &mote) in rig.motes.iter().enumerate() {
                if let Ok((mut stf, mut svis)) = parts.get_mut(mote) {
                    if idx < mote_budget {
                        let (mpos, mscale) = mote_pose(idx, local_t);
                        *svis = Visibility::Inherited;
                        stf.translation = mpos;
                        stf.scale = Vec3::splat(mscale);
                    } else {
                        *svis = Visibility::Hidden;
                    }
                }
            }
        } else {
            let model = commands
                .spawn((
                    WorldAssetRoot(vis_set.model.clone()),
                    Transform::from_translation(pos).with_rotation(rot),
                    Visibility::Inherited,
                    PowerupPart,
                ))
                .id();
            let pad = commands
                .spawn((
                    Mesh3d(assets.pad_mesh.clone()),
                    MeshMaterial3d(vis_set.pad_mat.clone()),
                    Transform::from_xyz(0.0, 0.08, 0.0),
                    Visibility::Inherited,
                    PowerupPart,
                ))
                .id();
            let ring = commands
                .spawn((
                    Mesh3d(assets.ring_mesh.clone()),
                    MeshMaterial3d(vis_set.ring_mat.clone()),
                    Transform::from_xyz(0.0, 0.14, 0.0),
                    Visibility::Inherited,
                    PowerupPart,
                ))
                .id();
            let mut motes = Vec::with_capacity(MOTE_COUNT);
            for idx in 0..MOTE_COUNT {
                let (mpos, mscale) = mote_pose(idx, local_t);
                let ent = commands
                    .spawn((
                        Mesh3d(assets.mote_mesh.clone()),
                        MeshMaterial3d(vis_set.mote_mat.clone()),
                        Transform::from_translation(mpos).with_scale(Vec3::splat(mscale)),
                        if idx < mote_budget {
                            Visibility::Inherited
                        } else {
                            Visibility::Hidden
                        },
                        PowerupPart,
                    ))
                    .id();
                motes.push(ent);
            }
            let root = commands
                .spawn((
                    PowerupRig {
                        supply_id: supply.id,
                        kind,
                        model,
                        pad,
                        ring,
                        motes: motes.clone(),
                    },
                    root_tf,
                    Visibility::Visible,
                ))
                .id();
            commands.entity(root).add_children(&[model, pad, ring]);
            commands.entity(root).add_children(&motes);
        }
    }

    for (rig, _, mut vis) in &mut rigs {
        if !active.contains(&rig.supply_id) {
            *vis = Visibility::Hidden;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powerup_loops_close_seamlessly() {
        for kind in [
            PowerupKind::Missile,
            PowerupKind::Hedgehog,
            PowerupKind::Boost,
            PowerupKind::Health,
        ] {
            let (p0, r0) = pickup_pose(kind, 0.0);
            let (p1, r1) = pickup_pose(kind, SPIN_PERIOD);
            assert!((p0 - p1).length() < 1e-5);
            assert!(r0.angle_between(r1) < 1e-5);
        }
        for idx in 0..MOTE_COUNT {
            let (m0, s0) = mote_pose(idx, 0.0);
            let (m1, s1) = mote_pose(idx, SPIN_PERIOD);
            assert!((m0 - m1).length() < 1e-5);
            assert!((s0 - s1).abs() < 1e-5);
        }
    }
}
