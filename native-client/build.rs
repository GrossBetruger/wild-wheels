//! Ports the browser client's procedural graphics into this build.
//! The JavaScript renderer stays the source of truth: see docs/native-graphics-port.md.
use std::{env, path::PathBuf, process::Command};

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_owned();
    // Every directory the browser renderer imports from.
    for source in ["client", "characters", "gameplay", "ui", "scripts/build"] {
        println!("cargo:rerun-if-changed={}", root.join(source).display());
    }
    let pack = PathBuf::from(env::var("OUT_DIR").unwrap()).join("graphics.wwgp");
    let status = Command::new("node")
        .arg(root.join("scripts/build/port-graphics.mjs"))
        .arg(&pack)
        .status()
        .expect("Node.js is required to port the browser graphics to the native client");
    assert!(status.success(), "porting the browser graphics failed");
}
