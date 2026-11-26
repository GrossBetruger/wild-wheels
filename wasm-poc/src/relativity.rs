//! Special Relativity (Avita-Jas's time-stop special ability) uplifted with
//! custom WebGL2 WESL/WGSL shaders & procedural Bevy VFX:
//! 1. Einstein "rubber-sheet" spacetime grid (`relativity_grid.wesl`) warped
//!    into a gravity well beneath the caster with expanding light-cone ripples.
//! 2. Expanding Fresnel Doppler light-cone dome (`relativity_dome.wesl`).
//! 3. Screen-space relativistic time-freeze overlay (`relativity_screen.wesl`)
//!    with activation/thaw chromatic shockwave rings & clock-dial ticks.
//! 4. Lorentz cyan-gold motion-echo rings trailing the caster through frozen time.
//! 5. Suspended spacetime motes frozen in mid-air during `time_stop`, bursting
//!    into motion the instant time resumes.
//! 6. Snappy camera FOV punch + pulsing cyan-indigo arena PointLight.
use crate::{MobileGraphics, Presentation, app::GameSession, scene};
use bevy::{
    asset::{AssetPath, RenderAssetUsages, embedded_asset, embedded_path},
    mesh::{Indices, MeshVertexBufferLayoutRef, PrimitiveTopology},
    pbr::{MaterialPipeline, MaterialPipelineKey},
    prelude::*,
    reflect::TypePath,
    render::render_resource::{
        AsBindGroup, RenderPipelineDescriptor, SpecializedMeshPipelineError,
    },
    shader::ShaderRef,
};
use std::f32::consts::{FRAC_PI_2, PI};

const TIME_STOP_DURATION: f32 = 2.5;

pub struct RelativityPlugin;

impl Plugin for RelativityPlugin {
    fn build(&self, app: &mut App) {
        embedded_asset!(app, "relativity_grid.wesl");
        embedded_asset!(app, "relativity_dome.wesl");
        embedded_asset!(app, "relativity_screen.wesl");
        app.add_plugins((
            MaterialPlugin::<SpacetimeGridMaterial>::default(),
            MaterialPlugin::<RelativityDomeMaterial>::default(),
            UiMaterialPlugin::<RelativityScreenMaterial>::default(),
        ))
        .add_systems(Startup, setup)
        .add_systems(
            Update,
            (sync_relativity, tick_echoes, tick_motes)
                .chain()
                .after(scene::sync)
                .in_set(Presentation),
        );
    }
}

fn embedded(file: &str) -> ShaderRef {
    let path = match file {
        "relativity_grid.wesl" => embedded_path!("relativity_grid.wesl"),
        "relativity_dome.wesl" => embedded_path!("relativity_dome.wesl"),
        _ => embedded_path!("relativity_screen.wesl"),
    };
    ShaderRef::Path(AssetPath::from_path_buf(path).with_source("embedded"))
}

#[derive(Asset, TypePath, AsBindGroup, Debug, Clone, Default)]
pub struct SpacetimeGridMaterial {
    #[uniform(0)]
    pub params: Vec4,
}

impl Material for SpacetimeGridMaterial {
    fn vertex_shader() -> ShaderRef {
        embedded("relativity_grid.wesl")
    }
    fn fragment_shader() -> ShaderRef {
        embedded("relativity_grid.wesl")
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Add
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
    fn specialize(
        _pipeline: &MaterialPipeline,
        descriptor: &mut RenderPipelineDescriptor,
        layout: &MeshVertexBufferLayoutRef,
        _key: MaterialPipelineKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        descriptor.vertex.buffers = vec![layout.0.get_layout(&[
            Mesh::ATTRIBUTE_POSITION.at_shader_location(0),
            Mesh::ATTRIBUTE_UV_0.at_shader_location(1),
        ])?];
        descriptor.primitive.cull_mode = None;
        if let Some(ds) = descriptor.depth_stencil.as_mut() {
            ds.depth_write_enabled = Some(false);
        }
        Ok(())
    }
}

#[derive(Asset, TypePath, AsBindGroup, Debug, Clone, Default)]
pub struct RelativityDomeMaterial {
    #[uniform(0)]
    pub params: Vec4,
}

impl Material for RelativityDomeMaterial {
    fn vertex_shader() -> ShaderRef {
        embedded("relativity_dome.wesl")
    }
    fn fragment_shader() -> ShaderRef {
        embedded("relativity_dome.wesl")
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Add
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
    fn specialize(
        _pipeline: &MaterialPipeline,
        descriptor: &mut RenderPipelineDescriptor,
        layout: &MeshVertexBufferLayoutRef,
        _key: MaterialPipelineKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        descriptor.vertex.buffers = vec![layout.0.get_layout(&[
            Mesh::ATTRIBUTE_POSITION.at_shader_location(0),
            Mesh::ATTRIBUTE_NORMAL.at_shader_location(1),
        ])?];
        descriptor.primitive.cull_mode = None;
        if let Some(ds) = descriptor.depth_stencil.as_mut() {
            ds.depth_write_enabled = Some(false);
        }
        Ok(())
    }
}

#[derive(Asset, TypePath, AsBindGroup, Debug, Clone, Default)]
pub struct RelativityScreenMaterial {
    #[uniform(0)]
    pub params: Vec4,
}

impl UiMaterial for RelativityScreenMaterial {
    fn fragment_shader() -> ShaderRef {
        embedded("relativity_screen.wesl")
    }
}

#[derive(Resource)]
struct RelativityRig {
    grid_ent: Entity,
    grid_mat: Handle<SpacetimeGridMaterial>,
    dome_ent: Entity,
    dome_mat: Handle<RelativityDomeMaterial>,
    screen_mat: Handle<RelativityScreenMaterial>,
    light_ent: Entity,
    echo_mesh: Handle<Mesh>,
    echo_cyan_mat: Handle<StandardMaterial>,
    echo_gold_mat: Handle<StandardMaterial>,
    mote_mesh: Handle<Mesh>,
    mote_mat: Handle<StandardMaterial>,
    active: bool,
    strength: f32,
    echo_timer: f32,
    motes_spawned: bool,
    screen_attached: bool,
}

#[derive(Component)]
struct ScreenOverlay;

#[derive(Component)]
struct LorentzEcho {
    age: f32,
    life: f32,
    start_scale: Vec3,
    end_scale: Vec3,
}

#[derive(Component)]
struct SpacetimeMote {
    drift_vel: Vec3,
    age: f32,
    life: f32,
    phase: f32,
    base_scale: f32,
}

/// Build a subdivided horizontal grid mesh (`size` x `size`, `subdivs` per side)
/// so the Einstein gravity well vertex shader curves smoothly.
fn build_grid_mesh(size: f32, subdivs: u32) -> Mesh {
    let count = (subdivs + 1) as usize;
    let half = size * 0.5;
    let mut positions = Vec::with_capacity(count * count);
    let mut uvs = Vec::with_capacity(count * count);
    for iz in 0..count {
        let vz = iz as f32 / subdivs as f32;
        let z = -half + vz * size;
        for ix in 0..count {
            let vx = ix as f32 / subdivs as f32;
            let x = -half + vx * size;
            positions.push([x, 0.0, z]);
            uvs.push([vx, vz]);
        }
    }
    let mut indices = Vec::with_capacity((subdivs * subdivs * 6) as usize);
    for iz in 0..subdivs {
        for ix in 0..subdivs {
            let a = iz * (subdivs + 1) + ix;
            let b = a + 1;
            let c = a + (subdivs + 1);
            let d = c + 1;
            indices.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD);
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut grid_mats: ResMut<Assets<SpacetimeGridMaterial>>,
    mut dome_mats: ResMut<Assets<RelativityDomeMaterial>>,
    mut screen_mats: ResMut<Assets<RelativityScreenMaterial>>,
    mut std_mats: ResMut<Assets<StandardMaterial>>,
) {
    let grid_mesh = meshes.add(build_grid_mesh(110.0, 56));
    let grid_mat = grid_mats.add(SpacetimeGridMaterial::default());
    let grid_ent = commands
        .spawn((
            Mesh3d(grid_mesh),
            MeshMaterial3d(grid_mat.clone()),
            Transform::from_xyz(0.0, 0.24, 0.0),
            Visibility::Hidden,
        ))
        .id();

    let dome_mesh = meshes.add(Sphere::new(1.0).mesh().uv(32, 20));
    let dome_mat = dome_mats.add(RelativityDomeMaterial::default());
    let dome_ent = commands
        .spawn((
            Mesh3d(dome_mesh),
            MeshMaterial3d(dome_mat.clone()),
            Transform::from_xyz(0.0, 1.5, 0.0),
            Visibility::Hidden,
        ))
        .id();

    let screen_mat = screen_mats.add(RelativityScreenMaterial::default());

    let light_ent = commands
        .spawn((
            PointLight {
                color: Color::srgb(0.32, 0.85, 1.0),
                intensity: 0.0,
                range: 95.0,
                shadow_maps_enabled: false,
                ..default()
            },
            Transform::from_xyz(0.0, 8.0, 0.0),
        ))
        .id();

    // Lorentz motion-echo ring mesh (flat glowing halo left behind Avita)
    let echo_mesh = meshes.add(Torus::new(0.20, 2.35));
    let echo_cyan_mat = std_mats.add(StandardMaterial {
        base_color: Color::srgba(0.28, 0.92, 1.0, 0.72),
        emissive: LinearRgba::rgb(1.4, 4.6, 6.2),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });
    let echo_gold_mat = std_mats.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.84, 0.36, 0.68),
        emissive: LinearRgba::rgb(4.5, 3.2, 0.9),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });

    // Suspended time-frozen spacetime mote mesh
    let mote_mesh = meshes.add(Sphere::new(0.22).mesh().uv(6, 4));
    let mote_mat = std_mats.add(StandardMaterial {
        base_color: Color::srgba(0.76, 0.95, 1.0, 0.85),
        emissive: LinearRgba::rgb(2.2, 4.2, 5.8),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        ..default()
    });

    commands.insert_resource(RelativityRig {
        grid_ent,
        grid_mat,
        dome_ent,
        dome_mat,
        screen_mat,
        light_ent,
        echo_mesh,
        echo_cyan_mat,
        echo_gold_mat,
        mote_mesh,
        mote_mat,
        active: false,
        strength: 0.0,
        echo_timer: 0.0,
        motes_spawned: false,
        screen_attached: false,
    });
}

#[allow(clippy::too_many_arguments)]
fn sync_relativity(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<GameSession>,
    preview: Res<crate::preview::Preview>,
    mobile: Res<MobileGraphics>,
    mut rig: ResMut<RelativityRig>,
    mut grid_mats: ResMut<Assets<SpacetimeGridMaterial>>,
    mut dome_mats: ResMut<Assets<RelativityDomeMaterial>>,
    mut screen_mats: ResMut<Assets<RelativityScreenMaterial>>,
    mut transforms: Query<(&mut Transform, &mut Visibility), Without<scene::FollowCamera>>,
    mut lights: Query<&mut PointLight>,
    mut cameras: Query<(Entity, &mut Projection), With<scene::FollowCamera>>,
) {
    // Attach full-screen UI overlay once the main FollowCamera exists
    if !rig.screen_attached
        && let Some((cam_ent, _)) = cameras.iter().next()
    {
        commands.spawn((
            Node {
                position_type: PositionType::Absolute,
                width: percent(100),
                height: percent(100),
                ..default()
            },
            MaterialNode(rig.screen_mat.clone()),
            UiTargetCamera(cam_ent),
            ScreenOverlay,
        ));
        rig.screen_attached = true;
    }

    let dt = time.delta_secs().min(0.05);
    let Some(client) = session.client.as_ref() else {
        return;
    };
    let view = preview.on_stage(client.view());
    let active = view.time_stop > 0.0;
    let remaining = (view.time_stop as f32).clamp(0.0, TIME_STOP_DURATION);
    let age = (TIME_STOP_DURATION - remaining).clamp(0.0, TIME_STOP_DURATION);

    let target_strength = if active { 1.0 } else { 0.0 };
    let rate = if active { 14.0 } else { 7.5 };
    rig.strength += (target_strength - rig.strength) * (1.0 - (-dt * rate).exp());
    if !active && rig.strength < 0.005 {
        rig.strength = 0.0;
    }
    rig.active = active;

    let caster = view
        .time_owner
        .and_then(|id| view.actors.get(id))
        .unwrap_or(view.player);
    let is_caster = if view.time_owner == Some(view.player.id) { 1.0 } else { 0.0 };
    let caster_pos = Vec3::new(caster.wx as f32, 0.24, caster.wz as f32);

    // 1. Warped Einstein spacetime grid on arena floor
    let wave_radius = (age * 68.0).min(72.0);
    if let Ok((mut tf, mut vis)) = transforms.get_mut(rig.grid_ent) {
        if rig.strength > 0.005 {
            tf.translation = caster_pos;
            *vis = Visibility::Visible;
        } else {
            *vis = Visibility::Hidden;
        }
    }
    if let Some(mut mat) = grid_mats.get_mut(&rig.grid_mat) {
        mat.params = Vec4::new(rig.strength, age, remaining, wave_radius);
    }

    // 2. Expanding Fresnel Doppler light-cone dome
    let dome_p = (age / 0.65).clamp(0.0, 1.0);
    let dome_ease = 1.0 - (1.0 - dome_p).powi(3);
    let dome_radius = 3.0 + dome_ease * 62.0;
    let rim_boost = (1.0 - dome_p) * 1.4 + if remaining < 0.35 && active { 0.9 } else { 0.0 };
    if let Ok((mut tf, mut vis)) = transforms.get_mut(rig.dome_ent) {
        if rig.strength > 0.005 {
            tf.translation = Vec3::new(caster.wx as f32, 1.4, caster.wz as f32);
            tf.scale = Vec3::new(dome_radius, dome_radius * 0.52, dome_radius);
            *vis = Visibility::Visible;
        } else {
            *vis = Visibility::Hidden;
        }
    }
    if let Some(mut mat) = dome_mats.get_mut(&rig.dome_mat) {
        mat.params = Vec4::new(rig.strength, age, rim_boost, 0.0);
    }

    // 3. Full-screen relativistic time-freeze overlay
    if let Some(mut mat) = screen_mats.get_mut(&rig.screen_mat) {
        mat.params = Vec4::new(rig.strength, age, remaining, is_caster);
    }

    // 4. Pulsing cyan-indigo arena PointLight beneath caster
    if let Ok(mut light) = lights.get_mut(rig.light_ent) {
        let pulse = 0.85 + 0.15 * (time.elapsed_secs() * 7.0).sin();
        light.intensity = rig.strength * 2_400_000.0 * pulse;
    }
    if let Ok((mut ltf, _)) = transforms.get_mut(rig.light_ent) {
        ltf.translation = Vec3::new(caster.wx as f32, 8.5, caster.wz as f32);
    }

    // 5. Snappy camera FOV punch on cast + tight relativistic focus during freeze
    if rig.strength > 0.005
        && let Some((_, mut proj)) = cameras.iter_mut().next()
        && let Projection::Perspective(persp) = &mut *proj
    {
        let cast_kick = (1.0 - (age / 0.32).clamp(0.0, 1.0)).powi(2) * 0.19;
        let freeze_focus = -0.045 * rig.strength;
        persp.fov = (persp.fov + cast_kick + freeze_focus).clamp(0.85, 1.45);
    }

    // 6. Lorentz cyan-gold motion-echo rings trailing behind the caster while moving
    if active {
        rig.echo_timer += dt;
        let interval = if mobile.mobile { 0.14 } else { 0.065 };
        if rig.echo_timer >= interval && caster.speed.abs() > 40.0 {
            rig.echo_timer = 0.0;
            let heading = caster.heading as f32;
            let rot = Quat::from_rotation_y(heading) * Quat::from_rotation_x(FRAC_PI_2);
            let is_gold = (age * 16.0) as u32 % 3 == 0;
            commands.spawn((
                Mesh3d(rig.echo_mesh.clone()),
                MeshMaterial3d(if is_gold {
                    rig.echo_gold_mat.clone()
                } else {
                    rig.echo_cyan_mat.clone()
                }),
                Transform::from_xyz(caster.wx as f32, 2.1, caster.wz as f32)
                    .with_rotation(rot)
                    .with_scale(Vec3::splat(0.95)),
                LorentzEcho {
                    age: 0.0,
                    life: 0.42,
                    start_scale: Vec3::splat(0.95),
                    end_scale: Vec3::splat(2.15),
                },
            ));
        }

        // 7. Spawn suspended time-frozen spacetime motes once per cast (desktop)
        if !rig.motes_spawned && !mobile.mobile {
            rig.motes_spawned = true;
            let count = 34usize;
            for i in 0..count {
                let fi = i as f32;
                let ang = fi * 2.399963 + age; // golden-angle spiral distribution
                let dist = 5.5 + (fi / count as f32).sqrt() * 34.0;
                let height = 1.2 + ((fi * 7.13).sin() * 0.5 + 0.5) * 6.5;
                let pos = Vec3::new(
                    caster.wx as f32 + ang.cos() * dist,
                    height,
                    caster.wz as f32 + ang.sin() * dist,
                );
                let out_dir = Vec3::new(ang.cos(), 0.45, ang.sin()).normalize();
                commands.spawn((
                    Mesh3d(rig.mote_mesh.clone()),
                    MeshMaterial3d(rig.mote_mat.clone()),
                    Transform::from_translation(pos).with_scale(Vec3::splat(0.8)),
                    SpacetimeMote {
                        drift_vel: out_dir * (8.0 + (fi % 5.0) * 2.4),
                        age: 0.0,
                        life: 0.75,
                        phase: fi * 0.9,
                        base_scale: 0.55 + (fi % 4.0) * 0.22,
                    },
                ));
            }
        }
    } else {
        rig.motes_spawned = false;
        rig.echo_timer = 0.0;
    }
}

fn tick_echoes(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(Entity, &mut LorentzEcho, &mut Transform)>,
) {
    let dt = time.delta_secs().min(0.05);
    for (ent, mut echo, mut tf) in &mut q {
        echo.age += dt;
        if echo.age >= echo.life {
            commands.entity(ent).despawn();
            continue;
        }
        let u = (echo.age / echo.life).clamp(0.0, 1.0);
        // Expand into a thin relativistic wake ring, then collapse cleanly to 0 at end
        let fade = (1.0 - u).powf(0.6);
        let s = echo.start_scale.lerp(echo.end_scale, u);
        tf.scale = Vec3::new(s.x, s.y * fade, s.z);
    }
}

fn tick_motes(
    mut commands: Commands,
    time: Res<Time>,
    rig: Res<RelativityRig>,
    mut q: Query<(Entity, &mut SpacetimeMote, &mut Transform)>,
) {
    let dt = time.delta_secs().min(0.05);
    let t = time.elapsed_secs();
    for (ent, mut mote, mut tf) in &mut q {
        if rig.active {
            // Frozen motionless in mid-air while time is stopped — only gently twinkling!
            let twinkle = 0.65 + 0.35 * (t * 6.5 + mote.phase).sin();
            tf.scale = Vec3::splat(mote.base_scale * twinkle);
        } else {
            // Time snaps back: motes burst outward and fade away!
            mote.age += dt;
            if mote.age >= mote.life {
                commands.entity(ent).despawn();
                continue;
            }
            let u = (mote.age / mote.life).clamp(0.0, 1.0);
            tf.translation += mote.drift_vel * dt;
            mote.drift_vel *= (1.0 - 2.4 * dt).max(0.0);
            tf.scale = Vec3::splat(mote.base_scale * (1.0 - u) * (PI * 0.5 * (1.0 - u)).sin().max(0.0));
        }
    }
}
