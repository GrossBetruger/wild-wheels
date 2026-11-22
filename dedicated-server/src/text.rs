use super::*;
use std::path::PathBuf;

pub const MAX_BYTES: usize = 64 * 1024;

pub struct TextStore {
    key: String,
    directory: PathBuf,
}

impl TextStore {
    pub fn from_env() -> Option<Arc<Self>> {
        let key = std::env::var_os("TEXT_POST_KEY")?;
        let key = key
            .into_string()
            .expect("TEXT_POST_KEY must be hexadecimal");
        assert!(
            key.len() == 64 && key.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "TEXT_POST_KEY must be 64 hexadecimal characters"
        );
        let directory = std::env::var_os("WILD_WHEELS_RUN_DIR")
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| ".wild-wheels".into())
            .join("text");
        Some(Arc::new(Self { key, directory }))
    }
}

pub async fn post(
    State(app): State<App>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(store) = app.text_store.clone() else {
        return error((404, "Not found."));
    };
    if !same_origin(&app, &headers) {
        return error((403, "Use the game from the same server."));
    }
    let loopback = addr.ip().to_canonical().is_loopback();
    let local = loopback && headers.get(header::HOST).is_some_and(lan::loopback_host);
    let https = loopback
        && app.trust_proxy
        && headers
            .get("x-forwarded-proto")
            .is_some_and(|value| value == "https");
    if !local && !https {
        return error((403, "Use HTTPS or connect locally."));
    }
    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("");
    if !security::key_matches(&store.key, presented) {
        let mut reply = error((401, "Send the text posting key as a bearer token."));
        reply
            .headers_mut()
            .insert(header::WWW_AUTHENTICATE, "Bearer".parse().unwrap());
        return reply;
    }
    if !limit(&app, addr.ip(), "text", 10, Duration::from_secs(60)) {
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
    let filename = format!("{}.txt", room::token());
    let path = store.directory.join(&filename);
    match tokio::task::spawn_blocking(move || sessions::write(&path, &body)).await {
        Ok(Ok(())) => response(201, json!({"filename": filename})),
        _ => error((500, "Unable to save text.")),
    }
}
