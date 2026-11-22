mod app;
mod arena_mesh;
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
mod plumage;
mod ported;
mod prefs;
mod reports;
mod scene;
mod session;
mod showcase;
mod sound;
mod sprite;
mod transport;
mod voice;
mod xray;

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = config::Config::from_args(std::env::args().skip(1))?;
    reports::remember_panics();
    app::run(config)
}
