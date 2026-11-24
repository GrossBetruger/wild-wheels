//! R-Yeah (#11) as an articulated Blender PBR Bell 206 JetRanger helicopter + hanging lion:
//! - Bell 206 JetRanger with spinning main rotor (tilts forward on boost + translucent blur disc)
//!   and fast-spinning tail rotor
//! - Always-mounted 6-barrel rotary Vulcan cannon under the Bell 206 belly (muzzle at local
//!   `(1.3, 4.56, 3.05)`), spinning up with fiery muzzle flash & dynamic light whenever firing!
//! - Heroic hanging lion pilot gripping the left skid, with a lush 44-lock flowing golden-amber
//!   mane billowing dynamically in rotor downwash, speed, boost, and turns!
//! - Ground rotor-wash dust & golden sparkle rings when boosting or somersaulting.
use crate::{MobileGraphics, Presentation, app::GameSession, ported, scene};
use bevy::animation::graph::AnimationNodeIndex;
use bevy::gltf::{Gltf, GltfAssetLabel};
use bevy::mesh::morph::MorphWeights;
use bevy::prelude::*;
use std::collections::HashSet;
use std::f32::consts::{PI, TAU};

pub const DRIVER: usize = 11;

const LION_CLIPS: [&str; 4] = ["hang", "boost", "roar", "fire"];
const HANG: usize = 0;
const BOOST: usize = 1;
const ROAR: usize = 2;
const FIRE: usize = 3;
/// The mane's baked passes, in shape-key order: (frames, frames a second) for
/// hovering then streaming, as `MANE_IDLE` and `MANE_BOOST` in the Blender script.
const MANE_PASSES: [(usize, f32); 2] = [(12, 6.0), (10, 10.0)];

/// Exact local-space position of the Bell 206 Vulcan cannon muzzle crown.
/// Used by `scene.rs` to align R-Yeah's hedgehogs so they stream straight out of the barrel!
pub const VULCAN_MUZZLE_LOCAL: Vec3 = Vec3::new(1.3, 4.56, 3.05);

/// Main rotor mast top & tail rotor hub offsets in R-Yeah's local space.
const MAIN_ROTOR_OFFSET: Vec3 = Vec3::new(1.3, 4.5 + 6.15 * 0.6, -0.4 - 0.2 * 0.6);
const TAIL_ROTOR_OFFSET: Vec3 = Vec3::new(1.3 + 0.26 * 0.6, 4.5 + 3.8 * 0.6, -0.4 - 6.1 * 0.6);
const VULCAN_SOCKET: Vec3 = Vec3::new(1.3, 4.56, 1.50);

/// Hover bob height matching `lionChopper` in `client/renderer.js`.
pub fn hover_height(time_secs: f32) -> f32 {
    0.18 + (time_secs * 3.0).sin() * 0.08
}

pub struct RYeahPlugin;

impl Plugin for RYeahPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, load).add_systems(
            Update,
            (rig_ryeah, fly_ryeah, tick_rotor_wash)
                .chain()
                .after(scene::sync)
                .in_set(Presentation),
        );
    }
}

#[derive(Clone)]
struct LionMoves {
    graph: Handle<AnimationGraph>,
    clips: [AnimationNodeIndex; LION_CLIPS.len()],
}

#[derive(Resource)]
struct RYeahAssets {
    chopper: Handle<WorldAsset>,
    main_rotor: Handle<WorldAsset>,
    tail_rotor: Handle<WorldAsset>,
    vulcan_barrels: Handle<WorldAsset>,
    lion_gltf: Handle<Gltf>,
    lion: Handle<WorldAsset>,
    moves: Option<LionMoves>,
    rotor_blur_mesh: Handle<Mesh>,
    rotor_blur_mat: Handle<StandardMaterial>,
    muzzle_flash_mesh: Handle<Mesh>,
    muzzle_outer_mat: Handle<StandardMaterial>,
    muzzle_core_mat: Handle<StandardMaterial>,
    wash_mesh: Handle<Mesh>,
    wash_dust_mat: Handle<StandardMaterial>,
    wash_gold_mat: Handle<StandardMaterial>,
}

struct LionSkeleton {
    player: Entity,
    lids: Option<Entity>,
    /// The mane's mesh: its shape keys are passes of an offline wind simulation.
    mane: Option<Entity>,
}

#[derive(Component)]
struct RYeahRig {
    id: usize,
    lion_root: Entity,
    skeleton: Option<LionSkeleton>,
    main_rotor: Entity,
    rotor_blur: Entity,
    tail_rotor: Entity,
    vulcan_barrels: Entity,
    muzzle_outer: Entity,
    muzzle_core: Entity,
    muzzle_light: Option<Entity>,
    /// How far the mane has gone from its hovering passes to its streaming ones.
    mane_stream: f32,
    rotor_angle: f32,
    rotor_tilt: f32,
    vulcan_angle: f32,
    vulcan_rpm: f32,
    prev_heading: f32,
    turn_swing: f32,
    wash_timer: f32,
    weights: [f32; LION_CLIPS.len()],
    blink: f32,
}

#[derive(Component)]
struct RotorWashPuff {
    vel: Vec3,
    age: f32,
    life: f32,
    start_scale: f32,
    end_scale: f32,
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


    commands.insert_resource(RYeahAssets {
        chopper: part("chopper"),
        main_rotor: part("main_rotor"),
        tail_rotor: part("tail_rotor"),
        vulcan_barrels: part("vulcan_barrels"),
        lion_gltf: assets.load("models/ryeah_lion.glb"),
        lion: part("lion"),
        moves: None,
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

#[allow(clippy::too_many_arguments)]
fn rig_ryeah(
    mut commands: Commands,
    assets: Option<ResMut<RYeahAssets>>,
    models: Res<Assets<Gltf>>,
    mut graphs: ResMut<Assets<AnimationGraph>>,
    mut rigs: Query<&mut RYeahRig>,
    family: Query<&Children>,
    names: Query<&Name>,
    mut players: Query<&mut AnimationPlayer>,
    morphs: Query<(), With<MorphWeights>>,
) {
    let Some(mut assets) = assets else { return };
    for mut rig in &mut rigs {
        if rig.skeleton.is_some() {
            continue;
        }
        let (mut player, mut lids, mut mane) = (None, None, None);
        for part in family.iter_descendants(rig.lion_root) {
            if players.contains(part) {
                player = Some(part);
            }
            if morphs.contains(part) {
                match names.get(part).is_ok_and(|name| name.as_str().contains("Mane")) {
                    true => mane = Some(part),
                    false => lids = Some(part),
                }
            }
        }
        let Some(player) = player else { continue };
        if assets.moves.is_none() {
            let Some(model) = models.get(&assets.lion_gltf) else {
                continue;
            };
            let mut graph = AnimationGraph::new();
            let root = graph.root;
            let mut nodes = [root; LION_CLIPS.len()];
            for (index, name) in LION_CLIPS.into_iter().enumerate() {
                if let Some(clip) = model.named_animations.get(name) {
                    nodes[index] = graph.add_clip(clip.clone(), 1.0, root);
                }
            }
            assets.moves = Some(LionMoves {
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
                .set_weight(if index == HANG { 1.0 } else { 0.0 });
        }
        commands.entity(player).insert(AnimationGraphHandle(moves.graph));

        rig.skeleton = Some(LionSkeleton { player, lids, mane });
    }
}

#[allow(clippy::too_many_arguments)]
fn fly_ryeah(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    preview: Res<crate::preview::Preview>,
    mobile: Res<MobileGraphics>,
    assets: Option<Res<RYeahAssets>>,
    mut rigs: Query<(Entity, &mut RYeahRig, &mut Transform, &mut Visibility)>,
    mut parts: Query<(&mut Transform, &mut Visibility), (Without<RYeahRig>, Without<PointLight>)>,
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

            // 0. Blend lion skeletal clips (hang / boost / roar / fire) + eyelid blink!
            let target_clip = if a.celebrate > 0.0 {
                ROAR
            } else if boost {
                BOOST
            } else if vulcan_active || recently_fired {
                FIRE
            } else {
                HANG
            };
            let blend = 1.0 - (-dt * 10.0).exp();
            for (i, w) in rig.weights.iter_mut().enumerate() {
                let goal = if i == target_clip { 1.0 } else { 0.0 };
                *w += (goal - *w) * blend;
            }
            rig.blink -= dt;
            if rig.blink < -0.18 {
                rig.blink = 2.4 + ((t * 1.7 + a.id as f32).sin().abs()) * 2.8;
            }
            let blink_w = if rig.blink < 0.0 {
                let u = (-rig.blink / 0.18).clamp(0.0, 1.0);
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

            // 3. The mane: fade through the passes of its offline wind simulation.
            // Hovering passes and streaming passes each loop on their own clock;
            // speed and boost move him from one to the other, and a hard turn
            // throws the mane to the outside.
            let streaming = if boost { 1.0 } else { (speed_norm * 0.45).min(0.5) };
            rig.mane_stream += (streaming - rig.mane_stream) * (1.0 - (-dt * 5.0).exp());
            if let Some(mut keys) = rig
                .skeleton
                .as_ref()
                .and_then(|skeleton| skeleton.mane)
                .and_then(|mane| morphs.get_mut(mane).ok())
            {
                let keys = keys.weights_mut();
                keys.fill(0.0);
                let thrown = (rig.turn_swing.abs() / 0.65).min(1.0) * 0.7;
                let mut cursor = 0;
                for ((frames, rate), share) in MANE_PASSES.into_iter().zip([1.0 - rig.mane_stream, rig.mane_stream]) {
                    let at = (t + a.id as f32 * 0.37) * rate;
                    let (first, fade) = (at as usize % frames, at.fract());
                    if let Some(pass) = keys.get_mut(cursor..cursor + frames) {
                        pass[first] += share * (1.0 - thrown) * (1.0 - fade);
                        pass[(first + 1) % frames] += share * (1.0 - thrown) * fade;
                    }
                    cursor += frames;
                }
                // `left` then `right` follow the passes: the side the mane is thrown to.
                if let Some(side) = keys.get_mut(cursor + usize::from(rig.turn_swing < 0.0)) {
                    *side = thrown;
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
            // Spawn full articulated R-Yeah rig! (Mane tufts attach in `rig_ryeah` once skeleton arrives.)
            let mut lion_root = Entity::PLACEHOLDER;
            let mut main_rotor = Entity::PLACEHOLDER;
            let mut rotor_blur = Entity::PLACEHOLDER;
            let mut tail_rotor = Entity::PLACEHOLDER;
            let mut vulcan_barrels = Entity::PLACEHOLDER;
            let mut muzzle_outer = Entity::PLACEHOLDER;
            let mut muzzle_core = Entity::PLACEHOLDER;
            let mut muzzle_light = None;

            let root = commands
                .spawn((WorldAssetRoot(assets.chopper.clone()), tf))
                .with_children(|parent| {
                    lion_root = parent
                        .spawn((WorldAssetRoot(assets.lion.clone()), Transform::IDENTITY))
                        .id();

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
                })
                .id();

            commands.entity(root).insert(RYeahRig {
                id: a.id,
                lion_root,
                skeleton: None,
                main_rotor,
                rotor_blur,
                tail_rotor,
                vulcan_barrels,
                muzzle_outer,
                muzzle_core,
                muzzle_light,
                mane_stream: 0.0,
                rotor_angle: 0.0,
                rotor_tilt: 0.0,
                vulcan_angle: 0.0,
                vulcan_rpm: 2.2,
                prev_heading: a.heading as f32,
                turn_swing: 0.0,
                wash_timer: 0.0,
                weights: [1.0, 0.0, 0.0, 0.0],
                blink: 2.0 + a.id as f32 * 0.7,
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
