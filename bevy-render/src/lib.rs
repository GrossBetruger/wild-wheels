#![recursion_limit = "256"]

pub mod arena_mesh;
pub mod avita;
pub mod bench;
pub mod blender;
pub mod explosions;
pub mod hedgeguard;
pub mod hud;
pub mod knowitowl;
pub mod pearococo;
pub mod plumage;
pub mod ported;
pub mod powerups;
pub mod preview;
pub mod relativity;
pub mod ryeah;
pub mod scene;
pub mod sound;
pub mod specialist;
pub mod sprite;
pub mod tehilim;
pub mod tycoon;
pub mod ui_port;
pub mod wormhole;
pub mod xray;
pub mod yuda;

use bevy::prelude::*;
use std::sync::{Mutex, OnceLock};

pub use blender::has_blender_model;
pub(crate) use blender::{BLENDER_MODELS, BlenderRacer, sync_blender_models};

pub const MOBILE_IDLE: u32 = 4;

pub static ARENA_CAMERA: Mutex<[f32; 19]> = Mutex::new([0.0; 19]);

static PACK_BYTES: OnceLock<&'static [u8]> = OnceLock::new();
static SOUND_BYTES: OnceLock<&'static [u8]> = OnceLock::new();
static UI_BYTES: OnceLock<&'static [u8]> = OnceLock::new();
type ReportHook = fn(&str, f32, &'static str, &str, serde_json::Value);
static REPORT_HOOK: OnceLock<ReportHook> = OnceLock::new();

pub fn set_pack_bytes(bytes: &'static [u8]) {
    let _ = PACK_BYTES.set(bytes);
}

pub fn set_sound_pack_bytes(bytes: &'static [u8]) {
    let _ = SOUND_BYTES.set(bytes);
}

pub fn set_ui_pack_bytes(bytes: &'static [u8]) {
    let _ = UI_BYTES.set(bytes);
}

pub fn set_report_hook(hook: ReportHook) {
    let _ = REPORT_HOOK.set(hook);
}

pub(crate) fn pack_bytes() -> &'static [u8] {
    PACK_BYTES.get().copied().unwrap_or(&[])
}

pub(crate) fn sound_pack_bytes() -> &'static [u8] {
    SOUND_BYTES.get().copied().unwrap_or(&[])
}

pub(crate) fn ui_pack_bytes() -> &'static [u8] {
    UI_BYTES.get().copied().unwrap_or(&[])
}

pub mod reports {
    pub fn limited(
        key: &str,
        seconds: f32,
        level: &'static str,
        event: &str,
        data: impl FnOnce() -> serde_json::Value,
    ) {
        if let Some(hook) = crate::REPORT_HOOK.get() {
            hook(key, seconds, level, event, data());
        }
    }
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

#[derive(SystemSet, Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct Presentation;

#[derive(Resource)]
pub struct MobileGraphics {
    pub mobile: bool,
    pub level: u32,
}

impl Default for MobileGraphics {
    fn default() -> Self {
        Self {
            mobile: false,
            level: 0,
        }
    }
}

impl MobileGraphics {
    pub fn detail<T: Copy>(&self, desktop: T, mobile: [T; 4]) -> T {
        match self.mobile {
            true => mobile[self.level.min(3) as usize],
            false => desktop,
        }
    }
}

pub fn mobile_rendering(graphics: Res<MobileGraphics>) -> bool {
    graphics.level != MOBILE_IDLE
}

/// Registers all shared 3D presentation, character rig, VFX, and shader plugins.
/// Host wrappers (WASM or Native) insert `app::GameSession` and optionally
/// `MobileGraphics` / `scene::Capture`, call `set_pack_bytes`, and schedule
/// their own input/network systems `.before(Presentation)` and HUD/UI systems
/// `.after(Presentation)`.
pub struct WildWheelsRenderPlugin;

impl Plugin for WildWheelsRenderPlugin {
    fn build(&self, app: &mut App) {
        if !app.world().contains_resource::<MobileGraphics>() {
            app.init_resource::<MobileGraphics>();
        }
        if !app.world().contains_resource::<scene::Capture>() {
            app.init_resource::<scene::Capture>();
        }
        app.add_plugins((
            ported::PortedGraphicsPlugin,
            scene::ArenaPresentationPlugin,
            avita::AvitaPlugin,
            explosions::ExplosionsPlugin,
            hedgeguard::HedgeguardPlugin,
            knowitowl::KnowItOwlPlugin,
            pearococo::PearococoPlugin,
            powerups::PowerupsPlugin,
            preview::PreviewPlugin,
            relativity::RelativityPlugin,
            ryeah::RYeahPlugin,
            tehilim::TehilimPlugin,
            tycoon::TycoonPlugin,
            wormhole::WormholePlugin,
            yuda::YudaPlugin,
        ))
        .add_systems(
            Startup,
            (blender::load_blender_models, blender::spawn_shader_warmup),
        )
        .add_systems(
            Update,
            (
                blender::retire_shader_warmup,
                scene::sync,
                blender::sync_blender_models,
                specialist::animate,
                blender::tick_exhaust_particles,
                ported::animate,
            )
                .chain()
                .in_set(Presentation),
        );
    }
}
