//! HTTP/WebSocket adapter. It moves bounded messages, never simulation state.
use crate::{
    config::Config,
    session::{Identity, Store, now},
};
use crossbeam_channel::{Receiver, Sender, bounded};
use futures_util::{SinkExt, StreamExt};
use reqwest::{Client, StatusCode};
use serde_json::{Value, json};
use std::{error::Error, time::Duration};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};

type NetResult<T> = Result<T, Box<dyn Error + Send + Sync>>;
pub enum Command {
    Input(Vec<u8>),
    /// A room setting or match start for `/api/control`.
    Control(Value),
    Driver(usize),
    Afk(bool),
    /// Give up the seat in the room, then stop.
    Leave,
    Stop,
}
pub enum Event {
    Status(String),
    Connected,
    Packet(Vec<u8>),
    Error(String),
}
pub struct Transport {
    pub events: Receiver<Event>,
    pub commands: Sender<Command>,
}
impl Drop for Transport {
    fn drop(&mut self) {
        let _ = self.commands.try_send(Command::Stop);
    }
}
impl Transport {
    pub fn spawn(config: Config) -> Self {
        let (tx, commands) = bounded(8);
        let (events, rx) = bounded(64);
        std::thread::Builder::new()
            .name("arena-network".into())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = events.try_send(Event::Error(e.to_string()));
                        return;
                    }
                };
                runtime.block_on(worker(config, commands, events));
            })
            .expect("could not start network worker");
        Self {
            events: rx,
            commands: tx,
        }
    }
}
async fn body(mut response: reqwest::Response) -> NetResult<Value> {
    if response.content_length().is_some_and(|n| n > 1_048_576) {
        return Err("Server response is too large".into());
    }
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err("Server response is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)?;
    if !status.is_success() {
        return Err(format!(
            "Server returned {status}: {}",
            value["error"].as_str().unwrap_or("request failed")
        )
        .into());
    }
    Ok(value)
}
async fn worker(config: Config, commands: Receiver<Command>, events: Sender<Event>) {
    let client = match Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = events.try_send(Event::Error(e.to_string()));
            return;
        }
    };
    let mut store = match Store::open() {
        Ok(s) => s,
        Err(e) => {
            let _ = events.try_send(Event::Error(format!("Session storage: {e}")));
            return;
        }
    };
    let mut delay = 1;
    loop {
        let _ = events.try_send(Event::Status("Connecting to dedicated arena...".into()));
        match connect(&config, &client, &mut store, &commands, &events).await {
            Ok(()) => return,
            Err(error) => {
                if events
                    .try_send(Event::Status(format!("Reconnecting in {delay}s: {error}")))
                    .is_err()
                {
                    return;
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(delay)).await;
        delay = (delay * 2).min(10);
        // Inputs from a dead session must not leak into the new session.
        loop {
            match commands.try_recv() {
                Ok(Command::Stop | Command::Leave)
                | Err(crossbeam_channel::TryRecvError::Disconnected) => return,
                Ok(_) => {}
                Err(crossbeam_channel::TryRecvError::Empty) => break,
            }
        }
    }
}
async fn connect(
    config: &Config,
    client: &Client,
    store: &mut Store,
    commands: &Receiver<Command>,
    events: &Sender<Event>,
) -> NetResult<()> {
    let origin = config.origin.as_str();
    let info = body(client.get(config.origin.join("api/info")?).send().await?).await?;
    if info["dedicated"] != true {
        return Err("Only the dedicated Rust server is supported".into());
    }
    let mut response = None;
    if let Some(identity) = store.get(origin) {
        let restored = client
            .post(config.origin.join("api/session")?)
            .header("Cookie", format!("wild-wheels-session={}", identity.token))
            .json(&json!({}))
            .send()
            .await?;
        if restored.status() != StatusCode::UNAUTHORIZED {
            response = Some(restored);
        }
    }
    let response =
        match response {
            Some(r) => r,
            None => client
                .post(config.origin.join("api/join")?)
                .json(
                    &json!({"code":"00","name":config.name,"driver":config.driver,"role":"driver"}),
                )
                .send()
                .await?,
        };
    let expiration = response
        .cookies()
        .find(|c| c.name() == "wild-wheels-session")
        .and_then(|c| c.max_age())
        .map(|age| now() + age.as_secs());
    let joined = body(response).await?;
    let token = joined["token"]
        .as_str()
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("Server did not issue a valid session")?
        .to_owned();
    store.remember(
        origin,
        Identity {
            token: token.clone(),
            expires: expiration.unwrap_or_else(now),
        },
    )?;
    // A restored identity keeps its name/character unless explicitly updated here.
    if matches!(
        joined["world"]["phase"].as_str(),
        Some("ready" | "finished")
    ) {
        body(
            client
                .post(config.origin.join("api/driver")?)
                .bearer_auth(&token)
                .json(&json!({"driver":config.driver}))
                .send()
                .await?,
        )
        .await?;
    }
    body(
        client
            .post(config.origin.join("api/name")?)
            .bearer_auth(&token)
            .json(&json!({"name":config.name}))
            .send()
            .await?,
    )
    .await?;
    if config.auto_start {
        let _ = body(
            client
                .post(config.origin.join("api/control")?)
                .bearer_auth(&token)
                .json(&json!({"action":"start"}))
                .send()
                .await?,
        )
        .await;
    }
    let mut socket_url = config.origin.join("api/socket")?;
    socket_url
        .set_scheme(match socket_url.scheme() {
            "https" => "wss",
            _ => "ws",
        })
        .map_err(|_| "Invalid socket URL")?;
    let mut request = socket_url.as_str().into_client_request()?;
    request.headers_mut().insert(
        "Origin",
        config.origin.origin().ascii_serialization().parse()?,
    );
    let (mut socket, _) = tokio_tungstenite::connect_async_with_config(
        request,
        Some(
            tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
                .max_message_size(Some(512 * 1024))
                .max_frame_size(Some(512 * 1024)),
        ),
        true,
    )
    .await?;
    socket
        .send(Message::Text(
            json!({"type":"authenticate","token":token})
                .to_string()
                .into(),
        ))
        .await?;
    events.try_send(Event::Status("Connected".into()))?;
    events.try_send(Event::Connected)?;
    loop {
        tokio::select! {
            message=socket.next()=>match message {
                Some(Ok(Message::Binary(bytes)))=>events.try_send(Event::Packet(bytes.to_vec())).map_err(|_|"Snapshot queue is full; reconnecting")?,
                Some(Ok(Message::Close(frame)))=>{if frame.is_some_and(|f|matches!(u16::from(f.code),4001|4004)){events.try_send(Event::Error("Session resumed elsewhere; restart to reconnect".into()))?;return Ok(());}return Err("Connection closed".into());},
                Some(Ok(_))=>{},Some(Err(e))=>return Err(e.into()),None=>return Err("Connection ended".into()),
            },
            _=tokio::time::sleep(Duration::from_millis(2))=>{
                for _ in 0..8 {match commands.try_recv(){
                    Ok(Command::Input(bytes))=>{let text=String::from_utf8(bytes)?;tokio::time::timeout(Duration::from_secs(2),socket.send(Message::Text(text.into()))).await??;},
                    Ok(Command::Control(action))=>{let result=body(client.post(config.origin.join("api/control")?).bearer_auth(&token).json(&action).send().await?).await;if let Err(e)=result{let _=events.try_send(Event::Status(e.to_string()));}},
                    Ok(Command::Driver(driver))=>{let result=body(client.post(config.origin.join("api/driver")?).bearer_auth(&token).json(&json!({"driver":driver})).send().await?).await;if let Err(e)=result{let _=events.try_send(Event::Status(e.to_string()));}},
                    Ok(Command::Leave)=>{let _=client.post(config.origin.join("api/leave")?).bearer_auth(&token).json(&json!({})).send().await;let _=socket.close(None).await;return Ok(());},
                    Ok(Command::Afk(afk))=>{
                        if !afk{continue;}
                        let response=client.post(config.origin.join("api/afk")?).bearer_auth(&token).json(&json!({"afk":true})).send().await?;
                        let age=response.cookies().find(|c|c.name()=="wild-wheels-session").and_then(|c|c.max_age()).map(|d|d.as_secs()).unwrap_or(0);
                        let reply=body(response).await?;
                        let resumed=reply["token"].as_str().ok_or("AFK response missing session")?;
                        store.remember(origin,Identity{token:resumed.into(),expires:now()+age})?;
                        let _=socket.close(None).await;events.try_send(Event::Status("Sitting out".into()))?;
                        loop {match commands.try_recv(){
                            Ok(Command::Afk(false))=>break,
                            Ok(Command::Leave)=>{let _=client.post(config.origin.join("api/leave")?).bearer_auth(resumed).json(&json!({})).send().await;return Ok(());},
                            Ok(Command::Stop)|Err(crossbeam_channel::TryRecvError::Disconnected)=>return Ok(()),
                            _=>{},
                        }tokio::time::sleep(Duration::from_millis(20)).await;}
                        return Err("Returning from AFK".into());
                    },
                    Ok(Command::Stop)|Err(crossbeam_channel::TryRecvError::Disconnected)=>{let _=socket.close(None).await;return Ok(());},
                    Err(crossbeam_channel::TryRecvError::Empty)=>break,
                }}
            }
        }
    }
}
