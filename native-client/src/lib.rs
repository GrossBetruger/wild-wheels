mod app;
mod bench;
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
mod scene;
mod session;
mod showcase;
mod sound;
mod sprite;
mod transport;

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = config::Config::from_args(std::env::args().skip(1))?;
    app::run(config)
}
