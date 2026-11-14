//! `--benchmark SECONDS --offscreen` plays the match with no window: every camera
//! draws into an image the size of the window on a high-density screen. As with a
//! window, one frame may still be drawing on the GPU while the next is prepared,
//! and no more. Frame times are then the real cost of drawing the game, including
//! stalls from changing what the GPU is still using, never paced by a display,
//! and nothing appears on screen.
use bevy::{
    camera::{ImageRenderTarget, RenderTarget},
    prelude::*,
    render::{
        Render, RenderApp, RenderSystems,
        render_resource::{PollType, TextureFormat},
        renderer::RenderDevice,
    },
};

/// The game window's size in points, drawn at two pixels per point.
const SIZE: (u32, u32) = (1280, 800);
const SCALE: f32 = 2.0;

#[derive(Resource)]
struct Canvas(Handle<Image>);

pub struct OffscreenPlugin;
impl Plugin for OffscreenPlugin {
    fn build(&self, app: &mut App) {
        let image = Image::new_target_texture(
            (SIZE.0 as f32 * SCALE) as u32,
            (SIZE.1 as f32 * SCALE) as u32,
            TextureFormat::Bgra8UnormSrgb,
            None,
        );
        let canvas = app.world_mut().resource_mut::<Assets<Image>>().add(image);
        app.insert_resource(Canvas(canvas))
            .add_systems(PostUpdate, retarget);
        app.sub_app_mut(RenderApp).add_systems(
            Render,
            finish_on_gpu
                .after(RenderSystems::PrepareBindGroups)
                .before(RenderSystems::Render),
        );
    }
}

/// Points every new camera, game and interface alike, at the image.
fn retarget(mut commands: Commands, canvas: Res<Canvas>, cameras: Query<Entity, Added<Camera>>) {
    for camera in &cameras {
        commands
            .entity(camera)
            .insert(RenderTarget::Image(ImageRenderTarget {
                handle: canvas.0.clone(),
                scale_factor: SCALE,
            }));
    }
}

/// Runs just before a frame is sent to the GPU and waits until the GPU has drawn
/// the previous one, so the GPU's cost counts in the frame time while it still
/// works on one frame as the next is prepared, as it does for a window.
fn finish_on_gpu(device: Res<RenderDevice>) {
    let _ = device.poll(PollType::wait_indefinitely());
}
