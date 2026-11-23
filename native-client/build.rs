//! Ports the browser client's procedural graphics and synthesized sounds into this build.
//! The JavaScript stays the source of truth: see docs/native-graphics-port.md and
//! docs/native-sound-port.md.
use std::{env, path::PathBuf, process::Command};

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_owned();
    // Every directory the browser renderer, UI overlays, and audio engine import from.
    for source in [
        "client",
        "characters",
        "gameplay",
        "ui",
        "audio",
        "style.css",
        "scripts/build",
    ] {
        println!("cargo:rerun-if-changed={}", root.join(source).display());
    }
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    for (script, pack, extra) in [
        ("port-graphics.mjs", "graphics.wwgp", None),
        ("port-sounds.mjs", "sounds.wwsp", None),
        ("port-ui.mjs", "ui.wwup", Some("--optional")),
    ] {
        let mut cmd = Command::new("node");
        cmd.arg(root.join("scripts/build").join(script));
        if let Some(flag) = extra {
            cmd.arg(flag);
        }
        cmd.arg(out.join(pack));
        let status = cmd
            .status()
            .expect("Node.js is required to port the browser graphics, UI, and sounds");
        assert!(status.success(), "{script} failed");
    }
}
