use bevy::gltf::GltfAssetLabel;
use bevy::prelude::*;
use crate::{MobileGraphics, app, knowitowl, pearococo, ported, ryeah, scene, specialist, yuda};

pub(crate) const BLENDER_MODELS: &[(usize, &str)] = &[(5, "models/tammy.glb"), (12, "models/catheterpillar.glb"),
    (13, "models/fourmidable.glb"), (15, "taicoon.glb")];

const RAPTOR_ENGINES: [(f32, f32, f32); 6] = [
    (0.0, 0.64, 0.28),
    (-0.55, -0.32, 0.28),
    (0.55, -0.32, 0.28),
    (0.0, -0.27, 0.16),
    (-0.23, 0.14, 0.16),
    (0.23, 0.14, 0.16),
];

pub fn has_blender_model(driver: usize) -> bool {
    driver == 7
        || driver == 8
        || driver == pearococo::DRIVER
        || driver == knowitowl::DRIVER
        || driver == ryeah::DRIVER
        || driver == yuda::DRIVER
        || BLENDER_MODELS.iter().any(|&(d, _)| d == driver)
}

#[derive(Resource)]
pub(crate) struct BlenderModels {
    static_models: std::collections::HashMap<usize, Handle<WorldAsset>>,
    houston_ship: Handle<WorldAsset>,
    houston_pilot: Handle<WorldAsset>,
    flame_mesh: Handle<Mesh>,
    diamond_mesh: Handle<Mesh>,
    flame_outer_mat: Handle<StandardMaterial>,
    idle_outer_mat: Handle<StandardMaterial>,
    flame_inner_mat: Handle<StandardMaterial>,
    diamond_mat: Handle<StandardMaterial>,
    smoke_mat: Handle<StandardMaterial>,
    idle_smoke_mat: Handle<StandardMaterial>,
    spark_mat: Handle<StandardMaterial>,
    rcs_mat: Handle<StandardMaterial>,
}

#[derive(Component)]
pub(crate) struct ExhaustParticle {
    vel: Vec3,
    age: f32,
    life: f32,
    start_scale: Vec3,
    end_scale: Vec3,
}

#[derive(Component)]
pub(crate) struct BlenderRacer {
    pub(crate) id: usize,
    pub(crate) driver: usize,
}

#[derive(Component)]
pub(crate) struct HoustonRig {
    id: usize,
    pilot: Entity,
    flames: Vec<(Entity, Entity, f32, f32, f32)>,
    diamonds: Vec<(Entity, f32, f32, f32, usize)>, // (entity, ex, ey, er, diamond_idx)
    rcs: [Entity; 2],
    plume_light: Entity,
}

pub(crate) fn load_blender_models(
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
    let idle_outer_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.96, 0.24, 0.14, 0.76),
        emissive: LinearRgba::rgb(4.8, 1.05, 0.55),
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
        base_color: Color::srgba(0.26, 0.40, 0.78, 0.22),
        emissive: LinearRgba::rgb(0.28, 0.45, 1.15),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    let idle_smoke_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.72, 0.28, 0.22, 0.26),
        emissive: LinearRgba::rgb(1.15, 0.34, 0.22),
        unlit: true,
        alpha_mode: AlphaMode::Add,
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
        flame_mesh,
        diamond_mesh,
        flame_outer_mat,
        idle_outer_mat,
        flame_inner_mat,
        diamond_mat,
        smoke_mat,
        idle_smoke_mat,
        spark_mat,
        rcs_mat,
    });
}

/// Tiny sub-pixel quads placed inside the initial camera frustum for 4 frames so
/// WebGL2 compiles all PBR/additive/alpha-blend shader pipelines during lobby
/// startup rather than stalling on the first seconds of a match.
#[derive(Component)]
pub(crate) struct ShaderWarmup {
    frames_left: u8,
}

pub(crate) fn spawn_shader_warmup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut images: ResMut<Assets<Image>>,
) {
    let quad = meshes.add(Rectangle::new(0.01, 0.01));
    // Vertex-colored mesh permutation (used by ported::Look::Solid).
    let mut vcol_mesh = Mesh::from(Rectangle::new(0.01, 0.01));
    vcol_mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, vec![[1.0_f32, 1.0, 1.0, 1.0]; 4]);
    let vcol_quad = meshes.add(vcol_mesh);
    // 1x1 white RGBA8 texture to trigger textured PBR/unlit pipeline permutations.
    let tex = images.add(Image::new_fill(
        bevy::render::render_resource::Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
        bevy::render::render_resource::TextureDimension::D2,
        &[255, 255, 255, 255],
        bevy::render::render_resource::TextureFormat::Rgba8UnormSrgb,
        bevy::asset::RenderAssetUsages::RENDER_WORLD,
    ));

    let mats: [(Handle<Mesh>, StandardMaterial); 6] = [
        // 1. Opaque PBR metallic/roughness (Blender .glb racers)
        (
            quad.clone(),
            StandardMaterial {
                base_color: Color::srgb(0.5, 0.5, 0.5),
                metallic: 0.5,
                perceptual_roughness: 0.4,
                ..default()
            },
        ),
        // 2. Opaque PBR + vertex colors (ported arena & non-Blender racers)
        (
            vcol_quad,
            StandardMaterial {
                base_color: Color::WHITE,
                metallic: 0.0,
                perceptual_roughness: 0.9,
                ..default()
            },
        ),
        // 3. Unlit additive (flames, sparks, contrails, shock diamonds)
        (
            quad.clone(),
            StandardMaterial {
                base_color: Color::srgba(1.0, 0.8, 0.4, 0.05),
                emissive: LinearRgba::rgb(1.0, 0.5, 0.2),
                unlit: true,
                alpha_mode: AlphaMode::Add,
                cull_mode: None,
                ..default()
            },
        ),
        // 4. Lit alpha-blend (smoke puffs, translucent glass)
        (
            quad.clone(),
            StandardMaterial {
                base_color: Color::srgba(0.2, 0.2, 0.2, 0.02),
                perceptual_roughness: 0.95,
                alpha_mode: AlphaMode::Blend,
                ..default()
            },
        ),
        // 5. Lit alpha-blend + texture (scorch decals)
        (
            quad.clone(),
            StandardMaterial {
                base_color: Color::srgba(1.0, 1.0, 1.0, 0.02),
                base_color_texture: Some(tex.clone()),
                perceptual_roughness: 0.95,
                alpha_mode: AlphaMode::Blend,
                ..default()
            },
        ),
        // 6. Unlit alpha-blend + texture (explosion flipbook)
        (
            quad,
            StandardMaterial {
                base_color: Color::srgba(1.0, 1.0, 1.0, 0.02),
                base_color_texture: Some(tex),
                unlit: true,
                alpha_mode: AlphaMode::Blend,
                cull_mode: None,
                ..default()
            },
        ),
    ];

    // Initial FollowCamera is at (0, 65, -75) looking at (0, 0, 0).
    // Placing sub-pixel quads along that view ray guarantees they are rendered and compiled.
    for (i, (mesh, mat)) in mats.into_iter().enumerate() {
        let mat_handle = materials.add(mat);
        commands.spawn((
            Mesh3d(mesh),
            MeshMaterial3d(mat_handle),
            Transform::from_xyz((i as f32 - 2.5) * 0.05, 58.0, -67.0).with_scale(Vec3::splat(0.05)),
            ShaderWarmup { frames_left: 4 },
        ));
    }
}

pub(crate) fn retire_shader_warmup(
    mut commands: Commands,
    mut warmups: Query<(Entity, &mut ShaderWarmup)>,
) {
    for (entity, mut warmup) in &mut warmups {
        if warmup.frames_left == 0 {
            commands.entity(entity).despawn();
        } else {
            warmup.frames_left -= 1;
        }
    }
}

pub(crate) fn sync_blender_models(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<app::GameSession>,
    preview: Res<crate::preview::Preview>,
    mobile: Res<MobileGraphics>,
    models: Option<Res<BlenderModels>>,
    mut existing: Query<
        (Entity, &BlenderRacer, &mut Transform, &mut Visibility),
        Without<HoustonRig>,
    >,
    mut rigs: Query<
        (Entity, &HoustonRig, &mut Transform, &mut Visibility),
        Without<BlenderRacer>,
    >,
    mut parts: Query<
        (&mut Transform, &mut Visibility, Option<&mut MeshMaterial3d<StandardMaterial>>),
        (Without<BlenderRacer>, Without<HoustonRig>, Without<PointLight>),
    >,
    mut lights: Query<&mut PointLight>,
) {
    let Some(models) = models else { return };
    let Some(client) = session.client.as_ref() else { return };
    let view = preview.on_stage(client.view());
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
            let gy = view.arena_def.ground_height(a.wx, a.wz) as f32;
            let hover = gy + if a.somersault > 0.0 {
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
                if let Ok((mut p_tf, _, _)) = parts.get_mut(rig.pilot) {
                    p_tf.translation = Vec3::new(0.0, cel_bounce, 0.0);
                    p_tf.rotation = Quat::from_rotation_y(turn * std::f32::consts::PI);
                }
                let cruise_scale = (a.speed.abs() as f32 / 520.0).clamp(0.35, 1.0);
                for (idx, &(outer, inner, ex, ey, er)) in rig.flames.iter().enumerate() {
                    let f1 = (t * 58.0 + idx as f32 * 2.3).sin();
                    let f2 = (t * 97.0 + idx as f32 * 4.1).cos();
                    let flicker = 1.0 + f1 * 0.22 + f2 * 0.12;
                    let wobble_x = (t * 43.0 + idx as f32 * 1.9).sin() * if firing || nightmare { 0.08 } else { 0.05 };
                    let wobble_y = (t * 37.0 + idx as f32 * 3.1).cos() * if firing || nightmare { 0.07 } else { 0.04 };
                    let (len_o, rad_o, len_i, rad_i) = if nightmare {
                        (8.4 * flicker, er * 1.85, 5.9 * flicker, er * 1.12)
                    } else if firing {
                        (6.5 * flicker, er * 1.50, 4.5 * flicker, er * 0.90)
                    } else {
                        let c = 1.65 + cruise_scale * 1.85;
                        (c * flicker, er * 1.05, c * 0.58 * flicker, er * 0.60)
                    };
                    if let Ok((mut otf, mut ovis, omat)) = parts.get_mut(outer) {
                        *ovis = Visibility::Inherited;
                        if let Some(mut mat_h) = omat {
                            mat_h.0 = if firing || nightmare {
                                models.flame_outer_mat.clone()
                            } else {
                                models.idle_outer_mat.clone()
                            };
                        }
                        otf.translation = Vec3::new(ex + wobble_x, 1.45 + ey + wobble_y, -3.50 - len_o * 0.5);
                        otf.rotation = Quat::from_euler(EulerRot::XYZ, -std::f32::consts::FRAC_PI_2 + wobble_y * 0.6, wobble_x * 0.6, 0.0);
                        otf.scale = Vec3::new(rad_o * (1.0 + f2 * 0.12), len_o, rad_o * (1.0 - f2 * 0.12));
                    }
                    if let Ok((mut itf, mut ivis, _)) = parts.get_mut(inner) {
                        *ivis = Visibility::Inherited;
                        itf.translation = Vec3::new(ex + wobble_x * 0.5, 1.45 + ey + wobble_y * 0.5, -3.50 - len_i * 0.5);
                        itf.scale = Vec3::new(rad_i, len_i, rad_i);
                    }
                }
                // Spawn sleek elongated vapor/smoke streaks & sparks seamlessly from the flame body!
                let back_dir = tf.rotation * Vec3::NEG_Z;
                let right_dir = tf.rotation * Vec3::X;
                let up_dir = tf.rotation * Vec3::Y;
                let seed = (t * 60.0) as usize;
                let emit_count = match (mobile.mobile, firing || nightmare) {
                    (true, false) => 0,
                    _ => mobile.detail(if nightmare { 3 } else { 2 }, [1, 1, 0, 0]),
                };
                for k in 0..emit_count {
                    let eng = RAPTOR_ENGINES[(seed + k * 2 + a.id) % 3];
                    let jitter = ((seed * 37 + k * 17) % 100) as f32 / 100.0 - 0.5;
                    let jitter2 = ((seed * 53 + k * 29) % 100) as f32 / 100.0 - 0.5;
                    if firing || nightmare {
                        let spawn_z = if nightmare { -7.6 } else { -6.0 };
                        let streak_pos = tf.transform_point(Vec3::new(
                            eng.0 + jitter * 0.22,
                            1.45 + eng.1 + jitter2 * 0.18,
                            spawn_z,
                        ));
                        let vel = back_dir * 26.0 + right_dir * (jitter * 3.8) + up_dir * (jitter2 * 2.4);
                        commands.spawn((
                            Mesh3d(models.diamond_mesh.clone()),
                            MeshMaterial3d(models.smoke_mat.clone()),
                            Transform {
                                translation: streak_pos,
                                rotation: tf.rotation,
                                scale: Vec3::new(0.24, 0.24, 1.45),
                            },
                            ExhaustParticle {
                                vel,
                                age: 0.0,
                                life: 0.26,
                                start_scale: Vec3::new(0.26, 0.26, 1.55),
                                end_scale: Vec3::new(0.55, 0.55, 2.40),
                            },
                        ));
                        let spark_pos = tf.transform_point(Vec3::new(eng.0, 1.45 + eng.1, -3.75));
                        let spark_vel = back_dir * (34.0 + jitter.abs() * 14.0)
                            + right_dir * (jitter * 7.5)
                            + up_dir * (jitter2 * 4.5 + 0.6);
                        commands.spawn((
                            Mesh3d(models.diamond_mesh.clone()),
                            MeshMaterial3d(if k % 2 == 0 { models.spark_mat.clone() } else { models.diamond_mat.clone() }),
                            Transform {
                                translation: spark_pos,
                                rotation: tf.rotation,
                                scale: Vec3::new(0.06, 0.06, 0.72),
                            },
                            ExhaustParticle {
                                vel: spark_vel,
                                age: 0.0,
                                life: 0.22,
                                start_scale: Vec3::new(0.065, 0.065, 0.78),
                                end_scale: Vec3::new(0.01, 0.01, 0.15),
                            },
                        ));
                    } else {
                        // Warm reddish-amber smoky cruise streaks flowing smoothly out of the non-boost flame!
                        let spawn_z = -4.2 - cruise_scale * 1.4;
                        let streak_pos = tf.transform_point(Vec3::new(
                            eng.0 + jitter * 0.26,
                            1.45 + eng.1 + jitter2 * 0.20,
                            spawn_z,
                        ));
                        let vel = back_dir * (12.0 + cruise_scale * 8.0)
                            + right_dir * (jitter * 3.4)
                            + up_dir * (0.4 + jitter2 * 2.0);
                        commands.spawn((
                            Mesh3d(models.diamond_mesh.clone()),
                            MeshMaterial3d(models.idle_smoke_mat.clone()),
                            Transform {
                                translation: streak_pos,
                                rotation: tf.rotation,
                                scale: Vec3::new(0.22, 0.22, 1.15),
                            },
                            ExhaustParticle {
                                vel,
                                age: 0.0,
                                life: 0.34,
                                start_scale: Vec3::new(0.24, 0.24, 1.20),
                                end_scale: Vec3::new(0.62, 0.62, 2.35),
                            },
                        ));
                        if k == 0 && seed % 2 == 0 {
                            let spark_pos = tf.transform_point(Vec3::new(eng.0, 1.45 + eng.1, -3.75));
                            let spark_vel = back_dir * 20.0 + right_dir * (jitter * 4.5) + up_dir * (jitter2 * 3.0);
                            commands.spawn((
                                Mesh3d(models.diamond_mesh.clone()),
                                MeshMaterial3d(models.spark_mat.clone()),
                                Transform {
                                    translation: spark_pos,
                                    rotation: tf.rotation,
                                    scale: Vec3::new(0.05, 0.05, 0.45),
                                },
                                ExhaustParticle {
                                    vel: spark_vel,
                                    age: 0.0,
                                    life: 0.20,
                                    start_scale: Vec3::new(0.05, 0.05, 0.50),
                                    end_scale: Vec3::new(0.01, 0.01, 0.10),
                                },
                            ));
                        }
                    }
                }
                // Glowing supersonic Mach shock diamonds pulsing down the 3 main Raptor plumes!
                for &(d_ent, ex, ey, er, di) in &rig.diamonds {
                    if let Ok((mut dtf, mut dvis, _)) = parts.get_mut(d_ent) {
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
                    if nightmare {
                        light.color = Color::srgb(0.55, 0.45, 1.0);
                        light.intensity = 420_000.0;
                    } else if firing {
                        light.color = Color::srgb(0.45, 0.72, 1.0);
                        light.intensity = 220_000.0;
                    } else {
                        light.color = Color::srgb(1.0, 0.38, 0.22);
                        light.intensity = 55_000.0 + cruise_scale * 40_000.0;
                    }
                }
                let rcs_z = if a.somersault > 0.275 { 2.05 } else { -2.35 };
                for (i, &rcs_ent) in rig.rcs.iter().enumerate() {
                    let side = if i == 0 { -1.0f32 } else { 1.0f32 };
                    if let Ok((mut rtf, mut rvis, _)) = parts.get_mut(rcs_ent) {
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
                                specialist::Rider::new(a.id, 7),
                                Transform::IDENTITY,
                            ))
                            .id();

                        let back_rot = Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2);
                        let engine_count = if mobile.mobile { 3 } else { RAPTOR_ENGINES.len() };
                        for (idx, (ex, ey, er)) in RAPTOR_ENGINES.into_iter().take(engine_count).enumerate() {
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
                            let inner = if mobile.mobile {
                                Entity::PLACEHOLDER
                            } else {
                                ship.spawn((
                                    Mesh3d(models.flame_mesh.clone()),
                                    MeshMaterial3d(models.flame_inner_mat.clone()),
                                    Transform {
                                        translation: Vec3::new(ex, 1.45 + ey, -3.75),
                                        rotation: back_rot,
                                        scale: Vec3::new(er * 0.6, 0.6, er * 0.6),
                                    },
                                ))
                                .id()
                            };
                            flames.push((outer, inner, ex, ey, er));
                            // 4 Mach shock diamonds behind each of the 3 main RVac bells (desktop only)
                            if !mobile.mobile && idx < 3 {
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
                        if !mobile.mobile {
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
                        }
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
        alive_static.insert((a.id, a.driver));
        let bounce = if a.celebrate > 0.0 {
            (t * 14.0).sin().abs() * 0.65
        } else {
            (t * 6.0 + a.id as f32).sin() * 0.04
        };
        let gy = view.arena_def.ground_height(a.wx, a.wz) as f32;
        let height = gy + if a.somersault > 0.0 { somersault_h } else { bounce };
        let tf = ported::placement(
            Vec3::new(a.wx as f32, height, a.wz as f32),
            a.heading as f32,
            pitch,
            0.0,
        );
        let tf = if specialist::separate_vehicle(a.driver) {
            let (height, pitch, roll, yaw) = scene::somersault(a.driver, a.somersault);
            let body = ported::placement(Vec3::new(a.wx as f32, gy + height, a.wz as f32),
                a.heading as f32 + yaw, pitch, roll);
            let seat = match a.driver {
                // The nurse hovers above her ambulance, tilted around the browser's seat pivot.
                12 => ported::placement(Vec3::Y * (1.83 + (t*3.0).sin()*0.06), 0.0, 0.78, 0.0),
                5 => {
                    let progress = 1.6 - a.celebrate as f32;
                    let envelope = (progress / 0.25).min(a.celebrate as f32 / 0.4).clamp(0., 1.);
                    let turn = envelope * envelope * (3. - 2. * envelope);
                    Transform::from_xyz(0., 0.13 + turn * (progress * 15.).sin() * 0.1, 0.)
                        .with_rotation(Quat::from_rotation_y(std::f32::consts::PI * turn))
                },
                _ => Transform::IDENTITY,
            };
            body * seat
        } else { tf };
        if let Some((_, _, mut cur_tf, mut vis)) =
            existing.iter_mut().find(|(_, r, _, _)| r.id == a.id && r.driver == a.driver)
        {
            *cur_tf = tf;
            *vis = Visibility::Visible;
        } else {
            commands.spawn((
                WorldAssetRoot(handle.clone()), tf,
                specialist::Rider::new(a.id, a.driver),
                BlenderRacer { id: a.id, driver: a.driver },
            ));
        }
    }
    for (_, r, _, mut vis) in &mut existing {
        if !alive_static.contains(&(r.id, r.driver)) {
            *vis = Visibility::Hidden;
        }
    }
    for (_, rig, _, mut vis) in &mut rigs {
        if !alive_houston.contains(&rig.id) {
            *vis = Visibility::Hidden;
            for &(outer, inner, _, _, _) in &rig.flames {
                if let Ok((_, mut ovis, _)) = parts.get_mut(outer) {
                    *ovis = Visibility::Hidden;
                }
                if let Ok((_, mut ivis, _)) = parts.get_mut(inner) {
                    *ivis = Visibility::Hidden;
                }
            }
            for &(d_ent, _, _, _, _) in &rig.diamonds {
                if let Ok((_, mut dvis, _)) = parts.get_mut(d_ent) {
                    *dvis = Visibility::Hidden;
                }
            }
            for &rcs_ent in &rig.rcs {
                if let Ok((_, mut rvis, _)) = parts.get_mut(rcs_ent) {
                    *rvis = Visibility::Hidden;
                }
            }
            if let Ok(mut light) = lights.get_mut(rig.plume_light) {
                light.intensity = 0.0;
            }
        }
    }
}

pub(crate) fn tick_exhaust_particles(
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
        p.vel *= (1.0 - 2.6 * dt).max(0.2);
        let s = p.start_scale.lerp(p.end_scale, u.sqrt());
        let fade = (1.0 - u).powf(1.4);
        tf.scale = (s * fade).max(Vec3::splat(0.005));
    }
}

