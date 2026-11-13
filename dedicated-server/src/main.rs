mod benchmark;
mod chat;
mod photos;
mod room;
mod sessions;
use axum::{
    body::{Body, Bytes},
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, DefaultBodyLimit, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use room::Room;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    sync::{mpsc, Semaphore},
    time::{timeout, MissedTickBehavior},
};
include!(concat!(env!("OUT_DIR"), "/assets.rs"));
#[derive(Clone)]
struct App {
    sessions: Arc<tokio::sync::Mutex<sessions::Sessions>>,
    photos: Arc<Mutex<photos::Album>>,
    room: Arc<Mutex<Room>>,
    limits: Arc<Mutex<HashMap<(IpAddr, String), (Instant, u32)>>>,
    sockets: Arc<Semaphore>,
    origin: Option<String>,
}
fn response(status: u16, value: Value) -> Response {
    (StatusCode::from_u16(status).unwrap(), Json(value)).into_response()
}
fn error(e: (u16, &str)) -> Response {
    response(e.0, json!({"error":e.1}))
}
fn session(h: &HeaderMap) -> &str {
    if let Some(t) = h
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        return t;
    }
    h.get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split(';')
                .find_map(|p| p.trim().strip_prefix("wild-wheels-session="))
        })
        .unwrap_or("")
}
fn same_origin(h: &HeaderMap) -> bool {
    if h.get("sec-fetch-site").is_some_and(|v| v == "cross-site") {
        return false;
    }
    let Some(origin) = h.get(header::ORIGIN) else {
        return true;
    };
    let Some(uri) = origin.to_str().ok().and_then(|s| s.parse::<Uri>().ok()) else {
        return false;
    };
    matches!(uri.scheme_str(), Some("http" | "https"))
        && uri.authority().map(|v| v.as_str()) == h.get(header::HOST).and_then(|v| v.to_str().ok())
}
fn limit(app: &App, ip: IpAddr, path: &str, max: u32, period: Duration) -> bool {
    let mut limits = app.limits.lock().unwrap();
    limits.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
    if limits.len() > 4096 {
        return false;
    }
    let record = limits
        .entry((ip, path.into()))
        .or_insert((Instant::now(), 0));
    if record.0.elapsed() >= period {
        *record = (Instant::now(), 0);
    }
    record.1 += 1;
    record.1 <= max
}
async fn headers(request: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let mut r = match timeout(Duration::from_secs(10), next.run(request)).await {
        Ok(r) => r,
        Err(_) => return error((408, "Request timed out.")),
    };
    let h = r.headers_mut();
    h.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    h.insert("x-content-type-options", "nosniff".parse().unwrap());
    h.insert(header::CONTENT_SECURITY_POLICY,"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'".parse().unwrap());
    r
}
async fn http(
    State(app): State<App>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    method: Method,
    uri: Uri,
    h: HeaderMap,
    body: Bytes,
) -> Response {
    let path = uri.path();
    if path.starts_with("/api/") {
        if !same_origin(&h) {
            return error((403, "Use the game from the same server."));
        }
        if !limit(
            &app,
            addr.ip(),
            path,
            match path {
                "/api/input" => 180,
                "/api/join" => 20,
                _ => 30,
            },
            match path {
                "/api/join" => Duration::from_secs(60),
                _ => Duration::from_secs(1),
            },
        ) {
            return error((429, "Too many requests. Try again shortly."));
        }
        if path == "/api/info" && method == Method::GET {
            return response(
                200,
                json!({"dedicated":true,"room":"00","maxPlayers":8,"addresses":[],"publicOrigin":app.origin,"controlPort":null}),
            );
        }
        if method != Method::POST {
            return error((405, "Use POST."));
        }
        if h.get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_none_or(|v| v.split(';').next() != Some("application/json"))
        {
            return error((415, "Use JSON."));
        }
        let Ok(b) = serde_json::from_slice::<Value>(&body) else {
            return error((400, "Invalid JSON."));
        };
        if !b.is_object() {
            return error((400, "Use a JSON object."));
        }
        return match control(&app, path, session(&h), &b).await {
            Ok(value) => {
                let token = value["token"].as_str().map(str::to_owned);
                let mut r = response(200, value);
                if let Some(token) = token {
                    let secure = app
                        .origin
                        .as_ref()
                        .is_some_and(|s| s.starts_with("https://"));
                    let cookie=format!("wild-wheels-session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",sessions::LIFETIME,match secure{true=>"; Secure",false=>""});
                    r.headers_mut()
                        .insert(header::SET_COOKIE, cookie.parse().unwrap());
                }
                r
            }
            Err(e) => error(e),
        };
    }
    if method != Method::GET && method != Method::HEAD {
        return error((405, "Use GET."));
    }
    match path {
        "/build.json" => response(200, json!({"build":BUILD})),
        "/healthz" => {
            let room = app.room.lock().unwrap();
            let mut timings = room.tick_us.clone();
            timings.sort_unstable();
            let p99 = timings
                .get(timings.len().saturating_sub(1) * 99 / 100)
                .copied()
                .unwrap_or(0);
            response(
                200,
                json!({"status":"ok","players":room.count(),"maxPlayers":8,"ticks":room.ticks,"tickP99Us":p99,"overruns":room.overruns,"build":BUILD}),
            )
        }
        _ => match ASSETS.iter().find(|a| a.0 == path) {
            Some((_, mime, data)) => {
                let mut r = Response::new(match method == Method::HEAD {
                    true => Body::empty(),
                    false => Body::from(*data),
                });
                r.headers_mut()
                    .insert(header::CONTENT_TYPE, mime.parse().unwrap());
                r
            }
            None => error((404, "Not found.")),
        },
    }
}
async fn control(app: &App, path: &str, token: &str, body: &Value) -> room::Result<Value> {
    let persist = matches!(path, "/api/join" | "/api/session" | "/api/afk" | "/api/name" | "/api/driver");
    let mut saved = match persist {
        true => Some(app.sessions.lock().await),
        false => None,
    };
    let at = sessions::now();
    let (value, record) = {
        let mut room = app.room.lock().unwrap();
        let value = dispatch(&mut room, saved.as_deref(), path, token, body, at)?;
        let record = saved.as_ref().map(|store| {
            let current_token = value["token"].as_str().unwrap_or(token);
            let id = room.find(current_token).unwrap();
            let p = room.members[id].as_ref().unwrap();
            let expires = match value["token"].is_string() {
                true => at + sessions::LIFETIME,
                false => store.find(current_token, at).map_or(at + sessions::LIFETIME, |p| p.expires),
            };
            sessions::Session {identity:p.identity.clone(), token:p.token.clone(), name:p.name.clone(), driver:p.driver, role:p.role.clone(), expires}
        });
        (value, record)
    };
    if let Some(record) = record {
        saved.as_mut().unwrap().remember(record, at).await.map_err(|error| {
            eprintln!("Unable to save player session: {error}");
            (503, "Unable to save your session. Please retry.")
        })?;
    }
    Ok(value)
}
fn dispatch(room: &mut Room, saved: Option<&sessions::Sessions>, path: &str, token: &str, body: &Value, at: u64) -> room::Result<Value> {
    if path == "/api/join" && body["code"] != "00" {
        return Err((404, "Room not found. Use room 00."));
    }
    let mut existing = room.find(token);
    if existing.is_none() && matches!(path, "/api/session" | "/api/join") {
        if let Some(profile) = saved.and_then(|store| store.find(token, at)) {
            existing = Some(room.restore(profile)?);
        }
    }
    match (path, existing) {
        ("/api/join", Some(id)) => Ok(room.resume(id, false)),
        ("/api/join", None) => room.join(body),
        (_, Some(id)) => room.control(id, path, body),
        (_, None) => Err((401, "Rejoin the room to reconnect.")),
    }
}
async fn upgrade(
    State(app): State<App>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    h: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !h.contains_key(header::ORIGIN) || !same_origin(&h) {
        return error((403, "Use the game from the same server."));
    }
    if !limit(&app, addr.ip(), "socket", 16, Duration::from_secs(1)) {
        return error((429, "Too many connections."));
    }
    let Ok(permit) = app.sockets.clone().try_acquire_owned() else {
        return error((503, "Too many connections."));
    };
    ws.max_message_size(2048)
        .max_frame_size(2048)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            connection(app, socket).await
        })
}
async fn connection(app: App, mut socket: WebSocket) {
    let Ok(Some(Ok(Message::Text(text)))) = timeout(Duration::from_secs(3), socket.next()).await
    else {
        return;
    };
    let Ok(auth) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    if auth["type"] != "authenticate" {
        return;
    }
    let Some(token) = auth["token"].as_str() else {
        return;
    };
    let (id, generation, notify) = {
        let mut room = app.room.lock().unwrap();
        let Some(id) = room.find(token) else {
            return;
        };
        let p = room.members[id].as_mut().unwrap();
        p.generation += 1;
        p.connected = true;
        p.seen = Instant::now();
        p.notify.notify_one();
        (id, p.generation, p.notify.clone())
    };
    let (mut sink, mut stream) = socket.split();
    let (pong_tx, mut pong_rx) = mpsc::channel::<Message>(1);
    let writer_app = app.clone();
    let writer = async move {
        loop {
            let message = tokio::select! {_=notify.notified()=>{let packet=writer_app.room.lock().unwrap().packet(id,generation);let Some(packet)=packet else{break;};Message::Binary(packet.into())},Some(pong)=pong_rx.recv()=>pong};
            if !matches!(
                timeout(Duration::from_secs(2), sink.send(message)).await,
                Ok(Ok(()))
            ) {
                break;
            }
        }
    };
    let reader = async {
        let mut since = Instant::now();
        let mut count = 0;
        loop {
            let Some(Ok(message)) = stream.next().await else {
                break;
            };
            if since.elapsed() >= Duration::from_secs(1) {
                since = Instant::now();
                count = 0;
            }
            count += 1;
            if count > 100 {
                break;
            }
            let text = match message {
                Message::Text(t) => t,
                Message::Close(_) => break,
                Message::Ping(_) | Message::Pong(_) => continue,
                _ => break,
            };
            let Ok(b) = serde_json::from_str::<Value>(&text) else {
                break;
            };
            let mut room = app.room.lock().unwrap();
            let Some(p) = &mut room.members[id] else {
                break;
            };
            if p.generation != generation || p.token != token {
                break;
            }
            p.seen = Instant::now();
            match b["type"].as_str() {
                Some("ping") => {
                    let Some(sent) = b["sent"].as_f64().filter(|v| v.is_finite() && *v >= 0.0)
                    else {
                        break;
                    };
                    if pong_tx
                        .try_send(Message::Text(
                            json!({"type":"pong","sent":sent}).to_string().into(),
                        ))
                        .is_err()
                    {
                        break;
                    }
                }
                Some("input") => {
                    if room.controls(id, b).is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
    };
    tokio::select! {_=writer=>{},_=reader=>{}}
    app.room.lock().unwrap().disconnect(id, generation);
}
#[tokio::main(flavor = "current_thread")]
async fn main() {
    if std::env::args().any(|v| v == "--benchmark") {
        benchmark::run();
        return;
    }
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "5173".into())
        .parse::<u16>()
        .expect("PORT must be 1–65535");
    assert!(port > 0);
    let bind = std::env::var("BIND")
        .unwrap_or_else(|_| "0.0.0.0".into())
        .parse::<IpAddr>()
        .expect("BIND must be an IP address");
    let arena = std::env::var("ARENA")
        .unwrap_or_else(|_| "0".into())
        .parse::<usize>()
        .unwrap();
    assert!(arena < 2, "ARENA must be 0 or 1");
    let bots = std::env::var("BOTS")
        .unwrap_or_else(|_| "1".into())
        .parse::<usize>()
        .unwrap();
    assert!(bots < 8, "BOTS must be 0–7");
    let origin = std::env::var("PUBLIC_ORIGIN").ok().map(|s| {
        let uri = s.parse::<Uri>().expect("Invalid PUBLIC_ORIGIN");
        assert!(
            matches!(uri.scheme_str(), Some("http" | "https"))
                && uri.authority().is_some()
                && uri.path() == "/"
                && uri.query().is_none(),
            "PUBLIC_ORIGIN must be an HTTP(S) origin"
        );
        s
    });
    let app = App {
        sessions: Arc::new(tokio::sync::Mutex::new(sessions::Sessions::open(
            std::env::var_os("WILD_WHEELS_SESSION_FILE").map(std::path::PathBuf::from)
                .unwrap_or_else(|| ".wild-wheels/sessions.json".into()), sessions::now(),
        ).expect("Unable to load player sessions"))),
        photos: Default::default(),
        room: Arc::new(Mutex::new(Room::new(arena, bots))),
        limits: Default::default(),
        sockets: Arc::new(Semaphore::new(32)),
        origin,
    };
    let clock = app.room.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_nanos(1_000_000_000 / 60));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            let deadline = interval.tick().await;
            let mut room = clock.lock().unwrap();
            if deadline.elapsed() > Duration::from_millis(16) {
                room.overruns += 1;
            }
            room.tick();
        }
    });
    let router = Router::new()
        .route("/api/socket", get(upgrade))
        .route(
            "/api/photos",
            get(photos::list)
                .post(photos::upload)
                .layer(DefaultBodyLimit::max(65536)),
        )
        .route("/api/photos/{epoch}/{id}", get(photos::image))
        .fallback(http)
        .layer(DefaultBodyLimit::max(2048))
        .layer(axum::middleware::from_fn(headers))
        .with_state(app);
    let listener = tokio::net::TcpListener::bind((bind, port))
        .await
        .expect("Unable to bind game port");
    println!(
        "Wild Wheels Rust: http://{bind}:{port} · one arena · 8 players · single async thread"
    );
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        #[cfg(unix)]
        {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("Unable to listen for SIGTERM");
            tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
    })
    .await
    .unwrap();
}

#[cfg(test)]
mod session_tests;
