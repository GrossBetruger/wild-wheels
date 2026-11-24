mod arena_mesh;
mod bench;
mod plumage;
mod ported;
mod scene;
mod sound;
mod sprite;
mod xray;

use bevy::asset::AssetMetaCheck;
use bevy::gltf::GltfAssetLabel;
use bevy::prelude::*;
use bevy::window::WindowResolution;
use serde_json::json;
use std::sync::{Mutex, OnceLock};
use wasm_bindgen::prelude::*;
use wild_wheels_core::{Action, Frame, Input, NativeArena, NativeClient};

pub mod reports {
    pub fn limited(_key: &str, _seconds: f64, _level: &str, _event: &str, _data: impl FnOnce() -> serde_json::Value) {}
}

pub mod app {
    use bevy::prelude::*;
    use wild_wheels_core::NativeClient;

    #[derive(Resource, Default)]
    pub struct GameSession {
        pub client: Option<NativeClient>,
        pub sounds: Vec<String>,
        pub voices: Vec<(usize, String, f64)>,
    }
    impl GameSession {
        pub fn joined(&self) -> bool {
            self.client.is_some()
        }
    }
}

#[derive(Resource)]
struct LocalMatch {
    arena: NativeArena,
    elapsed: f64,
    next_action: u32,
    last_x_tap: f64,
}

#[derive(Resource, Clone, Copy)]
struct LaunchConfig {
    driver: usize,
    arena: usize,
    bots: usize,
}

static PACK_BYTES: OnceLock<&'static [u8]> = OnceLock::new();
static SOUND_BYTES: OnceLock<&'static [u8]> = OnceLock::new();
static HUD_JSON: Mutex<String> = Mutex::new(String::new());

#[wasm_bindgen]
pub fn hud_state() -> String {
    HUD_JSON.lock().map(|g| g.clone()).unwrap_or_default()
}

pub(crate) fn pack_bytes() -> &'static [u8] {
    PACK_BYTES.get().copied().unwrap_or(&[])
}

pub(crate) fn sound_pack_bytes() -> &'static [u8] {
    SOUND_BYTES.get().copied().unwrap_or(&[])
}

const BLENDER_MODELS: &[(usize, &str)] = &[(15, "taicoon.glb")];

const RAPTOR_ENGINES: [(f32, f32, f32); 6] = [
    (0.0, 0.64, 0.28),
    (-0.55, -0.32, 0.28),
    (0.55, -0.32, 0.28),
    (0.0, -0.27, 0.16),
    (-0.23, 0.14, 0.16),
    (0.23, 0.14, 0.16),
];

pub(crate) fn has_blender_model(driver: usize) -> bool {
    driver == 7 || BLENDER_MODELS.iter().any(|&(d, _)| d == driver)
}

#[derive(Resource)]
struct BlenderModels {
    static_models: std::collections::HashMap<usize, Handle<WorldAsset>>,
    houston_ship: Handle<WorldAsset>,
    houston_pilot: Handle<WorldAsset>,
    houston_arm_l: Handle<WorldAsset>,
    houston_arm_r: Handle<WorldAsset>,
    flame_mesh: Handle<Mesh>,
    diamond_mesh: Handle<Mesh>,
    flame_outer_mat: Handle<StandardMaterial>,
    flame_inner_mat: Handle<StandardMaterial>,
    diamond_mat: Handle<StandardMaterial>,
    smoke_mat: Handle<StandardMaterial>,
    spark_mat: Handle<StandardMaterial>,
    rcs_mat: Handle<StandardMaterial>,
}

#[derive(Component)]
struct ExhaustParticle {
    vel: Vec3,
    age: f32,
    life: f32,
    start_scale: f32,
    end_scale: f32,
}

#[derive(Component)]
struct BlenderRacer {
    id: usize,
    driver: usize,
}

#[derive(Component)]
struct HoustonRig {
    id: usize,
    pilot: Entity,
    arm_l: Entity,
    arm_r: Entity,
    flames: Vec<(Entity, Entity, f32, f32, f32)>,
    diamonds: Vec<(Entity, f32, f32, f32, usize)>, // (entity, ex, ey, er, diamond_idx)
    rcs: [Entity; 2],
    plume_light: Entity,
}

#[wasm_bindgen]
pub fn start_game(pack: Vec<u8>, sound_pack: Vec<u8>, driver: usize, arena: usize, bots: usize) {
    console_error_panic_hook::set_once();
    let leaked: &'static [u8] = Box::leak(pack.into_boxed_slice());
    let _ = PACK_BYTES.set(leaked);
    let leaked_sound: &'static [u8] = Box::leak(sound_pack.into_boxed_slice());
    let _ = SOUND_BYTES.set(leaked_sound);

    let cfg = LaunchConfig {
        driver: driver.min(15),
        arena: arena.min(2),
        bots: bots.min(7),
    };

    let mut bevy_app = App::new();
    bevy_app
        .add_plugins(
            DefaultPlugins
                .set(AssetPlugin {
                    meta_check: AssetMetaCheck::Never,
                    ..default()
                })
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        title: "Wild Wheels — Bevy WASM PoC".into(),
                        canvas: Some("#bevy-canvas".into()),
                        fit_canvas_to_parent: true,
                        prevent_default_event_handling: true,
                        resolution: WindowResolution::new(1280, 720),
                        ..default()
                    }),
                    ..default()
                }),
        )
        .insert_resource(cfg)
        .insert_resource(app::GameSession::default())
        .insert_resource(scene::Capture(None))
        .add_plugins((
            ported::PortedGraphicsPlugin,
            scene::ArenaPresentationPlugin,
            sound::GameAudioPlugin,
        ))
        .add_systems(Startup, (start_local_match, load_blender_models))
        .add_systems(
            Update,
            (
                tick_local_match,
                scene::sync,
                sync_blender_models,
                tick_exhaust_particles,
                ported::animate,
                sound::play,
            )
                .chain(),
        );

    bevy_app.run();
}

fn load_blender_models(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let mut static_models = std::collections::HashMap::new();
    for &(driver, file) in BLENDER_MODELS {
        static_models.insert(driver, assets.load(GltfAssetLabel::Scene(0).from_asset(file)));
    }
    let flame_mesh = meshes.add(Cone::new(1.0, 1.0));
    let diamond_mesh = meshes.add(Sphere::new(1.0).mesh().uv(12, 8));
    let flame_outer_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.45, 0.14, 0.98, 0.72),
        emissive: LinearRgba::rgb(2.6, 0.55, 6.2),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    let flame_inner_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.48, 0.92, 1.0, 0.95),
        emissive: LinearRgba::rgb(1.0, 4.4, 7.8),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    let diamond_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.88, 0.98, 1.0, 1.0),
        emissive: LinearRgba::rgb(6.5, 9.0, 11.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    let smoke_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.74, 0.80, 0.88, 0.34),
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        cull_mode: None,
        ..default()
    });
    let spark_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.85, 0.55, 1.0),
        emissive: LinearRgba::rgb(8.0, 4.8, 1.8),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    let rcs_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.88, 0.95, 1.0, 0.7),
        emissive: LinearRgba::rgb(1.4, 1.7, 2.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    commands.insert_resource(BlenderModels {
        static_models,
        houston_ship: assets.load(GltfAssetLabel::Scene(0).from_asset("houston_ship.glb")),
        houston_pilot: assets.load(GltfAssetLabel::Scene(0).from_asset("houston_pilot.glb")),
        houston_arm_l: assets.load(GltfAssetLabel::Scene(0).from_asset("houston_arm_l.glb")),
        houston_arm_r: assets.load(GltfAssetLabel::Scene(0).from_asset("houston_arm_r.glb")),
        flame_mesh,
        diamond_mesh,
        flame_outer_mat,
        flame_inner_mat,
        diamond_mat,
        smoke_mat,
        spark_mat,
        rcs_mat,
    });
}

fn sync_blender_models(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<app::GameSession>,
    models: Option<Res<BlenderModels>>,
    mut existing: Query<(Entity, &BlenderRacer, &mut Transform, &mut Visibility), Without<HoustonRig>>,
    mut rigs: Query<(Entity, &HoustonRig, &mut Transform, &mut Visibility), Without<BlenderRacer>>,
    mut parts: Query<
        (&mut Transform, &mut Visibility),
        (Without<BlenderRacer>, Without<HoustonRig>, Without<PointLight>),
    >,
    mut lights: Query<&mut PointLight>,
) {
    let Some(models) = models else { return };
    let Some(client) = session.client.as_ref() else { return };
    let view = client.view();
    let t = time.elapsed_secs();
    let mut alive_static = std::collections::HashSet::new();
    let mut alive_houston = std::collections::HashSet::new();

    for a in view.actors {
        if a.inactive || a.afk || a.bomber || a.destroyed > 0.0 {
            continue;
        }
        let pitch = if a.somersault > 0.0 {
            let p = (1.0 - a.somersault as f32 / 0.55).clamp(0.0, 1.0);
            p * std::f32::consts::TAU
        } else {
            0.0
        };
        let somersault_h = if a.somersault > 0.0 {
            let p = (1.0 - a.somersault as f32 / 0.55).clamp(0.0, 1.0);
            (p * std::f32::consts::PI).sin() * 3.2
        } else {
            0.0
        };

        // Animated multi-part Blender Houston: Starship + rotating/waving sloth + 6 Raptor afterburners + RCS jets!
        if a.driver == 7 {
            alive_houston.insert(a.id);
            let hover = if a.somersault > 0.0 {
                somersault_h
            } else {
                (t * 5.0 + a.id as f32).sin() * 0.04
            };
            let boost_tilt = if a.boost > 0.0 && a.somersault <= 0.0 { -0.075 } else { 0.0 };
            let tf = ported::placement(
                Vec3::new(a.wx as f32, hover, a.wz as f32),
                a.heading as f32,
                pitch + boost_tilt,
                0.0,
            );

            // Faithful celebration turn & bounce (from client/renderer.js line 281-282)
            let progress = (1.6 - a.celebrate as f32).max(0.0);
            let envelope = if a.celebrate > 0.0 {
                (progress / 0.25).min(a.celebrate as f32 / 0.4).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let turn = envelope * envelope * (3.0 - 2.0 * envelope);
            let cel_bounce = turn * (progress * 15.0).sin() * 0.14;

            let firing = a.boost > 0.0 || a.somersault > 0.0;
            let nightmare = a.nightmare_active > 0.0;

            if let Some((_, rig, mut ship_tf, mut ship_vis)) =
                rigs.iter_mut().find(|(_, r, _, _)| r.id == a.id)
            {
                *ship_tf = tf;
                *ship_vis = Visibility::Visible;
                if let Ok((mut p_tf, _)) = parts.get_mut(rig.pilot) {
                    p_tf.translation = Vec3::new(0.0, cel_bounce, 0.0);
                    p_tf.rotation = Quat::from_rotation_y(turn * std::f32::consts::PI);
                }
                for &(arm_ent, side) in &[(rig.arm_l, -1.0f32), (rig.arm_r, 1.0f32)] {
                    if let Ok((mut a_tf, _)) = parts.get_mut(arm_ent) {
                        let wave = turn * (progress * 18.0 + side).sin() * 0.35;
                        a_tf.translation = Vec3::new(side * 0.85, 2.25, 0.28);
                        a_tf.rotation = Quat::from_euler(
                            EulerRot::XYZ,
                            -turn * 1.55 + wave,
                            0.0,
                            side * turn * 0.52,
                        );
                    }
                }
                for (idx, &(outer, inner, ex, ey, er)) in rig.flames.iter().enumerate() {
                    let f1 = (t * 58.0 + idx as f32 * 2.3).sin();
                    let f2 = (t * 97.0 + idx as f32 * 4.1).cos();
                    let flicker = 1.0 + f1 * 0.22 + f2 * 0.12;
                    let wobble_x = (t * 43.0 + idx as f32 * 1.9).sin() * if firing || nightmare { 0.08 } else { 0.03 };
                    let wobble_y = (t * 37.0 + idx as f32 * 3.1).cos() * if firing || nightmare { 0.07 } else { 0.025 };
                    let (len_o, rad_o, len_i, rad_i) = if nightmare {
                        (8.4 * flicker, er * 1.85, 5.9 * flicker, er * 1.12)
                    } else if firing {
                        (6.5 * flicker, er * 1.50, 4.5 * flicker, er * 0.90)
                    } else {
                        (1.10 * flicker, er * 0.74, 0.66 * flicker, er * 0.48)
                    };
                    if let Ok((mut otf, mut ovis)) = parts.get_mut(outer) {
                        *ovis = Visibility::Inherited;
                        otf.translation = Vec3::new(ex + wobble_x, 1.45 + ey + wobble_y, -3.50 - len_o * 0.5);
                        otf.rotation = Quat::from_euler(EulerRot::XYZ, -std::f32::consts::FRAC_PI_2 + wobble_y * 0.6, wobble_x * 0.6, 0.0);
                        otf.scale = Vec3::new(rad_o * (1.0 + f2 * 0.12), len_o, rad_o * (1.0 - f2 * 0.12));
                    }
                    if let Ok((mut itf, mut ivis)) = parts.get_mut(inner) {
                        *ivis = Visibility::Inherited;
                        itf.translation = Vec3::new(ex + wobble_x * 0.5, 1.45 + ey + wobble_y * 0.5, -3.50 - len_i * 0.5);
                        itf.scale = Vec3::new(rad_i, len_i, rad_i);
                    }
                }
                // Spawn turbulent world-space exhaust smoke clouds & sputtering methalox embers!
                let back_dir = tf.rotation * Vec3::NEG_Z;
                let right_dir = tf.rotation * Vec3::X;
                let up_dir = tf.rotation * Vec3::Y;
                let emit_count = if nightmare { 3 } else if firing { 2 } else { 1 };
                let seed = (t * 60.0) as usize;
                for k in 0..emit_count {
                    let eng = RAPTOR_ENGINES[(seed + k * 2 + a.id) % 3];
                    let jitter = ((seed * 37 + k * 17) % 100) as f32 / 100.0 - 0.5;
                    let jitter2 = ((seed * 53 + k * 29) % 100) as f32 / 100.0 - 0.5;
                    let nozzle_pos = tf.transform_point(Vec3::new(eng.0, 1.45 + eng.1, -3.65));
                    // Billowing exhaust smoke cloud drifting & curling in world space
                    if firing || nightmare || (seed + k) % 3 == 0 {
                        let spd = if firing || nightmare { 16.0 } else { 5.5 };
                        let vel = back_dir * spd
                            + right_dir * (jitter * if firing { 4.8 } else { 1.6 })
                            + up_dir * (0.9 + jitter2 * 2.2);
                        commands.spawn((
                            Mesh3d(models.diamond_mesh.clone()),
                            MeshMaterial3d(models.smoke_mat.clone()),
                            Transform::from_translation(nozzle_pos).with_scale(Vec3::splat(0.38)),
                            ExhaustParticle {
                                vel,
                                age: 0.0,
                                life: if firing || nightmare { 0.55 } else { 0.35 },
                                start_scale: if firing || nightmare { 0.45 } else { 0.22 },
                                end_scale: if firing || nightmare { 2.35 } else { 0.95 },
                            },
                        ));
                    }
                    // Incandescent hot sparks / plasma embers spitting out on boost & Nightmare Fuel!
                    if (firing || nightmare) && (seed + k) % 2 == 0 {
                        let vel = back_dir * (28.0 + jitter.abs() * 14.0)
                            + right_dir * (jitter * 9.5)
                            + up_dir * (jitter2 * 5.5 + 1.2);
                        commands.spawn((
                            Mesh3d(models.diamond_mesh.clone()),
                            MeshMaterial3d(if k % 2 == 0 { models.spark_mat.clone() } else { models.diamond_mat.clone() }),
                            Transform::from_translation(nozzle_pos).with_scale(Vec3::splat(0.18)),
                            ExhaustParticle {
                                vel,
                                age: 0.0,
                                life: 0.28,
                                start_scale: 0.20,
                                end_scale: 0.03,
                            },
                        ));
                    }
                }
                // Glowing supersonic Mach shock diamonds pulsing down the 3 main Raptor plumes!
                for &(d_ent, ex, ey, er, di) in &rig.diamonds {
                    if let Ok((mut dtf, mut dvis)) = parts.get_mut(d_ent) {
                        if firing || nightmare {
                            *dvis = Visibility::Inherited;
                            let spacing = if nightmare { 1.45 } else { 1.15 };
                            let pulse = 1.0 + (t * 60.0 + di as f32 * 1.9).sin() * 0.18;
                            let z = -3.85 - di as f32 * spacing;
                            let taper = (1.0 - di as f32 * 0.18).max(0.35);
                            dtf.translation = Vec3::new(ex, 1.45 + ey, z);
                            dtf.scale = Vec3::new(er * 0.58 * taper * pulse, er * 0.58 * taper * pulse, er * 1.35 * taper * pulse);
                        } else {
                            *dvis = Visibility::Hidden;
                        }
                    }
                }
                if let Ok(mut light) = lights.get_mut(rig.plume_light) {
                    light.intensity = if nightmare {
                        420_000.0
                    } else if firing {
                        220_000.0
                    } else {
                        18_000.0
                    };
                }
                let rcs_z = if a.somersault > 0.275 { 2.05 } else { -2.35 };
                for (i, &rcs_ent) in rig.rcs.iter().enumerate() {
                    let side = if i == 0 { -1.0f32 } else { 1.0f32 };
                    if let Ok((mut rtf, mut rvis)) = parts.get_mut(rcs_ent) {
                        if a.somersault > 0.0 {
                            let fl = 1.0 + (t * 40.0 + side).sin() * 0.2;
                            *rvis = Visibility::Inherited;
                            rtf.translation = Vec3::new(side * (1.02 + 0.85 * fl), 1.62, rcs_z);
                            rtf.scale = Vec3::new(0.24, 1.7 * fl, 0.24);
                        } else {
                            *rvis = Visibility::Hidden;
                        }
                    }
                }
            } else {
                // Spawn full animated Houston rig!
                let mut pilot_ent = Entity::PLACEHOLDER;
                let mut arm_l_ent = Entity::PLACEHOLDER;
                let mut arm_r_ent = Entity::PLACEHOLDER;
                let mut flames = Vec::with_capacity(6);
                let mut diamonds = Vec::with_capacity(12);
                let mut rcs_ents = [Entity::PLACEHOLDER; 2];
                let mut plume_light = Entity::PLACEHOLDER;

                let ship_ent = commands
                    .spawn((WorldAssetRoot(models.houston_ship.clone()), tf))
                    .with_children(|ship| {
                        pilot_ent = ship
                            .spawn((
                                WorldAssetRoot(models.houston_pilot.clone()),
                                Transform::IDENTITY,
                            ))
                            .with_children(|pilot| {
                                arm_l_ent = pilot
                                    .spawn((
                                        WorldAssetRoot(models.houston_arm_l.clone()),
                                        Transform::from_xyz(-0.85, 2.25, 0.28),
                                    ))
                                    .id();
                                arm_r_ent = pilot
                                    .spawn((
                                        WorldAssetRoot(models.houston_arm_r.clone()),
                                        Transform::from_xyz(0.85, 2.25, 0.28),
                                    ))
                                    .id();
                            })
                            .id();

                        let back_rot = Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2);
                        for (idx, (ex, ey, er)) in RAPTOR_ENGINES.into_iter().enumerate() {
                            let outer = ship
                                .spawn((
                                    Mesh3d(models.flame_mesh.clone()),
                                    MeshMaterial3d(models.flame_outer_mat.clone()),
                                    Transform {
                                        translation: Vec3::new(ex, 1.45 + ey, -3.95),
                                        rotation: back_rot,
                                        scale: Vec3::new(er, 1.0, er),
                                    },
                                ))
                                .id();
                            let inner = ship
                                .spawn((
                                    Mesh3d(models.flame_mesh.clone()),
                                    MeshMaterial3d(models.flame_inner_mat.clone()),
                                    Transform {
                                        translation: Vec3::new(ex, 1.45 + ey, -3.75),
                                        rotation: back_rot,
                                        scale: Vec3::new(er * 0.6, 0.6, er * 0.6),
                                    },
                                ))
                                .id();
                            flames.push((outer, inner, ex, ey, er));
                            // 4 Mach shock diamonds behind each of the 3 main RVac bells
                            if idx < 3 {
                                for di in 0..4 {
                                    let d = ship
                                        .spawn((
                                            Mesh3d(models.diamond_mesh.clone()),
                                            MeshMaterial3d(models.diamond_mat.clone()),
                                            Transform::from_xyz(ex, 1.45 + ey, -4.0 - di as f32),
                                            Visibility::Hidden,
                                        ))
                                        .id();
                                    diamonds.push((d, ex, ey, er, di));
                                }
                            }
                        }
                        plume_light = ship
                            .spawn((
                                PointLight {
                                    color: Color::srgb(0.45, 0.72, 1.0),
                                    intensity: 18_000.0,
                                    range: 22.0,
                                    shadow_maps_enabled: false,
                                    ..default()
                                },
                                Transform::from_xyz(0.0, 1.45, -5.2),
                            ))
                            .id();
                        for (i, side) in [-1.0f32, 1.0f32].into_iter().enumerate() {
                            rcs_ents[i] = ship
                                .spawn((
                                    Mesh3d(models.flame_mesh.clone()),
                                    MeshMaterial3d(models.rcs_mat.clone()),
                                    Transform {
                                        translation: Vec3::new(side * 1.5, 1.62, 2.05),
                                        rotation: Quat::from_rotation_z(
                                            -side * std::f32::consts::FRAC_PI_2,
                                        ),
                                        scale: Vec3::new(0.22, 1.5, 0.22),
                                    },
                                    Visibility::Hidden,
                                ))
                                .id();
                        }
                    })
                    .id();

                commands.entity(ship_ent).insert(HoustonRig {
                    id: a.id,
                    pilot: pilot_ent,
                    arm_l: arm_l_ent,
                    arm_r: arm_r_ent,
                    flames,
                    diamonds,
                    rcs: rcs_ents,
                    plume_light,
                });
            }
            continue;
        }

        let Some(handle) = models.static_models.get(&a.driver) else {
            continue;
        };
        alive_static.insert(a.id);
        let bounce = if a.celebrate > 0.0 {
            (t * 14.0).sin().abs() * 0.65
        } else {
            (t * 6.0 + a.id as f32).sin() * 0.04
        };
        let height = if a.somersault > 0.0 { somersault_h } else { bounce };
        let tf = ported::placement(
            Vec3::new(a.wx as f32, height, a.wz as f32),
            a.heading as f32,
            pitch,
            0.0,
        );
        if let Some((_, _, mut cur_tf, mut vis)) =
            existing.iter_mut().find(|(_, r, _, _)| r.id == a.id && r.driver == a.driver)
        {
            *cur_tf = tf;
            *vis = Visibility::Visible;
        } else {
            commands.spawn((
                BlenderRacer { id: a.id, driver: a.driver },
                WorldAssetRoot(handle.clone()),
                tf,
            ));
        }
    }
    for (_, r, _, mut vis) in &mut existing {
        if !alive_static.contains(&r.id) {
            *vis = Visibility::Hidden;
        }
    }
    for (_, rig, _, mut vis) in &mut rigs {
        if !alive_houston.contains(&rig.id) {
            *vis = Visibility::Hidden;
            for &(outer, inner, _, _, _) in &rig.flames {
                if let Ok((_, mut ovis)) = parts.get_mut(outer) {
                    *ovis = Visibility::Hidden;
                }
                if let Ok((_, mut ivis)) = parts.get_mut(inner) {
                    *ivis = Visibility::Hidden;
                }
            }
            for &(d_ent, _, _, _, _) in &rig.diamonds {
                if let Ok((_, mut dvis)) = parts.get_mut(d_ent) {
                    *dvis = Visibility::Hidden;
                }
            }
            for &rcs_ent in &rig.rcs {
                if let Ok((_, mut rvis)) = parts.get_mut(rcs_ent) {
                    *rvis = Visibility::Hidden;
                }
            }
            if let Ok(mut light) = lights.get_mut(rig.plume_light) {
                light.intensity = 0.0;
            }
        }
    }
}

fn tick_exhaust_particles(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(Entity, &mut Transform, &mut ExhaustParticle)>,
) {
    let dt = time.delta_secs().min(0.05);
    for (ent, mut tf, mut p) in &mut q {
        p.age += dt;
        if p.age >= p.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = p.age / p.life;
        tf.translation += p.vel * dt;
        p.vel *= (1.0 - 3.2 * dt).max(0.2);
        let s = p.start_scale + (p.end_scale - p.start_scale) * u.sqrt();
        let fade = if u > 0.7 { (1.0 - u) / 0.3 } else { 1.0 };
        tf.scale = Vec3::splat((s * fade).max(0.01));
    }
}

fn start_local_match(
    mut commands: Commands,
    cfg: Res<LaunchConfig>,
    mut session: ResMut<app::GameSession>,
) {
    let bots = if cfg.arena == 2 { cfg.bots.min(3) } else { cfg.bots.min(7) };
    let config = json!({
        "code": "00",
        "maxPlayers": 8,
        "arena": cfg.arena,
        "bots": bots,
        "dedicated": true,
        "host": null,
        "epoch": 1,
        "seed": 42,
        "players": [{"id": 0, "name": "WASM Pilot", "driver": cfg.driver, "role": "driver"}],
        "specialAbilities": true,
        "targetScore": 15,
        "matchMinutes": 5
    });
    let mut arena = NativeArena::new(config).expect("valid local arena");
    arena.start();
    let pkt = arena.packet(0);
    session.client = NativeClient::from_packet(&pkt, 0.0).ok();
    commands.insert_resource(LocalMatch {
        arena,
        elapsed: 0.0,
        next_action: 1,
        last_x_tap: -10.0,
    });
}

fn tick_local_match(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    mut local: ResMut<LocalMatch>,
    mut session: ResMut<app::GameSession>,
) {
    let dt = f64::from(time.delta_secs()).clamp(1.0 / 240.0, 0.05);
    local.elapsed += dt;

    let mut bits = 0u32;
    if keys.pressed(KeyCode::KeyW) || keys.pressed(KeyCode::ArrowUp) {
        bits |= 1;
    }
    if keys.pressed(KeyCode::KeyS) || keys.pressed(KeyCode::ArrowDown) {
        bits |= 2;
    }
    if keys.pressed(KeyCode::KeyA) || keys.pressed(KeyCode::ArrowLeft) {
        bits |= 8;
    }
    if keys.pressed(KeyCode::KeyD) || keys.pressed(KeyCode::ArrowRight) {
        bits |= 4;
    }
    if keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight) {
        bits |= 16;
    }
    if keys.pressed(KeyCode::Space) {
        bits |= 32;
    }

    let mut actions = Vec::new();
    let mut push = |kind: &str, item: &str, id: &mut u32| {
        actions.push(Action {
            id: Some(*id),
            kind: kind.into(),
            after_move: -1,
            wx: 0.0,
            wz: 0.0,
            item: item.into(),
            bomb_kind: None,
        });
        *id += 1;
    };
    if keys.just_pressed(KeyCode::KeyX) || keys.just_pressed(KeyCode::KeyE) {
        if local.elapsed - local.last_x_tap <= 0.38 {
            push("nightmare", "", &mut local.next_action);
            local.last_x_tap = -10.0;
        } else {
            push("turbo", "", &mut local.next_action);
            local.last_x_tap = local.elapsed;
        }
    }
    if keys.just_pressed(KeyCode::KeyF) {
        push("special", "", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::KeyZ) {
        push("somersault", "", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::KeyC) {
        push("chaff", "", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::Tab) || keys.just_pressed(KeyCode::KeyQ) {
        push("cycle", "", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::Digit1) {
        push("select", "hedgehog", &mut local.next_action);
    }
    if keys.just_pressed(KeyCode::Digit2) {
        push("select", "missile", &mut local.next_action);
    }

    let frame = Frame {
        dt,
        inputs: vec![Input {
            actor: 0,
            keys: bits,
            steer: None,
            sequence: None,
            moves: None,
            actions,
            action_clock: false,
        }],
    };
    let _ = local.arena.step(frame);
    let (events, voices) = local.arena.cues(0);
    let pkt = local.arena.packet_with_cues(0, events, voices);
    local.arena.drain();
    let (mut drained_sounds, mut drained_voices) = (Vec::new(), Vec::new());
    if let Some(client) = session.client.as_mut() {
        let _ = client.accept(&pkt, local.elapsed);
        drained_sounds = client.drain_audio();
        drained_voices = client.drain_voices();
        let view = client.view();
        let p = view.player;
        let mut standings: Vec<_> = view
            .actors
            .iter()
            .filter(|a| !a.inactive)
            .map(|a| {
                (
                    a.kills,
                    a.deaths,
                    a.id,
                    a.name.as_deref().unwrap_or("Bot"),
                    a.color.as_str(),
                )
            })
            .collect();
        standings.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        let rows: Vec<_> = standings
            .into_iter()
            .map(|(kills, deaths, id, name, color)| {
                json!({ "name": name, "color": color, "kills": kills, "deaths": deaths, "me": id == view.you })
            })
            .collect();
        let snap = json!({
            "phase": view.phase,
            "elapsed": view.elapsed,
            "duration": view.duration,
            "countdown": view.countdown,
            "health": p.health,
            "destroyed": p.destroyed,
            "speed": p.speed,
            "ammo": p.ammo,
            "missiles": p.missiles,
            "turbos": p.turbos,
            "chaff": p.chaff,
            "item": p.item,
            "specialCooldown": p.special_cooldown,
            "notice": p.notice,
            "noticeTime": p.notice_time,
            "standings": rows,
        })
        .to_string();
        if let Ok(mut guard) = HUD_JSON.lock() {
            *guard = snap;
        }
    } else {
        session.client = NativeClient::from_packet(&pkt, local.elapsed).ok();
    }
    session.sounds.append(&mut drained_sounds);
    session.voices.append(&mut drained_voices);
}
