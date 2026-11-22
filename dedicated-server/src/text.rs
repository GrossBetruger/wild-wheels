use super::*;
use axum::Extension;
use std::{
    collections::HashSet,
    fs,
    io::{self, ErrorKind},
    net::Ipv4Addr,
    path::{Path, PathBuf},
};

pub const MAX_BYTES: usize = 64 * 1024;
const MAX_FILES: usize = 256;

pub fn directory() -> PathBuf {
    std::env::var_os("WILD_WHEELS_RUN_DIR")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| ".wild-wheels".into())
        .join("text")
}

pub async fn post(
    State(app): State<App>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Extension(directory): Extension<PathBuf>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !same_origin(&app, &headers, addr.ip()) {
        return error((403, "Use the game from the same server."));
    }
    let minute = Duration::from_secs(60);
    if !limit(&app, addr.ip(), "text", 10, minute)
        || !limit(&app, Ipv4Addr::UNSPECIFIED.into(), "text-total", 30, minute)
    {
        return error((429, "Too many requests. Try again shortly."));
    }
    let plain_text = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("text/plain"));
    if !plain_text {
        return error((415, "Use text/plain with UTF-8 encoding."));
    }
    if body.is_empty() || std::str::from_utf8(&body).is_err() {
        return error((400, "Send non-empty UTF-8 text."));
    }
    match tokio::task::spawn_blocking(move || save(&directory, &body)).await {
        Ok(Ok(Some(filename))) => response(201, json!({"filename": filename})),
        Ok(Ok(None)) => error((507, "Text storage is full.")),
        _ => error((500, "Unable to save text.")),
    }
}

fn save(directory: &Path, body: &[u8]) -> io::Result<Option<String>> {
    let existing = match fs::read_dir(directory) {
        Ok(entries) => entries
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect::<io::Result<HashSet<_>>>()?,
        Err(error) if error.kind() == ErrorKind::NotFound => HashSet::new(),
        Err(error) => return Err(error),
    };
    let mut available = (1..=MAX_FILES)
        .map(|slot| format!("{slot}.txt"))
        .filter(|name| !existing.contains(std::ffi::OsStr::new(name)))
        .peekable();
    if available.peek().is_none() {
        return Ok(None);
    }
    let temporary = directory.join(format!(".{}.tmp", room::token()));
    let result = (|| {
        sessions::write(&temporary, body)?;
        for filename in available {
            // Publish a complete file without replacing another request's file.
            match fs::hard_link(&temporary, directory.join(&filename)) {
                Ok(()) => return Ok(Some(filename)),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Ok(None)
    })();
    let _ = fs::remove_file(temporary);
    result
}
