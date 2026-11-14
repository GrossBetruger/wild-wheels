use std::{collections::HashSet, env, fs, path::PathBuf};

fn main() {
    // Read the literal hex swatches without evaluating JavaScript. This keeps
    // native Rust and Wasm on the same palette as the browser and Node server.
    let palette = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../gameplay/player-colors.js");
    println!("cargo:rerun-if-changed={}", palette.display());
    let source = fs::read_to_string(palette).expect("Unable to read player palette");
    let colors: Vec<_> = source.split(['\'', '"']).filter(|value| {
        value.len() == 7 && value.starts_with('#')
            && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    }).collect();
    assert!(colors.len() >= 8, "The palette needs at least eight player colors");
    let distinct: HashSet<_> = colors.iter().map(|value| value.to_ascii_lowercase()).collect();
    assert_eq!(distinct.len(), colors.len(), "Player palette colors must be unique");
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("player_colors.rs"),
        format!("pub const PLAYER_COLORS: &[&str] = &{colors:?};\n"),
    ).expect("Unable to generate native player palette");
}
