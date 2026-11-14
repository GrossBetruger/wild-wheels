//! Ports the browser client's procedural graphics and synthesized sounds into this build.
//! The JavaScript stays the source of truth: see docs/native-graphics-port.md and
//! docs/native-sound-port.md.
use std::{env, path::PathBuf, process::Command};

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_owned();
    // Every directory the browser renderer and audio engine import from.
    for source in [
        "client",
        "characters",
        "gameplay",
        "ui",
        "audio",
        "scripts/build",
    ] {
        println!("cargo:rerun-if-changed={}", root.join(source).display());
    }
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    for (script, pack) in [
        ("port-graphics.mjs", "graphics.wwgp"),
        ("port-sounds.mjs", "sounds.wwsp"),
    ] {
        let status = Command::new("node")
            .arg(root.join("scripts/build").join(script))
            .arg(out.join(pack))
            .status()
            .expect("Node.js is required to port the browser graphics and sounds");
        assert!(status.success(), "{script} failed");
    }
}
