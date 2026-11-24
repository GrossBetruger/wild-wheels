//! KnowItOwl (#14) as a skinned Blender model on a skeleton. His moves are
//! animation clips authored in `blender/build_knowitowl.py` and blended here:
//! he pedals his bicycle, takes off without it while boosting, sheds feathers
//! in flight, blinks, and raises a wing to a glowing monocle for Dark Humor.
//! What he does and when follows `OwlFlight` in
//! `characters/knowitowl/knowitowl.js`.

use crate::{MobileGraphics, Presentation, app::GameSession, ported, scene};
use bevy::animation::{AnimationTargetId, graph::AnimationNodeIndex};
use bevy::gltf::{Gltf, GltfAssetLabel};
use bevy::mesh::morph::MorphWeights;
use bevy::prelude::*;
use bevy::{
    asset::RenderAssetUsages,
    mesh::{Indices, PrimitiveTopology},
};
use std::collections::HashSet;
use std::f32::consts::{FRAC_PI_2, PI, TAU};

pub const DRIVER: usize = 14;

// Where things sit in the racer's model space (x across, y up, z forward).
const BRACKET: Vec3 = Vec3::new(0.0, 0.95, 0.0);
const AXLES: [Vec3; 2] = [Vec3::new(0.0, 1.1, -1.9), Vec3::new(0.0, 1.1, 1.9)];
/// The monocle's centre, from the neck joint.
const MONOCLE: Vec3 = Vec3::new(0.46, 0.48, 0.96);
const LAMP: Vec3 = Vec3::new(0.0, 2.62, 2.1);

const WHEEL_RADIUS: f32 = 1.055;
/// Turns of the crank for each turn of the wheels.
const GEARING: f32 = 0.42;

/// The owl hovers this high while boosting, as in the browser.
const FLIGHT_HEIGHT: f32 = 2.4;
const FEATHER_LIFE: f32 = 2.2;
const RINGS: usize = 4;
const TEAL: Vec3 = Vec3::new(0.12, 0.9, 0.78);

/// The clips in `knowitowl.glb`, by name. The first two move only the legs;
/// the rest move everything else, so legs and upper body blend separately.
const CLIPS: [&str; 9] = ["pedal", "trail", "perch", "fly", "wave", "cheer", "wink", "flourish", "monocle"];
const PEDAL: usize = 0;
const TRAIL: usize = 1;
const PERCH: usize = 2;
const FLY: usize = 3;
/// The celebration poses of the browser, in its order, start here.
const GESTURES: usize = 4;
const LEG_CLIPS: usize = 2;
/// Mask groups of the animation graph: which bones a clip may not move.
const LEGS: u32 = 0;
const UPPER: u32 = 1;

pub struct KnowItOwlPlugin;

impl Plugin for KnowItOwlPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, load).add_systems(
            Update,
            (rig_up, ride, sync_bats, drift_feathers)
                .chain()
                .after(scene::sync)
                .in_set(Presentation),
        );
    }
}

#[derive(Resource)]
struct OwlAssets {
    owl: Handle<Gltf>,
    skin: Handle<WorldAsset>,
    bike: Handle<WorldAsset>,
    wheel: Handle<WorldAsset>,
    crank: Handle<WorldAsset>,
    /// Built once the model has loaded and the first owl has been spawned.
    moves: Option<Moves>,
    bat_body: Handle<WorldAsset>,
    bat_wings: [Handle<WorldAsset>; 2],
    bat_uzi: Handle<WorldAsset>,
    muzzle_mesh: Handle<Mesh>,
    muzzle_mat: Handle<StandardMaterial>,
    feather: Handle<Mesh>,
    feather_looks: [Handle<StandardMaterial>; 2],
    lens: Handle<Mesh>,
    ring: Handle<Mesh>,
    ring_looks: [Handle<StandardMaterial>; RINGS],
}

/// The owl's clips as one blend graph shared by every owl.
#[derive(Clone)]
struct Moves {
    graph: Handle<AnimationGraph>,
    clips: [AnimationNodeIndex; CLIPS.len()],
    /// How long the pedalling clip takes for one turn of the crank.
    crank_turn: f32,
}

#[derive(Component)]
struct BatRig {
    id: usize,
    wings: [Entity; 2],
    uzi: Entity,
    muzzle: Entity,
}

/// One owl.
#[derive(Component)]
struct OwlRig {
    id: usize,
    bike: Entity,
    wheels: [Entity; 2],
    crank: Entity,
    rider: Entity,
    lens_look: Handle<StandardMaterial>,
    lamp: Option<Entity>,
    /// The parts of the spawned model that are driven here, once it has arrived.
    skeleton: Option<Skeleton>,
    /// 0 on the bicycle, 1 in full flight.
    flight: f32,
    place: Vec3,
    roll: f32,
    turn: f32,
    /// How far into each celebration pose he is.
    gestures: [f32; CLIPS.len() - GESTURES],
    /// How brightly the monocle sees through the dark.
    glow: f32,
    /// Seconds until the next blink; negative while the eyes are closing and opening.
    blink: f32,
    shed: f32,
}

struct Skeleton {
    player: Entity,
    lids: Entity,
    rings: [Entity; RINGS],
    gleam: Option<Entity>,
}

#[derive(Component)]
struct ShedFeather {
    from: Vec3,
    drift: Vec3,
    age: f32,
    seed: f32,
}

/// A contour feather: a curved blade one unit long, drawn from both sides.
fn feather_mesh() -> Mesh {
    const STEPS: usize = 8;
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();
    for i in 0..=STEPS {
        let t = i as f32 / STEPS as f32;
        let (width, curl) = ((t * PI).sin() * 0.22 + 0.012, (t * PI).sin() * 0.06);
        for x in [-width, 0.0, width] {
            positions.push([x, t, curl - x.abs() * 0.25]);
            normals.push(Vec3::new(x.signum() * 0.35, 0.0, 1.0).normalize().to_array());
        }
        if i < STEPS {
            let row = (i * 3) as u32;
            for column in [row, row + 1] {
                indices.extend([column, column + 1, column + 4, column, column + 4, column + 3]);
            }
        }
    }
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD);
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

fn load(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let part = |name: &str| {
        assets.load(GltfAssetLabel::Scene(0).from_asset(format!("models/knowitowl_{name}.glb")))
    };
    let plume = |color: Color| StandardMaterial {
        base_color: color,
        perceptual_roughness: 0.9,
        double_sided: true,
        cull_mode: None,
        ..default()
    };
    let feather_looks = [
        materials.add(plume(Color::srgb(0.96, 0.957, 0.925))),
        materials.add(plume(Color::srgb(0.757, 0.796, 0.831))),
    ];
    let ring_looks = std::array::from_fn(|_| {
        materials.add(StandardMaterial {
            base_color: Color::BLACK,
            unlit: true,
            alpha_mode: AlphaMode::Add,
            cull_mode: None,
            ..default()
        })
    });
    let muzzle_mesh = meshes.add(Sphere::new(0.18).mesh().uv(10, 6));
    let muzzle_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.85, 0.45, 0.95),
        emissive: LinearRgba::rgb(12.0, 6.5, 1.5),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    commands.insert_resource(OwlAssets {
        owl: assets.load("models/knowitowl.glb"),
        skin: assets.load(GltfAssetLabel::Scene(0).from_asset("models/knowitowl.glb")),
        bike: part("bike"),
        wheel: part("wheel"),
        crank: part("crank"),
        moves: None,
        bat_body: assets.load(GltfAssetLabel::Scene(0).from_asset("models/bat_body.glb")),
        bat_wings: [
            assets.load(GltfAssetLabel::Scene(0).from_asset("models/bat_wing_l.glb")),
            assets.load(GltfAssetLabel::Scene(0).from_asset("models/bat_wing_r.glb")),
        ],
        bat_uzi: assets.load(GltfAssetLabel::Scene(0).from_asset("models/bat_uzi.glb")),
        muzzle_mesh,
        muzzle_mat,
        feather: meshes.add(feather_mesh()),
        feather_looks,
        lens: meshes.add(Circle::new(1.0)),
        ring: meshes.add(Torus { minor_radius: 0.035, major_radius: 1.0 }),
        ring_looks,
    });
}

fn spawn(
    commands: &mut Commands,
    assets: &OwlAssets,
    materials: &mut Assets<StandardMaterial>,
    lights: bool,
    id: usize,
    place: Transform,
) {
    // Clear glass until Dark Humor lights it.
    let lens_look = materials.add(StandardMaterial {
        base_color: Color::srgba(0.82, 0.93, 0.95, 0.16),
        perceptual_roughness: 0.04,
        reflectance: 0.9,
        alpha_mode: AlphaMode::Blend,
        cull_mode: None,
        ..default()
    });
    let none = Entity::PLACEHOLDER;
    let (mut bike, mut rider, mut crank, mut wheels, mut lamp) = (none, none, none, [none; 2], None);
    let root = commands
        .spawn((place, Visibility::Visible))
        .with_children(|root| {
            bike = root
                .spawn((WorldAssetRoot(assets.bike.clone()), Transform::IDENTITY))
                .with_children(|bike| {
                    for (wheel, axle) in wheels.iter_mut().zip(AXLES) {
                        *wheel = bike
                            .spawn((WorldAssetRoot(assets.wheel.clone()), Transform::from_translation(axle)))
                            .id();
                    }
                    crank = bike
                        .spawn((WorldAssetRoot(assets.crank.clone()), Transform::from_translation(BRACKET)))
                        .id();
                    if lights {
                        lamp = Some(
                            bike.spawn((
                                PointLight {
                                    color: Color::srgb(1.0, 0.86, 0.6),
                                    intensity: 0.0,
                                    range: 11.0,
                                    shadow_maps_enabled: false,
                                    ..default()
                                },
                                Transform::from_translation(LAMP),
                            ))
                            .id(),
                        );
                    }
                })
                .id();
            rider = root.spawn((WorldAssetRoot(assets.skin.clone()), Transform::IDENTITY)).id();
        })
        .id();
    commands.entity(root).insert(OwlRig {
        id,
        bike,
        wheels,
        crank,
        rider,
        lens_look,
        lamp,
        skeleton: None,
        flight: 0.0,
        place: place.translation,
        roll: 0.0,
        turn: 0.0,
        gestures: [0.0; CLIPS.len() - GESTURES],
        glow: 0.0,
        blink: 1.5 + id as f32 * 0.7,
        shed: 0.0,
    });
}

/// Once an owl's model has been spawned: start its clips, and hang the
/// monocle's lens, rings and light from its head.
#[allow(clippy::too_many_arguments)]
fn rig_up(
    mut commands: Commands,
    mobile: Res<MobileGraphics>,
    assets: Option<ResMut<OwlAssets>>,
    models: Res<Assets<Gltf>>,
    clips: Res<Assets<AnimationClip>>,
    mut graphs: ResMut<Assets<AnimationGraph>>,
    mut rigs: Query<&mut OwlRig>,
    family: Query<&Children>,
    bones: Query<(&Name, &AnimationTargetId)>,
    mut players: Query<&mut AnimationPlayer>,
    morphs: Query<(), With<MorphWeights>>,
) {
    let Some(mut assets) = assets else { return };
    for mut rig in &mut rigs {
        if rig.skeleton.is_some() {
            continue;
        }
        let (mut player, mut lids, mut head) = (None, None, None);
        for part in family.iter_descendants(rig.rider) {
            if players.contains(part) {
                player = Some(part);
            }
            if morphs.contains(part) {
                lids = Some(part);
            }
            if bones.get(part).is_ok_and(|(name, _)| name.as_str() == "head") {
                head = Some(part);
            }
        }
        let (Some(player), Some(lids), Some(head)) = (player, lids, head) else { continue };
        if assets.moves.is_none() {
            let Some(model) = models.get(&assets.owl) else { continue };
            let mut graph = AnimationGraph::new();
            for part in family.iter_descendants(rig.rider) {
                let Ok((name, &bone)) = bones.get(part) else { continue };
                let leg = ["thigh", "shin", "foot"].iter().any(|leg| name.starts_with(leg));
                graph.add_target_to_mask_group(bone, if leg { LEGS } else { UPPER });
            }
            let root = graph.root;
            let mut nodes = [root; CLIPS.len()];
            let mut crank_turn = 1.0;
            for (index, name) in CLIPS.into_iter().enumerate() {
                let Some(clip) = model.named_animations.get(name) else { continue };
                if index == PEDAL {
                    crank_turn = clips.get(clip).map_or(1.0, |clip| clip.duration());
                }
                let keep_off = if index < LEG_CLIPS { UPPER } else { LEGS };
                nodes[index] = graph.add_clip_with_mask(clip.clone(), 1 << keep_off, 1.0, root);
            }
            assets.moves = Some(Moves { graph: graphs.add(graph), clips: nodes, crank_turn });
        }
        let Some(moves) = assets.moves.clone() else { continue };
        let Ok(mut playing) = players.get_mut(player) else { continue };
        for (index, clip) in moves.clips.into_iter().enumerate() {
            let clip = playing.play(clip).repeat().set_weight(0.0);
            if index == PEDAL {
                // The crank, not the clock, says how far round the legs are.
                clip.pause();
            }
        }
        commands.entity(player).insert(AnimationGraphHandle(moves.graph));
        let none = Entity::PLACEHOLDER;
        let (mut rings, mut gleam) = ([none; RINGS], None);
        // The skeleton's joints are turned a quarter from the model's axes;
        // this socket turns back, so its children sit in model space.
        commands.entity(head).with_children(|head| {
            head.spawn((Transform::from_rotation(Quat::from_rotation_x(FRAC_PI_2)), Visibility::Inherited))
                .with_children(|socket| {
                    socket.spawn((
                        Mesh3d(assets.lens.clone()),
                        MeshMaterial3d(rig.lens_look.clone()),
                        Transform::from_translation(MONOCLE + Vec3::Z * 0.005)
                            .with_scale(Vec3::new(0.37, 0.41, 1.0)),
                    ));
                    for (ring, look) in rings.iter_mut().zip(&assets.ring_looks) {
                        *ring = socket
                            .spawn((
                                Mesh3d(assets.ring.clone()),
                                MeshMaterial3d(look.clone()),
                                Transform::from_translation(MONOCLE),
                                Visibility::Hidden,
                            ))
                            .id();
                    }
                    if !mobile.mobile {
                        gleam = Some(
                            socket
                                .spawn((
                                    PointLight {
                                        color: Color::srgb(TEAL.x, TEAL.y, TEAL.z),
                                        intensity: 0.0,
                                        range: 14.0,
                                        shadow_maps_enabled: false,
                                        ..default()
                                    },
                                    Transform::from_translation(MONOCLE + Vec3::Z * 0.9),
                                ))
                                .id(),
                        );
                    }
                });
        });
        rig.skeleton = Some(Skeleton { player, lids, rings, gleam });
    }
}

#[allow(clippy::too_many_arguments)]
fn ride(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    mobile: Res<MobileGraphics>,
    assets: Option<Res<OwlAssets>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut rigs: Query<(&mut OwlRig, &mut Transform, &mut Visibility), Without<BatRig>>,
    mut parts: Query<(&mut Transform, &mut Visibility), (Without<OwlRig>, Without<BatRig>)>,
    mut lights: Query<&mut PointLight>,
    mut players: Query<&mut AnimationPlayer>,
    mut morphs: Query<&mut MorphWeights>,
) {
    let Some(assets) = assets else { return };
    let Some(client) = session.client.as_ref() else { return };
    let view = client.view();
    let (now, dt) = (time.elapsed_secs(), time.delta_secs().min(0.05));
    let ease = |rate: f32| 1.0 - (-dt * rate).exp();
    let mut riding = HashSet::new();

    // The monocle's rings travel outward in step for every owl.
    for (index, look) in assets.ring_looks.iter().enumerate() {
        if let Some(mut look) = materials.get_mut(look) {
            let fade = 1.0 - (now * 0.65 + index as f32 / RINGS as f32).fract();
            look.emissive = LinearRgba::from_vec3(TEAL * 2.2 * fade * fade);
        }
    }

    for a in view.actors {
        if a.driver != DRIVER || a.inactive || a.afk || a.bomber || a.destroyed > 0.0 {
            continue;
        }
        riding.insert(a.id);
        let (jump, pitch, _, yaw) = scene::somersault(DRIVER, a.somersault);
        let ground = Vec3::new(a.wx as f32, 0.0, a.wz as f32);
        let place = ported::placement(ground + Vec3::Y * jump, a.heading as f32 + yaw, pitch, 0.0);
        let Some((mut rig, mut root, mut shown)) = rigs.iter_mut().find(|(rig, ..)| rig.id == a.id) else {
            spawn(&mut commands, &assets, &mut materials, !mobile.mobile, a.id, place);
            continue;
        };
        let rig = &mut *rig;
        *root = place;
        *shown = Visibility::Visible;

        let boosting = a.boost > 0.0;
        rig.flight += (f32::from(boosting) - rig.flight) * ease(8.0);
        let flight = rig.flight;
        let aloft = flight * flight * (3.0 - 2.0 * flight);

        // Wheels and crank turn with the ground actually covered.
        let forward = Quat::from_rotation_y(a.heading as f32) * Vec3::Z;
        let covered = (ground - rig.place).dot(forward);
        rig.place = ground;
        if covered.abs() < 4.0 {
            rig.roll = (rig.roll + covered / WHEEL_RADIUS) % TAU;
            rig.turn = (rig.turn + covered / WHEEL_RADIUS * GEARING).rem_euclid(TAU);
        }

        // Celebrations cycle through the browser's poses; Dark Humor holds the last.
        let pose = match (view.special_abilities && a.special_active > 0.0, a.celebrate > 0.0) {
            (true, _) => 6,
            (false, true) => 1 + (now * 1.3) as usize % 6,
            (false, false) => 0,
        };
        // Poses 5 and 6 are both the wing at the monocle.
        let gesture = pose.checked_sub(1).map(|gesture| gesture.min(rig.gestures.len() - 1));
        for (index, depth) in rig.gestures.iter_mut().enumerate() {
            *depth += (f32::from(gesture == Some(index)) - *depth) * ease(10.0);
        }
        rig.glow += (f32::from(pose == 6) - rig.glow) * ease(7.0);
        let monocle = rig.gestures[rig.gestures.len() - 1];

        // The bicycle stays behind the moment he takes off.
        if let Ok((_, mut bike)) = parts.get_mut(rig.bike) {
            *bike = match boosting {
                true => Visibility::Hidden,
                false => Visibility::Inherited,
            };
        }
        for wheel in rig.wheels {
            if let Ok((mut wheel, _)) = parts.get_mut(wheel) {
                wheel.rotation = Quat::from_rotation_x(rig.roll);
            }
        }
        if let Ok((mut crank, _)) = parts.get_mut(rig.crank) {
            crank.rotation = Quat::from_rotation_x(rig.turn);
        }
        if let Some(mut lamp) = rig.lamp.and_then(|lamp| lights.get_mut(lamp).ok()) {
            lamp.intensity = match boosting {
                true => 0.0,
                false => 42_000.0 + (now * 23.0 + a.id as f32).sin() * 2_500.0,
            };
        }

        // He rises off the saddle; the clips do the rest of the flying.
        let lift = flight * (FLIGHT_HEIGHT + (now * 5.0).sin() * 0.15);
        if let Ok((mut rider, _)) = parts.get_mut(rig.rider) {
            rider.translation = Vec3::Y * lift;
        }

        if let (Some(skeleton), Some(moves)) = (&rig.skeleton, &assets.moves) {
            // Legs pedal with the crank or trail in flight; the upper body
            // rests, flies, or gives way to a gesture.
            let gesturing = rig.gestures.iter().sum::<f32>().min(1.0);
            let mut weights = [0.0; CLIPS.len()];
            weights[PEDAL] = 1.0 - aloft;
            weights[TRAIL] = aloft;
            weights[PERCH] = (1.0 - flight) * (1.0 - gesturing);
            weights[FLY] = flight * (1.0 - gesturing);
            weights[GESTURES..].copy_from_slice(&rig.gestures);
            if let Ok(mut player) = players.get_mut(skeleton.player) {
                for (clip, weight) in moves.clips.iter().zip(weights) {
                    if let Some(clip) = player.animation_mut(*clip) {
                        clip.set_weight(weight);
                    }
                }
                if let Some(pedal) = player.animation_mut(moves.clips[PEDAL]) {
                    pedal.seek_to(rig.turn / TAU * moves.crank_turn);
                }
            }

            // He blinks every few seconds, and winks his left eye for the wink pose.
            rig.blink -= dt;
            if rig.blink < -0.16 {
                rig.blink = 2.2 + (now * 7.3 + a.id as f32).sin().abs() * 3.0;
            }
            let blink = match rig.blink < 0.0 {
                true => 1.0 - (rig.blink / -0.08 - 1.0).abs(),
                false => 0.0,
            };
            if let Ok(mut lids) = morphs.get_mut(skeleton.lids)
                && let [left, right, ..] = lids.weights_mut()
            {
                *left = blink.max(rig.gestures[2]).clamp(0.0, 1.0);
                *right = blink.clamp(0.0, 1.0);
            }

            // Dark Humor: the lens glows teal and sends rings ahead of him.
            if let Some(mut gleam) = skeleton.gleam.and_then(|gleam| lights.get_mut(gleam).ok()) {
                gleam.intensity = rig.glow * 70_000.0;
            }
            for (index, ring) in skeleton.rings.into_iter().enumerate() {
                let Ok((mut ring, mut seen)) = parts.get_mut(ring) else { continue };
                if rig.glow < 0.03 {
                    *seen = Visibility::Hidden;
                    continue;
                }
                *seen = Visibility::Inherited;
                let progress = (now * 0.65 + index as f32 / RINGS as f32).fract();
                ring.translation = MONOCLE + Vec3::Z * (0.14 + progress * 3.0);
                ring.rotation = Quat::from_rotation_x(FRAC_PI_2);
                ring.scale = Vec3::splat((0.14 + progress * 0.65) * rig.glow);
            }
        }
        if let Some(mut lens) = materials.get_mut(&rig.lens_look) {
            let lit = 0.35 * monocle + 2.6 * rig.glow;
            lens.emissive = LinearRgba::from_vec3(TEAL * lit);
            lens.base_color = Color::srgba(0.82 - 0.5 * rig.glow, 0.93, 0.95 - 0.1 * rig.glow, 0.16 + 0.5 * rig.glow);
        }

        // Feathers come loose from alternate wings in flight.
        let every = mobile.detail(0.055, [0.11, 0.11, 0.22, 0.22]);
        rig.shed += dt;
        if boosting && rig.shed >= every {
            rig.shed = 0.0;
            let side = (now * 29.0).sin().signum();
            let seed = now * 11.0 + a.id as f32;
            let from = place.transform_point(Vec3::new(side * (1.2 + flight), lift + 3.5, -0.4));
            commands.spawn((
                Mesh3d(assets.feather.clone()),
                MeshMaterial3d(assets.feather_looks[usize::from((seed * 3.0).sin() > 0.55)].clone()),
                Transform::from_translation(from).with_scale(Vec3::ZERO),
                ShedFeather {
                    from,
                    drift: place.rotation * Vec3::new(side, 0.0, -3.0),
                    age: 0.0,
                    seed,
                },
            ));
        }
    }

    for (rig, _, mut shown) in &mut rigs {
        if riding.contains(&rig.id) {
            continue;
        }
        *shown = Visibility::Hidden;
        let gleam = rig.skeleton.as_ref().and_then(|skeleton| skeleton.gleam);
        for light in [rig.lamp, gleam].into_iter().flatten() {
            if let Ok(mut light) = lights.get_mut(light) {
                light.intensity = 0.0;
            }
        }
    }
}

/// Articulated Blender PBR BatYouDidn'tKnow: hovers beside KnowItOwl while rapid-fire
/// (`vulcan`) is active, flaps scalloped wings, aims at targets, and kicks his Uzi with
/// a bright muzzle flash on shots.
fn sync_bats(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    assets: Option<Res<OwlAssets>>,
    mut bats: Query<(&BatRig, &mut Transform, &mut Visibility), Without<OwlRig>>,
    mut parts: Query<(&mut Transform, &mut Visibility), (Without<BatRig>, Without<OwlRig>)>,
) {
    let Some(assets) = assets else { return };
    let Some(client) = session.client.as_ref() else { return };
    let view = client.view();
    let now = time.elapsed_secs();
    let mut active = HashSet::new();

    for a in view.actors {
        if a.driver != DRIVER || a.inactive || a.afk || a.bomber || a.destroyed > 0.0 || a.vulcan <= 0.0 {
            continue;
        }
        let Some([bx, bz, aim]) = client.bat_aim(a.id) else {
            continue;
        };
        active.insert(a.id);
        let (jump, _, _, _) = scene::somersault(DRIVER, a.somersault);
        let lift = if a.boost > 0.0 { FLIGHT_HEIGHT } else { 0.0 };
        let bob = (now * 7.2 + a.id as f32).sin() * 0.22;
        let place = ported::placement(
            Vec3::new(bx as f32, 3.35 + jump + lift + bob, bz as f32),
            aim as f32,
            0.0,
            0.0,
        );
        let flap = (now * 16.0 + a.id as f32).sin();
        let firing = a.bat_cooldown > 0.09;
        let recoil = if firing { -0.11 } else { 0.0 };

        if let Some((rig, mut root_tf, mut vis)) = bats.iter_mut().find(|(r, ..)| r.id == a.id) {
            *root_tf = place;
            *vis = Visibility::Visible;
            for (i, &wing_ent) in rig.wings.iter().enumerate() {
                let sign = if i == 0 { -1.0f32 } else { 1.0f32 };
                if let Ok((mut wtf, _)) = parts.get_mut(wing_ent) {
                    wtf.rotation = Quat::from_euler(EulerRot::YXZ, sign * (-0.18 + flap * 0.22), 0.0, sign * (flap * 0.58));
                }
            }
            if let Ok((mut utf, _)) = parts.get_mut(rig.uzi) {
                utf.translation = Vec3::new(0.0, -0.52, 0.42 + recoil);
            }
            if let Ok((mut mtf, mut mvis)) = parts.get_mut(rig.muzzle) {
                *mvis = if firing { Visibility::Inherited } else { Visibility::Hidden };
                let s = 0.85 + (now * 60.0).sin().abs() * 0.55;
                mtf.scale = Vec3::new(s, s, s * 1.45);
            }
        } else {
            let none = Entity::PLACEHOLDER;
            let (mut wing_ents, mut uzi_ent, mut muzzle_ent) = ([none; 2], none, none);
            let root = commands
                .spawn((WorldAssetRoot(assets.bat_body.clone()), place, Visibility::Visible))
                .with_children(|bat| {
                    for (i, side) in [-1.0f32, 1.0f32].into_iter().enumerate() {
                        wing_ents[i] = bat
                            .spawn((
                                WorldAssetRoot(assets.bat_wings[i].clone()),
                                Transform::from_xyz(side * 0.33, 0.85, -0.05),
                            ))
                            .id();
                    }
                    uzi_ent = bat
                        .spawn((
                            WorldAssetRoot(assets.bat_uzi.clone()),
                            Transform::from_xyz(0.0, -0.52, 0.42),
                        ))
                        .with_children(|uzi| {
                            muzzle_ent = uzi
                                .spawn((
                                    Mesh3d(assets.muzzle_mesh.clone()),
                                    MeshMaterial3d(assets.muzzle_mat.clone()),
                                    Transform::from_xyz(0.0, 0.22, 1.12),
                                    Visibility::Hidden,
                                ))
                                .id();
                        })
                        .id();
                })
                .id();
            commands.entity(root).insert(BatRig {
                id: a.id,
                wings: wing_ents,
                uzi: uzi_ent,
                muzzle: muzzle_ent,
            });
        }
    }

    for (rig, _, mut vis) in &mut bats {
        if !active.contains(&rig.id) {
            *vis = Visibility::Hidden;
        }
    }
}

/// Loose feathers slow, sink and flutter, shrinking away as in the browser.
fn drift_feathers(
    mut commands: Commands,
    time: Res<Time>,
    mut feathers: Query<(Entity, &mut Transform, &mut ShedFeather)>,
) {
    let dt = time.delta_secs().min(0.05);
    for (entity, mut place, mut feather) in &mut feathers {
        feather.age += dt;
        let age = feather.age;
        if age >= FEATHER_LIFE {
            commands.entity(entity).despawn();
            continue;
        }
        let step = feather.drift * dt - Vec3::Y * dt * (0.6 + age * 0.5);
        feather.from += step;
        feather.drift *= 1.0 - (0.9 * dt).min(1.0);
        let flutter = (age * 5.0 + feather.seed).sin() * 0.3;
        place.translation = Vec3::new(feather.from.x + flutter, feather.from.y.max(0.15), feather.from.z);
        place.rotation = Quat::from_euler(
            EulerRot::YXZ,
            feather.seed + age * 2.0,
            age * 0.5 + FRAC_PI_2 * 0.6,
            (feather.seed + age * 6.0).sin() * 1.1,
        );
        place.scale = Vec3::splat((1.0 - age / FEATHER_LIFE) * 0.9);
    }
}
