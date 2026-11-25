//! Avita-Jas (#8) as an articulated Blender PBR Cessna 172 Skyhawk + skinned
//! earthworm pilot + offline-simulated woven aviator scarf:
//! - Skinned 10-bone earthworm (`models/avita_worm.glb`) with clips:
//!   `cruise` (S-curve ripple), `boost` (aero tuck), `accordion` (earthworm
//!   compression + springy rebound on somersault touchdown or hit), and
//!   `wing_waggle` (celebration salute synced to the Cessna's wing-waggle roll).
//! - Woven cloth aviator scarf (`Avita_Scarf`) with offline wind/gust/turn
//!   physics baked into shape keys (`idle`, `boost`, `left`, `right`).
//! - Spinning twisted propeller + boost blur disc + wingtip contrails.
use crate::{MobileGraphics, Presentation, app::GameSession, ported, scene};
use bevy::animation::{AnimatedBy, AnimationTargetId, graph::AnimationNodeIndex};
use bevy::gltf::{Gltf, GltfAssetLabel};
use bevy::mesh::morph::MorphWeights;
use bevy::prelude::*;
use std::collections::HashSet;
use std::f32::consts::TAU;

pub const DRIVER: usize = 8;

const CLIPS: [&str; 4] = ["cruise", "boost", "accordion", "wing_waggle"];
const CRUISE: usize = 0;
const BOOST: usize = 1;
const ACCORDION: usize = 2;
const WING_WAGGLE: usize = 3;

const ACCORDION_LEN: f32 = 1.2;
const CELEBRATE_LEN: f32 = 1.6;

/// Scarf baked passes in shape-key order: (frames, frames/sec), matching
/// `SCARF_IDLE` and `SCARF_BOOST` in `wasm-poc/blender/build_avita.py`.
const SCARF_PASSES: [(usize, f32); 2] = [(12, 6.0), (10, 10.0)];

pub struct AvitaPlugin;

impl Plugin for AvitaPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, load).add_systems(
            Update,
            (rig_avita, fly_avita, tick_contrails)
                .chain()
                .after(scene::sync)
                .in_set(Presentation),
        );
    }
}

#[derive(Clone)]
struct WormMoves {
    graph: Handle<AnimationGraph>,
    clips: [AnimationNodeIndex; CLIPS.len()],
}

#[derive(Resource)]
struct AvitaAssets {
    plane: Handle<WorldAsset>,
    prop: Handle<WorldAsset>,
    worm_gltf: Handle<Gltf>,
    worm: Handle<WorldAsset>,
    moves: Option<WormMoves>,
    prop_blur_mesh: Handle<Mesh>,
    prop_blur_mat: Handle<StandardMaterial>,
    contrail_mesh: Handle<Mesh>,
    contrail_mat: Handle<StandardMaterial>,
}

struct WormSkeleton {
    player: Entity,
    scarf: Option<Entity>,
}

#[derive(Component)]
struct AvitaRig {
    id: usize,
    prop: Entity,
    prop_blur: Entity,
    worm_root: Entity,
    skeleton: Option<WormSkeleton>,
    prop_angle: f32,
    prev_heading: f32,
    turn_swing: f32,
    scarf_stream: f32,
    prev_somersault: f64,
    prev_health: f64,
    accordion_t: Option<f32>,
    weights: [f32; CLIPS.len()],
}

#[derive(Component)]
struct ContrailPuff {
    vel: Vec3,
    age: f32,
    life: f32,
    start_scale: Vec3,
    end_scale: Vec3,
}

fn ease(amount: f32) -> f32 {
    let u = amount.clamp(0.0, 1.0);
    u * u * (3.0 - 2.0 * u)
}

fn load(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    commands.insert_resource(AvitaAssets {
        plane: assets.load(GltfAssetLabel::Scene(0).from_asset("avita_plane.glb")),
        prop: assets.load(GltfAssetLabel::Scene(0).from_asset("avita_prop.glb")),
        worm_gltf: assets.load("models/avita_worm.glb"),
        worm: assets.load(GltfAssetLabel::Scene(0).from_asset("models/avita_worm.glb")),
        moves: None,
        prop_blur_mesh: meshes.add(Cylinder::new(1.36, 0.03)),
        prop_blur_mat: materials.add(StandardMaterial {
            base_color: Color::srgba(0.62, 0.86, 0.96, 0.28),
            emissive: LinearRgba::rgb(0.35, 0.75, 1.15),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            cull_mode: None,
            ..default()
        }),
        contrail_mesh: meshes.add(Sphere::new(0.45).mesh().uv(8, 6)),
        contrail_mat: materials.add(StandardMaterial {
            base_color: Color::srgba(0.84, 0.94, 1.0, 0.42),
            emissive: LinearRgba::rgb(0.45, 0.65, 0.85),
            unlit: true,
            alpha_mode: AlphaMode::Add,
            cull_mode: None,
            ..default()
        }),
    });
}

#[allow(clippy::too_many_arguments)]
fn rig_avita(
    mut commands: Commands,
    assets: Option<ResMut<AvitaAssets>>,
    models: Res<Assets<Gltf>>,
    mut graphs: ResMut<Assets<AnimationGraph>>,
    mut rigs: Query<&mut AvitaRig>,
    family: Query<&Children>,
    names: Query<&Name>,
    mut players: Query<&mut AnimationPlayer>,
    morphs: Query<(), With<MorphWeights>>,
    targets: Query<Option<&AnimatedBy>, With<AnimationTargetId>>,
) {
    let Some(mut assets) = assets else { return };
    for mut rig in &mut rigs {
        if rig.skeleton.is_some() {
            continue;
        }
        let (mut player, mut scarf) = (None, None);
        for part in family.iter_descendants(rig.worm_root) {
            if players.contains(part) {
                player = Some(part);
            }
            if morphs.contains(part)
                && names.get(part).is_ok_and(|name| name.as_str().contains("Scarf"))
            {
                scarf = Some(part);
            }
        }
        let Some(player) = player else { continue };
        if assets.moves.is_none() {
            let Some(model) = models.get(&assets.worm_gltf) else {
                continue;
            };
            let mut graph = AnimationGraph::new();
            let root = graph.root;
            let mut nodes = [root; CLIPS.len()];
            for (index, name) in CLIPS.into_iter().enumerate() {
                if let Some(clip) = model.named_animations.get(name) {
                    nodes[index] = graph.add_clip(clip.clone(), 1.0, root);
                }
            }
            assets.moves = Some(WormMoves {
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
        // Self-heal any bone whose AnimatedBy wasn't linked to this AnimationPlayer.
        for part in family.iter_descendants(rig.worm_root) {
            if let Ok(animated_by) = targets.get(part)
                && animated_by.map(|a| a.0) != Some(player)
            {
                commands.entity(part).insert(AnimatedBy(player));
            }
        }
        for (index, clip) in moves.clips.into_iter().enumerate() {
            let anim = playing.play(clip).set_weight(if index == CRUISE { 1.0 } else { 0.0 });
            if index == CRUISE || index == BOOST {
                anim.repeat();
            } else {
                anim.pause();
            }
        }
        commands.entity(player).insert(AnimationGraphHandle(moves.graph));
        rig.skeleton = Some(WormSkeleton { player, scarf });
    }
}

#[allow(clippy::too_many_arguments)]
fn fly_avita(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    preview: Res<crate::preview::Preview>,
    mobile: Res<MobileGraphics>,
    assets: Option<Res<AvitaAssets>>,
    mut rigs: Query<(Entity, &mut AvitaRig, &mut Transform, &mut Visibility)>,
    mut parts: Query<(&mut Transform, &mut Visibility), Without<AvitaRig>>,
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

        let (som_h, som_pitch, som_roll, som_yaw) = scene::somersault(DRIVER, a.somersault);
        let boosting = a.boost > 0.0 || a.somersault > 0.0;
        let speed_norm = (a.speed.abs() as f32 / 520.0).clamp(0.0, 1.35);
        let boost_pitch = if a.boost > 0.0 && a.somersault <= 0.0 {
            -0.06
        } else {
            0.0
        };

        // Wing-waggle celebration roll on the whole Cessna 172!
        let celebrate_cycle = if a.celebrate > 0.0 {
            ((CELEBRATE_LEN - a.celebrate as f32) / CELEBRATE_LEN).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let waggle_lift = if a.celebrate > 0.0 {
            let env = ease((celebrate_cycle / 0.18).min((1.0 - celebrate_cycle) / 0.22));
            0.38 * env
        } else {
            0.0
        };
        let waggle_roll = if a.celebrate > 0.0 {
            let env = ease((celebrate_cycle / 0.18).min((1.0 - celebrate_cycle) / 0.22));
            (celebrate_cycle * TAU * 2.0).sin() * 0.44 * env
        } else {
            0.0
        };

        if let Some((_, mut rig, mut plane_tf, mut plane_vis)) =
            rigs.iter_mut().find(|(_, r, _, _)| r.id == a.id)
        {
            // Track turning rate for subtle Cessna bank & scarf centrifugal throw
            let dh = (a.heading as f32 - rig.prev_heading)
                .sin()
                .atan2((a.heading as f32 - rig.prev_heading).cos());
            rig.prev_heading = a.heading as f32;
            let turn_target = if dt > 0.001 {
                ((dh / dt) * 0.20).clamp(-0.65, 0.65)
            } else {
                0.0
            };
            rig.turn_swing += (turn_target - rig.turn_swing) * (1.0 - (-dt * 8.0).exp());

            // Trigger earthworm accordion scrunch on somersault touchdown or taking damage
            let landed = rig.prev_somersault > 0.0 && a.somersault <= 0.0;
            let took_hit = a.health < rig.prev_health - 0.01;
            rig.prev_somersault = a.somersault;
            rig.prev_health = a.health;
            if landed || took_hit {
                rig.accordion_t = Some(0.0);
            }
            if let Some(acc) = &mut rig.accordion_t {
                *acc += dt;
                if *acc >= ACCORDION_LEN {
                    rig.accordion_t = None;
                }
            }

            // Combine somersault roll, wing-waggle celebration roll, and subtle turn banking
            let bank_roll = if a.somersault > 0.0 {
                som_roll
            } else if a.celebrate > 0.0 {
                waggle_roll
            } else {
                -rig.turn_swing * 0.28
            };
            let tf = ported::placement(
                Vec3::new(a.wx as f32, som_h + waggle_lift, a.wz as f32),
                a.heading as f32 + som_yaw,
                som_pitch + boost_pitch,
                bank_roll,
            );
            *plane_tf = tf;
            *plane_vis = Visibility::Visible;

            // 1. Blend skeletal clips: wing_waggle > accordion > boost > cruise
            let target_clip = if a.celebrate > 0.0 {
                WING_WAGGLE
            } else if rig.accordion_t.is_some() {
                ACCORDION
            } else if boosting {
                BOOST
            } else {
                CRUISE
            };
            let blend_rate = if target_clip == ACCORDION { 18.0 } else { 10.0 };
            let blend = 1.0 - (-dt * blend_rate).exp();
            for (i, w) in rig.weights.iter_mut().enumerate() {
                let goal = if i == target_clip { 1.0 } else { 0.0 };
                *w += (goal - *w) * blend;
            }

            let stream_goal = if boosting { 1.0 } else { (speed_norm * 0.55).min(0.6) };
            rig.scarf_stream += (stream_goal - rig.scarf_stream) * (1.0 - (-dt * 5.0).exp());
            let scarf_stream = rig.scarf_stream;

            if let (Some(skel), Some(moves)) = (&rig.skeleton, &assets.moves) {
                if let Ok(mut playing) = players.get_mut(skel.player) {
                    for (i, &node) in moves.clips.iter().enumerate() {
                        if let Some(anim) = playing.animation_mut(node) {
                            anim.set_weight(rig.weights[i]);
                            if i == ACCORDION
                                && let Some(acc) = rig.accordion_t
                            {
                                anim.seek_to(acc.min(ACCORDION_LEN));
                            } else if i == WING_WAGGLE && a.celebrate > 0.0 {
                                anim.seek_to((CELEBRATE_LEN - a.celebrate as f32).clamp(0.0, CELEBRATE_LEN));
                            }
                        }
                    }
                }

                // 2. Offline-simulated woven scarf playback
                if let Some(scarf_ent) = skel.scarf
                    && let Ok(mut keys) = morphs.get_mut(scarf_ent)
                {
                    let keys = keys.weights_mut();
                    keys.fill(0.0);
                    let swing = (rig.turn_swing + waggle_roll * 1.1).clamp(-0.65, 0.65);
                    let thrown = (swing.abs() / 0.65).min(1.0) * 0.68;
                    let mut cursor = 0;
                    for ((frames, rate), share) in
                        SCARF_PASSES.into_iter().zip([1.0 - scarf_stream, scarf_stream])
                    {
                        let at = (t + a.id as f32 * 0.41) * rate;
                        let (first, fade) = (at as usize % frames, at.fract());
                        if let Some(pass) = keys.get_mut(cursor..cursor + frames) {
                            pass[first] += share * (1.0 - thrown) * (1.0 - fade);
                            pass[(first + 1) % frames] += share * (1.0 - thrown) * fade;
                        }
                        cursor += frames;
                    }
                    // `left` then `right` follow the looping wind passes
                    if let Some(side) = keys.get_mut(cursor + usize::from(swing < 0.0)) {
                        *side = thrown;
                    }
                }
            }

            // 3. Spinning propeller & boost blur disc
            rig.prop_angle = (rig.prop_angle + dt * if boosting { 54.0 } else { 22.0 }) % TAU;
            if let Ok((mut ptf, _)) = parts.get_mut(rig.prop) {
                ptf.rotation = Quat::from_rotation_z(rig.prop_angle);
            }
            if let Ok((_, mut bvis)) = parts.get_mut(rig.prop_blur) {
                *bvis = if boosting {
                    Visibility::Inherited
                } else {
                    Visibility::Hidden
                };
            }

            // 4. Wingtip contrails while boosting (desktop)
            if boosting && !mobile.mobile {
                let backward = tf.rotation * Vec3::NEG_Z;
                for side in [-1.0_f32, 1.0_f32] {
                    let tip_world = tf.transform_point(Vec3::new(side * 3.55, 3.28, -0.88));
                    commands.spawn((
                        Mesh3d(assets.contrail_mesh.clone()),
                        MeshMaterial3d(assets.contrail_mat.clone()),
                        Transform::from_translation(tip_world)
                            .looking_to(backward, Vec3::Y)
                            .with_scale(Vec3::new(0.14, 0.14, 0.55)),
                        ContrailPuff {
                            vel: backward * 10.0 + Vec3::new(side * 0.5, 0.25, 0.0),
                            age: 0.0,
                            life: 0.34,
                            start_scale: Vec3::new(0.14, 0.14, 0.55),
                            end_scale: Vec3::new(0.42, 0.42, 1.35),
                        },
                    ));
                }
            }
        } else {
            let tf = ported::placement(
                Vec3::new(a.wx as f32, som_h, a.wz as f32),
                a.heading as f32 + som_yaw,
                som_pitch + boost_pitch,
                som_roll,
            );
            let mut prop_ent = Entity::PLACEHOLDER;
            let mut blur_ent = Entity::PLACEHOLDER;
            let mut worm_ent = Entity::PLACEHOLDER;
            let plane_ent = commands
                .spawn((WorldAssetRoot(assets.plane.clone()), tf))
                .with_children(|plane| {
                    prop_ent = plane
                        .spawn((
                            WorldAssetRoot(assets.prop.clone()),
                            Transform::from_xyz(0.0, 1.78, 3.16),
                        ))
                        .id();
                    blur_ent = plane
                        .spawn((
                            Mesh3d(assets.prop_blur_mesh.clone()),
                            MeshMaterial3d(assets.prop_blur_mat.clone()),
                            Transform::from_xyz(0.0, 1.78, 3.17)
                                .with_rotation(Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)),
                            Visibility::Hidden,
                        ))
                        .id();
                    worm_ent = plane
                        .spawn((WorldAssetRoot(assets.worm.clone()), Transform::IDENTITY))
                        .id();
                })
                .id();
            commands.entity(plane_ent).insert(AvitaRig {
                id: a.id,
                prop: prop_ent,
                prop_blur: blur_ent,
                worm_root: worm_ent,
                skeleton: None,
                prop_angle: 0.0,
                prev_heading: a.heading as f32,
                turn_swing: 0.0,
                scarf_stream: 0.0,
                prev_somersault: a.somersault,
                prev_health: a.health,
                accordion_t: None,
                weights: [1.0, 0.0, 0.0, 0.0],
            });
        }
    }

    for (_, rig, _, mut vis) in &mut rigs {
        if !alive.contains(&rig.id) {
            *vis = Visibility::Hidden;
            if let Ok((_, mut bvis)) = parts.get_mut(rig.prop_blur) {
                *bvis = Visibility::Hidden;
            }
        }
    }
}

fn tick_contrails(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(Entity, &mut ContrailPuff, &mut Transform)>,
) {
    let dt = time.delta_secs().min(0.05);
    for (ent, mut p, mut tf) in &mut q {
        p.age += dt;
        if p.age >= p.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = (p.age / p.life).clamp(0.0, 1.0);
        tf.translation += p.vel * dt;
        p.vel *= (1.0 - 2.2 * dt).max(0.0);
        tf.scale = p.start_scale.lerp(p.end_scale, u);
    }
}
