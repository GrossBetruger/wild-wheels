//! The lobby's character preview, drawn by this client so that it shows the
//! same racer the match will: a stand-in racer on a small stage far from the
//! arena, filmed by its own camera into an image that the page copies into
//! its preview box.
//!
//! The stand-in is one more entry in the list of racers, so every racer's own
//! drawing code shows it without knowing about previews.

use bevy::camera::{ClearColorConfig, RenderTarget};
use bevy::core_pipeline::tonemapping::{DebandDither, Tonemapping};
use bevy::prelude::*;
use bevy::render::gpu_readback::{ReadbackComplete, ReadbackOnce};
use bevy::render::render_resource::{Extent3d, TextureFormat, TextureUsages};
use std::sync::Mutex;
use wild_wheels_core::{Actor, ClientView};

/// The stand-in's id: far above any racer's, so nothing in a match refers to it.
pub const ID: usize = 4000;
/// Where the stage stands, well beyond the main camera's sight.
pub const STAGE: Vec3 = Vec3::new(6000.0, 0.0, 6000.0);
/// The browser's preview backdrop.
const BACKDROP: Color = Color::srgb(0.898, 0.871, 0.937);
/// Frames copied out for the page each second.
const RATE: f32 = 30.0;

/// What the page last asked to see.
#[derive(Clone)]
struct Request {
    driver: usize,
    color: String,
    /// Seconds the preview has been playing; the camera orbits with it.
    clock: f32,
    yaw: f64,
    celebrate: f64,
    boost: bool,
    tall: bool,
    size: UVec2,
    readback: bool,
}

static REQUEST: Mutex<Option<Request>> = Mutex::new(None);
/// The newest frame not yet taken: width, height, then RGBA rows.
static FRAME: Mutex<Vec<u8>> = Mutex::new(Vec::new());

/// Show a racer on the preview stage for offscreen GPU readback (browser HUD).
/// `width` must be a multiple of 64, so that rows of the copied image carry no padding.
#[allow(clippy::too_many_arguments)]
pub fn show_character_preview(
    driver: usize,
    color: String,
    clock: f32,
    yaw: f64,
    celebrate: f64,
    boost: bool,
    tall: bool,
    width: u32,
    height: u32,
) {
    let size = UVec2::new((width.clamp(64, 1024) / 64) * 64, height.clamp(32, 1024));
    if let Ok(mut request) = REQUEST.lock() {
        *request = Some(Request {
            driver,
            color,
            clock,
            yaw,
            celebrate,
            boost,
            tall,
            size,
            readback: true,
        });
    }
}

/// Show a live 3D racer on the preview turntable at `STAGE` for a direct camera
/// (used by the native client lobby without offscreen readback).
pub fn show_stage_preview(driver: usize, color: String) {
    if let Ok(mut request) = REQUEST.lock() {
        *request = Some(Request {
            driver,
            color,
            clock: 0.0,
            yaw: 0.0,
            celebrate: 0.0,
            boost: false,
            tall: matches!(driver, 11 | 12 | 14),
            size: UVec2::new(64, 64),
            readback: false,
        });
    }
}

pub fn hide_character_preview() {
    if let Ok(mut request) = REQUEST.lock() {
        *request = None;
    }
}

/// The newest preview frame as width and height (little-endian `u32`s)
/// followed by RGBA pixels, or nothing if none has arrived since the last call.
pub fn take_character_preview() -> Vec<u8> {
    FRAME.lock().map(|mut frame| std::mem::take(&mut *frame)).unwrap_or_default()
}

/// The racers to draw: those in the match, and the stand-in while it is shown.
#[derive(Resource, Default)]
pub struct Preview {
    racers: Vec<Actor>,
    disc_spawned: bool,
    film: Option<Film>,
    since_copy: f32,
}

struct Film {
    camera: Entity,
    image: Handle<Image>,
    size: UVec2,
}

impl Preview {
    /// The same view of the match, with the stand-in among its racers.
    pub fn on_stage<'a>(&'a self, view: ClientView<'a>) -> ClientView<'a> {
        ClientView { actors: &self.racers, ..view }
    }
}

pub struct PreviewPlugin;

impl Plugin for PreviewPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<Preview>()
            .add_systems(Update, stage.before(crate::scene::sync).in_set(crate::Presentation));
    }
}

fn stage(
    mut commands: Commands,
    time: Res<Time>,
    session: Res<crate::app::GameSession>,
    mobile: Res<crate::MobileGraphics>,
    mut preview: ResMut<Preview>,
    mut images: ResMut<Assets<Image>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut cameras: Query<(&mut Camera, &mut Transform)>,
) {
    let request = REQUEST.lock().ok().and_then(|request| request.clone());
    preview.racers.clear();
    if let Some(client) = session.client.as_ref() {
        preview.racers.extend_from_slice(client.view().actors);
    }
    let Some(request) = request else {
        if let Some((mut camera, _)) = preview.film.as_ref().and_then(|film| cameras.get_mut(film.camera).ok()) {
            camera.is_active = false;
        }
        return;
    };
    preview.racers.push(Actor {
        id: ID,
        driver: request.driver,
        color: request.color.clone(),
        wx: f64::from(STAGE.x),
        wz: f64::from(STAGE.z),
        heading: request.yaw,
        motion_heading: request.yaw,
        camera_heading: request.yaw,
        health: 3.0,
        celebrate: request.celebrate,
        boost: if request.boost { 1.0 } else { 0.0 },
        ..default()
    });

    if !preview.disc_spawned {
        preview.disc_spawned = true;
        // The browser's preview turntable: a cream disc with a lilac rim.
        for (radius, drop, color) in [(4.7, 0.12, Color::srgb(0.776, 0.729, 0.839)), (4.5, 0.08, Color::srgb(0.973, 0.953, 0.898))] {
            commands.spawn((
                Mesh3d(meshes.add(Cylinder::new(radius, 0.04))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: color,
                    perceptual_roughness: 0.9,
                    ..default()
                })),
                Transform::from_translation(STAGE - Vec3::Y * drop),
            ));
        }
    }
    if !request.readback {
        if let Some((mut camera, _)) = preview.film.as_ref().and_then(|film| cameras.get_mut(film.camera).ok()) {
            camera.is_active = false;
        }
        return;
    }

    if preview.film.is_none() {
        let mut image = Image::new_target_texture(request.size.x, request.size.y, TextureFormat::Rgba8UnormSrgb, None);
        // Copied out for the page after every render.
        image.texture_descriptor.usage |= TextureUsages::COPY_SRC;
        let image = images.add(image);
        let mut camera = commands.spawn((
            Camera3d::default(),
            Camera {
                // Before the arena's cameras, so the image is ready when they finish.
                order: -1,
                clear_color: ClearColorConfig::Custom(BACKDROP),
                ..default()
            },
            RenderTarget::from(image.clone()),
            Projection::Perspective(PerspectiveProjection {
                fov: 0.8,
                near: 0.3,
                far: 120.0,
                ..default()
            }),
            Tonemapping::None,
            DebandDither::Disabled,
        ));
        if mobile.mobile {
            camera.insert(Msaa::Off);
        }
        preview.film = Some(Film { camera: camera.id(), image, size: request.size });
    }
    let Preview { film: Some(film), since_copy, .. } = &mut *preview else { return };
    if film.size != request.size
        && let Some(mut image) = images.get_mut(&film.image)
    {
        image.resize(Extent3d { width: request.size.x, height: request.size.y, depth_or_array_layers: 1 });
        film.size = request.size;
    }
    if let Ok((mut camera, mut place)) = cameras.get_mut(film.camera) {
        camera.is_active = true;
        // The browser's slow orbit; taller racers are framed from further back.
        let orbit = request.clock * 0.28 + 0.35;
        let (radius, height, aim) = if request.tall { (15.0, 9.5, 4.0) } else { (12.0, 7.4, 2.55) };
        *place = Transform::from_translation(STAGE + Vec3::new(orbit.sin() * radius, height, orbit.cos() * radius))
            .looking_at(STAGE + Vec3::Y * aim, Vec3::Y);
    }
    *since_copy += time.delta_secs();
    if *since_copy >= 1.0 / RATE {
        *since_copy = 0.0;
        let size = film.size;
        commands
            .spawn(ReadbackOnce::texture(film.image.clone()))
            .observe(move |copied: On<ReadbackComplete>, mut commands: Commands| {
                commands.entity(copied.entity).try_despawn();
                if copied.data.len() != (size.x * size.y * 4) as usize {
                    return;
                }
                if let Ok(mut frame) = FRAME.lock() {
                    frame.clear();
                    frame.extend_from_slice(&size.x.to_le_bytes());
                    frame.extend_from_slice(&size.y.to_le_bytes());
                    frame.extend_from_slice(&copied.data);
                }
            });
    }
}
