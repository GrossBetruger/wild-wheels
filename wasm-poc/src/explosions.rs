//! Cinematic, physically-simulated 3D explosions for the Bevy WASM PoC:
//! - Blinding core flash + dynamic orange-gold PointLight illuminating the arena & smoke
//! - Expanding ground shockwave ring
//! - Rolling buoyant multi-temperature fireball lobes
//! - PBR-lit dark charcoal smoke column under-lit fiery orange by the blast PointLight
//! - 28 spinning, ballistic, ground-bouncing 3D metal/charred splinters & hot shrapnel
//! - 34 velocity-aligned ricocheting spark streaks
use crate::app::GameSession;
use bevy::prelude::*;
use std::collections::HashSet;

pub struct ExplosionsPlugin;
impl Plugin for ExplosionsPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<SeenBlasts>()
            .add_systems(Startup, setup_assets)
            .add_systems(Update, (detect_explosions, tick_explosions).chain());
    }
}

#[derive(Resource)]
struct ExplosionAssets {
    sphere: Handle<Mesh>,
    splinter_long: Handle<Mesh>,
    splinter_shard: Handle<Mesh>,
    splinter_chunk: Handle<Mesh>,
    spark_mesh: Handle<Mesh>,
    ring_mesh: Handle<Mesh>,
    flash_mat: Handle<StandardMaterial>,
    fire_hot_mat: Handle<StandardMaterial>,
    fire_mid_mat: Handle<StandardMaterial>,
    fire_deep_mat: Handle<StandardMaterial>,
    smoke_dark_mat: Handle<StandardMaterial>,
    smoke_ash_mat: Handle<StandardMaterial>,
    ring_mat: Handle<StandardMaterial>,
    shrapnel_metal: Handle<StandardMaterial>,
    shrapnel_wood: Handle<StandardMaterial>,
    shrapnel_hot: Handle<StandardMaterial>,
    spark_gold: Handle<StandardMaterial>,
    spark_white: Handle<StandardMaterial>,
}

#[derive(Resource, Default)]
struct SeenBlasts {
    /// Tracks active explosion signatures `(wx_q, wz_q)` so each blast triggers once.
    active: HashSet<(i32, i32)>,
    seed: u64,
}

#[derive(Component)]
struct BlastLight {
    age: f32,
    life: f32,
    peak: f32,
}

#[derive(Component)]
struct BlastFlash {
    age: f32,
    life: f32,
    max_scale: f32,
}

#[derive(Component)]
struct BlastRing {
    age: f32,
    life: f32,
    max_radius: f32,
}

#[derive(Component)]
struct FireLobe {
    vel: Vec3,
    buoyancy: f32,
    drag: f32,
    age: f32,
    life: f32,
    start_scale: f32,
    peak_scale: f32,
    spin: Vec3,
}

#[derive(Component)]
struct SmokePuff {
    vel: Vec3,
    buoyancy: f32,
    drag: f32,
    age: f32,
    life: f32,
    start_scale: f32,
    end_scale: f32,
    spin: Vec3,
}

#[derive(Component)]
struct Splinter {
    vel: Vec3,
    rot_vel: Vec3,
    age: f32,
    life: f32,
    base_scale: Vec3,
    bounces: u8,
    hot: bool,
    trail_timer: f32,
}

#[derive(Component)]
struct SparkStreak {
    vel: Vec3,
    age: f32,
    life: f32,
    base_len: f32,
}

fn next_rand(seed: &mut u64) -> f32 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    (((*seed >> 33) as u32) as f32) / (u32::MAX as f32)
}

fn setup_assets(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let sphere = meshes.add(Sphere::new(1.0).mesh().uv(12, 8));
    let splinter_long = meshes.add(Cuboid::new(0.14, 0.08, 1.0));
    let splinter_shard = meshes.add(Cuboid::new(0.42, 0.07, 0.68));
    let splinter_chunk = meshes.add(Cuboid::new(0.32, 0.24, 0.44));
    let spark_mesh = meshes.add(Cuboid::new(0.065, 0.065, 1.0));
    let ring_mesh = meshes.add(Torus::new(0.88, 1.0));

    let flash_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.96, 0.78, 0.95),
        emissive: LinearRgba::rgb(22.0, 16.0, 6.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    let fire_hot_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.88, 0.35, 0.95),
        emissive: LinearRgba::rgb(13.0, 8.2, 1.8),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    let fire_mid_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.44, 0.08, 0.9),
        emissive: LinearRgba::rgb(8.5, 2.6, 0.28),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    let fire_deep_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(0.85, 0.14, 0.04, 0.85),
        emissive: LinearRgba::rgb(4.2, 0.55, 0.08),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    // PBR-lit dark smoke: undersides glow fiery orange from the dynamic blast PointLight!
    let smoke_dark_mat = materials.add(StandardMaterial {
        base_color: Color::srgb(0.15, 0.14, 0.17),
        perceptual_roughness: 0.96,
        metallic: 0.0,
        ..default()
    });
    let smoke_ash_mat = materials.add(StandardMaterial {
        base_color: Color::srgb(0.28, 0.25, 0.29),
        perceptual_roughness: 0.94,
        metallic: 0.0,
        ..default()
    });
    let ring_mat = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.76, 0.38, 0.75),
        emissive: LinearRgba::rgb(5.5, 3.2, 1.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    let shrapnel_metal = materials.add(StandardMaterial {
        base_color: Color::srgb(0.24, 0.26, 0.30),
        perceptual_roughness: 0.36,
        metallic: 0.88,
        ..default()
    });
    let shrapnel_wood = materials.add(StandardMaterial {
        base_color: Color::srgb(0.42, 0.26, 0.15),
        perceptual_roughness: 0.80,
        metallic: 0.05,
        ..default()
    });
    let shrapnel_hot = materials.add(StandardMaterial {
        base_color: Color::srgb(0.95, 0.42, 0.10),
        emissive: LinearRgba::rgb(7.0, 2.2, 0.30),
        perceptual_roughness: 0.40,
        metallic: 0.65,
        ..default()
    });
    let spark_gold = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.78, 0.25, 1.0),
        emissive: LinearRgba::rgb(10.0, 5.5, 1.2),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });
    let spark_white = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.96, 0.85, 1.0),
        emissive: LinearRgba::rgb(14.0, 11.5, 6.5),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        ..default()
    });

    commands.insert_resource(ExplosionAssets {
        sphere,
        splinter_long,
        splinter_shard,
        splinter_chunk,
        spark_mesh,
        ring_mesh,
        flash_mat,
        fire_hot_mat,
        fire_mid_mat,
        fire_deep_mat,
        smoke_dark_mat,
        smoke_ash_mat,
        ring_mat,
        shrapnel_metal,
        shrapnel_wood,
        shrapnel_hot,
        spark_gold,
        spark_white,
    });
}

fn detect_explosions(
    mut commands: Commands,
    session: Res<GameSession>,
    assets: Option<Res<ExplosionAssets>>,
    mut seen: ResMut<SeenBlasts>,
) {
    let Some(assets) = assets else { return };
    let Some(client) = session.client.as_ref() else {
        seen.active.clear();
        return;
    };
    let view = client.view();
    let mut current = HashSet::new();
    for fx in view.effects {
        if fx.kind != "explosion" && fx.kind != "abomb" {
            continue;
        }
        let key = ((fx.wx * 2.0).round() as i32, (fx.wz * 2.0).round() as i32);
        current.insert(key);
        if fx.age < 0.25 && !seen.active.contains(&key) {
            let scale = if fx.kind == "abomb" { 1.85 } else { 1.0 };
            spawn_blast(
                &mut commands,
                &assets,
                &mut seen.seed,
                Vec3::new(fx.wx as f32, 0.9, fx.wz as f32),
                scale,
            );
        }
    }
    seen.active = current;
}

fn spawn_blast(
    commands: &mut Commands,
    assets: &ExplosionAssets,
    seed: &mut u64,
    origin: Vec3,
    scale: f32,
) {
    // 1. Dynamic warm orange-gold blast PointLight (illuminates floor, karts, and smoke undersides!)
    commands.spawn((
        PointLight {
            color: Color::srgb(1.0, 0.56, 0.18),
            intensity: 1_900_000.0 * scale,
            range: 46.0 * scale,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_translation(origin + Vec3::Y * 1.4),
        BlastLight {
            age: 0.0,
            life: 1.15 * scale.sqrt(),
            peak: 1_900_000.0 * scale,
        },
    ));

    // 2. Blinding white-hot initial core flash
    commands.spawn((
        Mesh3d(assets.sphere.clone()),
        MeshMaterial3d(assets.flash_mat.clone()),
        Transform::from_translation(origin).with_scale(Vec3::splat(0.6 * scale)),
        BlastFlash {
            age: 0.0,
            life: 0.22,
            max_scale: 3.6 * scale,
        },
    ));

    // 3. Expanding ground shockwave ring
    commands.spawn((
        Mesh3d(assets.ring_mesh.clone()),
        MeshMaterial3d(assets.ring_mat.clone()),
        Transform::from_translation(Vec3::new(origin.x, 0.24, origin.z))
            .with_scale(Vec3::new(0.8, 0.18, 0.8)),
        BlastRing {
            age: 0.0,
            life: 0.44 * scale.sqrt(),
            max_radius: 13.5 * scale,
        },
    ));

    // 4. Rolling, buoyant multi-temperature fireball lobes (18 lobes)
    let fire_count = (18.0 * scale.sqrt()) as usize;
    for i in 0..fire_count {
        let a = next_rand(seed) * std::f32::consts::TAU;
        let elev = next_rand(seed) * 0.85;
        let spd = (3.5 + next_rand(seed) * 9.5) * scale;
        let dir = Vec3::new(a.cos() * elev.cos(), 0.35 + elev.sin(), a.sin() * elev.cos()).normalize();
        let mat = match i % 3 {
            0 => assets.fire_hot_mat.clone(),
            1 => assets.fire_mid_mat.clone(),
            _ => assets.fire_deep_mat.clone(),
        };
        let life = (0.42 + next_rand(seed) * 0.52) * scale.sqrt();
        let peak = (1.15 + next_rand(seed) * 1.65) * scale;
        commands.spawn((
            Mesh3d(assets.sphere.clone()),
            MeshMaterial3d(mat),
            Transform::from_translation(origin + dir * (0.4 + next_rand(seed) * 0.8) * scale)
                .with_scale(Vec3::splat(0.35 * scale)),
            FireLobe {
                vel: dir * spd,
                buoyancy: 7.5 + next_rand(seed) * 5.0,
                drag: 2.8 + next_rand(seed) * 1.4,
                age: 0.0,
                life,
                start_scale: 0.45 * scale,
                peak_scale: peak,
                spin: Vec3::new(
                    next_rand(seed) * 4.0 - 2.0,
                    next_rand(seed) * 4.0 - 2.0,
                    next_rand(seed) * 4.0 - 2.0,
                ),
            },
        ));
    }

    // 5. Awesome PBR-lit billowing dark charcoal & ash smoke column (22 puffs, under-lit by PointLight!)
    let smoke_count = (22.0 * scale.sqrt()) as usize;
    for i in 0..smoke_count {
        let a = (i as f32 / smoke_count as f32) * std::f32::consts::TAU + next_rand(seed) * 0.45;
        let ring = i % 2 == 0;
        let spd_h = if ring { 4.5 + next_rand(seed) * 6.5 } else { 1.0 + next_rand(seed) * 3.0 };
        let spd_y = if ring { 2.5 + next_rand(seed) * 4.5 } else { 6.5 + next_rand(seed) * 7.5 };
        let vel = Vec3::new(a.cos() * spd_h, spd_y, a.sin() * spd_h) * scale;
        let mat = if i % 3 == 0 {
            assets.smoke_ash_mat.clone()
        } else {
            assets.smoke_dark_mat.clone()
        };
        let life = (1.55 + next_rand(seed) * 1.25) * scale.sqrt();
        let offset = Vec3::new(a.cos() * 0.9, 0.3 + next_rand(seed) * 1.1, a.sin() * 0.9) * scale;
        commands.spawn((
            Mesh3d(assets.sphere.clone()),
            MeshMaterial3d(mat),
            Transform::from_translation(origin + offset).with_scale(Vec3::splat(0.35 * scale)),
            SmokePuff {
                vel,
                buoyancy: 2.8 + next_rand(seed) * 2.2,
                drag: 1.65 + next_rand(seed) * 0.85,
                age: 0.0,
                life,
                start_scale: (0.45 + next_rand(seed) * 0.45) * scale,
                end_scale: (2.1 + next_rand(seed) * 1.6) * scale,
                spin: Vec3::new(
                    next_rand(seed) * 2.0 - 1.0,
                    next_rand(seed) * 2.0 - 1.0,
                    next_rand(seed) * 2.0 - 1.0,
                ),
            },
        ));
    }

    // 6. 28 Physics-simulated spinning, bouncing 3D splinters & red-hot shrapnel chunks!
    let splinter_count = (28.0 * scale.sqrt()) as usize;
    for i in 0..splinter_count {
        let a = next_rand(seed) * std::f32::consts::TAU;
        let spd_h = (9.0 + next_rand(seed) * 24.0) * scale;
        let spd_y = (8.5 + next_rand(seed) * 18.0) * scale;
        let vel = Vec3::new(a.cos() * spd_h, spd_y, a.sin() * spd_h);
        let mesh = match i % 3 {
            0 => assets.splinter_long.clone(),
            1 => assets.splinter_shard.clone(),
            _ => assets.splinter_chunk.clone(),
        };
        let hot = i % 4 == 0;
        let mat = if hot {
            assets.shrapnel_hot.clone()
        } else if i % 3 == 0 {
            assets.shrapnel_wood.clone()
        } else {
            assets.shrapnel_metal.clone()
        };
        let base_scale = Vec3::new(
            0.7 + next_rand(seed) * 0.9,
            0.7 + next_rand(seed) * 0.9,
            0.8 + next_rand(seed) * 1.4,
        ) * scale.sqrt();
        commands.spawn((
            Mesh3d(mesh),
            MeshMaterial3d(mat),
            Transform {
                translation: origin + Vec3::new(a.cos() * 0.6, 0.4 + next_rand(seed) * 0.8, a.sin() * 0.6),
                rotation: Quat::from_euler(
                    EulerRot::XYZ,
                    next_rand(seed) * 6.28,
                    next_rand(seed) * 6.28,
                    next_rand(seed) * 6.28,
                ),
                scale: base_scale,
            },
            Splinter {
                vel,
                rot_vel: Vec3::new(
                    (next_rand(seed) - 0.5) * 24.0,
                    (next_rand(seed) - 0.5) * 24.0,
                    (next_rand(seed) - 0.5) * 24.0,
                ),
                age: 0.0,
                life: 1.8 + next_rand(seed) * 1.4,
                base_scale,
                bounces: 0,
                hot,
                trail_timer: 0.0,
            },
        ));
    }

    // 7. 34 High-velocity ricocheting incandescent spark streaks!
    let spark_count = (34.0 * scale.sqrt()) as usize;
    for i in 0..spark_count {
        let a = next_rand(seed) * std::f32::consts::TAU;
        let spd_h = (16.0 + next_rand(seed) * 32.0) * scale;
        let spd_y = (6.0 + next_rand(seed) * 22.0) * scale;
        let vel = Vec3::new(a.cos() * spd_h, spd_y, a.sin() * spd_h);
        let mat = if i % 3 == 0 {
            assets.spark_white.clone()
        } else {
            assets.spark_gold.clone()
        };
        let base_len = (0.65 + next_rand(seed) * 0.95) * scale.sqrt();
        commands.spawn((
            Mesh3d(assets.spark_mesh.clone()),
            MeshMaterial3d(mat),
            Transform::from_translation(origin + Vec3::Y * 0.4)
                .looking_to(vel.normalize_or(Vec3::Y), Vec3::Y)
                .with_scale(Vec3::new(1.0, 1.0, base_len)),
            SparkStreak {
                vel,
                age: 0.0,
                life: 0.55 + next_rand(seed) * 0.65,
                base_len,
            },
        ));
    }
}

fn tick_explosions(
    mut commands: Commands,
    time: Res<Time>,
    assets: Option<Res<ExplosionAssets>>,
    mut lights: Query<(Entity, &mut PointLight, &mut BlastLight)>,
    mut flashes: Query<
        (Entity, &mut Transform, &mut BlastFlash),
        (Without<BlastRing>, Without<FireLobe>, Without<SmokePuff>, Without<Splinter>, Without<SparkStreak>),
    >,
    mut rings: Query<
        (Entity, &mut Transform, &mut BlastRing),
        (Without<BlastFlash>, Without<FireLobe>, Without<SmokePuff>, Without<Splinter>, Without<SparkStreak>),
    >,
    mut fires: Query<
        (Entity, &mut Transform, &mut FireLobe),
        (Without<BlastFlash>, Without<BlastRing>, Without<SmokePuff>, Without<Splinter>, Without<SparkStreak>),
    >,
    mut smokes: Query<
        (Entity, &mut Transform, &mut SmokePuff),
        (Without<BlastFlash>, Without<BlastRing>, Without<FireLobe>, Without<Splinter>, Without<SparkStreak>),
    >,
    mut splinters: Query<
        (Entity, &mut Transform, &mut Splinter),
        (Without<BlastFlash>, Without<BlastRing>, Without<FireLobe>, Without<SmokePuff>, Without<SparkStreak>),
    >,
    mut sparks: Query<
        (Entity, &mut Transform, &mut SparkStreak),
        (Without<BlastFlash>, Without<BlastRing>, Without<FireLobe>, Without<SmokePuff>, Without<Splinter>),
    >,
) {
    let dt = time.delta_secs().min(0.05);
    let t = time.elapsed_secs();

    for (ent, mut light, mut b) in &mut lights {
        b.age += dt;
        if b.age >= b.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = b.age / b.life;
        let flicker = 0.85 + (t * 55.0 + b.age * 20.0).sin() * 0.15;
        light.intensity = b.peak * (1.0 - u).powi(2) * flicker;
    }

    for (ent, mut tf, mut f) in &mut flashes {
        f.age += dt;
        if f.age >= f.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = f.age / f.life;
        let s = if u < 0.45 {
            f.max_scale * (u / 0.45).sqrt()
        } else {
            f.max_scale * (1.0 - (u - 0.45) / 0.55)
        };
        tf.scale = Vec3::splat(s.max(0.01));
    }

    for (ent, mut tf, mut r) in &mut rings {
        r.age += dt;
        if r.age >= r.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = r.age / r.life;
        let rad = 0.8 + (r.max_radius - 0.8) * u.powf(0.62);
        let thick = 0.22 * (1.0 - u).powf(1.3);
        tf.scale = Vec3::new(rad, thick.max(0.005), rad);
    }

    for (ent, mut tf, mut f) in &mut fires {
        f.age += dt;
        if f.age >= f.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = f.age / f.life;
        let buoy = f.buoyancy;
        let damp = (1.0 - f.drag * dt).max(0.1);
        f.vel.y += buoy * dt;
        f.vel *= damp;
        tf.translation += f.vel * dt;
        tf.translation.y = tf.translation.y.max(0.35);
        tf.rotation *= Quat::from_euler(EulerRot::XYZ, f.spin.x * dt, f.spin.y * dt, f.spin.z * dt);
        let s = if u < 0.35 {
            f.start_scale + (f.peak_scale - f.start_scale) * (u / 0.35).sqrt()
        } else {
            f.peak_scale * (1.0 - (u - 0.35) / 0.65).powf(1.25)
        };
        tf.scale = Vec3::splat(s.max(0.01));
    }

    for (ent, mut tf, mut s) in &mut smokes {
        s.age += dt;
        if s.age >= s.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = s.age / s.life;
        let buoy = s.buoyancy;
        let damp = (1.0 - s.drag * dt).max(0.15);
        s.vel.y += buoy * dt * (1.0 - u * 0.6);
        s.vel *= damp;
        tf.translation += s.vel * dt;
        tf.translation.y = tf.translation.y.max(0.45);
        tf.rotation *= Quat::from_euler(EulerRot::XYZ, s.spin.x * dt, s.spin.y * dt, s.spin.z * dt);
        let grow = s.start_scale + (s.end_scale - s.start_scale) * u.powf(0.55);
        let fade = if u > 0.62 {
            (1.0 - (u - 0.62) / 0.38).powf(1.4)
        } else {
            1.0
        };
        tf.scale = Vec3::splat((grow * fade).max(0.01));
    }

    for (ent, mut tf, mut sp) in &mut splinters {
        sp.age += dt;
        if sp.age >= sp.life {
            commands.entity(ent).despawn();
            continue;
        }
        sp.vel.y -= 38.0 * dt;
        tf.translation += sp.vel * dt;
        // Real floor bounce with restitution, friction & bounce sparks!
        if tf.translation.y <= 0.14 {
            tf.translation.y = 0.14;
            if sp.vel.y < -3.0 {
                sp.vel.y = -sp.vel.y * 0.42;
                sp.vel.x *= 0.68;
                sp.vel.z *= 0.68;
                sp.rot_vel *= 0.62;
                sp.bounces = sp.bounces.saturating_add(1);
                if sp.bounces == 1
                    && let Some(ref a) = assets
                {
                    // Mini spark pop on first high-speed impact!
                    for k in 0..2 {
                        let sign = if k == 0 { 1.0 } else { -1.0 };
                        let sv = Vec3::new(
                            sp.vel.x * 0.4 + sign * 4.5,
                            4.0 + sp.vel.y.abs() * 0.5,
                            sp.vel.z * 0.4 - sign * 3.5,
                        );
                        commands.spawn((
                            Mesh3d(a.spark_mesh.clone()),
                            MeshMaterial3d(a.spark_gold.clone()),
                            Transform::from_translation(tf.translation + Vec3::Y * 0.1)
                                .looking_to(sv.normalize_or(Vec3::Y), Vec3::Y)
                                .with_scale(Vec3::new(0.8, 0.8, 0.45)),
                            SparkStreak {
                                vel: sv,
                                age: 0.0,
                                life: 0.28,
                                base_len: 0.45,
                            },
                        ));
                    }
                }
            } else {
                sp.vel.y = 0.0;
                sp.vel.x *= (1.0 - 6.0 * dt).max(0.0);
                sp.vel.z *= (1.0 - 6.0 * dt).max(0.0);
                sp.rot_vel *= (1.0 - 8.0 * dt).max(0.0);
            }
        }
        // Hot flying shrapnel leaves tiny glowing fire wisps in mid-air!
        if sp.hot && sp.age < 0.7 && sp.vel.length_squared() > 25.0 {
            sp.trail_timer += dt;
            if sp.trail_timer >= 0.045
                && let Some(ref a) = assets
            {
                sp.trail_timer = 0.0;
                commands.spawn((
                    Mesh3d(a.sphere.clone()),
                    MeshMaterial3d(a.fire_mid_mat.clone()),
                    Transform::from_translation(tf.translation).with_scale(Vec3::splat(0.18)),
                    FireLobe {
                        vel: Vec3::new(0.0, 1.8, 0.0),
                        buoyancy: 3.0,
                        drag: 4.0,
                        age: 0.0,
                        life: 0.22,
                        start_scale: 0.18,
                        peak_scale: 0.30,
                        spin: Vec3::ZERO,
                    },
                ));
            }
        }
        tf.rotation *= Quat::from_euler(
            EulerRot::XYZ,
            sp.rot_vel.x * dt,
            sp.rot_vel.y * dt,
            sp.rot_vel.z * dt,
        );
        let u = sp.age / sp.life;
        let fade = if u > 0.78 { (1.0 - u) / 0.22 } else { 1.0 };
        tf.scale = (sp.base_scale * fade).max(Vec3::splat(0.005));
    }

    for (ent, mut tf, mut sk) in &mut sparks {
        sk.age += dt;
        if sk.age >= sk.life {
            commands.entity(ent).despawn();
            continue;
        }
        sk.vel.y -= 32.0 * dt;
        sk.vel *= (1.0 - 1.2 * dt).max(0.2);
        tf.translation += sk.vel * dt;
        if tf.translation.y <= 0.08 {
            tf.translation.y = 0.08;
            sk.vel.y = sk.vel.y.abs() * 0.45;
            sk.vel.x *= 0.75;
            sk.vel.z *= 0.75;
        }
        let u = sk.age / sk.life;
        if sk.vel.length_squared() > 0.1 {
            tf.look_to(sk.vel.normalize(), Vec3::Y);
        }
        let fade = (1.0 - u).powf(1.3);
        let len = (sk.base_len * (0.4 + sk.vel.length() * 0.03) * fade).max(0.02);
        tf.scale = Vec3::new((fade).max(0.02), (fade).max(0.02), len);
    }
}
