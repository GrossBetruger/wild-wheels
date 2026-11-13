use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf};
fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_owned();
    let assets: Vec<String> =
        serde_json::from_slice(&fs::read(root.join("public-assets.json")).unwrap()).unwrap();
    println!("cargo:rerun-if-changed=../public-assets.json");
    let mut code = String::from("pub static ASSETS:&[(&str,&str,&[u8])]=&[\n");
    let mut hash = Sha256::new();
    for name in assets {
        assert!(!name.contains("..") && !name.starts_with('/'));
        let source = root.join(&name);
        println!("cargo:rerun-if-changed={}", source.display());
        let path = match name.as_str() {
            "index.html" => {
                let html = fs::read_to_string(&source)
                    .unwrap()
                    .replace("<body>", "<body class=\"dedicated-server\">");
                let html = html
                    .replace("SUNNY SIDE CIRCUIT", "SHARED ARENA")
                    .replace("GRAND PRIX", "ARENA BATTLE")
                    .replace("3 LAPS · 6 RACERS", "UP TO 8 PLAYERS")
                    .replace(
                        "Six racers. Three laps. One very shiny trophy.",
                        "One shared arena. Up to eight players.",
                    )
                    .replace("LET’S RACE", "LET’S BATTLE")
                    .replace("aria-label=\"Pause race\">Ⅱ", "aria-label=\"Go AFK\">AFK")
                    .replace("<div class=\"viewport\">", "<div class=\"viewport\"><div id=\"arena-connection\" class=\"arena-connection\" role=\"status\" aria-live=\"polite\"><strong>JOINING THE ARENA…</strong><p>Connecting to the shared game.</p><button type=\"button\" class=\"primary hidden\">RETRY CONNECTION</button></div>");
                let path = PathBuf::from(env::var("OUT_DIR").unwrap()).join("dedicated-index.html");
                fs::write(&path, html).unwrap();
                path
            }
            _ => source,
        };
        let bytes = fs::read(&path).unwrap();
        hash.update(&name);
        hash.update(&bytes);
        let mime = match name.rsplit('.').next().unwrap() {
            "html" => "text/html; charset=utf-8",
            "css" => "text/css; charset=utf-8",
            "wasm" => "application/wasm",
            "ogg" => "audio/ogg",
            "flac" => "audio/flac",
            _ => "text/javascript; charset=utf-8",
        };
        let route = match name.as_str() {
            "index.html" => "/".to_owned(),
            _ => format!("/{name}"),
        };
        code += &format!("({route:?},{mime:?},include_bytes!({:?})),\n", path);
    }
    // Build identity also changes with native service/core sources.
    fn sources(path: PathBuf, hash: &mut Sha256) {
        let mut paths: Vec<_> = fs::read_dir(path)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        paths.sort();
        for p in paths {
            if p.is_dir() {
                sources(p, hash);
                continue;
            }
            println!("cargo:rerun-if-changed={}", p.display());
            hash.update(fs::read(p).unwrap());
        }
    }
    sources(root.join("dedicated-server/src"), &mut hash);
    sources(root.join("rust-core/src"), &mut hash);
    code += &format!(
        "];\npub const BUILD:&str={:?};",
        format!("{:X}", hash.finalize())[..10].to_owned()
    );
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("assets.rs"),
        code,
    )
    .unwrap();
}
