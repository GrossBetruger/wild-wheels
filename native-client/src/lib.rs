mod app;
mod bench;
mod chat;
mod colors;
mod config;
mod feedback;
mod gui;
mod metrics;
mod offscreen;
mod pilot;
mod prefs;
mod reports;
mod session;
mod showcase;
mod transport;
mod voice;

pub(crate) use wild_wheels_render::{hud, plumage, ported, scene, sound, ui_port};

const EMBEDDED_GRAPHICS_PACK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/graphics.wwgp"));
const EMBEDDED_SOUND_PACK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/sounds.wwsp"));
const EMBEDDED_UI_PACK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/ui.wwup"));

pub(crate) fn init_render() {
    wild_wheels_render::set_pack_bytes(EMBEDDED_GRAPHICS_PACK);
    wild_wheels_render::set_sound_pack_bytes(EMBEDDED_SOUND_PACK);
    wild_wheels_render::set_ui_pack_bytes(EMBEDDED_UI_PACK);
    wild_wheels_render::set_report_hook(|key, seconds, level, event, data| {
        reports::limited(key, seconds, level, event, || data);
    });
}

#[cfg(test)]
mod ui_pack_tests {
    #[test]
    fn embedded_ui_pack_parses_cleanly() {
        let count = super::ui_port::verify_pack(super::EMBEDDED_UI_PACK)
            .expect("embedded WWUP pack must be valid");
        assert!(count == 0 || count >= 20);
    }
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = config::Config::from_args(std::env::args().skip(1))?;
    reports::remember_panics();
    app::run(config)
}
