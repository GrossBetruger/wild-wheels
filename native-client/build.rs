//! Ports the browser client's procedural graphics, HTML UI cards, and synthesized
//! sounds into this build. Each pack hashes its own inputs so editing only CSS,
//! audio, or Rust skips re-running unchanged exporters.
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn hash_path(path: &Path, hash: &mut u64) {
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(path)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .collect();
        entries.sort();
        for entry in entries {
            hash_path(&entry, hash);
        }
        return;
    }
    for byte in path.to_string_lossy().as_bytes() {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(0x100000001b3);
    }
    if let Ok(bytes) = fs::read(path) {
        for byte in bytes {
            *hash ^= u64::from(byte);
            *hash = hash.wrapping_mul(0x100000001b3);
        }
    }
}

fn inputs_hash(root: &Path, inputs: &[&str]) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for rel in inputs {
        hash_path(&root.join(rel), &mut hash);
    }
    format!("{hash:016x}")
}

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_owned();
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
    let packs: &[(&str, &str, Option<&str>, &[&str])] = &[
        (
            "port-graphics.mjs",
            "graphics.wwgp",
            None,
            &[
                "client",
                "characters",
                "gameplay",
                "ui/ability-announcements.js",
                "scripts/build/graphics-port.mjs",
                "scripts/build/port-graphics.mjs",
            ],
        ),
        (
            "port-sounds.mjs",
            "sounds.wwsp",
            None,
            &[
                "audio",
                "gameplay/combat.js",
                "gameplay/engine.js",
                "characters/knowitowl/dark-humor.js",
                "scripts/build/sound-port.mjs",
                "scripts/build/port-sounds.mjs",
            ],
        ),
        (
            "port-ui.mjs",
            "ui.wwup",
            Some("--optional"),
            &[
                "style.css",
                "ui/ability-announcements.js",
                "ui/reward-notice.js",
                "scripts/build/ui-port.mjs",
                "scripts/build/port-ui.mjs",
            ],
        ),
    ];
    for &(script, pack, extra, inputs) in packs {
        let pack_path = out.join(pack);
        let stamp_path = out.join(format!("{pack}.hash"));
        let digest = inputs_hash(&root, inputs);
        let unchanged = pack_path.exists()
            && fs::read_to_string(&stamp_path).ok().as_deref() == Some(digest.as_str());
        if unchanged {
            continue;
        }
        let mut cmd = Command::new("node");
        cmd.arg(root.join("scripts/build").join(script));
        if let Some(flag) = extra {
            cmd.arg(flag);
        }
        cmd.arg(&pack_path);
        let status = cmd
            .status()
            .expect("Node.js is required to port the browser graphics, UI, and sounds");
        assert!(status.success(), "{script} failed");
        let _ = fs::write(&stamp_path, digest);
    }
}
