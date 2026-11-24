//! KnowItOwl (#14) as an articulated Blender model: the owl pedals his bicycle,
//! takes off without it while boosting, sheds feathers in flight, and raises a
//! wing to a glowing monocle for Dark Humor. The parts come from
//! `blender/build_knowitowl.py`; the motion follows `OwlFlight` and `drawOwl`
//! in `characters/knowitowl/knowitowl.js`.

use crate::{MobileGraphics, Presentation, app::GameSession, ported, scene};
use bevy::gltf::GltfAssetLabel;
use bevy::prelude::*;
use bevy::{
    asset::RenderAssetUsages,
    mesh::{Indices, PrimitiveTopology},
};
use std::collections::HashSet;
use std::f32::consts::{FRAC_PI_2, PI, TAU};

pub const DRIVER: usize = 14;

// Where each part hinges, in the racer's model space (x across, y up, z forward).
const NECK: Vec3 = Vec3::new(0.0, 4.3, 0.05);
const SHOULDER: Vec3 = Vec3::new(0.75, 3.55, -0.35);
const HIP: Vec3 = Vec3::new(0.42, 2.75, -0.35);
const BRACKET: Vec3 = Vec3::new(0.0, 0.95, 0.0);
const AXLES: [Vec3; 2] = [Vec3::new(0.0, 1.1, -1.9), Vec3::new(0.0, 1.1, 1.9)];
/// The monocle's centre, in the head's own space.
const MONOCLE: Vec3 = Vec3::new(0.46, 0.48, 0.96);
/// The rider leans and sways about the middle of his body.
const CHEST: Vec3 = Vec3::new(0.0, 3.3, -0.3);
const LAMP: Vec3 = Vec3::new(0.0, 2.62, 2.1);

const WHEEL_RADIUS: f32 = 1.055;
const CRANK_RADIUS: f32 = 0.3;
/// Turns of the crank for each turn of the wheels.
const GEARING: f32 = 0.42;
/// A foot's sole rests this far above the middle of its pedal.
const SOLE: f32 = 0.16;
const THIGH: f32 = 1.0;
const SHIN: f32 = 1.1;
/// In flight the feet trail here, below and behind the hips.
const TRAIL: Vec2 = Vec2::new(-0.9, -1.5);

/// The owl hovers this high while boosting, as in the browser.
const FLIGHT_HEIGHT: f32 = 2.4;
const FEATHER_LIFE: f32 = 2.2;
const RINGS: usize = 4;
const TEAL: Vec3 = Vec3::new(0.12, 0.9, 0.78);

pub struct KnowItOwlPlugin;

impl Plugin for KnowItOwlPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, load).add_systems(
            Update,
            (ride, sync_bats, drift_feathers)
                .chain()
                .after(scene::sync)
                .in_set(Presentation),
        );
    }
}

#[derive(Resource)]
struct OwlAssets {
    bike: Handle<WorldAsset>,
    wheel: Handle<WorldAsset>,
    crank: Handle<WorldAsset>,
    body: Handle<WorldAsset>,
    head: Handle<WorldAsset>,
    wings: [Handle<WorldAsset>; 2],
    thigh: Handle<WorldAsset>,
    shin: Handle<WorldAsset>,
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

#[derive(Component)]
struct BatRig {
    id: usize,
    wings: [Entity; 2],
    uzi: Entity,
    muzzle: Entity,
}

/// One owl. Index 0 of each pair is his left (-x) side, index 1 his right.
#[derive(Component)]
struct OwlRig {
    id: usize,
    bike: Entity,
    wheels: [Entity; 2],
    crank: Entity,
    rider: Entity,
    head: Entity,
    wings: [Entity; 2],
    thighs: [Entity; 2],
    shins: [Entity; 2],
    rings: [Entity; RINGS],
    lens_look: Handle<StandardMaterial>,
    lamp: Option<Entity>,
    gleam: Option<Entity>,
    /// 0 on the bicycle, 1 in full flight.
    flight: f32,
    place: Vec3,
    roll: f32,
    turn: f32,
    flap: f32,
    /// How far each wing is lifted by a gesture.
    raise: [f32; 2],
    bow: f32,
    lean: f32,
    sway: f32,
    tilt: f32,
    /// How far the right wing has reached for the monocle.
    monocle: f32,
    /// How brightly the monocle sees through the dark.
    glow: f32,
    shed: f32,
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
        bike: part("bike"),
        wheel: part("wheel"),
        crank: part("crank"),
        body: part("body"),
        head: part("head"),
        wings: [part("wing_l"), part("wing_r")],
        thigh: part("thigh"),
        shin: part("shin"),
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
    let (mut bike, mut rider, mut head, mut crank) = (none, none, none, none);
    let (mut wheels, mut wings, mut thighs, mut shins) = ([none; 2], [none; 2], [none; 2], [none; 2]);
    let (mut rings, mut lamp, mut gleam) = ([none; RINGS], None, None);
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
            rider = root
                .spawn((Transform::IDENTITY, Visibility::Inherited))
                .with_children(|rider| {
                    rider.spawn((WorldAssetRoot(assets.body.clone()), Transform::IDENTITY));
                    head = rider
                        .spawn((WorldAssetRoot(assets.head.clone()), Transform::from_translation(NECK)))
                        .with_children(|head| {
                            head.spawn((
                                Mesh3d(assets.lens.clone()),
                                MeshMaterial3d(lens_look.clone()),
                                Transform::from_translation(MONOCLE + Vec3::Z * 0.005)
                                    .with_scale(Vec3::new(0.37, 0.41, 1.0)),
                            ));
                            for (ring, look) in rings.iter_mut().zip(&assets.ring_looks) {
                                *ring = head
                                    .spawn((
                                        Mesh3d(assets.ring.clone()),
                                        MeshMaterial3d(look.clone()),
                                        Transform::from_translation(MONOCLE),
                                        Visibility::Hidden,
                                    ))
                                    .id();
                            }
                            if lights {
                                gleam = Some(
                                    head.spawn((
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
                        })
                        .id();
                    for (i, side) in [-1.0f32, 1.0].into_iter().enumerate() {
                        let across = Vec3::new(side, 1.0, 1.0);
                        wings[i] = rider
                            .spawn((
                                WorldAssetRoot(assets.wings[i].clone()),
                                Transform::from_translation(SHOULDER * across),
                            ))
                            .id();
                        thighs[i] = rider
                            .spawn((WorldAssetRoot(assets.thigh.clone()), Transform::from_translation(HIP * across)))
                            .id();
                        shins[i] = rider
                            .spawn((WorldAssetRoot(assets.shin.clone()), Transform::from_translation(HIP * across)))
                            .id();
                    }
                })
                .id();
        })
        .id();
    commands.entity(root).insert(OwlRig {
        id,
        bike,
        wheels,
        crank,
        rider,
        head,
        wings,
        thighs,
        shins,
        rings,
        lens_look,
        lamp,
        gleam,
        flight: 0.0,
        place: place.translation,
        roll: 0.0,
        turn: 0.0,
        flap: 0.0,
        raise: [0.0; 2],
        bow: 0.0,
        lean: 0.0,
        sway: 0.0,
        tilt: 0.0,
        monocle: 0.0,
        glow: 0.0,
        shed: 0.0,
    });
}

/// Angles about x for a thigh hanging from `hip` and a shin from its knee so
/// that the sole reaches `target`, with the knee bent forward; and where the
/// knee ends up. Points are (height, forward).
fn leg(hip: Vec2, target: Vec2) -> (f32, f32, Vec2) {
    // A part authored hanging straight down points here once turned by `angle`.
    let hanging = |angle: f32| Vec2::new(-angle.cos(), -angle.sin());
    let reach = target - hip;
    let distance = reach.length().clamp((THIGH - SHIN).abs() + 0.02, THIGH + SHIN - 0.01);
    let toward = f32::atan2(-reach.y, -reach.x);
    let bend = ((THIGH * THIGH + distance * distance - SHIN * SHIN) / (2.0 * THIGH * distance))
        .clamp(-1.0, 1.0)
        .acos();
    let thigh = toward - bend;
    let knee = hip + hanging(thigh) * THIGH;
    let sole = hip + hanging(toward) * distance - knee;
    (thigh, f32::atan2(-sole.y, -sole.x), knee)
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
            rig.turn = (rig.turn + covered / WHEEL_RADIUS * GEARING) % TAU;
        }
        rig.flap = (rig.flap + dt * TAU * (0.44 + flight * 0.96)) % TAU;
        let flap = rig.flap.sin();

        // Celebrations cycle through the browser's poses; Dark Humor holds the last.
        let pose = match (view.special_abilities && a.special_active > 0.0, a.celebrate > 0.0) {
            (true, _) => 6,
            (false, true) => 1 + (now * 1.3) as usize % 6,
            (false, false) => 0,
        };
        let (raise, bow, lean, sway, tilt) = match pose {
            1 => ([0.0, 0.7 + (now * 9.0).sin() * 0.22], 0.0, 0.0, 0.0, 0.0),
            2 => ([0.8, 0.8], 0.3, 0.15, 0.0, 0.0),
            3 => ([0.0, 0.0], 0.06, 0.0, 0.0, 0.3),
            4 => ([1.4, 1.4], 0.0, 0.0, 1.0, 0.0),
            5 => ([0.0, 0.0], 0.05, 0.0, 0.0, 0.0),
            6 => ([0.0, 0.0], -0.08, 0.0, 0.0, 0.0),
            _ => ([0.0, 0.0], 0.0, 0.0, 0.0, 0.0),
        };
        let quick = ease(10.0);
        for (now, target) in rig.raise.iter_mut().zip(raise) {
            *now += (target - *now) * quick;
        }
        rig.bow += (bow - rig.bow) * quick;
        rig.lean += (lean - rig.lean) * quick;
        rig.sway += (sway - rig.sway) * quick;
        rig.tilt += (tilt - rig.tilt) * quick;
        rig.monocle += (f32::from(pose >= 5) - rig.monocle) * ease(12.0);
        rig.glow += (f32::from(pose == 6) - rig.glow) * ease(7.0);

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

        // He rises off the saddle, leaning into the wind, and bobs as he flaps.
        let lift = flight * (FLIGHT_HEIGHT + (now * 5.0).sin() * 0.15 - flap * 0.12);
        let posture = Quat::from_rotation_y(rig.sway * (now * 4.0).sin() * 0.45)
            * Quat::from_rotation_x(rig.lean + aloft * 0.2);
        let seat = Transform {
            translation: CHEST - posture * CHEST + Vec3::Y * lift,
            rotation: posture,
            ..default()
        };
        if let Ok((mut rider, _)) = parts.get_mut(rig.rider) {
            *rider = seat;
        }
        if let Ok((mut head, _)) = parts.get_mut(rig.head) {
            let glance = (now * 0.6 + a.id as f32 * 1.7).sin() * 0.14 * (1.0 - aloft);
            head.rotation = Quat::from_rotation_y(glance)
                * Quat::from_rotation_x(rig.bow - aloft * 0.16)
                * Quat::from_rotation_z(rig.tilt);
        }

        // Wings: folded and ruffling on the bicycle, spread and beating in flight.
        for (i, side) in [-1.0f32, 1.0].into_iter().enumerate() {
            let Ok((mut wing, _)) = parts.get_mut(rig.wings[i]) else { continue };
            let spread = flight * (0.8 + flap * 0.43) + (1.0 - flight) * (0.07 + flap * 0.16) + rig.raise[i];
            let feathering = rig.flap.cos() * 0.24 * aloft;
            let mut pose = Quat::from_rotation_z(side * spread) * Quat::from_rotation_x(feathering);
            if i == 1 {
                // The right wingtip comes up to adjust the monocle.
                let shoulder = SHOULDER * Vec3::new(side, 1.0, 1.0);
                let reach = NECK + MONOCLE + Vec3::new(0.32, -0.05, 0.1) - shoulder;
                let tap = (now * 7.0).sin() * 0.03 * rig.monocle;
                let held = Quat::from_rotation_arc(Vec3::new(0.9, -1.6, 0.0).normalize(), reach.normalize())
                    * Quat::from_rotation_y(tap);
                let reached = rig.monocle * rig.monocle * (3.0 - 2.0 * rig.monocle);
                pose = pose.slerp(held, reached);
            }
            wing.rotation = pose;
        }

        // Feet follow the pedals, then trail behind once he is airborne.
        let from_bike = seat.compute_affine().inverse();
        for (i, side) in [-1.0f32, 1.0].into_iter().enumerate() {
            let hip = Vec2::new(HIP.y, HIP.z);
            let pedal = BRACKET
                + Vec3::new(0.0, rig.turn.cos(), rig.turn.sin()) * CRANK_RADIUS * side
                + Vec3::Y * SOLE;
            let pedal = from_bike.transform_point3(pedal);
            let dangle = (now * 3.1 + side).sin() * 0.08;
            let target = Vec2::new(pedal.y, pedal.z).lerp(hip + TRAIL + Vec2::new(dangle, 0.0), aloft);
            let (thigh, shin, knee) = leg(hip, target);
            if let Ok((mut part, _)) = parts.get_mut(rig.thighs[i]) {
                part.rotation = Quat::from_rotation_x(thigh);
            }
            if let Ok((mut part, _)) = parts.get_mut(rig.shins[i]) {
                part.translation = Vec3::new(HIP.x * side, knee.x, knee.y);
                part.rotation = Quat::from_rotation_x(shin);
            }
        }

        // Dark Humor: the lens glows teal and sends rings ahead of him.
        if let Some(mut lens) = materials.get_mut(&rig.lens_look) {
            let lit = 0.35 * rig.monocle + 2.6 * rig.glow;
            lens.emissive = LinearRgba::from_vec3(TEAL * lit);
            lens.base_color = Color::srgba(0.82 - 0.5 * rig.glow, 0.93, 0.95 - 0.1 * rig.glow, 0.16 + 0.5 * rig.glow);
        }
        if let Some(mut gleam) = rig.gleam.and_then(|gleam| lights.get_mut(gleam).ok()) {
            gleam.intensity = rig.glow * 70_000.0;
        }
        for (index, ring) in rig.rings.into_iter().enumerate() {
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

        // Feathers come loose from alternate wings in flight.
        let every = mobile.detail(0.055, [0.11, 0.11, 0.22, 0.22]);
        rig.shed += dt;
        if boosting && rig.shed >= every {
            rig.shed = 0.0;
            let side = (now * 29.0).sin().signum();
            let seed = now * 11.0 + a.id as f32;
            commands.spawn((
                Mesh3d(assets.feather.clone()),
                MeshMaterial3d(assets.feather_looks[usize::from((seed * 3.0).sin() > 0.55)].clone()),
                Transform::from_translation(place.transform_point(Vec3::new(side * (1.2 + flight), lift + 3.5, -0.4)))
                    .with_scale(Vec3::ZERO),
                ShedFeather {
                    from: place.transform_point(Vec3::new(side * (1.2 + flight), lift + 3.5, -0.4)),
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
        for light in [rig.lamp, rig.gleam].into_iter().flatten() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_leg_reaches_its_pedal_all_the_way_round_with_the_knee_ahead() {
        let hip = Vec2::new(HIP.y, HIP.z);
        let hanging = |angle: f32| Vec2::new(-angle.cos(), -angle.sin());
        for step in 0..16 {
            let turn = step as f32 * TAU / 16.0;
            let pedal = Vec2::new(BRACKET.y + SOLE + turn.cos() * CRANK_RADIUS, turn.sin() * CRANK_RADIUS);
            let (thigh, shin, knee) = leg(hip, pedal);
            assert!((knee - (hip + hanging(thigh) * THIGH)).length() < 1e-5);
            assert!((knee + hanging(shin) * SHIN - pedal).length() < 1e-3, "foot misses the pedal at {turn}");
            assert!(knee.y > hip.y, "knee bends backward at {turn}");
        }
    }

    #[test]
    fn a_leg_stretches_toward_what_it_cannot_reach() {
        let hip = Vec2::new(HIP.y, HIP.z);
        let (thigh, shin, _) = leg(hip, hip + Vec2::new(-9.0, 0.0));
        assert!(thigh.abs() < 0.2 && shin.abs() < 0.2);
    }
}
