use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn experimental_asset(code: &mut String, hash: &mut Sha256, route: &str, path: &Path) {
    let mime = match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("glb") => "model/gltf-binary",
        Some("png") => "image/png",
        Some("wwgp" | "wwsp") => "application/octet-stream",
        _ => panic!("Unexpected experimental asset type: {}", path.display()),
    };
    println!("cargo:rerun-if-changed={}", path.display());
    hash.update(route);
    hash.update(fs::read(path).unwrap_or_else(|error| panic!("{}: {error}", path.display())));
    code.push_str(&format!("({route:?},{mime:?},include_bytes!({path:?})),\n"));
}

fn experimental_models(code: &mut String, hash: &mut Sha256, directory: &Path, prefix: &str) {
    println!("cargo:rerun-if-changed={}", directory.display());
    let mut entries: Vec<_> = fs::read_dir(directory).unwrap().map(|entry| entry.unwrap()).collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let file_type = entry.file_type().unwrap();
        let route = format!("{prefix}/{}", entry.file_name().to_str().unwrap());
        if file_type.is_dir() {
            experimental_models(code, hash, &entry.path(), &route);
        }
        if file_type.is_file() && matches!(entry.path().extension().and_then(|extension| extension.to_str()), Some("glb" | "png")) {
            experimental_asset(code, hash, &route, &entry.path());
        }
    }
}

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_owned();
    let assets: Vec<String> =
        serde_json::from_slice(&fs::read(root.join("public-assets.json")).unwrap()).unwrap();
    println!("cargo:rerun-if-changed=../public-assets.json");
    let mut code = String::from("pub static ASSETS:&[(&str,&str,&[u8])]=&[\n");
    let mut compressed = String::from("pub static COMPRESSED_ASSETS:&[(&str,&[u8])]=&[\n");
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
            "svg" => "image/svg+xml",
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
    println!("cargo:rerun-if-env-changed=WILD_WHEELS_EXPERIMENTAL_DIR");
    if let Some(directory) = env::var_os("WILD_WHEELS_EXPERIMENTAL_DIR") {
        let generated = fs::canonicalize(root.join(directory)).expect("Experimental asset build directory");
        let source = root.join("wasm-poc");
        for name in ["graphics.wwgp", "sounds.wwsp", "pkg/wild_wheels_wasm_poc.js", "pkg/wild_wheels_wasm_poc_bg.wasm"] {
            let route = format!("/experimental/{name}");
            experimental_asset(&mut code, &mut hash, &route, &generated.join(name));
            if name != "sounds.wwsp" {
                let gzip = generated.join(format!("{name}.gz"));
                println!("cargo:rerun-if-changed={}", gzip.display());
                compressed.push_str(&format!("({route:?},include_bytes!({gzip:?})),\n"));
            }
        }
        experimental_models(&mut code, &mut hash, &source.join("assets"), "/experimental/assets");
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
    let build = format!("{:X}", hash.finalize())[..10].to_owned();
    let dedicated_index = PathBuf::from(env::var("OUT_DIR").unwrap()).join("dedicated-index.html");
    let stamped = fs::read_to_string(&dedicated_index)
        .unwrap()
        .replace("<body class=\"dedicated-server\">", &format!("<body class=\"dedicated-server\" data-build=\"{build}\">"));
    fs::write(&dedicated_index, stamped).unwrap();
    code += &format!("];\npub const BUILD:&str={build:?};");
    code += &compressed;
    code += "];";
    let git = |args: &[&str]| std::process::Command::new("git").args(args).current_dir(&root).output().ok().filter(|out|out.status.success()).map(|out|String::from_utf8_lossy(&out.stdout).trim().to_owned()).unwrap_or_default();
    let revision = git(&["rev-parse", "HEAD"]);
    for target in ["HEAD", "refs/heads/main"] {
        let path = git(&["rev-parse", "--git-path", target]);
        if !path.is_empty() {println!("cargo:rerun-if-changed={}", root.join(path).display());}
    }
    code += &format!("\npub const REVISION:&str={revision:?};");
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("assets.rs"),
        code,
    )
    .unwrap();
}
