//! Master-Yuda (#10) as an articulated Blender PBR cruiser motorcycle & biker elder:
//! - Spinning front & rear motorcycle wheels
//! - Akira-style deep drift lean + inside exhaust scraping floor sparks
//! - Rear-axle wheelie on boost
//! - A skinned rider whose jacket comes off, is thrown, and goes back on, as
//!   animation clips authored in `blender/build_yuda.py`
use crate::{MobileGraphics, Presentation, app::GameSession, ported, scene};
use bevy::animation::graph::AnimationNodeIndex;
use bevy::gltf::{Gltf, GltfAssetLabel};
use bevy::prelude::*;
use std::collections::HashSet;
use std::f32::consts::TAU;

pub const DRIVER: usize = 10;

const WHEEL_RADIUS: f32 = 0.92;
const AXLES: [Vec3; 2] = [Vec3::new(0.0, 0.92, -1.65), Vec3::new(0.0, 0.92, 1.80)];

/// The rider's clips in `yuda_rider.glb`, by name.
const CLIPS: [&str; 4] = ["ride", "strip", "bare", "dress"];
const RIDE: usize = 0;
const STRIP: usize = 1;
const BARE: usize = 2;
const DRESS: usize = 3;
/// How far into the strip the jacket leaves him, and where it is then, as in
/// `RELEASE_FRAME`, `RELEASE_TURN` and `RELEASE_SHIFT` of the Blender script.
const RELEASE: f32 = 8.0 / 30.0;
const RELEASE_AT: Vec3 = Vec3::new(0.0, 2.5, -1.42);
const RELEASE_PITCH: f32 = -0.6;
const EXHAUST_TIPS: [Vec3; 2] = [Vec3::new(-0.65, 0.67, -2.38), Vec3::new(0.65, 0.67, -2.38)];

pub struct YudaPlugin;

impl Plugin for YudaPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, load).add_systems(
            Update,
            (rig_up_yuda, ride_yuda, tick_yuda_fx)
                .chain()
                .after(scene::sync)
                .in_set(Presentation),
        );
    }
}

#[derive(Resource)]
struct YudaAssets {
    bike: Handle<WorldAsset>,
    wheel: Handle<WorldAsset>,
    rider: Handle<Gltf>,
    rider_skin: Handle<WorldAsset>,
    jacket: Handle<Gltf>,
    jacket_skin: Handle<WorldAsset>,
    /// Built once both models have loaded and the first rider has been spawned.
    moves: Option<Moves>,
    spark_mesh: Handle<Mesh>,
    spark_gold: Handle<StandardMaterial>,
    spark_cyan: Handle<StandardMaterial>,
    smoke_mesh: Handle<Mesh>,
    flame_mesh: Handle<Mesh>,
    flame_mat: Handle<StandardMaterial>,
}

/// The rider's clips as one blend graph, and the thrown jacket's as another.
#[derive(Clone)]
struct Moves {
    graph: Handle<AnimationGraph>,
    clips: [AnimationNodeIndex; CLIPS.len()],
    lengths: [f32; CLIPS.len()],
    toss_graph: Handle<AnimationGraph>,
    tumble: AnimationNodeIndex,
}

/// Where the jacket is.
#[derive(Clone, Copy, PartialEq)]
enum Wear {
    On,
    Stripping,
    Off,
    Dressing,
}

#[derive(Component)]
struct YudaRig {
    id: usize,
    wheels: [Entity; 2],
    flames: [Entity; 2],
    rider: Entity,
    /// The loose jacket he throws: one per rider, hidden between throws.
    toss: Entity,
    /// The animation players of the rider and of the loose jacket, once their models have arrived.
    players: Option<[Entity; 2]>,
    wear: Wear,
    /// Seconds into the strip or the dressing.
    clock: f32,
    thrown: bool,
    /// How much of each clip is showing.
    mix: [f32; CLIPS.len()],
    lamp: Option<Entity>,
    spin: f32,
    roll: f32,
    side: f32,
    wheelie: f32,
    spark_timer: f32,
    smoke_timer: f32,
    smoke_pipe: usize,
}

#[derive(Component)]
struct ExhaustPuff {
    vel: Vec3,
    spin: Vec3,
    age: f32,
    life: f32,
    start_scale: f32,
    end_scale: f32,
    mat: Handle<StandardMaterial>,
    base_rgb: [f32; 3],
    max_alpha: f32,
    hot_glow: f32,
}

#[derive(Component)]
struct FlyingJacket {
    vel: Vec3,
    rot_vel: Vec3,
    age: f32,
    life: f32,
}

#[derive(Component)]
struct ScrapeSpark {
    vel: Vec3,
    age: f32,
    life: f32,
}

fn build_smoke_mesh() -> Mesh {
    let mut mesh = Sphere::new(0.65).mesh().uv(14, 10);
    if let Some(bevy::mesh::VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute_mut(Mesh::ATTRIBUTE_POSITION)
    {
        for p in positions.iter_mut() {
            let v = Vec3::from_array(*p);
            let n1 = (v.x * 4.8 + 0.4).sin() * (v.y * 4.5 - 0.3).cos() * (v.z * 4.6).sin();
            let n2 = (v.x * 8.2 - v.z * 7.4).sin() * (v.y * 7.6 + 1.1).cos();
            let disp = 1.0 + n1 * 0.28 + n2 * 0.14;
            *p = (v * disp).to_array();
        }
    }
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
        assets.load(GltfAssetLabel::Scene(0).from_asset(format!("models/yuda_{name}.glb")))
    };
    let spark_mesh = meshes.add(Cuboid::new(0.06, 0.06, 0.55));
    let spark_gold = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.82, 0.28, 1.0),
        emissive: LinearRgba::rgb(12.0, 6.2, 1.4),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    let spark_cyan = materials.add(StandardMaterial {
        base_color: Color::srgba(0.45, 0.96, 1.0, 1.0),
        emissive: LinearRgba::rgb(2.8, 9.5, 12.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    let smoke_mesh = meshes.add(build_smoke_mesh());
    let flame_mesh = meshes.add(Cone::new(0.36, 2.5));
    let flame_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.58, 0.14, 0.96),
        emissive: LinearRgba::rgb(13.0, 5.4, 0.9),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    commands.insert_resource(YudaAssets {
        bike: part("bike"),
        wheel: part("wheel"),
        rider: assets.load("models/yuda_rider.glb"),
        rider_skin: part("rider"),
        jacket: assets.load("models/yuda_jacket.glb"),
        jacket_skin: part("jacket"),
        moves: None,
        spark_mesh,
        spark_gold,
        spark_cyan,
        smoke_mesh,
        flame_mesh,
        flame_mat,
    });
}

/// Once a rider's models have been spawned: start his clips and his loose
/// jacket's, every one silent until `ride_yuda` turns it up.
fn rig_up_yuda(
    mut commands: Commands,
    assets: Option<ResMut<YudaAssets>>,
    models: Res<Assets<Gltf>>,
    clips: Res<Assets<AnimationClip>>,
    mut graphs: ResMut<Assets<AnimationGraph>>,
    mut rigs: Query<&mut YudaRig>,
    family: Query<&Children>,
    mut players: Query<&mut AnimationPlayer>,
) {
    let Some(mut assets) = assets else { return };
    for mut rig in &mut rigs {
        if rig.players.is_some() {
            continue;
        }
        let player_in = |root: Entity| family.iter_descendants(root).find(|part| players.contains(*part));
        let (Some(rider), Some(loose)) = (player_in(rig.rider), player_in(rig.toss)) else { continue };
        if assets.moves.is_none() {
            let (Some(model), Some(jacket)) = (models.get(&assets.rider), models.get(&assets.jacket)) else {
                continue;
            };
            let Some(tumble) = jacket.named_animations.get("tumble") else { continue };
            let mut graph = AnimationGraph::new();
            let root = graph.root;
            let (mut nodes, mut lengths) = ([root; CLIPS.len()], [1.0; CLIPS.len()]);
            for (index, name) in CLIPS.into_iter().enumerate() {
                let Some(clip) = model.named_animations.get(name) else { continue };
                lengths[index] = clips.get(clip).map_or(1.0, |clip| clip.duration());
                nodes[index] = graph.add_clip(clip.clone(), 1.0, root);
            }
            let (toss_graph, tumble) = AnimationGraph::from_clip(tumble.clone());
            assets.moves = Some(Moves {
                graph: graphs.add(graph),
                clips: nodes,
                lengths,
                toss_graph: graphs.add(toss_graph),
                tumble,
            });
        }
        let Some(moves) = assets.moves.clone() else { continue };
        if let Ok(mut playing) = players.get_mut(rider) {
            for (index, clip) in moves.clips.into_iter().enumerate() {
                let clip = playing.play(clip).repeat().set_weight(f32::from(index == RIDE));
                if index == STRIP || index == DRESS {
                    clip.pause();
                }
            }
        }
        if let Ok(mut playing) = players.get_mut(loose) {
            playing.play(moves.tumble).repeat();
        }
        commands.entity(rider).insert(AnimationGraphHandle(moves.graph));
        commands.entity(loose).insert(AnimationGraphHandle(moves.toss_graph));
        rig.players = Some([rider, loose]);
    }
}

#[allow(clippy::too_many_arguments)]
fn ride_yuda(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    preview: Res<crate::preview::Preview>,
    mobile: Res<MobileGraphics>,
    assets: Option<Res<YudaAssets>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut rigs: Query<(&mut YudaRig, &mut Transform, &mut Visibility)>,
    mut parts: Query<(&mut Transform, &mut Visibility), Without<YudaRig>>,
    mut lights: Query<&mut PointLight>,
    mut players: Query<&mut AnimationPlayer>,
) {
    let Some(assets) = assets else { return };
    let Some(client) = session.client.as_ref() else { return };
    let view = preview.on_stage(client.view());
    let (now, dt) = (time.elapsed_secs(), time.delta_secs().min(0.05));
    let mut alive = HashSet::new();

    for a in view.actors {
        if a.driver != DRIVER || a.inactive || a.afk || a.bomber || a.destroyed > 0.0 {
            continue;
        }
        alive.insert(a.id);
        let (jump, somersault_pitch, _, yaw) = scene::somersault(DRIVER, a.somersault);
        let drifting = view.phase == "racing" && a.was_drifting && a.somersault <= 0.0;
        let boosting = a.boost > 0.0 && a.somersault <= 0.0;
        let bare = a.boost > 0.0 || a.vulcan > 0.0;

        if let Some((mut rig, mut root_tf, mut vis)) = rigs.iter_mut().find(|(r, ..)| r.id == a.id) {
            *vis = Visibility::Visible;
            // Akira-style deep drift lean
            let slip = (a.heading - a.motion_heading).sin().atan2((a.heading - a.motion_heading).cos()) as f32;
            if drifting && slip.abs() > 0.015 {
                rig.side = -slip.signum();
            }
            let target_roll = if drifting { rig.side * 0.92 } else { 0.0 };
            rig.roll += (target_roll - rig.roll) * (1.0 - (-dt * if drifting { 16.0 } else { 11.0 }).exp());
            if a.somersault > 0.0 {
                rig.roll = 0.0;
            }
            // Rear-axle wheelie on boost
            let target_wheelie = if boosting { 1.0 } else { 0.0 };
            rig.wheelie += (target_wheelie - rig.wheelie) * (1.0 - (-dt * 11.0).exp());
            let wheelie_pitch = -0.56 * rig.wheelie;
            let wheelie_lift = 1.65 * (-wheelie_pitch).sin() * 0.55;

            let place = ported::placement(
                Vec3::new(a.wx as f32, jump + wheelie_lift, a.wz as f32),
                a.heading as f32 + yaw,
                somersault_pitch + wheelie_pitch,
                rig.roll,
            );
            *root_tf = place;

            // Spin both motorcycle wheels proportional to ground speed
            let speed = a.speed as f32 * 0.085;
            rig.spin = (rig.spin + speed * dt / WHEEL_RADIUS) % TAU;
            for &w_ent in &rig.wheels {
                if let Ok((mut wtf, _)) = parts.get_mut(w_ent) {
                    wtf.rotation = Quat::from_rotation_x(rig.spin);
                }
            }

            // The jacket comes off for a boost or rapid fire and goes back on
            // after; starting again mid-dressing throws it again, as in the browser.
            match (bare, rig.wear) {
                (true, Wear::On | Wear::Dressing) => (rig.wear, rig.clock, rig.thrown) = (Wear::Stripping, 0.0, false),
                (false, Wear::Off | Wear::Stripping) => (rig.wear, rig.clock) = (Wear::Dressing, 0.0),
                _ => rig.clock += dt,
            }
            let lengths = assets.moves.as_ref().map_or([1.0; CLIPS.len()], |moves| moves.lengths);
            // He lets go of it part-way through the strip, or at once if the strip is cut short.
            let letting_go = rig.wear == Wear::Stripping && rig.clock >= RELEASE || rig.wear == Wear::Dressing;
            if letting_go && !rig.thrown {
                rig.thrown = true;
                let back = place.rotation * Vec3::NEG_Z;
                if let Ok((mut loose, mut seen)) = parts.get_mut(rig.toss) {
                    *loose = place
                        * Transform::from_translation(RELEASE_AT).with_rotation(Quat::from_rotation_x(RELEASE_PITCH));
                    *seen = Visibility::Visible;
                }
                commands.entity(rig.toss).insert(FlyingJacket {
                    vel: back * 14.0 + Vec3::Y * 7.5,
                    rot_vel: Vec3::new(5.5, 4.2, -3.8),
                    age: 0.0,
                    life: 1.15,
                });
            }
            if rig.wear == Wear::Stripping && rig.clock >= lengths[STRIP] {
                rig.wear = Wear::Off;
            }
            if rig.wear == Wear::Dressing && rig.clock >= lengths[DRESS] {
                rig.wear = Wear::On;
            }
            let showing = match rig.wear {
                Wear::On => RIDE,
                Wear::Stripping => STRIP,
                Wear::Off => BARE,
                Wear::Dressing => DRESS,
            };
            for (clip, share) in rig.mix.iter_mut().enumerate() {
                *share += (f32::from(clip == showing) - *share) * (1.0 - (-dt * 30.0).exp());
            }
            if let (Some([rider, _]), Some(moves)) = (rig.players, &assets.moves)
                && let Ok(mut player) = players.get_mut(rider)
            {
                for (clip, node) in moves.clips.into_iter().enumerate() {
                    let Some(playing) = player.animation_mut(node) else { continue };
                    playing.set_weight(rig.mix[clip]);
                    // The strip and the dressing run once, on this rider's own clock.
                    if clip == showing && (clip == STRIP || clip == DRESS) {
                        playing.seek_to(rig.clock.min(lengths[clip] - 0.001));
                    }
                }
            }
            if let Some(lamp) = rig.lamp
                && let Ok(mut light) = lights.get_mut(lamp)
            {
                light.intensity = if boosting { 160_000.0 } else { 85_000.0 };
            }

            // Twin megaphone boost afterburner flames
            for (i, &f_ent) in rig.flames.iter().enumerate() {
                if let Ok((mut ftf, mut fvis)) = parts.get_mut(f_ent) {
                    if boosting {
                        let flicker = 0.85 + (now * 58.0 + i as f32 * 2.1).sin() * 0.26;
                        *fvis = Visibility::Inherited;
                        ftf.translation = EXHAUST_TIPS[i] + Vec3::new(0.0, 0.0, -1.18 * flicker);
                        ftf.scale = Vec3::new(1.05, flicker * 1.2, 1.05);
                    } else {
                        *fvis = Visibility::Hidden;
                    }
                }
            }

            // Master-Yuda's iconic thick charcoal-soot rolling-coal exhaust clouds (`YudaExhaust`):
            // bold dark chug puffs while cruising, and massive persistent 3-second billowing
            // charcoal smokescreen clouds trailing behind both chrome megaphones while boosting!
            let smoke_interval = if mobile.mobile {
                if boosting { 0.08 } else { 0.16 }
            } else if boosting {
                0.04
            } else {
                0.085
            };
            rig.smoke_timer += dt;
            if rig.smoke_timer >= smoke_interval {
                rig.smoke_timer = 0.0;
                let pipe_count = if boosting && !mobile.mobile { 2 } else { 1 };
                let back = place.rotation * Vec3::NEG_Z;
                let right = place.rotation * Vec3::X;
                for _ in 0..pipe_count {
                    let tip_idx = rig.smoke_pipe % 2;
                    rig.smoke_pipe = rig.smoke_pipe.wrapping_add(1);
                    let jitter = (now * 23.0 + rig.smoke_pipe as f32 * 1.7).sin();
                    let jitter2 = (now * 31.0 + rig.smoke_pipe as f32 * 2.3).cos();
                    let spawn_pos = place.transform_point(EXHAUST_TIPS[tip_idx] + Vec3::new(0.0, 0.0, -0.22));
                    let (base_rgb, max_alpha, hot_glow, start_s, end_s, life) = if boosting {
                        ([0.07, 0.065, 0.075], 0.92, 1.8, 1.15, 3.85, 2.8)
                    } else {
                        ([0.16, 0.17, 0.19], 0.78, 0.0, 0.72, 2.15, 1.35)
                    };
                    let mat = materials.add(StandardMaterial {
                        base_color: Color::srgba(base_rgb[0], base_rgb[1], base_rgb[2], max_alpha),
                        emissive: LinearRgba::rgb(hot_glow, hot_glow * 0.34, hot_glow * 0.06),
                        perceptual_roughness: 0.98,
                        metallic: 0.0,
                        alpha_mode: AlphaMode::Blend,
                        ..default()
                    });
                    // Persistent world-space clouds: gentle rearward kick that quickly settles
                    // and rises slowly (`y + age * 0.7` like YudaExhaust), filling the path!
                    let vel = back * (if boosting { 4.2 } else { 3.5 })
                        + right * (jitter * if boosting { 1.8 } else { 0.9 })
                        + Vec3::Y * (0.95 + jitter2.abs() * 0.65);
                    commands.spawn((
                        Mesh3d(assets.smoke_mesh.clone()),
                        MeshMaterial3d(mat.clone()),
                        Transform::from_translation(spawn_pos)
                            .with_rotation(Quat::from_euler(EulerRot::XYZ, jitter * 3.1, jitter2 * 3.1, 0.0))
                            .with_scale(Vec3::splat(start_s)),
                        ExhaustPuff {
                            vel,
                            spin: Vec3::new(jitter * 1.4, jitter2 * 1.3, -jitter * 1.1),
                            age: 0.0,
                            life,
                            start_scale: start_s,
                            end_scale: end_s,
                            mat,
                            base_rgb,
                            max_alpha,
                            hot_glow,
                        },
                    ));
                }
            }

            // Emit scraping metallic sparks from the inside exhaust pipe when drifting!
            if drifting && !mobile.mobile {
                rig.spark_timer += dt;
                if rig.spark_timer >= 0.03 {
                    rig.spark_timer = 0.0;
                    let side_sign = -rig.roll.signum();
                    let contact = place.transform_point(Vec3::new(side_sign * 0.65, 0.35, -1.65));
                    let back = place.rotation * Vec3::NEG_Z;
                    let mat = if a.drift >= 0.85 {
                        assets.spark_cyan.clone()
                    } else {
                        assets.spark_gold.clone()
                    };
                    for k in 0..3 {
                        let s = (now * 37.0 + k as f32 * 2.1).sin();
                        let vel = back * (10.0 + k as f32 * 3.5)
                            + Vec3::new(s * 4.5, 2.2 + (k as f32) * 1.4, -s * 3.5);
                        commands.spawn((
                            Mesh3d(assets.spark_mesh.clone()),
                            MeshMaterial3d(mat.clone()),
                            Transform::from_translation(Vec3::new(contact.x, 0.14, contact.z))
                                .looking_to(vel.normalize_or(Vec3::Y), Vec3::Y),
                            ScrapeSpark {
                                vel,
                                age: 0.0,
                                life: 0.38,
                            },
                        ));
                    }
                }
            }
        } else {
            let place = ported::placement(
                Vec3::new(a.wx as f32, jump, a.wz as f32),
                a.heading as f32 + yaw,
                somersault_pitch,
                0.0,
            );
            let none = Entity::PLACEHOLDER;
            let (mut wheels, mut flames, mut rider, mut lamp) = ([none; 2], [none; 2], none, None);
            let toss = commands
                .spawn((WorldAssetRoot(assets.jacket_skin.clone()), Transform::IDENTITY, Visibility::Hidden))
                .id();
            let root = commands
                .spawn((WorldAssetRoot(assets.bike.clone()), place, Visibility::Visible))
                .with_children(|bike| {
                    for (slot, axle) in wheels.iter_mut().zip(AXLES) {
                        *slot = bike
                            .spawn((
                                WorldAssetRoot(assets.wheel.clone()),
                                Transform::from_translation(axle),
                            ))
                            .id();
                    }
                    let back_rot = Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2);
                    for (slot, tip) in flames.iter_mut().zip(EXHAUST_TIPS) {
                        *slot = bike
                            .spawn((
                                Mesh3d(assets.flame_mesh.clone()),
                                MeshMaterial3d(assets.flame_mat.clone()),
                                Transform::from_translation(tip + Vec3::new(0.0, 0.0, -0.75))
                                    .with_rotation(back_rot),
                                Visibility::Hidden,
                            ))
                            .id();
                    }
                    rider = bike
                        .spawn((WorldAssetRoot(assets.rider_skin.clone()), Transform::IDENTITY))
                        .id();
                    if !mobile.mobile {
                        lamp = Some(
                            bike.spawn((
                                PointLight {
                                    color: Color::srgb(1.0, 0.92, 0.72),
                                    intensity: 85_000.0,
                                    range: 18.0,
                                    shadow_maps_enabled: false,
                                    ..default()
                                },
                                Transform::from_xyz(0.0, 1.95, 2.35),
                            ))
                            .id(),
                        );
                    }
                })
                .id();
            commands.entity(root).insert(YudaRig {
                id: a.id,
                wheels,
                flames,
                rider,
                toss,
                players: None,
                wear: Wear::On,
                clock: 0.0,
                thrown: false,
                mix: [1.0, 0.0, 0.0, 0.0],
                lamp,
                spin: 0.0,
                roll: 0.0,
                side: 1.0,
                wheelie: 0.0,
                spark_timer: 0.0,
                smoke_timer: 0.0,
                smoke_pipe: 0,
            });
        }
    }

    for (rig, _, mut vis) in &mut rigs {
        if !alive.contains(&rig.id) {
            *vis = Visibility::Hidden;
            if let Some(lamp) = rig.lamp
                && let Ok(mut light) = lights.get_mut(lamp)
            {
                light.intensity = 0.0;
            }
        }
    }
}

fn tick_yuda_fx(
    mut commands: Commands,
    time: Res<Time>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut jackets: Query<
        (Entity, &mut Transform, &mut Visibility, &mut FlyingJacket),
        (Without<ScrapeSpark>, Without<ExhaustPuff>),
    >,
    mut sparks: Query<(Entity, &mut Transform, &mut ScrapeSpark), (Without<FlyingJacket>, Without<ExhaustPuff>)>,
    mut puffs: Query<(Entity, &mut Transform, &mut ExhaustPuff), (Without<FlyingJacket>, Without<ScrapeSpark>)>,
) {
    let dt = time.delta_secs().min(0.05);
    for (ent, mut tf, mut p) in &mut puffs {
        p.age += dt;
        if p.age >= p.life {
            materials.remove(&p.mat);
            commands.entity(ent).despawn();
            continue;
        }
        let u = p.age / p.life;
        p.vel.x *= (1.0 - 3.2 * dt).max(0.1);
        p.vel.z *= (1.0 - 3.2 * dt).max(0.1);
        p.vel.y = 0.75 + (1.0 - u) * 0.55;
        tf.translation += p.vel * dt;
        tf.rotation *= Quat::from_euler(EulerRot::XYZ, p.spin.x * dt, p.spin.y * dt, p.spin.z * dt);
        let scale = p.start_scale + (p.end_scale - p.start_scale) * u.powf(0.65);
        tf.scale = Vec3::splat(scale);
        if let Some(mut mat) = materials.get_mut(&p.mat) {
            // Stay thick and bold for most of the cloud's life, then dissolve smoothly at the end
            let fade = if u > 0.78 { ((1.0 - u) / 0.22).powf(1.2) } else { 1.0 };
            let alpha = p.max_alpha * fade;
            // Lighten very slightly from deep soot into weathered grey as it ages
            let lift = u * 0.10;
            mat.base_color = Color::srgba(p.base_rgb[0] + lift, p.base_rgb[1] + lift, p.base_rgb[2] + lift, alpha);
            let cool = (1.0 - u * 5.0).max(0.0);
            let glow = p.hot_glow * cool * cool;
            mat.emissive = LinearRgba::rgb(glow, glow * 0.35, glow * 0.06);
        }
    }
    for (ent, mut tf, mut seen, mut j) in &mut jackets {
        j.age += dt;
        if j.age >= j.life {
            // The loose jacket is kept for the next throw.
            *seen = Visibility::Hidden;
            commands.entity(ent).remove::<FlyingJacket>();
            continue;
        }
        j.vel.y -= 14.0 * dt;
        j.vel *= (1.0 - 1.4 * dt).max(0.2);
        tf.translation += j.vel * dt;
        tf.translation.y = tf.translation.y.max(0.25);
        tf.rotation *= Quat::from_euler(EulerRot::XYZ, j.rot_vel.x * dt, j.rot_vel.y * dt, j.rot_vel.z * dt);
        let u = j.age / j.life;
        let s = if u > 0.7 { (1.0 - u) / 0.3 } else { 1.0 };
        tf.scale = Vec3::splat(s.max(0.01));
    }
    for (ent, mut tf, mut sp) in &mut sparks {
        sp.age += dt;
        if sp.age >= sp.life {
            commands.entity(ent).despawn();
            continue;
        }
        sp.vel.y -= 22.0 * dt;
        tf.translation += sp.vel * dt;
        if tf.translation.y < 0.08 {
            tf.translation.y = 0.08;
            sp.vel.y = sp.vel.y.abs() * 0.35;
        }
        if sp.vel.length_squared() > 0.1 {
            tf.look_to(sp.vel.normalize(), Vec3::Y);
        }
        let fade = (1.0 - sp.age / sp.life).max(0.02);
        tf.scale = Vec3::new(fade, fade, fade * 1.1);
    }
}
