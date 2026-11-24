//! Pearococo (#9) as an opulent Blender PBR Rococo royal chariot + peacock queen:
//! - Spinning gilded carriage wheels (4 axles)
//! - Articulated royal right wing performing her aristocratic celebration wrist-wave
//! - 11 sculpted, cupped 3D peacock tail feathers driven by our upgraded thin-film
//!   iridescent `PlumageMaterial` shader (`plumage.wesl`), with smooth boost tail-fold,
//!   spring-damped turn swing, jewel-cut golden shaft beads, and layered 3D ocelli eyes!
//! - Swirling rose-pink, lavender-violet, and gold fairy-dust boost ribbon!
use crate::{
    MobileGraphics, Presentation,
    app::GameSession,
    plumage::{PlumageMaterial, Wind, feather_coordinates},
    ported, scene,
};
use bevy::animation::graph::AnimationNodeIndex;
use bevy::camera::visibility::NoFrustumCulling;
use bevy::gltf::{Gltf, GltfAssetLabel};
use bevy::mesh::{MeshTag, PrimitiveTopology, morph::MorphWeights};
use bevy::prelude::*;
use std::collections::HashSet;
use std::f32::consts::{PI, TAU};

pub const DRIVER: usize = 9;

const QUEEN_CLIPS: [&str; 3] = ["poise", "wave", "boost"];
const POISE: usize = 0;
const WAVE: usize = 1;
const BOOST: usize = 2;

const WHEEL_RADIUS: f32 = 0.76;
const WHEEL_AXLES: [Vec3; 4] = [
    Vec3::new(-1.82, 0.97, -1.55),
    Vec3::new(1.82, 0.97, -1.55),
    Vec3::new(-1.82, 0.97, 1.45),
    Vec3::new(1.82, 0.97, 1.45),
];
const TAIL_ROOT: Vec3 = Vec3::new(0.0, 1.75, -1.05);

pub struct PearococoPlugin;

impl Plugin for PearococoPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, load).add_systems(
            Update,
            (rig_pearococo, drive_pearococo, tick_fairy_boost)
                .chain()
                .after(scene::sync)
                .in_set(Presentation),
        );
    }
}

#[derive(Clone)]
struct QueenMoves {
    graph: Handle<AnimationGraph>,
    clips: [AnimationNodeIndex; QUEEN_CLIPS.len()],
}

#[derive(Resource)]
struct PearococoAssets {
    chariot: Handle<WorldAsset>,
    wheel: Handle<WorldAsset>,
    queen_gltf: Handle<Gltf>,
    queen: Handle<WorldAsset>,
    moves: Option<QueenMoves>,
    feathers: [Handle<Mesh>; 11],
    plumage_mat: Handle<PlumageMaterial>,
    star_mesh: Handle<Mesh>,
    mist_mesh: Handle<Mesh>,
    star_gold: Handle<StandardMaterial>,
    star_magenta: Handle<StandardMaterial>,
    mist_pink: Handle<StandardMaterial>,
    mist_lavender: Handle<StandardMaterial>,
}

struct QueenSkeleton {
    player: Entity,
    lids: Option<Entity>,
}

#[derive(Component)]
struct PearococoRig {
    id: usize,
    queen_root: Entity,
    skeleton: Option<QueenSkeleton>,
    wheels: [Entity; 4],
    feathers: [Entity; 11],
    shimmer_light: Option<Entity>,
    spin: f32,
    fold: f32,
    prev_heading: f32,
    swing: f32,
    swing_vel: f32,
    press: f32,
    fairy_timer: f32,
    weights: [f32; QUEEN_CLIPS.len()],
    blink: f32,
}

#[derive(Component)]
struct FairySpark {
    vel: Vec3,
    spin: Vec3,
    age: f32,
    life: f32,
    start_scale: f32,
    end_scale: f32,
}

/// Builds one sculpted, 3D-cupped peacock feather mesh for index `i` (0..11),
/// complete with:
/// - 18×4 subdivided cupped iridescent blade (so `plumage.wesl` bends it silky-smooth!)
/// - Raised 24K golden rachis shaft & 9 faceted jewel beads that twinkle in the shader
/// - Layered 3D ocellus (peacock eye): gold outer halo, sapphire-teal iris, royal-magenta heart,
///   and luminous pearl catchlight on both front & back!
fn build_feather_mesh(i: usize) -> Mesh {
    let angle = (i as f32 - 5.0) * 0.23;
    let (dx, dy) = (angle.sin(), angle.cos());
    let length = 3.95 + (i % 2) as f32 * 0.18;
    let point = |t: f32, w: f32, z: f32| -> [f32; 3] {
        [dx * t + dy * w, 1.75 + dy * t - dx * w, z]
    };

    let mut positions: Vec<[f32; 3]> = Vec::new();
    let mut normals: Vec<[f32; 3]> = Vec::new();
    let mut colors: Vec<[f32; 4]> = Vec::new();

    let mut push_tri = |a: [f32; 3], b: [f32; 3], c: [f32; 3], col: [f32; 4]| {
        let va = Vec3::from_array(a);
        let vb = Vec3::from_array(b);
        let vc = Vec3::from_array(c);
        let n = (vb - va).cross(vc - va).normalize_or(Vec3::Z).to_array();
        positions.extend_from_slice(&[a, b, c]);
        normals.extend_from_slice(&[n, n, n]);
        colors.extend_from_slice(&[col, col, col]);
    };

    // 1. Cupped, high-subdivision iridescent feather blade
    // Color satisfies plumage.wesl's iridescent test: b > r * 0.85 && g > r * 1.1
    let blade_col = if i % 2 == 1 {
        [0.45, 0.76, 0.68, 1.0]
    } else {
        [0.38, 0.66, 0.72, 1.0]
    };
    let len_segs = 18usize;
    let wid_segs = 4usize;
    let sample_blade = |iu: usize, iv: usize| -> [f32; 3] {
        let t = iu as f32 / len_segs as f32;
        let s = (iv as f32 / wid_segs as f32) * 2.0 - 1.0; // -1..+1 across blade
        // Graceful peacock plume silhouette: slender stem widening into a lush teardrop crown
        let profile = (t * PI).sin().powf(0.75) * (0.55 + 0.55 * t.powf(1.4));
        let w = s * profile * 0.48;
        // Subtle 3D cupping camber across the blade so light rolls organically over the curve!
        let camber = -(1.0 - s * s) * 0.085 * profile;
        let z = -1.05 - t * 0.42 + camber;
        point(t * length, w, z)
    };
    for iu in 0..len_segs {
        for iv in 0..wid_segs {
            let p00 = sample_blade(iu, iv);
            let p10 = sample_blade(iu + 1, iv);
            let p11 = sample_blade(iu + 1, iv + 1);
            let p01 = sample_blade(iu, iv + 1);
            push_tri(p00, p10, p11, blade_col);
            push_tri(p00, p11, p01, blade_col);
        }
    }

    // Helper for small 3D faceted jewels / ocellus discs
    let mut add_oval = |cx: f32, cy: f32, cz: f32, rx: f32, ry: f32, rz: f32, col: [f32; 4], segs: usize| {
        let center_f = [cx, cy, cz + rz];
        let center_b = [cx, cy, cz - rz];
        for s in 0..segs {
            let a0 = s as f32 * TAU / segs as f32;
            let a1 = (s + 1) as f32 * TAU / segs as f32;
            let p0 = [
                cx + dx * (a0.sin() * ry) + dy * (a0.cos() * rx),
                cy + dy * (a0.sin() * ry) - dx * (a0.cos() * rx),
                cz,
            ];
            let p1 = [
                cx + dx * (a1.sin() * ry) + dy * (a1.cos() * rx),
                cy + dy * (a1.sin() * ry) - dx * (a1.cos() * rx),
                cz,
            ];
            push_tri(center_f, p0, p1, col);
            push_tri(center_b, p1, p0, col);
        }
    };

    // 2. Faceted 24K gold jewel beads along the rachis shaft (caught by plumage.wesl's jewel branch!)
    let gold_col = [0.92, 0.74, 0.38, 1.0];
    for j in 1..=9 {
        let p = point(j as f32 * length / 10.0, 0.0, -1.05 - (j as f32 / 10.0) * 0.42);
        add_oval(p[0], p[1], p[2], 0.048, 0.095, 0.055, gold_col, 6);
    }

    // 3. Multi-layered 3D ocellus (peacock eye) at 82% along the feather (both front & back)
    let eye_pos = point(length * 0.82, 0.0, -1.05 - 0.82 * 0.42);
    let teal_eye = [0.16, 0.50, 0.58, 1.0];
    let magenta_eye = [0.84, 0.44, 0.70, 1.0];
    let pearl_col = [1.0, 0.97, 0.92, 1.0];
    for side in [-1.0_f32, 1.0] {
        let z0 = eye_pos[2] + side * 0.09;
        add_oval(eye_pos[0], eye_pos[1], z0, 0.30, 0.43, 0.05, gold_col, 10);
        add_oval(eye_pos[0], eye_pos[1], z0 + side * 0.055, 0.21, 0.30, 0.035, teal_eye, 10);
        add_oval(eye_pos[0], eye_pos[1], z0 + side * 0.09, 0.115, 0.175, 0.025, magenta_eye, 8);
        add_oval(
            eye_pos[0] - 0.04 * dy + 0.08 * dx,
            eye_pos[1] + 0.04 * dx + 0.08 * dy,
            z0 + side * 0.12,
            0.055,
            0.065,
            0.02,
            pearl_col,
            6,
        );
    }

    let (uv0, uv1) = feather_coordinates(&positions);
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        bevy::asset::RenderAssetUsages::RENDER_WORLD,
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uv0);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_1, uv1);
    mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, colors);
    mesh
}

fn load(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut plumages: ResMut<Assets<PlumageMaterial>>,
) {
    let part = |name: &str| {
        assets.load(GltfAssetLabel::Scene(0).from_asset(format!("models/pearococo_{name}.glb")))
    };
    let feathers = std::array::from_fn(|i| meshes.add(build_feather_mesh(i)));
    let plumage_mat = plumages.add(PlumageMaterial {});

    commands.insert_resource(PearococoAssets {
        chariot: part("chariot"),
        wheel: part("wheel"),
        queen_gltf: assets.load("models/pearococo_queen.glb"),
        queen: part("queen"),
        moves: None,
        feathers,
        plumage_mat,
        star_mesh: meshes.add(Cuboid::new(0.26, 0.26, 0.26)),
        mist_mesh: meshes.add(Sphere::new(0.48).mesh().uv(8, 6)),
        star_gold: materials.add(StandardMaterial {
            base_color: Color::srgba(1.0, 0.90, 0.52, 1.0),
            emissive: LinearRgba::rgb(9.0, 6.4, 1.8),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            ..default()
        }),
        star_magenta: materials.add(StandardMaterial {
            base_color: Color::srgba(1.0, 0.44, 0.78, 1.0),
            emissive: LinearRgba::rgb(8.2, 2.2, 5.4),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            ..default()
        }),
        mist_pink: materials.add(StandardMaterial {
            base_color: Color::srgba(0.98, 0.54, 0.78, 0.30),
            emissive: LinearRgba::rgb(1.4, 0.42, 0.92),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            cull_mode: None,
            ..default()
        }),
        mist_lavender: materials.add(StandardMaterial {
            base_color: Color::srgba(0.76, 0.36, 0.94, 0.28),
            emissive: LinearRgba::rgb(0.95, 0.32, 1.65),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            cull_mode: None,
            ..default()
        }),
    });
}

#[allow(clippy::too_many_arguments)]
fn rig_pearococo(
    mut commands: Commands,
    assets: Option<ResMut<PearococoAssets>>,
    models: Res<Assets<Gltf>>,
    mut graphs: ResMut<Assets<AnimationGraph>>,
    mut rigs: Query<&mut PearococoRig>,
    family: Query<&Children>,
    mut players: Query<&mut AnimationPlayer>,
    morphs: Query<(), With<MorphWeights>>,
) {
    let Some(mut assets) = assets else { return };
    for mut rig in &mut rigs {
        if rig.skeleton.is_some() {
            continue;
        }
        let (mut player, mut lids) = (None, None);
        for part in family.iter_descendants(rig.queen_root) {
            if players.contains(part) {
                player = Some(part);
            }
            if morphs.contains(part) {
                lids = Some(part);
            }
        }
        let Some(player) = player else { continue };
        if assets.moves.is_none() {
            let Some(model) = models.get(&assets.queen_gltf) else {
                continue;
            };
            let mut graph = AnimationGraph::new();
            let root = graph.root;
            let mut nodes = [root; QUEEN_CLIPS.len()];
            for (index, name) in QUEEN_CLIPS.into_iter().enumerate() {
                if let Some(clip) = model.named_animations.get(name) {
                    nodes[index] = graph.add_clip(clip.clone(), 1.0, root);
                }
            }
            assets.moves = Some(QueenMoves {
                graph: graphs.add(graph),
                clips: nodes,
            });
        }
        let Some(moves) = assets.moves.clone() else {
            continue;
        };
        let Ok(mut playing) = players.get_mut(player) else {
            continue;
        };
        for (index, clip) in moves.clips.into_iter().enumerate() {
            playing
                .play(clip)
                .repeat()
                .set_weight(if index == POISE { 1.0 } else { 0.0 });
        }
        commands.entity(player).insert(AnimationGraphHandle(moves.graph));
        rig.skeleton = Some(QueenSkeleton { player, lids });
    }
}

#[allow(clippy::too_many_arguments)]
fn drive_pearococo(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    preview: Res<crate::preview::Preview>,
    mobile: Res<MobileGraphics>,
    assets: Option<Res<PearococoAssets>>,
    mut rigs: Query<(Entity, &mut PearococoRig, &mut Transform, &mut Visibility)>,
    mut parts: Query<
        (&mut Transform, Option<&mut MeshTag>),
        (Without<PearococoRig>, Without<PointLight>),
    >,
    mut lights: Query<&mut PointLight>,
    mut players: Query<&mut AnimationPlayer>,
    mut morphs: Query<&mut MorphWeights>,
) {
    let Some(assets) = assets else { return };
    let Some(client) = session.client.as_ref() else {
        return;
    };
    let view = preview.on_stage(client.view());
    let t = time.elapsed_secs();
    let dt = time.delta_secs().min(0.05);
    let mut alive = HashSet::new();

    for a in view.actors {
        if a.driver != DRIVER || a.inactive || a.afk || a.bomber || a.destroyed > 0.0 {
            continue;
        }
        alive.insert(a.id);

        let (som_h, som_pitch, som_roll, som_yaw) = scene::somersault(a.driver, a.somersault);
        let boost = a.boost > 0.0;
        let tf = ported::placement(
            Vec3::new(a.wx as f32, som_h, a.wz as f32),
            a.heading as f32 + som_yaw,
            som_pitch,
            som_roll,
        );

        if let Some((_, mut rig, mut root_tf, mut root_vis)) =
            rigs.iter_mut().find(|(_, r, _, _)| r.id == a.id)
        {
            *root_tf = tf;
            *root_vis = Visibility::Visible;

            // 1. Spin all 4 gilded Rococo carriage wheels with ground speed
            let speed = a.speed as f32 * 0.085;
            rig.spin = (rig.spin + speed * dt / WHEEL_RADIUS) % TAU;
            for &w_ent in &rig.wheels {
                if let Ok((mut wtf, _)) = parts.get_mut(w_ent) {
                    wtf.rotation = Quat::from_rotation_x(rig.spin);
                }
            }

            // 2. Blend skinned queen clips (`poise` / `wave` / `boost`) + slow aristocratic blink!
            let target_clip = if a.celebrate > 0.0 {
                WAVE
            } else if boost {
                BOOST
            } else {
                POISE
            };
            let blend = 1.0 - (-dt * 9.0).exp();
            for (i, w) in rig.weights.iter_mut().enumerate() {
                let goal = if i == target_clip { 1.0 } else { 0.0 };
                *w += (goal - *w) * blend;
            }
            rig.blink -= dt;
            if rig.blink < -0.24 {
                rig.blink = 2.8 + ((t * 1.3 + a.id as f32).sin().abs()) * 3.0;
            }
            let blink_w = if rig.blink < 0.0 {
                let u = (-rig.blink / 0.24).clamp(0.0, 1.0);
                (u * PI).sin()
            } else {
                0.0
            };
            if let (Some(skel), Some(moves)) = (&rig.skeleton, &assets.moves) {
                if let Ok(mut playing) = players.get_mut(skel.player) {
                    for (i, &node) in moves.clips.iter().enumerate() {
                        if let Some(anim) = playing.animation_mut(node) {
                            anim.set_weight(rig.weights[i]);
                        }
                    }
                }
                if let Some(lids_ent) = skel.lids
                    && let Ok(mut mw) = morphs.get_mut(lids_ent)
                    && let Some(w0) = mw.weights_mut().first_mut()
                {
                    *w0 = blink_w;
                }
            }

            // 3. Smooth boost tail-fold + spring-damped wind physics fed into plumage.wesl!
            let target_fold = if boost { 1.0 } else { 0.0 };
            let fold_rate = if boost { 1.0 / 0.35 } else { 1.0 / 0.55 };
            if rig.fold < target_fold {
                rig.fold = (rig.fold + dt * fold_rate).min(1.0);
            } else {
                rig.fold = (rig.fold - dt * fold_rate).max(0.0);
            }
            let smooth_fold = rig.fold * rig.fold * (3.0 - 2.0 * rig.fold);

            let dh = (a.heading as f32 - rig.prev_heading)
                .sin()
                .atan2((a.heading as f32 - rig.prev_heading).cos());
            rig.prev_heading = a.heading as f32;
            let swing_target = if dt > 0.001 {
                ((dh / dt).clamp(-6.0, 6.0) * 0.28).clamp(-1.0, 1.0)
            } else {
                0.0
            };
            rig.swing_vel += ((swing_target - rig.swing) * 90.0 - rig.swing_vel * 9.0) * dt;
            rig.swing = (rig.swing + rig.swing_vel * dt).clamp(-1.0, 1.0);
            let press_target = (a.speed.abs() as f32 / 520.0).min(1.0);
            rig.press += (press_target - rig.press) * (1.0 - (-dt * 4.0).exp());
            let wind_tag = Wind {
                swing: rig.swing,
                press: rig.press,
            }
            .tag(false);

            // Fold each feather around TAIL_ROOT matching graphics-port.mjs plumage fold!
            for (i, &f_ent) in rig.feathers.iter().enumerate() {
                if let Ok((mut ftf, tag)) = parts.get_mut(f_ent) {
                    if let Some(mut mtag) = tag
                        && mtag.value != wind_tag
                    {
                        mtag.value = wind_tag;
                    }
                    let f_angle = (i as f32 - 5.0) * 0.23;
                    let turn = f_angle * smooth_fold * 0.86;
                    let fold_x = -smooth_fold * 0.95;
                    let z_tuck = -f_angle.abs() * smooth_fold * 0.12;
                    let mat = Mat4::from_translation(TAIL_ROOT + Vec3::new(0.0, 0.0, z_tuck))
                        * Mat4::from_rotation_x(fold_x)
                        * Mat4::from_rotation_z(turn)
                        * Mat4::from_translation(-TAIL_ROOT);
                    *ftf = Transform::from_matrix(mat);
                }
            }

            // Warm royal pearl-gold aura light intensifies on boost
            if let Some(light_ent) = rig.shimmer_light
                && let Ok(mut light) = lights.get_mut(light_ent)
            {
                light.intensity = if boost { 190_000.0 } else { 55_000.0 };
            }

            // 4. Fairy-dust boost ribbons (rose-pink & lavender mist + glittering gold/magenta stars!)
            if boost || a.somersault > 0.0 {
                let interval = if mobile.mobile { 0.08 } else { 0.03 };
                rig.fairy_timer += dt;
                if rig.fairy_timer >= interval {
                    rig.fairy_timer = 0.0;
                    let back = tf.rotation * Vec3::NEG_Z;
                    let right = tf.rotation * Vec3::X;
                    let sides: &[f32] = if mobile.mobile { &[0.0] } else { &[-1.3, 1.3] };
                    for (si, &sx) in sides.iter().enumerate() {
                        let j = (t * 29.0 + si as f32 * 2.1).sin();
                        let j2 = (t * 19.0 + si as f32 * 1.3).cos();
                        let pos = tf.transform_point(Vec3::new(sx, 1.15, -2.2));
                        let vel = back * (16.0 + j.abs() * 5.0)
                            + right * (j * 2.8)
                            + Vec3::Y * (2.6 + j2 * 1.1);
                        // Glittering fairy star
                        commands.spawn((
                            Mesh3d(assets.star_mesh.clone()),
                            MeshMaterial3d(if (t * 15.0) as usize % 2 == si % 2 {
                                assets.star_gold.clone()
                            } else {
                                assets.star_magenta.clone()
                            }),
                            Transform::from_translation(pos).with_scale(Vec3::splat(0.45)),
                            FairySpark {
                                vel,
                                spin: Vec3::new(5.5, 7.2, 4.1),
                                age: 0.0,
                                life: 0.55,
                                start_scale: 0.50,
                                end_scale: 0.02,
                            },
                        ));
                        // Swirling pastel satin mist (desktop)
                        if !mobile.mobile {
                            commands.spawn((
                                Mesh3d(assets.mist_mesh.clone()),
                                MeshMaterial3d(if si == 0 {
                                    assets.mist_pink.clone()
                                } else {
                                    assets.mist_lavender.clone()
                                }),
                                Transform::from_translation(pos).with_scale(Vec3::splat(0.70)),
                                FairySpark {
                                    vel: vel * 0.72,
                                    spin: Vec3::new(1.2, 1.8, 1.0),
                                    age: 0.0,
                                    life: 0.65,
                                    start_scale: 0.70,
                                    end_scale: 2.35,
                                },
                            ));
                        }
                    }
                }
            }
        } else {
            // Spawn opulent Pearococo chariot + skinned queen + 4 wheels + 11 iridescent tail feathers!
            let none = Entity::PLACEHOLDER;
            let mut queen_root = none;
            let mut wheels = [none; 4];
            let mut feathers = [none; 11];
            let mut shimmer_light = None;

            let root = commands
                .spawn((WorldAssetRoot(assets.chariot.clone()), tf, Visibility::Visible))
                .with_children(|parent| {
                    queen_root = parent
                        .spawn((WorldAssetRoot(assets.queen.clone()), Transform::IDENTITY))
                        .id();
                    for (slot, axle) in wheels.iter_mut().zip(WHEEL_AXLES) {
                        *slot = parent
                            .spawn((
                                WorldAssetRoot(assets.wheel.clone()),
                                Transform::from_translation(axle),
                            ))
                            .id();
                    }
                    for (i, slot) in feathers.iter_mut().enumerate() {
                        *slot = parent
                            .spawn((
                                Mesh3d(assets.feathers[i].clone()),
                                MeshMaterial3d(assets.plumage_mat.clone()),
                                MeshTag { value: Wind::default().tag(false) },
                                NoFrustumCulling,
                                Transform::IDENTITY,
                            ))
                            .id();
                    }
                    if !mobile.mobile {
                        shimmer_light = Some(
                            parent
                                .spawn((
                                    PointLight {
                                        color: Color::srgb(1.0, 0.86, 0.94),
                                        intensity: 55_000.0,
                                        range: 18.0,
                                        shadow_maps_enabled: false,
                                        ..default()
                                    },
                                    Transform::from_xyz(0.0, 3.4, -2.4),
                                ))
                                .id(),
                        );
                    }
                })
                .id();

            commands.entity(root).insert(PearococoRig {
                id: a.id,
                queen_root,
                skeleton: None,
                wheels,
                feathers,
                shimmer_light,
                spin: 0.0,
                fold: 0.0,
                prev_heading: a.heading as f32,
                swing: 0.0,
                swing_vel: 0.0,
                press: 0.0,
                fairy_timer: 0.0,
                weights: [1.0, 0.0, 0.0],
                blink: 2.2 + a.id as f32 * 0.8,
            });
        }
    }

    for (entity, rig, _, mut vis) in &mut rigs {
        if !alive.contains(&rig.id) {
            *vis = Visibility::Hidden;
            if let Some(light_ent) = rig.shimmer_light
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

fn tick_fairy_boost(
    mut commands: Commands,
    time: Res<Time>,
    mut sparks: Query<(Entity, &mut FairySpark, &mut Transform)>,
) {
    let dt = time.delta_secs().min(0.05);
    for (ent, mut sp, mut tf) in &mut sparks {
        sp.age += dt;
        if sp.age >= sp.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = sp.age / sp.life;
        sp.vel *= (1.0 - 2.0 * dt).max(0.2);
        tf.translation += sp.vel * dt;
        tf.rotation *= Quat::from_euler(EulerRot::XYZ, sp.spin.x * dt, sp.spin.y * dt, sp.spin.z * dt);
        let s = sp.start_scale + (sp.end_scale - sp.start_scale) * u;
        tf.scale = Vec3::splat(s.max(0.01));
    }
}
