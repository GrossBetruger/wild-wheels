//! Master-Yuda (#10) as an articulated Blender PBR cruiser motorcycle & biker elder:
//! - Spinning front & rear motorcycle wheels
//! - Akira-style deep drift lean + inside exhaust scraping floor sparks
//! - Rear-axle wheelie on boost + flying leather jacket throw on boost/Vulcan!
use crate::{MobileGraphics, Presentation, app::GameSession, ported, scene};
use bevy::gltf::GltfAssetLabel;
use bevy::prelude::*;
use std::collections::HashSet;
use std::f32::consts::TAU;

pub const DRIVER: usize = 10;

const WHEEL_RADIUS: f32 = 0.92;
const AXLES: [Vec3; 2] = [Vec3::new(0.0, 0.92, -1.65), Vec3::new(0.0, 0.92, 1.80)];

pub struct YudaPlugin;

impl Plugin for YudaPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, load).add_systems(
            Update,
            (ride_yuda, tick_yuda_fx)
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
    rider_clothed: Handle<WorldAsset>,
    rider_bare: Handle<WorldAsset>,
    jacket: Handle<WorldAsset>,
    spark_mesh: Handle<Mesh>,
    spark_gold: Handle<StandardMaterial>,
    spark_cyan: Handle<StandardMaterial>,
}

#[derive(Component)]
struct YudaRig {
    id: usize,
    wheels: [Entity; 2],
    rider_clothed: Entity,
    rider_bare: Entity,
    lamp: Option<Entity>,
    spin: f32,
    roll: f32,
    side: f32,
    wheelie: f32,
    was_bare: bool,
    spark_timer: f32,
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
    commands.insert_resource(YudaAssets {
        bike: part("bike"),
        wheel: part("wheel"),
        rider_clothed: part("rider"),
        rider_bare: part("rider_bare"),
        jacket: part("jacket"),
        spark_mesh,
        spark_gold,
        spark_cyan,
    });
}

#[allow(clippy::too_many_arguments)]
fn ride_yuda(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    mobile: Res<MobileGraphics>,
    assets: Option<Res<YudaAssets>>,
    mut rigs: Query<(&mut YudaRig, &mut Transform, &mut Visibility)>,
    mut parts: Query<(&mut Transform, &mut Visibility), Without<YudaRig>>,
    mut lights: Query<&mut PointLight>,
) {
    let Some(assets) = assets else { return };
    let Some(client) = session.client.as_ref() else { return };
    let view = client.view();
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

            // Toggle clothed vs bare-chested rider & throw the flying leather jacket on strip!
            if bare && !rig.was_bare {
                let back = place.rotation * Vec3::NEG_Z;
                commands.spawn((
                    WorldAssetRoot(assets.jacket.clone()),
                    Transform::from_translation(place.transform_point(Vec3::new(0.0, 2.6, -0.6)))
                        .with_rotation(place.rotation),
                    FlyingJacket {
                        vel: back * 14.0 + Vec3::Y * 7.5,
                        rot_vel: Vec3::new(5.5, 4.2, -3.8),
                        age: 0.0,
                        life: 1.15,
                    },
                ));
            }
            rig.was_bare = bare;
            if let Ok((_, mut cvis)) = parts.get_mut(rig.rider_clothed) {
                *cvis = if bare { Visibility::Hidden } else { Visibility::Inherited };
            }
            if let Ok((_, mut bvis)) = parts.get_mut(rig.rider_bare) {
                *bvis = if bare { Visibility::Inherited } else { Visibility::Hidden };
            }
            if let Some(lamp) = rig.lamp
                && let Ok(mut light) = lights.get_mut(lamp)
            {
                light.intensity = if boosting { 160_000.0 } else { 85_000.0 };
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
            let (mut wheels, mut rider_clothed, mut rider_bare, mut lamp) = ([none; 2], none, none, None);
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
                    rider_clothed = bike
                        .spawn((WorldAssetRoot(assets.rider_clothed.clone()), Transform::IDENTITY))
                        .id();
                    rider_bare = bike
                        .spawn((
                            WorldAssetRoot(assets.rider_bare.clone()),
                            Transform::IDENTITY,
                            Visibility::Hidden,
                        ))
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
                rider_clothed,
                rider_bare,
                lamp,
                spin: 0.0,
                roll: 0.0,
                side: 1.0,
                wheelie: 0.0,
                was_bare: false,
                spark_timer: 0.0,
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
    mut jackets: Query<(Entity, &mut Transform, &mut FlyingJacket), Without<ScrapeSpark>>,
    mut sparks: Query<(Entity, &mut Transform, &mut ScrapeSpark), Without<FlyingJacket>>,
) {
    let dt = time.delta_secs().min(0.05);
    for (ent, mut tf, mut j) in &mut jackets {
        j.age += dt;
        if j.age >= j.life {
            commands.entity(ent).despawn();
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
