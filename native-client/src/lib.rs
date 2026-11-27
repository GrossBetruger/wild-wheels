mod app;
mod bench;
mod chat;
mod colors;
mod config;
mod feedback;
mod gui;
mod hud;
mod metrics;
mod offscreen;
mod pilot;
mod prefs;
mod reports;
mod session;
mod showcase;
mod transport;
mod ui_port;
mod voice;

pub(crate) use wild_wheels_render::{plumage, ported, scene, sound};

const EMBEDDED_GRAPHICS_PACK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/graphics.wwgp"));
const EMBEDDED_SOUND_PACK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/sounds.wwsp"));

pub(crate) fn init_render() {
    wild_wheels_render::set_pack_bytes(EMBEDDED_GRAPHICS_PACK);
    wild_wheels_render::set_sound_pack_bytes(EMBEDDED_SOUND_PACK);
    wild_wheels_render::set_report_hook(|key, seconds, level, event, data| {
        reports::limited(key, seconds, level, event, || data);
    });
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = config::Config::from_args(std::env::args().skip(1))?;
    reports::remember_panics();
    app::run(config)
}
