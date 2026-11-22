mod benchmark;
mod chat;
mod lan;
mod leaderboard;
mod logs;
mod photos;
mod room;
mod sessions;
mod stats;
mod updates;
mod security;
mod text;
mod voice;
use security::{same_origin, same_origin_get};
use axum::{
    body::{Body, Bytes},
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, DefaultBodyLimit, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
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
    stats: Arc<Mutex<stats::Stats>>,
    logs: logs::Logs,
    shutdown: tokio::sync::watch::Sender<bool>,
    updates: Arc<tokio::sync::Mutex<updates::Updates>>,
    sessions: Arc<tokio::sync::Mutex<sessions::Sessions>>,
    photos: Arc<Mutex<photos::Album>>,
    room: Arc<Mutex<Room>>,
    limits: Arc<Mutex<HashMap<(IpAddr, String), (Instant, u32)>>>,
    sockets: Arc<Semaphore>,
    voice_sockets: Arc<Semaphore>,
    voice: Arc<Mutex<voice::VoiceHub>>,
    listener: SocketAddr,
    origin: Option<String>,
    trust_proxy: bool,
    invite_secret: Option<String>,
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
fn limit(app: &App, ip: IpAddr, path: &str, max: u32, period: Duration) -> bool {
    let mut limits = app.limits.lock().unwrap();
    limits.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
    if limits.len() >= 4096 && !limits.contains_key(&(ip, path.into())) {
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
async fn headers(State(app): State<App>, request: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let peer = request.extensions().get::<ConnectInfo<SocketAddr>>().map(|p| p.0.ip());
    if !peer.is_some_and(|peer| security::transport(&app, request.headers(), peer)) {
        return error((403, "Use the configured HTTPS game origin."));
    }
    let secure = app.origin.as_ref().is_some_and(|o| o.starts_with("https://"))
        || peer.is_some_and(|peer| security::trusted_https(&app, request.headers(), peer));
    let seconds = match request.uri().path() {"/api/updates/check" => 30, _ => 10};
    let mut r = match timeout(Duration::from_secs(seconds), next.run(request)).await {
        Ok(r) => r,
        Err(_) => return error((408, "Request timed out.")),
    };
    let h = r.headers_mut();
    h.insert("referrer-policy", "no-referrer".parse().unwrap());
    if secure { h.insert("strict-transport-security", "max-age=31536000".parse().unwrap()); }
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
        let read_only = method == Method::GET && matches!(path, "/api/leaderboard" | "/api/info");
        if !(if read_only { same_origin_get(&app, &h, addr.ip()) } else { same_origin(&app, &h, addr.ip()) }) {
            return error((403, "Use the game from the same server."));
        }
        if !limit(
            &app,
            addr.ip(),
            if matches!(path, "/api/input" | "/api/join" | "/api/updates/check" | "/api/updates/install") { path } else { "api" },
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
        if path == "/api/leaderboard" && method == Method::GET {
            return response(200, app.room.lock().unwrap().board.report());
        }
        if path == "/api/info" && method == Method::GET {
            let addresses = match (&app.origin, h.get(header::HOST)) {
                (None, Some(host)) if addr.ip().to_canonical().is_loopback() && lan::loopback_host(host) => {
                    lan::addresses(app.listener)
                }
                _ => Vec::new(),
            };
            return response(
                200,
                json!({"dedicated":true,"room":"00","maxPlayers":room::CAPACITY,"addresses":addresses,"publicOrigin":app.origin,"controlPort":null,"arenas":wild_wheels_core::arena_defs()}),
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
        if matches!(path, "/api/updates/check" | "/api/updates/install") {
            {
                let room = app.room.lock().unwrap();
                let Some(id) = room.find(session(&h)) else {return error((401, "Join the room before managing updates."));};
                if path.ends_with("/install") && (room.members[id].as_ref().unwrap().afk || !matches!(room.core.phase(), "ready" | "finished")) {
                    return error((409, "Update the server between matches, while you are active."));
                }
            }
            let bucket = match path {"/api/updates/check" => "update-check", _ => "update-install"};
            if !limit(&app, addr.ip(), bucket, 2, Duration::from_secs(60)) {return error((429, "Please wait before checking again."));}
            let Ok(mut updates) = app.updates.try_lock() else {return error((409, "Another update check is running."));};
            let result = match path {"/api/updates/check" => updates.check().await, _ => updates.start().await};
            return match result {Ok(value) => response(200, value), Err(e) => error(e)};
        }
        let outcome = control(&app, path, session(&h), &b).await;
        note_request(&app, path, &b, &outcome);
        return match outcome {
            Ok(value) => {
                let token = value["token"].as_str().map(str::to_owned);
                let mut r = response(200, value);
                if let Some(token) = token {
                    let secure = app
                        .origin
                        .as_ref()
                        .is_some_and(|s| s.starts_with("https://"))
                        || security::trusted_https(&app, &h, addr.ip());
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
        "/statsz" => {
            if !limit(&app, addr.ip(), "stats", 30, Duration::from_secs(60)) {
                return error((429, "Too many stats requests."));
            }
            let mut report = app.stats.lock().unwrap().report();
            report["currentCommit"] = json!(REVISION);
            report["build"] = json!(BUILD);
            report["timezone"] = json!("UTC");
            response(200, report)
        }
        "/build.json" => response(200, json!({"build":BUILD,"revision":REVISION})),
        "/logz" | "/logz/all" => {
            // Collecting everything is the heavier request, so it is allowed less often.
            let everything = path == "/logz/all";
            if !limit(&app, addr.ip(), if everything { "logs-all" } else { "logs" }, if everything { 4 } else { 30 }, Duration::from_secs(60)) {
                return error((429, "Too many log requests."));
            }
            if !everything {
                let presented = h.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
                if !app.logs.key_matches(presented) {
                    return error((401, "Send the log reading key as a bearer token."));
                }
            }
            let Some(directory) = app.logs.directory().map(std::path::Path::to_owned) else {
                return error((503, "This server is not keeping a log."));
            };
            let query = match logs::Query::parse(uri.query().unwrap_or("")) {
                Ok(query) => query,
                Err(message) => return error((400, message)),
            };
            if everything {
                if query.day.is_some() || query.limit.is_some() {
                    return error((400, "Everything has no day or limit. Use days, source, level, event and contains."));
                }
                let at = logs::now();
                let (query, listing) = (Arc::new(query), directory.clone());
                let listed = query.clone();
                let Ok(days) = tokio::task::spawn_blocking(move || logs::kept(&listing, &listed, at)).await else {
                    return error((500, "The log could not be read."));
                };
                // One day is read and sent at a time, away from the game's thread, so
                // the whole log is never held in memory.
                let pieces = futures_util::stream::iter(days).then(move |day| {
                    let (directory, query) = (directory.clone(), query.clone());
                    async move { tokio::task::spawn_blocking(move || Bytes::from(logs::collected(&directory, &day, &query))).await.map_err(std::io::Error::other) }
                });
                let mut r = Response::new(Body::from_stream(pieces));
                r.headers_mut().insert(header::CONTENT_TYPE, "application/x-ndjson".parse().unwrap());
                r.headers_mut().insert(header::CONTENT_DISPOSITION, format!("attachment; filename=\"wild-wheels-log-{}.jsonl\"", logs::day(at)).parse().unwrap());
                return r;
            }
            if query.days.is_some() {
                return error((400, "Use days with /logz/all."));
            }
            let limits = app.logs.limits();
            // Files are read away from the game's thread.
            match tokio::task::spawn_blocking(move || logs::read(&directory, limits, &query, logs::now())).await {
                Ok(Ok(found)) => response(200, found),
                Ok(Err(message)) => error((400, message)),
                Err(_) => error((500, "The log could not be read.")),
            }
        }
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
                json!({"status":"ok","players":room.count(),"maxPlayers":room::CAPACITY,"ticks":room.ticks,"tickP99Us":p99,"overruns":room.overruns,"build":BUILD,"revision":REVISION}),
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
/// Notes a room request in the problem log: refusals, and the ones that change
/// who is playing or how. Chat and controls are not noted, nor is anything secret.
fn note_request(app: &App, path: &str, body: &Value, outcome: &room::Result<Value>) {
    let asked: serde_json::Map<String, Value> = ["action", "arena", "bots", "driver", "afk", "role", "color", "abilities"]
        .iter()
        .filter_map(|key| body.get(*key).filter(|v| !v.is_null()).map(|v| (key.to_string(), v.clone())))
        .collect();
    match outcome {
        Err((status, message)) => app.logs.note("warn", "request-refused", json!({"path":path,"status":status,"message":message,"asked":asked})),
        Ok(value) if matches!(path, "/api/join" | "/api/session" | "/api/leave" | "/api/afk" | "/api/driver" | "/api/name" | "/api/color" | "/api/control") => {
            let who = value["you"].as_u64().map(|id| app.room.lock().unwrap().who(id as usize));
            app.logs.note("info", "request", json!({"path":path,"who":who,"asked":asked,"phase":value["world"]["phase"]}));
        }
        Ok(_) => {}
    }
}
/// A client's own problems, sent a few at a time over HTTP, never over the game socket.
async fn report(State(app): State<App>, ConnectInfo(addr): ConnectInfo<SocketAddr>, h: HeaderMap, body: Bytes) -> Response {
    if !same_origin(&app, &h, addr.ip()) {
        return error((403, "Use the game from the same server."));
    }
    if !limit(&app, addr.ip(), "log", 6, Duration::from_secs(10)) {
        return error((429, "Too many reports. Try again shortly."));
    }
    if h.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_none_or(|v| v.split(';').next() != Some("application/json")) {
        return error((415, "Use JSON."));
    }
    let Ok(b) = serde_json::from_slice::<Value>(&body) else {
        return error((400, "Invalid JSON."));
    };
    // Only a player in the room may write to the log.
    let who = {
        let room = app.room.lock().unwrap();
        room.find(session(&h)).map(|id| room.who(id))
    };
    let Some(who) = who else {
        return error((401, "Join the room before reporting."));
    };
    match logs::reports(&b) {
        Ok((source, entries)) => {
            let received = logs::now();
            for (level, event, mut fields) in entries {
                fields["who"] = who.clone();
                // When it happened, not when it was sent, to set beside the server's own lines.
                fields["happened"] = json!(logs::stamp(received - fields["agoMs"].as_u64().unwrap_or(0)));
                app.logs.client(source, level, &event, fields);
            }
            response(200, json!({}))
        }
        Err(message) => error((400, message)),
    }
}
async fn control(app: &App, path: &str, token: &str, body: &Value) -> room::Result<Value> {
    let persist = matches!(path, "/api/join" | "/api/session" | "/api/afk" | "/api/name" | "/api/driver" | "/api/color");
    let mut saved = match persist {
        true => Some(app.sessions.lock().await),
        false => None,
    };
    let at = sessions::now();
    let (value, record, previous_color) = {
        let mut room = app.room.lock().unwrap();
        let known = room.find(token).is_some() || saved.as_deref().is_some_and(|store| store.find(token, at).is_some());
        if path == "/api/join" && !known && app.invite_secret.as_ref().is_some_and(|secret| body["invite"].as_str() != Some(secret.as_str())) {
            return Err((403, "Open the complete invitation link."));
        }
        let previous_color = if path == "/api/color" {
            room.find(token).map(|id| { let p = room.members[id].as_ref().unwrap(); (p.color.clone(), p.preferred_color.clone()) })
        } else { None };
        if path == "/api/leave" {
            if let Some(id) = room.find(token) {
                app.voice.lock().unwrap().disconnect(id);
            }
        }
        let value = dispatch(&mut room, saved.as_deref(), path, token, body, at)?;
        let record = saved.as_ref().map(|store| {
            let current_token = value["token"].as_str().unwrap_or(token);
            let id = room.find(current_token).unwrap();
            let p = room.members[id].as_ref().unwrap();
            let expires = match value["token"].is_string() {
                true => at + sessions::LIFETIME,
                false => store.find(current_token, at).map_or(at + sessions::LIFETIME, |p| p.expires),
            };
            sessions::Session {identity:p.identity.clone(), token:p.token.clone(), name:p.name.clone(), driver:p.driver, role:p.role.clone(), color:p.preferred_color.clone(), chat_color:Some(p.chat_color.clone()), expires}
        });
        (value, record, previous_color)
    };
    if let Some(record) = record {
        if let Err(error) = saved.as_mut().unwrap().remember(record, at).await {
            if let Some((color, preferred)) = previous_color {
                let mut room = app.room.lock().unwrap();
                if let Some(id) = room.find(token) {
                    let member = room.members[id].as_mut().unwrap(); member.color = color; member.preferred_color = preferred;
                    room.broadcast();
                }
            }
            eprintln!("Unable to save player session: {error}");
            return Err((503, "Unable to save your session. Please retry."));
        }
    }
    Ok(value)
}
fn dispatch(room: &mut Room, saved: Option<&sessions::Sessions>, path: &str, token: &str, body: &Value, at: u64) -> room::Result<Value> {
    if path == "/api/join" && body["code"] != "00" {
        return Err((404, "Room not found. Use room 00."));
    }
    let preference = if matches!(path, "/api/join" | "/api/session") { room::color_preference(body)? } else { None };
    let mut existing = room.find(token);
    if existing.is_none() && matches!(path, "/api/session" | "/api/join") {
        if let Some(profile) = saved.and_then(|store| store.find(token, at)) {
            existing = Some(room.restore(profile)?);
        }
    }
    match (path, existing) {
        ("/api/join", Some(id)) => {
            if let Some(color) = preference { room.prefer_color(id, &color)?; }
            Ok(room.resume(id, false))
        },
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
    if !h.contains_key(header::ORIGIN) || !same_origin(&app, &h, addr.ip()) {
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
/// The parts of a refused input that explain the refusal, without its key presses.
fn input_summary(text: &str) -> Value {
    let Ok(b) = serde_json::from_str::<Value>(text) else {
        return Value::Null;
    };
    let moves = b["moves"].as_array().map(|moves| json!({"count":moves.len(),"first":moves.first().map(|m| m["sequence"].clone()),"last":moves.last().map(|m| m["sequence"].clone())}));
    let actions: Vec<_> = b["actions"].as_array().into_iter().flatten().take(8).map(|a| json!({"type":a["type"],"id":a["id"],"afterMove":a["afterMove"]})).collect();
    json!({"sequence":b["sequence"],"epoch":b["epoch"],"moves":moves,"actions":actions})
}
async fn connection(app: App, mut socket: WebSocket) {
    let mut shutdown = app.shutdown.subscribe();
    if *shutdown.borrow() { return; }
    let refuse = |reason: &str| app.logs.note("warn", "socket-refused", json!({"reason":reason}));
    let Ok(Some(Ok(Message::Text(text)))) = timeout(Duration::from_secs(3), socket.next()).await
    else {
        return refuse("no sign-in message within 3 seconds");
    };
    let Ok(auth) = serde_json::from_str::<Value>(&text) else {
        return refuse("the sign-in message was not JSON");
    };
    if auth["type"] != "authenticate" {
        return refuse("the first message was not a sign-in");
    }
    let Some(token) = auth["token"].as_str() else {
        return refuse("the sign-in had no session");
    };
    let (id, generation, notify) = {
        let mut room = app.room.lock().unwrap();
        let Some(id) = room.find(token) else {
            drop(room);
            return refuse("the session is not in the room");
        };
        let p = room.members[id].as_mut().unwrap();
        p.generation += 1;
        p.connected = true;
        p.seen = Instant::now();
        p.notify.notify_one();
        let opened = (id, p.generation, p.notify.clone());
        app.logs.note("info", "socket-open", json!({"who":room.who(id),"connection":opened.1}));
        opened
    };
    let opened = Instant::now();
    let (mut sink, mut stream) = socket.split();
    let (pong_tx, mut pong_rx) = mpsc::channel::<Message>(1);
    let writer_app = app.clone();
    let writer = async move {
        loop {
            let message = tokio::select! {_=notify.notified()=>{let packet=writer_app.room.lock().unwrap().packet(id,generation);let Some(packet)=packet else{break "replaced by a newer connection, or the player left";};Message::Binary(packet.into())},Some(pong)=pong_rx.recv()=>pong};
            if !matches!(
                timeout(Duration::from_secs(2), sink.send(message)).await,
                Ok(Ok(()))
            ) {
                break "the client did not take a message within 2 seconds";
            }
        }
    };
    // Why the server ended the connection, and what it held if it refused an input.
    let reader = async {
        let mut since = Instant::now();
        let mut count = 0;
        loop {
            let message = match timeout(Duration::from_secs(30), stream.next()).await {
                Ok(Some(Ok(message))) => message,
                Ok(Some(Err(_))) => break ("the connection failed".to_owned(), Value::Null),
                Ok(None) => break ("the client went away".to_owned(), Value::Null),
                Err(_) => break ("nothing from the client for 30 seconds".to_owned(), Value::Null),
            };
            if since.elapsed() >= Duration::from_secs(1) {
                since = Instant::now();
                count = 0;
            }
            count += 1;
            if count > 100 {
                break ("more than 100 messages in a second".to_owned(), Value::Null);
            }
            let text = match message {
                Message::Text(t) => t,
                Message::Close(_) => break ("the client closed it".to_owned(), Value::Null),
                Message::Ping(_) | Message::Pong(_) => continue,
                _ => break ("a message that was not text".to_owned(), Value::Null),
            };
            let Ok(b) = serde_json::from_str::<Value>(&text) else {
                break ("a message that was not JSON".to_owned(), Value::Null);
            };
            let mut room = app.room.lock().unwrap();
            let Some(p) = &mut room.members[id] else {
                break ("the player left".to_owned(), Value::Null);
            };
            if p.generation != generation || p.token != token {
                break ("replaced by a newer connection".to_owned(), Value::Null);
            }
            p.seen = Instant::now();
            match b["type"].as_str() {
                Some("ping") => {
                    let Some(sent) = b["sent"].as_f64().filter(|v| v.is_finite() && *v >= 0.0)
                    else {
                        break ("an invalid ping".to_owned(), Value::Null);
                    };
                    if pong_tx
                        .try_send(Message::Text(
                            json!({"type":"pong","sent":sent}).to_string().into(),
                        ))
                        .is_err()
                    {
                        break ("pings faster than they could be answered".to_owned(), Value::Null);
                    }
                }
                Some("input") => {
                    let held = room.input_state(id);
                    if let Err((_, message)) = room.controls(id, b) {
                        break (format!("refused input: {message}"), json!({"held":held,"input":input_summary(&text)}));
                    }
                }
                _ => break ("an unknown kind of message".to_owned(), Value::Null),
            }
        }
    };
    let (reason, detail) = tokio::select! {reason=writer=>(reason.to_owned(),Value::Null),ended=reader=>ended,_=shutdown.changed()=>("the server is stopping".to_owned(),Value::Null)};
    let mut room = app.room.lock().unwrap();
    // A refusal is the server's doing and worth a look; a client leaving is routine.
    let level = match reason.starts_with("refused") || reason.starts_with("more than") || reason.contains("did not take") {
        true => "error",
        false => "info",
    };
    app.logs.note(level, "socket-closed", json!({"who":room.who(id),"connection":generation,"seconds":opened.elapsed().as_secs(),"reason":reason,"detail":detail}));
    room.disconnect(id, generation);
}
// Keep the 60 Hz simulation timer independent of HTTP and WebSocket scheduling.
// Enable the I/O driver too so macOS parks on kqueue instead of timer-coalesced condvars.
fn spawn_game_clock(task: impl std::future::Future<Output = ()> + Send + 'static) -> std::thread::JoinHandle<()> {
    std::thread::Builder::new().name("game-clock".into()).spawn(move || {
        tokio::runtime::Builder::new_current_thread().enable_all().build()
            .expect("game clock runtime").block_on(task);
    }).expect("game clock thread")
}

#[cfg(test)]
#[tokio::test(flavor = "current_thread")]
async fn game_clock_advances_while_the_request_thread_is_busy() {
    let (tx, rx) = std::sync::mpsc::channel();
    let clock = spawn_game_clock(async move {
        let mut interval = tokio::time::interval(Duration::from_nanos(1_000_000_000 / 60));
        interval.set_missed_tick_behavior(MissedTickBehavior::Burst);
        let started = Instant::now();
        let mut ticks = 0u32;
        while started.elapsed() < Duration::from_millis(250) {
            interval.tick().await;
            ticks += 1;
        }
        tx.send(ticks).unwrap();
    });
    let ticks = rx.recv_timeout(Duration::from_secs(2)).expect("tick while the request thread is blocked");
    assert!(ticks >= 12, "expected ~60 Hz clock (~15 ticks in 250ms), got {ticks}");
    clock.join().unwrap();
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
    if let Some(arenas_path) = std::env::var_os("WILD_WHEELS_ARENAS_FILE") {
        let text = std::fs::read_to_string(&arenas_path).expect("Unable to read WILD_WHEELS_ARENAS_FILE");
        let defs: Vec<wild_wheels_core::ArenaDef> = serde_json::from_str(&text).expect("Invalid WILD_WHEELS_ARENAS_FILE JSON");
        wild_wheels_core::set_arena_defs(defs).expect("Invalid arena definitions in WILD_WHEELS_ARENAS_FILE");
    }
    let arena = std::env::var("ARENA")
        .unwrap_or_else(|_| "0".into())
        .parse::<usize>()
        .unwrap();
    assert!(arena < wild_wheels_core::arena_count(), "ARENA is out of range");
    let bots = std::env::var("BOTS")
        .unwrap_or_else(|_| "1".into())
        .parse::<usize>()
        .unwrap();
    let max_capacity = wild_wheels_core::arena_max_players(arena).map_or(room::CAPACITY, |cap| cap.min(room::CAPACITY));
    assert!(bots < max_capacity, "BOTS must leave a seat free");
    let origin = std::env::var("PUBLIC_ORIGIN").ok().map(|s| {
        let uri = s.parse::<Uri>().expect("Invalid PUBLIC_ORIGIN");
        assert!(
            matches!(uri.scheme_str(), Some("http" | "https"))
                && uri.authority().is_some()
                && uri.path() == "/"
                && uri.query().is_none(),
            "PUBLIC_ORIGIN must be an HTTP(S) origin"
        );
        s.trim_end_matches('/').to_owned()
    });
    let chat_path = std::env::var_os("WILD_WHEELS_CHAT_FILE").map(std::path::PathBuf::from)
        .unwrap_or_else(|| ".wild-wheels/chat.json".into());
    let stats_path = std::env::var_os("WILD_WHEELS_STATS_FILE").map(std::path::PathBuf::from)
        .unwrap_or_else(|| ".wild-wheels/stats.json".into());
    // SPECIAL_ABILITIES=off starts the room with abilities off, as a host can set.
    let abilities = match std::env::var("SPECIAL_ABILITIES").as_deref() {
        Ok("off") => false,
        Ok("on") | Err(_) => true,
        Ok(_) => panic!("SPECIAL_ABILITIES must be on or off"),
    };
    let board_path = std::env::var_os("WILD_WHEELS_LEADERBOARD_FILE").map(std::path::PathBuf::from)
        .unwrap_or_else(|| ".wild-wheels/leaderboard.json".into());
    let mut room = Room::new(arena, bots);
    room.board = leaderboard::Leaderboard::open(&board_path).expect("Unable to load the saved leaderboard");
    room.abilities = abilities;
    room.chat = chat::Chat::open(&chat_path).expect("Unable to load saved chat");
    let invite_secret = std::env::var("INVITE_SECRET").ok();
    if origin.as_ref().is_some_and(|o| o.starts_with("https://")) {
        assert!(invite_secret.as_ref().is_some_and(|v| v.len() >= 32), "Set INVITE_SECRET to at least 32 random characters for public hosting");
    }
    let log_directory = std::env::var_os("WILD_WHEELS_LOG_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| ".wild-wheels/logs".into());
    let log_key = std::env::var("LOG_READ_KEY").ok();
    assert!(log_key.as_ref().is_none_or(|key| key.len() >= 32), "LOG_READ_KEY must have at least 32 characters");
    let logs = logs::Logs::open(&log_directory, logs::Limits::from_env(), log_key).unwrap_or_else(|error| {
        eprintln!("Unable to keep a problem log in {}: {error}", log_directory.display());
        logs::Logs::disabled()
    });
    // A panic is the one problem the server cannot note afterwards.
    let panic_log = logs.clone();
    let earlier = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        panic_log.note("error", "panic", json!({"message":panic.to_string()}));
        panic_log.flush();
        earlier(panic);
    }));
    logs.note("info", "server-start", json!({"build":BUILD,"revision":REVISION,"port":port,"arena":arena,"bots":bots,"players":room::CAPACITY,"abilities":abilities}));
    room.log = logs.clone();
    let listener = tokio::net::TcpListener::bind((bind, port))
        .await
        .expect("Unable to bind game port");
    let app = App {
        logs,
        stats: Arc::new(Mutex::new(stats::Stats::open(&stats_path).expect("Unable to load saved server stats"))),
        shutdown: tokio::sync::watch::channel(false).0,
        updates: Arc::new(tokio::sync::Mutex::new(updates::Updates::discover())),
        sessions: Arc::new(tokio::sync::Mutex::new(sessions::Sessions::open(
            std::env::var_os("WILD_WHEELS_SESSION_FILE").map(std::path::PathBuf::from)
                .unwrap_or_else(|| ".wild-wheels/sessions.json".into()), sessions::now(),
        ).expect("Unable to load player sessions"))),
        photos: Default::default(),
        room: Arc::new(Mutex::new(room)),
        limits: Default::default(),
        sockets: Arc::new(Semaphore::new(32)),
        voice_sockets: Arc::new(Semaphore::new(32)),
        voice: Default::default(),
        listener: listener.local_addr().expect("Unable to read game listening address"),
        origin,
        trust_proxy: std::env::var("TRUST_PROXY").is_ok_and(|v| v == "1"),
        invite_secret,
    };
    let clock = app.room.clone();
    let clock_board = board_path.clone();
    let tick_stats = app.stats.clone();
    let commit = match REVISION.is_empty() {true=>format!("build:{BUILD}"),false=>REVISION.to_owned()};
    let mut stop_clock = app.shutdown.subscribe();
    let clock_task = spawn_game_clock(async move {
        let mut interval = tokio::time::interval(Duration::from_nanos(1_000_000_000 / 60));
        // Catch up brief OS timer coalescing so the match clock stays at 60 Hz,
        // while resetting after long pauses (>250ms) so the server never bursts endlessly.
        interval.set_missed_tick_behavior(MissedTickBehavior::Burst);
        // For the problem log: a minute of tick costs, late ticks and the longest
        // wait between ticks, reported once a minute while anyone is in the room.
        let (mut costs, mut late, mut longest_gap, mut last) = (Vec::with_capacity(3600), 0u32, Duration::ZERO, Instant::now());
        loop {
            let deadline = tokio::select! {tick=interval.tick()=>tick,_=stop_clock.changed()=>break};
            let woke = Instant::now();
            if woke.saturating_duration_since(deadline.into_std()) > Duration::from_millis(250) {
                interval.reset();
            }
            let mut room = clock.lock().unwrap();
            let acquired = Instant::now();
            let gap = acquired.duration_since(last);
            if gap >= Duration::from_millis(250) {
                room.log.note("warn", "tick-gap", json!({"gapMs":gap.as_millis() as u64,
                    "timerLateMs":woke.saturating_duration_since(deadline.into_std()).as_millis() as u64,
                    "roomLockWaitMs":acquired.duration_since(woke).as_millis() as u64,
                    "clock":room.clock()}));
            }
            last = acquired;
            let overrun = deadline.elapsed() > Duration::from_millis(16);
            if overrun {
                room.overruns += 1;
            }
            room.tick();
            if std::mem::take(&mut room.board_changed) {
                // A match just finished. The file is written away from the game's thread.
                let (board, path, log) = (room.board.clone(), clock_board.clone(), room.log.clone());
                tokio::task::spawn_blocking(move || {
                    if let Err(error) = board.save(&path) {
                        eprintln!("Unable to save the leaderboard: {error}");
                        log.note("error", "leaderboard-not-saved", json!({"error":error.to_string()}));
                    }
                });
            }
            let cost = *room.tick_us.last().unwrap_or(&0);
            tick_stats.lock().unwrap().record(&commit, sessions::now(), cost, overrun, room.count());
            late += u32::from(overrun);
            longest_gap = longest_gap.max(gap);
            costs.push(cost);
            if cost > 16_000 {
                room.log.note("warn", "tick-slow", json!({"microseconds":cost,"players":room.count()}));
            }
            if costs.len() >= 3600 {
                costs.sort_unstable();
                if room.count() > 0 || late > 0 {
                    let level = match late > 30 || longest_gap > Duration::from_millis(250) {true => "warn", false => "info"};
                    let (players, busiest, clock) = (room.activity(), room.busiest(), room.clock());
                    room.log.note(level, "server-minute", json!({"ticks":costs.len(),"tickMicroseconds":{"median":costs[costs.len()/2],"p99":costs[costs.len()*99/100],"longest":costs[costs.len()-1]},"lateTicks":late,"longestGapMs":longest_gap.as_millis() as u64,"phase":room.core.phase(),"clock":clock,"busiest":busiest,"players":players}));
                }
                costs.clear();
                late = 0;
                longest_gap = Duration::ZERO;
            }
        }
    });
    let checkpoint_stats = app.stats.clone();
    let checkpoint_path = stats_path.clone();
    let mut stop_saving = app.shutdown.subscribe();
    let checkpoint_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            tokio::select! {_=interval.tick()=>{},_=stop_saving.changed()=>break}
            let snapshot = checkpoint_stats.lock().unwrap().clone();
            let path = checkpoint_path.clone();
            match tokio::task::spawn_blocking(move || snapshot.save(&path)).await {
                Ok(Ok(())) => {},
                _ => eprintln!("Unable to checkpoint server stats; will retry in 30 seconds."),
            }
        }
    });
    let router = Router::new()
        .route("/api/socket", get(upgrade))
        .route("/api/voice", get(voice::upgrade))
        .route(
            "/api/photos",
            get(photos::list)
                .post(photos::upload)
                .layer(DefaultBodyLimit::max(65536)),
        )
        .route("/api/photos/{epoch}/{id}", get(photos::image))
        .route("/api/log", post(report).layer(DefaultBodyLimit::max(8192)))
        .route(
            "/api/text",
            post(text::post)
                .route_layer(axum::Extension(text::directory()))
                .layer(DefaultBodyLimit::max(text::MAX_BYTES)),
        )
        .fallback(http)
        .layer(DefaultBodyLimit::max(2048))
        .layer(axum::middleware::from_fn_with_state(app.clone(), headers))
        .with_state(app.clone());
    println!(
        "Wild Wheels Rust: http://{bind}:{port} · one arena · {} players · single async thread",
        room::CAPACITY
    );
    let shutdown = app.shutdown.clone();
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
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
        // Stop upgraded connections too, so graceful shutdown can drain promptly.
        let _ = shutdown.send(true);
    })
    .await
    .unwrap();
    clock_task.join().expect("Server clock task failed");
    checkpoint_task.await.expect("Stats checkpoint task failed");
    // All HTTP chat writes have drained before the final snapshot is taken.
    let final_stats = app.stats.lock().unwrap().clone();
    tokio::task::spawn_blocking(move || {
        let chat = app.room.lock().unwrap().chat.save(&chat_path);
        let stats = final_stats.save(&stats_path);
        let board = app.room.lock().unwrap().board.save(&board_path);
        chat.and(stats).and(board)
    })
        .await.expect("Server state save task failed").expect("Unable to save server state during shutdown");
    app.logs.note("info", "server-stop", json!({}));
    app.logs.flush();
    println!("Chat saved for the next server start.");
    println!("Cumulative server stats saved for the next server start.");
}

#[cfg(test)]
mod session_tests;
